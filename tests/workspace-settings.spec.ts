import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CommonspaceRoutingProvider,
	CredentialSource,
} from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createService(): Promise<{
	root: string;
	service: CommonspaceHostService;
}> {
	const root = await mkdtemp(join(tmpdir(), "commonspace-workspace-settings-"));
	roots.push(root);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: async () => [] },
	);
	await service.initialize();
	return { root, service };
}

describe("workspace settings", () => {
	it("keeps versioned Jev credentials private across restart, preservation, clearing and disabling", async () => {
		const { root, service } = await createService();
		const text = {
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "text-writer",
		} as const;
		await service.updateRoutingConfiguration({
			...text,
			jev: { model: "jev-1.13.0", apiKey: "synthetic-jev-secret" },
		});
		expect(service.routing()).toMatchObject({
			jev: {
				model: "jev-1.13.0",
				apiKeyConfigured: true,
				enabled: true,
				apiKeySource: CredentialSource.Saved,
			},
		});
		expect((await service.diagnostics()).inference).toMatchObject({
			location: "remote",
			configured: true,
		});
		expect(JSON.stringify(await service.bootstrap())).not.toContain(
			"synthetic-jev-secret",
		);
		const persisted = JSON.parse(
			await readFile(join(root, "routing.json"), "utf8"),
		);
		expect(persisted.jev).toEqual({
			version: 2,
			enabled: true,
			model: "jev-1.13.0",
			apiKey: "synthetic-jev-secret",
		});
		await service.close();
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await restarted.initialize();
		expect(restarted.routing()).toMatchObject({
			jev: { apiKeyConfigured: true },
		});
		await restarted.updateRoutingConfiguration({
			...text,
			jev: { model: "jev-latest" },
		});
		expect(restarted.routing()).toMatchObject({
			jev: { apiKeyConfigured: true },
		});
		await restarted.updateRoutingConfiguration({
			...text,
			jev: { model: "jev-latest", apiKey: null },
		});
		expect(
			JSON.parse(await readFile(join(root, "routing.json"), "utf8")).jev.apiKey,
		).toBeUndefined();
		await restarted.updateRoutingConfiguration({ ...text, jev: null });
		expect(restarted.routing()).toMatchObject({ jev: { enabled: false } });
		await restarted.close();
	});
	it("validates an unsaved routing candidate without changing durable settings", async () => {
		const { root, service } = await createService();
		const before = service.routing();

		const inference = service.validateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "candidate-model",
			baseUrl: "https://example.test/v1/",
			apiKey: "candidate-secret",
		});

		expect(inference).toMatchObject({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			location: "remote",
			configured: true,
		});
		expect(service.routing()).toEqual(before);
		await expect(
			readFile(join(root, "routing.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
