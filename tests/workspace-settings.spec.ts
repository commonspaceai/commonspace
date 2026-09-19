import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
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
		{ discoverAgents: discoverTestHarnesses },
	);
	services.push(service);
	await service.initialize();
	return { root, service };
}

describe("workspace settings", () => {
	it("persists only the selected harness agent across restart", async () => {
		const { root, service } = await createService();
		await addTestHarness(service, "codex");

		await expect(
			service.updateRoutingConfiguration({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "codex",
			}),
		).resolves.toEqual({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		expect((await service.diagnostics()).inference).toMatchObject({
			provider: CommonspaceRoutingProvider.Harness,
			location: "runtime-managed",
			configured: true,
		});
		expect(
			JSON.parse(await readFile(join(root, "routing.json"), "utf8")),
		).toEqual({
			version: 3,
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		expect((await stat(join(root, "routing.json"))).mode & 0o777).toBe(0o600);

		await service.close();
		services.splice(services.indexOf(service), 1);
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses },
		);
		services.push(restarted);
		await restarted.initialize();
		expect(restarted.routing()).toEqual({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
	});

	it("validates an added inference agent without changing durable settings", async () => {
		const { root, service } = await createService();
		await addTestHarness(service, "codex");
		const before = service.routing();

		const inference = service.validateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});

		expect(inference).toMatchObject({
			provider: CommonspaceRoutingProvider.Harness,
			location: "runtime-managed",
			configured: true,
		});
		expect(service.routing()).toEqual(before);
		await expect(
			readFile(join(root, "routing.json"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects an agent that has not been added to the workspace", async () => {
		const { service } = await createService();
		await expect(
			service.updateRoutingConfiguration({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "codex",
			}),
		).rejects.toThrow("Inference agent must be a configured agent");
	});
});
