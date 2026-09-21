import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, expect, it } from "vitest";
import { startCommonspaceServer } from "../server/src/index.ts";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

const services: CommonspaceHostService[] = [];
const roots: string[] = [];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function loadConfiguration(saved?: string) {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-configuration-audit-"),
	);
	roots.push(root);
	if (saved !== undefined) await writeFile(join(root, "routing.json"), saved);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: async () => [] },
	);
	services.push(service);
	await service.initialize();
	return { root, service };
}

it.each([
	"not JSON",
	JSON.stringify({
		version: 2,
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "old-agent",
	}),
	JSON.stringify({ provider: "removed-provider", secret: "discard-me" }),
	JSON.stringify({
		version: 3,
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "missing-agent",
	}),
])(
	"removes unsupported or unavailable inference configuration immediately (%s)",
	async (saved) => {
		const { root, service } = await loadConfiguration(saved);
		expect(service.routing().provider).toBe(
			CommonspaceRoutingProvider.Unconfigured,
		);
		expect((await service.diagnostics()).inference.configured).toBe(false);
		await expect(
			readFile(join(root, "routing.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	},
);

it("loads an exact current inference record for an Agent in the workspace", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-configuration-current-"),
	);
	roots.push(root);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: discoverTestHarnesses },
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	await service.updateRoutingConfiguration({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "codex",
	});

	const restarted = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: async () => [] },
	);
	services.push(restarted);
	await restarted.initialize();
	expect(restarted.routing()).toEqual({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "codex",
	});
});

it("clears inference when its Agent is removed and does not resurrect it", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-configuration-agent-removal-"),
	);
	roots.push(root);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: discoverTestHarnesses },
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	await service.updateRoutingConfiguration({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "codex",
	});

	await service.mutate({ action: "remove-agent", agentId: "codex" });
	expect(service.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
	await expect(
		readFile(join(root, "routing.json"), "utf8"),
	).rejects.toMatchObject({ code: "ENOENT" });

	await addTestHarness(service, "codex", "Review Bot");
	expect(service.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);

	const restarted = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: async () => [] },
	);
	services.push(restarted);
	await restarted.initialize();
	expect(restarted.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
});

it("serializes an inference save with removal of that Agent", async () => {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-configuration-concurrent-removal-"),
	);
	roots.push(root);
	const persistenceStarted = deferred<void>();
	const releasePersistence = deferred<void>();
	let pauseHarnessWrite = false;
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			beforePersistRoutingConfiguration: async (configuration) => {
				if (
					pauseHarnessWrite &&
					configuration.provider === CommonspaceRoutingProvider.Harness
				) {
					pauseHarnessWrite = false;
					persistenceStarted.resolve(undefined);
					await releasePersistence.promise;
				}
			},
		},
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	await service.updateRoutingConfiguration({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "codex",
	});

	pauseHarnessWrite = true;
	const saving = service.updateRoutingConfiguration({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "codex",
	});
	await persistenceStarted.promise;
	const removing = service.mutate({
		action: "remove-agent",
		agentId: "codex",
	});
	releasePersistence.resolve(undefined);
	await Promise.all([saving, removing]);

	expect(service.snapshot().agents).toEqual([]);
	expect(service.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
	await expect(
		readFile(join(root, "routing.json"), "utf8"),
	).rejects.toMatchObject({ code: "ENOENT" });
});

it("saves run defaults independently while saved inference is discarded", async () => {
	const { service } = await loadConfiguration("broken configuration");
	await service.mutate({
		action: "set-defaults",
		maxAgentsPerTurn: 2,
		memoryThreads: 6,
	});
	expect(service.snapshot().defaults).toEqual({
		maxAgentsPerTurn: 2,
		memoryThreads: 6,
	});
	expect(service.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
});

it.each([0, 9, 1.5])(
	"rejects an invalid agent limit instead of silently rewriting %s",
	async (maxAgentsPerTurn) => {
		const { service } = await loadConfiguration();
		const before = service.snapshot().defaults;
		await expect(
			service.mutate({ action: "set-defaults", maxAgentsPerTurn }),
		).rejects.toThrow("must be an integer");
		expect(service.snapshot().defaults).toEqual(before);
	},
);

it("removes current-looking records with unknown fields", async () => {
	const { root, service } = await loadConfiguration(
		JSON.stringify({
			version: 3,
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "agent",
			unexpected: true,
		}),
	);
	expect(service.routing().provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
	await expect(
		readFile(join(root, "routing.json"), "utf8"),
	).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects removed providers and unknown fields at the API boundary", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-configuration-api-"));
	roots.push(root);
	const running = await startCommonspaceServer({
		root,
		port: 0,
		dependencies: { discoverAgents: async () => [] },
		logger: { warn: () => undefined, info: () => undefined },
	});
	try {
		const before = running.service.routing();
		for (const body of [
			{ provider: "removed-provider", model: "removed-model" },
			{
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "missing-agent",
				unexpected: true,
			},
		]) {
			for (const [method, path] of [
				["PUT", "/api/routing"],
				["POST", "/api/routing/validate"],
			] as const) {
				const response = await fetch(`${running.url}${path}`, {
					method,
					headers: { origin: running.url, "content-type": "application/json" },
					body: JSON.stringify(body),
				});
				expect(response.status).toBe(400);
				expect(running.service.routing()).toEqual(before);
			}
		}
	} finally {
		await running.close();
	}
});
