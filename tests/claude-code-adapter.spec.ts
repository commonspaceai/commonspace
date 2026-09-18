// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addDiscoveredAgent, createInitialState } from "../server/src/state.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const fixturePath = fileURLToPath(
	new URL("./fixtures/fake-acp-agent.mjs", import.meta.url),
);

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createService(root?: string) {
	const directory =
		root ?? (await mkdtemp(join(tmpdir(), "commonspace-claude-adapter-")));
	if (root === undefined) roots.push(directory);
	const service = new CommonspaceHostService(
		{},
		{
			root: directory,
			hermesPath: join(directory, "missing-hermes"),
			codexPath: join(directory, "missing-codex"),
			codexAcpCommand: join(directory, "must-not-launch-codex"),
			claudeCodePath: process.execPath,
			claudeCodeAcpCommand: process.execPath,
			claudeCodeAcpArgs: [fixturePath],
		},
	);
	services.push(service);
	await service.initialize();
	return { service, root: directory };
}

describe("Claude Code adapter", () => {
	it("does not offer a missing CLI", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-absent-claude-"));
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root, claudeCodePath: join(root, "missing-claude") },
		);
		services.push(service);
		await service.initialize();
		expect(
			(await service.discoverAgents("claude-code")).discoveredAgents,
		).toEqual([]);
	});

	it("rejects fabricated Claude identities and drops malformed persisted bindings during migration", async () => {
		const profile = {
			id: "claude-code",
			displayName: "Claude Code",
			adapter: "claude-code" as const,
			model: null,
			status: "stopped" as const,
		};
		expect(() =>
			addDiscoveredAgent(createInitialState(), {
				...profile,
				nativeProfile: "invented",
			}),
		).toThrow("invalid discovered Claude Code identity");
		expect(() =>
			addDiscoveredAgent(createInitialState(), { ...profile, id: "invented" }),
		).toThrow("invalid discovered Claude Code identity");
		const { service, root } = await createService();
		await service.discoverAgents("claude-code");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "claude-code",
			adapter: "claude-code",
		});
		const state = service.snapshot();
		await service.close();
		const valid = mustExist(state.agents[0]);
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				...state,
				version: 27,
				agents: [
					{ ...valid, id: "invented" },
					{ ...valid, nativeProfile: "invented" },
					{ ...valid, displayName: "Reviewer" },
				],
			}),
		);
		const { service: restarted } = await createService(root);
		expect(restarted.snapshot().version).toBe(30);
		expect(restarted.snapshot().agents).toMatchObject([
			{ id: "claude-code", adapter: "claude-code", displayName: "Reviewer" },
		]);
		expect(restarted.snapshot().agents).toHaveLength(1);
	});

	it("preserves renamed identity and emitted activity through a private archive round trip", async () => {
		const { service } = await createService();
		vi.stubEnv("FAKE_ACP_TRACE", "1");
		await service.discoverAgents("claude-code");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "claude-code",
			adapter: "claude-code",
		});
		await service.mutate({
			action: "update-agent-profile",
			agentId: "claude-code",
			displayName: "Reviewer",
		});
		await service.send({
			conversation: { kind: "dm", id: "claude-code" },
			text: "Review this.",
		});
		await service.whenIdle();
		const archive = await service.exportWorkspace();
		const { service: imported } = await createService();
		await imported.importWorkspace(archive, {});
		expect(imported.snapshot().agents).toMatchObject([
			{ id: "claude-code", adapter: "claude-code", displayName: "Reviewer" },
		]);
		const reply = imported
			.snapshot()
			.messages["dm:claude-code"]?.find(
				(message) => message.authorType === "agent",
			);
		expect(reply?.trace).toMatchObject({
			adapter: "claude-code",
			entries: expect.any(Array),
		});
		expect(imported.snapshot().agentSessions).toEqual({});
		expect(JSON.stringify(archive)).not.toContain(
			"123e4567-e89b-42d3-a456-426614174000",
		);
	});

	it("keeps the selected harness authoritative when native IDs collide", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-colliding-harness-"),
		);
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async (adapter) => [
					{
						id: "claude-code",
						displayName: "Claude Code",
						adapter,
						model: null,
						status: "stopped",
					},
				],
			},
		);
		services.push(service);
		await service.initialize();
		await service.discoverAgents("hermes");
		await service.discoverAgents("claude-code");
		await expect(
			service.mutate({
				action: "add-discovered-agent",
				agentId: "claude-code",
			}),
		).rejects.toThrow("ambiguous discovered agent");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "claude-code",
			adapter: "claude-code",
		});
		expect(service.snapshot().agents).toMatchObject([
			{ id: "claude-code", adapter: "claude-code" },
		]);
	});

	it("discovers only on request, persists the native identity, and reports readiness separately", async () => {
		const { service, root } = await createService();
		expect((await service.bootstrap()).discoveredAgents).toEqual([]);
		expect(service.snapshot().agents).toEqual([]);
		const discovery = await service.discoverAgents("claude-code");
		expect(
			discovery.discoveredAgents.map(({ id, adapter }) => ({ id, adapter })),
		).toEqual([{ id: "claude-code", adapter: "claude-code" }]);
		expect(service.snapshot().agents).toEqual([]);
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "claude-code",
		});
		const diagnostics = await service.diagnostics();
		expect(
			diagnostics.harnesses.find(({ adapter }) => adapter === "claude-code"),
		).toMatchObject({
			installed: true,
			rostered: true,
			runReadiness: "unknown",
		});
		await service.close();
		const { service: restarted } = await createService(root);
		expect(restarted.snapshot().agents).toMatchObject([
			{ id: "claude-code", adapter: "claude-code", displayName: "Claude Code" },
		]);
	});

	it("uses its own runtime, resumes after restart, keeps session references private, and resets on /new", async () => {
		const { service, root } = await createService();
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		await service.discoverAgents("claude-code");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "claude-code",
		});
		const conversation = { kind: "dm" as const, id: "claude-code" };
		await service.send({ conversation, text: "Remember the orange kite." });
		await service.whenIdle();
		const session =
			service.snapshot().agentSessions["claude-code"]?.["Bot Chat"];
		expect(session).toEqual(expect.any(String));
		expect(JSON.stringify(await service.bootstrap())).not.toContain(
			mustExist(session),
		);
		await service.close();
		const { service: restarted } = await createService(root);
		await restarted.send({ conversation, text: "Continue." });
		await restarted.whenIdle();
		expect(
			restarted.snapshot().agentSessions["claude-code"]?.["Bot Chat"],
		).toBe(session);
		expect(
			(await restarted.bootstrap()).state.messages["dm:claude-code"]?.filter(
				(message) => message.authorType === "agent",
			),
		).toHaveLength(2);
		await restarted.mutate({ action: "reset-dm", agentId: "claude-code" });
		vi.stubEnv("FAKE_ACP_SESSION_ID", "123e4567-e89b-42d3-a456-426614174001");
		await restarted.send({ conversation, text: "Fresh context." });
		await restarted.whenIdle();
		expect(
			Object.values(restarted.snapshot().agentSessions["claude-code"] ?? {}),
		).toContain("123e4567-e89b-42d3-a456-426614174001");
		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames
				.filter((frame) => frame.method === "session/load")
				.map((frame) => frame.params.sessionId),
		).toEqual([session]);
		expect(
			frames.filter((frame) => frame.method === "session/new"),
		).toHaveLength(2);
	});
});
