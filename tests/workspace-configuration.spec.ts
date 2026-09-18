import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CommonspaceReasoning,
	CommonspaceRoutingProvider,
} from "@commonspace/shared";
import { afterEach, expect, it } from "vitest";
import { startCommonspaceServer } from "../server/src/index.ts";
import { CommonspaceHostService } from "../server/src/service.ts";

const services: CommonspaceHostService[] = [];
const roots: string[] = [];
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
	return service;
}

it.each([
	undefined,
	"not JSON",
	JSON.stringify({
		provider: CommonspaceRoutingProvider.OpenAiCompatible,
		model: "router",
		baseUrl: "broken://endpoint",
		apiKey: "synthetic-other-provider-key",
	}),
	JSON.stringify({
		provider: CommonspaceRoutingProvider.OpenAiCompatible,
		model: "router",
		baseUrl: "https://example.test/v1",
		jev: { version: 99, model: "unknown" },
	}),
])(
	"keeps unavailable saved routing unavailable instead of selecting another provider (%s)",
	async (saved) => {
		const service = await loadConfiguration(saved);
		expect(service.routing().provider).toBe("unconfigured");
		expect((await service.diagnostics()).inference.configured).toBe(false);
	},
);

it("retains a saved Jev credential when routing is disabled and re-enabled", async () => {
	const service = await loadConfiguration();
	const text = {
		provider: CommonspaceRoutingProvider.OpenAiCompatible,
		model: "router",
		baseUrl: "https://example.test/v1",
	} as const;
	await service.updateRoutingConfiguration({
		...text,
		jev: { model: "jev-1.13.0", apiKey: "synthetic-jev-key" },
	});
	await service.updateRoutingConfiguration({ ...text, jev: null });
	await service.updateRoutingConfiguration({
		...text,
		jev: { model: "jev-1.13.0" },
	});
	expect(service.routing()).toMatchObject({
		jev: { enabled: true, apiKeyConfigured: true },
	});
});

it("saves run defaults independently while a saved router is invalid", async () => {
	const service = await loadConfiguration("broken configuration");
	await service.mutate({
		action: "set-defaults",
		model: null,
		reasoning: CommonspaceReasoning.Native,
		maxAgentsPerTurn: 2,
		memoryThreads: 6,
	});
	expect(service.snapshot().defaults).toEqual({
		model: null,
		reasoning: CommonspaceReasoning.Native,
		maxAgentsPerTurn: 2,
		memoryThreads: 6,
	});
	expect(service.routing()).toMatchObject({
		provider: CommonspaceRoutingProvider.Unconfigured,
		reason: "invalid",
	});
});
it.each([0, 9, 1.5])(
	"rejects an invalid agent limit instead of silently rewriting %s",
	async (maxAgentsPerTurn) => {
		const service = await loadConfiguration();
		const before = service.snapshot().defaults;
		await expect(
			service.mutate({ action: "set-defaults", maxAgentsPerTurn }),
		).rejects.toThrow("must be an integer");
		expect(service.snapshot().defaults).toEqual(before);
	},
);

it.each([
	{ apiKeey: null },
	{ harnessAgentId: "wrong-provider-field" },
	{ jev: { version: 2, enabled: true, model: "jev-1.13.0", apiKeey: null } },
])("rejects unknown fields in current saved routing: %j", async (extra) => {
	const service = await loadConfiguration(
		JSON.stringify({
			version: 2,
			provider: "openai-compatible",
			model: "router",
			baseUrl: "https://example.test/v1",
			...extra,
		}),
	);
	expect(service.routing()).toMatchObject({
		provider: "unconfigured",
		reason: "invalid",
	});
});

it("rejects misspelled credential updates before saving or validating", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-configuration-api-"));
	roots.push(root);
	const running = await startCommonspaceServer({
		root,
		port: 0,
		dependencies: { discoverAgents: async () => [] },
		logger: { warn: () => undefined, info: () => undefined },
	});
	try {
		await running.service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "router",
			baseUrl: "https://example.test/v1",
			apiKey: "synthetic-key",
		});
		const before = running.service.routing();
		for (const body of [
			{ provider: "openai-compatible", model: "changed", apiKeey: null },
			{
				provider: "openai-compatible",
				model: "changed",
				jev: { model: "jev-1.13.0", apiKeey: null },
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
