import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { discoverTestHarnesses } from "./test-harnesses.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("runtime diagnostics", () => {
	it("reports harness discovery, recorded history, and inference data flow without paths or secrets", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-diagnostics-"));
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Done." }),
			},
		);
		await service.initialize();
		await service.discoverAgents("codex");
		await service.mutate({ action: "add-discovered-agent", agentId: "codex" });
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		const diagnostics = await service.diagnostics();

		expect(diagnostics).toMatchObject({
			service: {
				status: "ready",
				stateVersion: expect.any(Number),
				storage: "ready",
				projectlessWorkspace: "ready",
			},
			inference: {
				provider: CommonspaceRoutingProvider.Harness,
				location: "runtime-managed",
				configured: true,
				sends: [
					"message text",
					"Agent labels",
					"Project labels",
					"shared context",
					"routing corrections",
				],
			},
			harnesses: expect.arrayContaining([
				{
					adapter: "codex",
					installed: true,
					rostered: true,
					recordedRunStatus: "no-recorded-runs",
					recovery: expect.any(String),
				},
				{
					adapter: "hermes",
					installed: true,
					rostered: false,
					recordedRunStatus: "no-recorded-runs",
					recovery: expect.any(String),
				},
			]),
		});
		expect(JSON.stringify(diagnostics)).not.toContain(root);
		await service.close();
	});
});
