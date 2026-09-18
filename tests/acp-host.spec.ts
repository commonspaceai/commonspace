import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CommonspaceHostConfig,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"fake-acp-agent.mjs",
);

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

function acpConfig(root: string): CommonspaceHostConfig {
	return {
		root,
		codexAcpCommand: process.execPath,
		codexAcpArgs: [fixturePath],
	};
}

describe("Commonspace ACP host path", () => {
	it("launches a named Hermes agent with its native profile", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-hermes-profile-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_CAPTURE_ENV", "1");
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			},
			{
				discoverAgents: async () => [
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes",
						model: "gpt-test",
						status: "stopped",
					},
				],
			},
		);
		await service.initialize();
		await service.discoverAgents("hermes");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "frontend",
		});

		await service.send({
			conversation: { kind: "dm", id: "frontend" },
			text: "Inspect the UI.",
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(frames.find((frame) => frame.event === "environment")?.argv).toEqual(
			["-p", "frontend", "acp"],
		);
	});

	it("replaces a silent persisted Hermes session and retries the prompt once", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-hermes-silent-session-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		const discoverAgents = async () => [
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "gpt-test",
				status: "stopped" as const,
			},
		];
		const config: CommonspaceHostConfig = {
			root,
			hermesAcpCommand: process.execPath,
			hermesAcpArgs: [fixturePath],
		};
		const initial = new CommonspaceHostService({}, config, { discoverAgents });
		await initial.initialize();
		await initial.discoverAgents("hermes");
		await initial.mutate({
			action: "add-discovered-agent",
			agentId: "frontend",
		});
		await initial.send({
			conversation: { kind: "dm", id: "frontend" },
			text: "Create native state.",
		});
		await initial.whenIdle();
		await initial.close();

		vi.stubEnv("FAKE_ACP_EMPTY_AFTER_LOAD", "1");
		const restarted = new CommonspaceHostService({}, config, {
			discoverAgents,
		});
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "dm", id: "frontend" },
			text: "Continue after stale native state.",
		});
		await restarted.whenIdle();
		expect(restarted.snapshot().messages["dm:frontend"]?.at(-1)?.text).toBe(
			"Echo: Continue after stale native state.",
		);
		await restarted.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.filter((frame) => frame.method === "session/load"),
		).toHaveLength(1);
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(2);
	});

	it("delivers general files as ACP resource links", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-file-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Read the attached notes.",
			files: [
				{
					name: "notes.txt",
					mimeType: "text/plain",
					data: Buffer.from("notes").toString("base64"),
				},
			],
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const prompt = frames.find((frame) => frame.method === "session/prompt")
			?.params.prompt;
		expect(prompt).toEqual([
			{ type: "text", text: "Read the attached notes." },
			{
				type: "resource_link",
				name: "notes.txt",
				uri: expect.stringMatching(/^file:\/\//u),
				mimeType: "text/plain",
				size: 5,
			},
		]);
		expect(JSON.stringify(await service.bootstrap())).not.toContain(
			prompt[1].uri,
		);
	});

	it("imports an ACP agent resource link as a durable file attachment", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-generated-file-"),
		);
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const generated = join(workspace, "report.txt");
		await writeFile(generated, "generated report");
		vi.stubEnv("FAKE_ACP_RESOURCE_URI", pathToFileURL(generated).href);
		vi.stubEnv("FAKE_ACP_RESOURCE_NAME", "report.txt");
		vi.stubEnv("FAKE_ACP_RESOURCE_MIME", "text/plain");
		const service = new CommonspaceHostService(
			{},
			{ ...acpConfig(root), defaultCwd: workspace },
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create the report.",
		});
		await service.whenIdle();

		const reply = service
			.snapshot()
			.messages["dm:codex"]?.find((message) => message.authorType === "agent");
		const file = reply?.files?.[0];
		expect(file).toMatchObject({
			name: "report.txt",
			mimeType: "text/plain",
			size: 16,
		});
		await expect(
			service.readFileAttachment(mustExist(file).id),
		).resolves.toMatchObject({
			data: Buffer.from("generated report"),
		});
		expect(JSON.stringify(await service.bootstrap())).not.toContain(generated);
		expect(JSON.stringify(await service.bootstrap())).not.toContain(
			pathToFileURL(generated).href,
		);
		await service.close();
	});

	it("rejects a credential-bearing ACP source hidden behind a safe display name", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-credential-source-"),
		);
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const generated = join(workspace, ".env");
		await writeFile(generated, "SYNTHETIC_TOKEN=not-a-secret");
		vi.stubEnv("FAKE_ACP_RESOURCE_URI", pathToFileURL(generated).href);
		vi.stubEnv("FAKE_ACP_RESOURCE_NAME", "report.txt");
		vi.stubEnv("FAKE_ACP_RESOURCE_MIME", "text/plain");
		const service = new CommonspaceHostService(
			{},
			{ ...acpConfig(root), defaultCwd: workspace },
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create the report.",
		});
		await service.whenIdle();

		const reply = service
			.snapshot()
			.messages["dm:codex"]?.find((message) => message.authorType === "agent");
		expect(reply?.files).toBeUndefined();
		await service.close();
	});

	it.each([
		{
			caseName: "prohibited display name",
			resourceName: "report.txt",
			targetName: "report.txt",
			displayName: ".env.local",
			outside: false,
		},
		{
			caseName: "credential-bearing resolved symlink target",
			resourceName: "report.txt",
			targetName: "credentials.json",
			displayName: "report.txt",
			outside: false,
		},
		{
			caseName: "credential-bearing symlink source name",
			resourceName: "id_ed25519",
			targetName: "report.txt",
			displayName: "report.txt",
			outside: false,
		},
		{
			caseName: "symlink target outside the allowed root",
			resourceName: "report.txt",
			targetName: "outside.txt",
			displayName: "report.txt",
			outside: true,
		},
	] as const)("rejects ACP resource with $caseName", async (fixture) => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-file-guard-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const target = join(fixture.outside ? root : workspace, fixture.targetName);
		await writeFile(target, "synthetic fixture bytes");
		const resource = join(workspace, fixture.resourceName);
		if (resource !== target) await symlink(target, resource);
		vi.stubEnv("FAKE_ACP_RESOURCE_URI", pathToFileURL(resource).href);
		vi.stubEnv("FAKE_ACP_RESOURCE_NAME", fixture.displayName);
		vi.stubEnv("FAKE_ACP_RESOURCE_MIME", "text/plain");
		const service = new CommonspaceHostService(
			{},
			{ ...acpConfig(root), defaultCwd: workspace },
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create the report.",
		});
		await service.whenIdle();

		const reply = service
			.snapshot()
			.messages["dm:codex"]?.find((message) => message.authorType === "agent");
		expect(reply?.files).toBeUndefined();
		expect(await readdir(join(root, "attachments"))).toEqual([]);
		await service.close();
	});

	it("does not include an invalid ACP resource path in warnings", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-file-warning-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const missing = join(workspace, "private-missing-report.txt");
		vi.stubEnv("FAKE_ACP_RESOURCE_URI", pathToFileURL(missing).href);
		vi.stubEnv("FAKE_ACP_RESOURCE_NAME", "report.txt");
		vi.stubEnv("FAKE_ACP_RESOURCE_MIME", "text/plain");
		const warn = vi.fn();
		const service = new CommonspaceHostService(
			{ warn },
			{ ...acpConfig(root), defaultCwd: workspace },
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create the report.",
		});
		await service.whenIdle();

		const reply = service
			.snapshot()
			.messages["dm:codex"]?.find((message) => message.authorType === "agent");
		expect(reply?.files).toBeUndefined();
		expect(await readdir(join(root, "attachments"))).toEqual([]);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(missing);
		await service.close();
	});

	it("returns the exact Commonspace-selected ACP permission option", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-permission-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_PERMISSION_REQUEST", "1");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Request permission.",
		});
		await vi.waitFor(() => {
			expect(service.snapshot().permissions[0]?.status).toBe("pending");
		});
		await service.respondPermission(
			mustExist(service.snapshot().permissions[0]).id,
			"allow",
		);
		await service.whenIdle();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(frames).toContainEqual({
			jsonrpc: "2.0",
			id: "permission-1",
			result: { outcome: { outcome: "selected", optionId: "allow" } },
		});
		await service.close();
	});

	it("delivers delta-only prompts, reloads persisted sessions, and preserves hard DM resets", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-host-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_REPLAY_ON_LOAD", "1");

		const service = new CommonspaceHostService(
			{},
			{
				...acpConfig(root),
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Only the first delta.",
		});
		await service.whenIdle();

		expect(
			service.snapshot().messages["dm:codex"]?.map((message) => message.text),
		).toEqual(["Only the first delta.", "Echo: Only the first delta."]);
		expect(service.snapshot().agentSessions["codex"]?.["Bot Chat"]).toBe(
			"123e4567-e89b-42d3-a456-426614174000",
		);
		await service.close();

		const restarted = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Only the resumed delta.",
		});
		await restarted.whenIdle();
		expect(restarted.snapshot().messages["dm:codex"]?.at(-1)?.text).toBe(
			"Echo: Only the resumed delta.",
		);

		await restarted.mutate({ action: "reset-dm", agentId: "codex" });
		await restarted.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Only the fresh delta.",
		});
		await restarted.whenIdle();
		expect(
			restarted.snapshot().messages["dm:codex"]?.map((message) => message.text),
		).toEqual([
			"Only the first delta.",
			"Echo: Only the first delta.",
			"Only the resumed delta.",
			"Echo: Only the resumed delta.",
			"New session started",
			"Only the fresh delta.",
			"Echo: Only the fresh delta.",
		]);
		await restarted.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames
				.filter((frame) => frame.method === "session/prompt")
				.map((frame) => frame.params.prompt),
		).toEqual([
			[{ type: "text", text: "Only the first delta." }],
			[{ type: "text", text: "Only the resumed delta." }],
			[{ type: "text", text: "Only the fresh delta." }],
		]);
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(2);
		expect(
			frames.filter((frame) => frame.method === "session/load"),
		).toHaveLength(1);
	});

	it.each(["codex", "hermes"] as const)(
		"persists a sanitized %s activity trace on the reply",
		async (adapter) => {
			const root = await mkdtemp(
				join(tmpdir(), `commonspace-${adapter}-trace-`),
			);
			roots.push(root);
			vi.stubEnv("FAKE_ACP_TRACE", "1");
			vi.stubEnv(
				"FAKE_ACP_TRACE_PATH",
				join(root, "workspace", "package.json"),
			);
			const config: CommonspaceHostConfig =
				adapter === "hermes"
					? {
							root,
							hermesAcpCommand: process.execPath,
							hermesAcpArgs: [fixturePath],
						}
					: acpConfig(root);
			const agentId = adapter;
			const service = new CommonspaceHostService({}, config, {
				discoverAgents: discoverTestHarnesses,
			});

			await service.initialize();
			await addTestHarness(service, adapter);
			await service.send({
				conversation: { kind: "dm", id: agentId },
				text: "Keep an audit trail.",
			});
			await service.whenIdle();

			const reply = service.snapshot().messages[`dm:${agentId}`]?.at(-1);
			expect(reply).toMatchObject({
				authorType: "agent",
				trace: {
					adapter,
					startedAt: expect.any(String),
					completedAt: expect.any(String),
					entries: expect.arrayContaining([
						expect.objectContaining({
							type: "reasoning",
							text: "Inspecting the workspace. Choosing the smallest safe change.",
						}),
						expect.objectContaining({
							type: "tool",
							id: "call-1",
							status: "completed",
							input: expect.stringMatching(
								/^\{\n {2}"path": "\[host path\](?:\/workspace)?\/package\.json"\n\}$/u,
							),
						}),
					]),
				},
			});
			expect(JSON.stringify(reply)).not.toContain(root);
			await service.close();

			const persisted = JSON.parse(
				await readFile(join(root, "state.json"), "utf8"),
			);
			expect(
				JSON.stringify(persisted.messages[`dm:${agentId}`]?.at(-1)),
			).not.toContain(root);

			const restarted = new CommonspaceHostService({}, config, {
				discoverAgents: discoverTestHarnesses,
			});
			await restarted.initialize();
			expect(
				restarted.snapshot().messages[`dm:${agentId}`]?.at(-1)?.trace,
			).toEqual(reply?.trace);
			await restarted.close();
		},
	);

	it("delivers Hermes Channel turns as exact message deltas over ACP", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-hermes-acp-delta-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_CAPTURE_ENV", "1");
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesPath: join(root, "missing-legacy-hermes"),
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			} satisfies CommonspaceHostConfig,
			{
				discoverAgents: async () => [
					{
						id: "hermes",
						displayName: "Hermes",
						adapter: "hermes",
						model: "gpt-test",
						status: "stopped",
					},
				],
				routeAgents: async (input) => ({
					agentIds: [mustExist(input.candidates[0]).id],
					reason: "Test inference selected the channel agent.",
				}),
			},
		);
		await service.initialize();
		await service.mutate({ action: "add-discovered-agent", agentId: "hermes" });
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "general",
					agentIds: ["hermes"],
				})
			).channels[0],
		);

		const initial = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Historical room message.",
		});
		const thread = mustExist(initial.thread);
		await service.whenIdle();
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			text: "is the acp finished for @@commonspace",
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const deliveredText = frames
			.filter((frame) => frame.method === "session/prompt")
			.map((frame) =>
				frame.params.prompt
					.slice(0, 1)
					.map((part: { text?: string }) => part.text ?? "")
					.join(""),
			);
		expect(deliveredText).toEqual([
			"Historical room message.",
			"is the acp finished for @@commonspace",
		]);
		const participantBlocks = frames
			.filter((frame) => frame.method === "session/prompt")
			.map((frame) => frame.params.prompt[1]);
		expect(participantBlocks).toHaveLength(2);
		for (const block of participantBlocks) {
			expect(block.type).toBe("text");
			expect(block.text).toContain('"name":"Hermes"');
			expect(block.text).not.toContain("Historical room message.");
		}
		expect(deliveredText.join("\n")).not.toContain("Recent room history:");
		expect(deliveredText.join("\n")).not.toContain("Execution contract:");
		expect(
			frames.filter((frame) => frame.method === "initialize"),
		).toHaveLength(1);
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(1);
		expect(frames.filter((frame) => frame.method === "session/load")).toEqual(
			[],
		);
		expect(frames.find((frame) => frame.event === "environment")).toMatchObject(
			{
				noBrowser: "1",
				argv: ["acp"],
			},
		);
	});

	it("persists and reloads opaque ACP session identifiers", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-opaque-session-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_SESSION_ID", "codex:thread/opaque-session-01");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Start opaque.",
		});
		await service.whenIdle();
		expect(service.snapshot().agentSessions["codex"]?.["Bot Chat"]).toBe(
			"codex:thread/opaque-session-01",
		);
		await service.close();

		const restarted = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Resume opaque.",
		});
		await restarted.whenIdle();
		await restarted.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.find((frame) => frame.method === "session/load")?.params.sessionId,
		).toBe("codex:thread/opaque-session-01");
	});

	it("maps ACP-advertised Codex run settings without mutating harness configuration", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-host-settings-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_SETTINGS", "1");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.mutate({
			action: "set-defaults",
			model: "gpt-test",
			reasoning: "high",
		});
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Use my settings.",
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.find((frame) => frame.method === "session/set_mode")?.params
				.modeId,
		).toBe("agent");
		expect(
			frames
				.filter((frame) => frame.method === "session/set_config_option")
				.map((frame) => frame.params),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ configId: "model", value: "gpt-test" }),
				expect.objectContaining({
					configId: "reasoning_effort",
					value: "high",
				}),
			]),
		);
	});

	it("maps the workspace model and edit approval onto native ACP controls", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-hermes-acp-settings-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_HERMES_SETTINGS", "1");
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			},
			{
				discoverAgents: async () => [
					{
						id: "hermes",
						displayName: "Hermes",
						adapter: "hermes",
						model: null,
						status: "stopped",
					},
				],
				routeAgents: async (input) => ({
					agentIds: [mustExist(input.candidates[0]).id],
					reason: "Test inference selected the channel agent.",
				}),
			},
		);
		await service.initialize();
		await service.mutate({ action: "add-discovered-agent", agentId: "hermes" });
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "general",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.mutate({
			action: "set-defaults",
			model: "openai:hermes-test",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Use native settings.",
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		// The fake Hermes session starts in accept_edits, so ACP may skip a redundant mode change.
		expect(
			frames.find((frame) => frame.method === "session/set_mode")?.params
				.modeId ?? "accept_edits",
		).toBe("accept_edits");
		expect(
			frames.find((frame) => frame.method === "session/set_model")?.params
				.modelId,
		).toBe("openai:hermes-test");
	});

	it("uses full-access ACP mode for an agent configured with full access", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-full-access-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_HERMES_SETTINGS", "1");
		vi.stubEnv("FAKE_ACP_CAPTURE_ENV", "1");
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await service.discoverAgents("hermes");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "hermes",
			fullAccess: true,
		});

		await service.send({
			conversation: { kind: "dm", id: "hermes" },
			text: "Use full access.",
		});
		await service.whenIdle();
		await service.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(frames.find((frame) => frame.event === "environment")?.argv).toEqual(
			["acp", "--accept-hooks"],
		);
		expect(
			frames.find((frame) => frame.method === "session/set_mode")?.params
				.modeId,
		).toBe("dont_ask");
	});

	it("isolates concurrent harness inference across Channels", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-inference-concurrency-"),
		);
		roots.push(root);
		vi.stubEnv("FAKE_ACP_PROMPT_DELAY_MS", "250");
		const service = new CommonspaceHostService(
			{},
			{
				...acpConfig(root),
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fixturePath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		try {
			await service.initialize();
			const harness = await addTestHarness(service, "codex", "Router");
			const worker = await addTestHarness(service, "hermes", "Worker");
			const firstChannel = mustExist(
				(
					await service.mutate({
						action: "create-channel",
						name: "first",
						agentIds: [worker.id],
					})
				).channels.at(-1),
			);
			const secondChannel = mustExist(
				(
					await service.mutate({
						action: "create-channel",
						name: "second",
						agentIds: [worker.id],
					})
				).channels.at(-1),
			);
			await service.updateRoutingConfiguration({
				provider: "harness",
				harnessAgentId: harness.id,
			});
			vi.stubEnv(
				"FAKE_ACP_INFERENCE_RESPONSE",
				JSON.stringify({
					mode: "parallel",
					assignments: [
						{
							agentId: worker.id,
							projectIds: [],
						},
					],
					confidence: 0.95,
					reason: "Route to the Channel worker.",
				}),
			);

			const accepted = await Promise.all([
				service.send({
					conversation: { kind: "channel", id: firstChannel.id },
					text: "Handle the first request.",
				}),
				service.send({
					conversation: { kind: "channel", id: secondChannel.id },
					text: "Handle the second request.",
				}),
			]);
			await service.whenIdle();

			for (const response of accepted) {
				const messages =
					service.snapshot().messages[
						`channel:${response.accepted.conversation.id}`
					] ?? [];
				expect(
					messages.find((message) => message.id === response.accepted.id)
						?.routing?.status,
				).toBe("resolved");
				expect(
					messages.some(
						(message) =>
							message.authorType === "agent" &&
							message.sourceMessageId === response.accepted.id,
					),
				).toBe(true);
			}
		} finally {
			await service.close();
		}
	});

	it.each(["initialize", "session/new"])(
		"stops during ACP %s without dispatching a prompt and permits the next turn",
		async (method) => {
			const root = await mkdtemp(join(tmpdir(), "commonspace-acp-stop-setup-"));
			roots.push(root);
			const logPath = join(root, "frames.ndjson");
			vi.stubEnv("FAKE_ACP_LOG", logPath);
			vi.stubEnv("FAKE_ACP_DELAY_METHOD", method);
			vi.stubEnv("FAKE_ACP_SETUP_DELAY_MS", "400");
			const service = new CommonspaceHostService({}, acpConfig(root), {
				discoverAgents: discoverTestHarnesses,
			});
			try {
				await service.initialize();
				await addTestHarness(service, "codex", "Review Bot");
				const sent = await service.send({
					conversation: { kind: "dm", id: "codex" },
					text: "Stop before the native prompt.",
				});
				await vi.waitFor(async () =>
					expect(await readFile(logPath, "utf8")).toContain(
						`"method":"${method}"`,
					),
				);
				vi.stubEnv("FAKE_ACP_SETUP_DELAY_MS", "0");
				await service.stopAgentRuns({ messageId: sent.accepted.id });
				await service.whenIdle();
				expect(await readFile(logPath, "utf8")).not.toContain(
					'"method":"session/prompt"',
				);
				expect(service.snapshot().messages["dm:codex"]).toEqual([
					expect.objectContaining({
						id: sent.accepted.id,
						replyStatus: "error",
						replyError: "Stopped by user.",
					}),
				]);
				await service.send({
					conversation: { kind: "dm", id: "codex" },
					text: "Next native turn.",
				});
				await service.whenIdle();
				expect(service.snapshot().messages["dm:codex"]?.at(-1)).toMatchObject({
					authorType: "agent",
					text: "Echo: Next native turn.",
				});
			} finally {
				await service.close();
			}
		},
	);

	it("cancels the active native ACP turn when a DM crosses a hard reset boundary", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-reset-cancel-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_HANG_PROMPT", "1");
		vi.stubEnv("FAKE_ACP_DELAY_CANCEL_MS", "250");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		try {
			await service.initialize();
			await addTestHarness(service, "codex", "Review Bot");
			await service.send({
				conversation: { kind: "dm", id: "codex" },
				text: "Long turn.",
			});
			await vi.waitFor(async () => {
				expect(
					(await readFile(logPath, "utf8")).includes("session/prompt"),
				).toBe(true);
			});

			await service.mutate({ action: "reset-dm", agentId: "codex" });
			expect((await readFile(logPath, "utf8")).includes("session/cancel")).toBe(
				true,
			);
			await service.whenIdle();
			expect(service.snapshot().messages["dm:codex"]).toEqual([
				expect.objectContaining({
					text: "Long turn.",
					replyStatus: "error",
					replyError: "Interrupted by /new.",
				}),
				expect.objectContaining({
					authorId: "dm-session-boundary",
					text: "New session started",
				}),
			]);
		} finally {
			await service.close();
		}
	});

	it("closes an active ACP turn without publishing a shutdown failure or leaving it running", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-shutdown-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_HANG_PROMPT", "1");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Long turn.",
		});
		await vi.waitFor(async () => {
			expect((await readFile(logPath, "utf8")).includes("session/prompt")).toBe(
				true,
			);
		});

		await expect(
			Promise.race([
				service.close().then(() => "closed"),
				new Promise((resolve) => setTimeout(() => resolve("timed-out"), 1_500)),
			]),
		).resolves.toBe("closed");
		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				authorType: "user",
				replyStatus: "error",
				replyError: "Commonspace shut down before the agent completed.",
			}),
		]);
	});

	it("keeps the ACP CLI connected until its turn finishes during a development restart", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-development-restart-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_PROMPT_DELAY_MS", "150");
		const service = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Finish across the reload request.",
		});
		await vi.waitFor(async () => {
			expect((await readFile(logPath, "utf8")).includes("session/prompt")).toBe(
				true,
			);
		});

		const drain = service.drainAndClose();
		await expect(
			Promise.race([
				drain.then(() => "closed"),
				new Promise((resolve) =>
					setTimeout(() => resolve("still-running"), 25),
				),
			]),
		).resolves.toBe("still-running");
		await drain;

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({ authorType: "user", replyStatus: "complete" }),
			expect.objectContaining({
				authorType: "agent",
				text: "Echo: Finish across the reload request.",
			}),
		]);
	});

	it("does not replace a persisted ACP session for a transient load failure", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-load-transient-"),
		);
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		const initial = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await initial.initialize();
		await addTestHarness(initial, "codex", "Review Bot");
		await initial.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create native state.",
		});
		await initial.whenIdle();
		await initial.close();

		vi.stubEnv(
			"FAKE_ACP_LOAD_ERROR",
			"authentication service temporarily unavailable",
		);
		const restarted = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Do not replace this session.",
		});
		await restarted.whenIdle();
		const state = restarted.snapshot();
		expect(state.agentSessions["codex"]?.["Bot Chat"]).toBe(
			"123e4567-e89b-42d3-a456-426614174000",
		);
		expect(state.messages["dm:codex"]?.at(-1)?.authorType).toBe("system");
		expect(state.messages["dm:codex"]?.at(-1)?.text).not.toContain(
			"123e4567-e89b-42d3-a456-426614174000",
		);
		await restarted.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(1);
		expect(
			frames.filter((frame) => frame.method === "session/load"),
		).toHaveLength(1);
	});

	it("replaces a persisted ACP session exactly once when the native session is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-load-missing-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		const initial = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await initial.initialize();
		await addTestHarness(initial, "codex", "Review Bot");
		await initial.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create native state.",
		});
		await initial.whenIdle();
		await initial.close();

		vi.stubEnv("FAKE_ACP_LOAD_ERROR", "native session not found");
		const restarted = new CommonspaceHostService({}, acpConfig(root), {
			discoverAgents: discoverTestHarnesses,
		});
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Recover once.",
		});
		await restarted.whenIdle();
		expect(restarted.snapshot().messages["dm:codex"]?.at(-1)?.text).toBe(
			"Echo: Recover once.",
		);
		await restarted.close();

		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.filter((frame) => frame.method === "session/load"),
		).toHaveLength(1);
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(2);
		expect(
			frames.filter((frame) => frame.method === "initialize"),
		).toHaveLength(3);
	});
});
