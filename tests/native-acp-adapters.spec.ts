import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertGeminiAcpVersion } from "../server/src/adapters/gemini.ts";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addDiscoveredAgent, createInitialState } from "../server/src/state.ts";

const serverRequire = createRequire(
	new URL("../server/package.json", import.meta.url),
);
const geminiCliPath = join(
	dirname(serverRequire.resolve("@google/gemini-cli/package.json")),
	"bundle/gemini.js",
);
const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const fixture = fileURLToPath(
	new URL("./fixtures/fake-acp-agent.mjs", import.meta.url),
);
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

it.each([
	{ initial: true, updated: false, modes: ["allow", "ask"] },
	{ initial: false, updated: true, modes: ["ask", "allow"] },
])(
	"applies OpenCode access policy $initial -> $updated while preserving its session",
	async ({ initial, updated, modes }) => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-opencode-policy-"));
		roots.push(root);
		const framesPath = join(root, "frames.jsonl");
		vi.stubEnv("FAKE_ACP_CAPTURE_ENV", "1");
		vi.stubEnv("FAKE_ACP_LOG", framesPath);
		vi.stubEnv("OPENCODE_PERMISSION", JSON.stringify({ "*": "ask" }));
		const service = new CommonspaceHostService(
			{},
			{
				root,
				opencodePath: process.execPath,
				opencodeAcpCommand: process.execPath,
				opencodeAcpArgs: [fixture],
			},
		);
		services.push(service);
		await service.initialize();
		await service.discoverAgents("opencode");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "opencode",
			adapter: "opencode",
			fullAccess: initial,
		});
		const conversation = { kind: "dm" as const, id: "opencode" };
		await service.send({ conversation, text: "First permission policy." });
		await service.whenIdle();
		const sessionId = service.snapshot().agentSessions.opencode?.["Bot Chat"];
		await service.mutate({
			action: "update-agent-profile",
			agentId: "opencode",
			displayName: "OpenCode",
			fullAccess: updated,
		});
		await service.send({ conversation, text: "New permission policy." });
		await service.whenIdle();
		expect(service.snapshot().agentSessions.opencode?.["Bot Chat"]).toBe(
			sessionId,
		);
		const frames = (await readFile(framesPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames
				.filter((frame) => frame.event === "environment")
				.map((frame) => JSON.parse(frame.opencodePermission)),
		).toEqual(modes.map((mode) => ({ "*": mode })));
		expect(
			frames.find((frame) => frame.method === "session/load")?.params.sessionId,
		).toBe(sessionId);
	},
);

it.each([
	{ initial: true, updated: false, initialMode: "allow" },
	{ initial: false, updated: true, initialMode: "ask" },
])(
	"invalidates admitted OpenCode work when Full access changes $initial -> $updated",
	async ({ initial, updated, initialMode }) => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-opencode-revoke-"));
		roots.push(root);
		const framesPath = join(root, "frames.jsonl");
		vi.stubEnv("FAKE_ACP_LOG", framesPath);
		vi.stubEnv("FAKE_ACP_CAPTURE_ENV", "1");
		vi.stubEnv("OPENCODE_PERMISSION", JSON.stringify({ "*": "ask" }));
		vi.stubEnv("FAKE_ACP_HANG_PROMPT", "1");
		vi.stubEnv("FAKE_ACP_SHUTDOWN_DELAY_MS", "300");
		const service = new CommonspaceHostService(
			{},
			{
				root,
				opencodePath: process.execPath,
				opencodeAcpCommand: process.execPath,
				opencodeAcpArgs: [fixture],
			},
		);
		services.push(service);
		await service.initialize();
		await service.discoverAgents("opencode");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "opencode",
			adapter: "opencode",
			fullAccess: initial,
		});
		const sent = await service.send({
			conversation: { kind: "dm", id: "opencode" },
			text: "Long-running native work.",
		});
		await vi.waitFor(async () =>
			expect(await readFile(framesPath, "utf8")).toContain(
				'"method":"session/prompt"',
			),
		);
		const queued = await service.send({
			conversation: { kind: "dm", id: "opencode" },
			text: "Follow-up under current policy.",
		});
		vi.stubEnv("FAKE_ACP_HANG_PROMPT", "0");
		await service.mutate({
			action: "update-agent-profile",
			agentId: "opencode",
			displayName: "OpenCode",
			fullAccess: updated,
		});
		await service.whenIdle();
		expect(
			service
				.snapshot()
				.messages["dm:opencode"]?.find(
					(message) => message.id === sent.accepted.id,
				),
		).toMatchObject({ replyStatus: "cancelled" });
		expect(
			service
				.snapshot()
				.messages["dm:opencode"]?.find(
					(message) => message.id === queued.accepted.id,
				),
		).toMatchObject({ replyStatus: "cancelled" });
		const frames = (await readFile(framesPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames
				.filter((frame) => frame.event === "environment")
				.map((frame) => JSON.parse(frame.opencodePermission)),
		).toEqual([{ "*": initialMode }]);
		const flushed = frames.findIndex(
			(frame) => frame.event === "native-flushed",
		);
		const replacement = frames.findIndex(
			(frame, index) =>
				frame.event === "environment" &&
				index > frames.findIndex((first) => first.event === "environment"),
		);
		expect(flushed).toBeGreaterThan(-1);
		expect(replacement).toBe(-1);
	},
);

it("does not launch a replaced Gemini identity after an asynchronous version check", async () => {
	vi.stubEnv("FAKE_ACP_VERSION", "0.43.0");
	const root = await mkdtemp(join(tmpdir(), "commonspace-gemini-authority-"));
	roots.push(root);
	const cliPath = join(root, "gemini-version.mjs");
	const probePath = join(root, "probe.txt");
	const framesPath = join(root, "frames.jsonl");
	await writeFile(
		cliPath,
		`#!${process.execPath}\nimport { writeFile } from "node:fs/promises";\nawait writeFile(process.env.FAKE_GEMINI_PROBE_LOG, "version check");\nawait new Promise(resolve => setTimeout(resolve, 400));\nconsole.log("0.43.0");\n`,
		{ mode: 0o755 },
	);
	await writeFile(framesPath, "");
	vi.stubEnv("FAKE_GEMINI_PROBE_LOG", probePath);
	vi.stubEnv("FAKE_ACP_LOG", framesPath);
	const service = new CommonspaceHostService(
		{},
		{
			root,
			geminiPath: cliPath,
			geminiAcpCommand: process.execPath,
			geminiAcpArgs: [fixture],
		},
	);
	services.push(service);
	await service.initialize();
	await service.discoverAgents("gemini");
	await service.mutate({
		action: "add-discovered-agent",
		agentId: "gemini",
		adapter: "gemini",
	});
	await rm(probePath);
	await service.send({
		conversation: { kind: "dm", id: "gemini" },
		text: "Old identity request.",
	});
	await vi.waitFor(async () =>
		expect(await readFile(probePath, "utf8")).toBe("version check"),
	);
	await service.mutate({ action: "remove-agent", agentId: "gemini" });
	await service.mutate({
		action: "add-discovered-agent",
		agentId: "gemini",
		adapter: "gemini",
	});
	await service.whenIdle();
	expect(await readFile(framesPath, "utf8")).toBe("");
	await service.send({
		conversation: { kind: "dm", id: "gemini" },
		text: "Replacement identity request.",
	});
	await service.whenIdle();
	expect(service.snapshot().messages["dm:gemini"]?.at(-1)).toMatchObject({
		authorType: "agent",
		text: "Echo: Replacement identity request.",
	});
});

describe.each([
	{ adapter: "gemini", label: "Gemini CLI" },
	{ adapter: "opencode", label: "OpenCode" },
] as const)("$label native ACP adapter", ({ adapter, label }) => {
	it("discovers explicitly, dispatches to its own runtime, and retains identity after restart", async () => {
		if (adapter === "gemini") vi.stubEnv("FAKE_ACP_VERSION", "0.43.0");
		const root = await mkdtemp(join(tmpdir(), "commonspace-native-acp-"));
		roots.push(root);
		const config = {
			root,
			geminiPath: geminiCliPath,
			geminiAcpCommand: process.execPath,
			geminiAcpArgs: [fixture],
			opencodePath: process.execPath,
			opencodeAcpCommand: process.execPath,
			opencodeAcpArgs: [fixture],
			codexAcpCommand: join(root, "must-not-use-codex"),
		};
		const service = new CommonspaceHostService({}, config);
		services.push(service);
		await service.initialize();
		expect((await service.bootstrap()).discoveredAgents).toEqual([]);
		const found = await service.discoverAgents(adapter);
		expect(found.discoveredAgents).toMatchObject([
			{ id: adapter, adapter, displayName: label },
		]);
		expect(service.snapshot().agents).toEqual([]);
		await service.mutate({
			action: "add-discovered-agent",
			agentId: adapter,
			adapter,
		});
		await service.send({
			conversation: { kind: "dm", id: adapter },
			text: "Use the selected native harness.",
		});
		await service.whenIdle();
		expect(
			service
				.snapshot()
				.messages[`dm:${adapter}`]?.some(
					(message) =>
						message.authorType === "agent" &&
						message.text === "Echo: Use the selected native harness.",
				),
		).toBe(true);
		await service.close();
		const restarted = new CommonspaceHostService({}, config);
		services.push(restarted);
		await restarted.initialize();
		expect(restarted.snapshot().agents).toMatchObject([
			{ id: adapter, adapter, displayName: label },
		]);
	});

	it("rejects invented native identities and profiles", () => {
		const profile = {
			id: adapter,
			adapter,
			displayName: label,
			model: null,
			status: "stopped" as const,
		};
		expect(() =>
			addDiscoveredAgent(createInitialState(), { ...profile, id: "invented" }),
		).toThrow("invalid discovered");
		expect(() =>
			addDiscoveredAgent(createInitialState(), {
				...profile,
				nativeProfile: "invented",
			}),
		).toThrow("invalid discovered");
	});
});

it.each([
	{ version: "0.59.0", error: "supported ACP version range" },
	{ version: "0.43.0-preview.1", error: "supported ACP version range" },
	{ version: "", error: "supported ACP version range" },
	{ version: "0.43.0", error: "Gemini CLI session reload is disabled" },
])(
	"retains accepted requests and exact sessions when Gemini $version cannot reload safely",
	async ({ version, error }) => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-gemini-version-"));
		roots.push(root);
		const cliPath = join(root, "gemini-version.mjs");
		await writeFile(
			cliPath,
			`#!${process.execPath}\nconsole.log("0.43.0");\n`,
			{ mode: 0o700 },
		);
		const framesPath = join(root, "frames.jsonl");
		vi.stubEnv("FAKE_ACP_LOG", framesPath);
		vi.stubEnv("FAKE_ACP_VERSION", "0.43.0");
		const config = {
			root,
			geminiPath: cliPath,
			geminiAcpCommand: process.execPath,
			geminiAcpArgs: [fixture],
		};
		const first = new CommonspaceHostService({}, config);
		services.push(first);
		await first.initialize();
		await first.discoverAgents("gemini");
		await first.mutate({
			action: "add-discovered-agent",
			adapter: "gemini",
			agentId: "gemini",
		});
		await first.send({
			conversation: { kind: "dm", id: "gemini" },
			text: "First accepted request.",
		});
		await first.whenIdle();
		const original = JSON.parse(
			await readFile(join(root, "state.json"), "utf8"),
		);
		expect(original.agentSessions.gemini["Bot Chat"]).toEqual(
			expect.any(String),
		);
		await first.close();
		await writeFile(framesPath, "");
		vi.stubEnv("FAKE_ACP_VERSION", version);
		const resumed = new CommonspaceHostService({}, config);
		services.push(resumed);
		await resumed.initialize();
		await resumed.send({
			conversation: { kind: "dm", id: "gemini" },
			text: "Keep this accepted request.",
		});
		await resumed.whenIdle();
		const saved = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
		expect(saved.agentSessions).toEqual(original.agentSessions);
		expect(saved.messages["dm:gemini"]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					text: "Keep this accepted request.",
					replyStatus: "failed",
					replyError: expect.stringContaining(error),
				}),
			]),
		);
		expect(await readFile(framesPath, "utf8")).not.toMatch(
			/session\/(new|load|prompt)/u,
		);
	},
);

it("blocks Gemini versions with unverified or regressed ACP history before launch", () => {
	for (const version of ["0.39.1", "0.41.2", "0.43.0"])
		expect(() => assertGeminiAcpVersion(version)).not.toThrow();
	for (const version of [
		"0.39.0",
		"0.44.1",
		"0.47.0",
		"0.58.0",
		"0.59.0",
		"0.39.00",
		"0.43.01",
		"0.59.0-preview.0",
		"unknown",
	])
		expect(() => assertGeminiAcpVersion(version)).toThrow(
			"supported ACP version range",
		);
});
