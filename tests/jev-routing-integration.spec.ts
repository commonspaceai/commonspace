import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentRunInput,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const services: CommonspaceHostService[] = [];
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	vi.unstubAllGlobals();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
const choice = (value: string, confidence = 0.95) => ({
	type: "choice",
	choice: value,
	confidence,
	probabilities: { [value]: 1 },
});
function judgments(confidence = 0.95) {
	return new Response(
		JSON.stringify({
			model: "jev-1.13.0",
			answers: { mode: choice("single"), owner: choice("codex", confidence) },
		}),
	);
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-jev-"));
	roots.push(root);
	const runs: AgentRunInput[] = [];
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async (input) => {
				runs.push(input);
				return { text: "Verified." };
			},
		},
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Backend");
	await addTestHarness(service, "hermes", "Frontend");
	const channel = mustExist(
		(
			await service.mutate({
				action: "create-channel",
				name: "routing",
				agentIds: ["codex", "hermes"],
			})
		).channels[0],
	);
	await service.updateRoutingConfiguration({
		provider: "harness",
		harnessAgentId: "codex",
		jev: { model: "jev-1.13.0", apiKey: "synthetic-secret" },
	});
	return { service, channel, runs, root };
}
describe("Jev conversation routing", () => {
	it.each(["parallel", "relay"] as const)(
		"dispatches the original request in %s mode without assignment authoring",
		async (mode) => {
			const { service, channel, runs } = await fixture();
			const request = vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							model: "jev-1.13.0",
							answers: {
								mode: choice(mode),
								first: choice("codex"),
								"needed:codex": { type: "noul", noul: 0.95 },
								"needed:hermes": { type: "noul", noul: 0.95 },
								"next:codex": choice("hermes"),
								"next:hermes": choice("end"),
							},
						}),
					),
			);
			vi.stubGlobal("fetch", request);
			const text =
				"Backend and Frontend: discuss the authentication API and login screen. Preserve AUTH_PROTOCOL and do not inspect files.";
			const sent = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text,
			});
			await service.whenIdle();
			expect(request).toHaveBeenCalledOnce();
			expect(runs).toHaveLength(2);
			expect(runs.every((run) => !run.sessionName.includes("Routing"))).toBe(
				true,
			);
			expect(runs[0]?.message).toBe(text);
			expect(runs[0]?.participationContext).toContain("Backend");
			expect(runs[1]?.participationContext).toContain("Frontend");
			if (mode === "parallel") expect(runs[1]?.message).toBe(text);
			else {
				expect(runs[1]?.message).toContain(text);
				expect(runs[1]?.message).toContain("From Backend:\n\nVerified.");
			}
			const accepted = service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(m) => m.id === sent.accepted.id,
				);
			expect(accepted?.routing?.assignments).toEqual([
				{ id: expect.any(String), agentId: "codex", projectIds: [] },
				{ id: expect.any(String), agentId: "hermes", projectIds: [] },
			]);
		},
	);
	it("does not restore deleted facts through pending routing-correction compaction", async () => {
		const { service, channel } = await fixture();
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend OLD_ROUTING_FACT",
		});
		await service.whenIdle();
		await service.updateRoutingConfiguration({
			provider: "openai-compatible",
			model: "writer",
			baseUrl: "https://example.test/v1",
		});
		let resolve!: (response: Response) => void;
		const request = vi.fn(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				}),
		);
		vi.stubGlobal("fetch", request);
		await service.rerouteAssignment({
			sourceMessageId: sent.accepted.id,
			assignmentId: mustExist(sent.accepted.routing?.assignments[0]).id,
			agentId: "hermes",
			projectIds: [],
		});
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.deleteMessage(sent.accepted.id);
		resolve(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({ summary: "OLD_ROUTING_FACT" }),
							},
						},
					],
				}),
			),
		);
		await service.whenIdle();
		expect(
			service.snapshot().channels.find((c) => c.id === channel.id)
				?.routingMemory.summary,
		).not.toContain("OLD_ROUTING_FACT");
	});
	it("does not restore or dispatch a request deleted during routing", async () => {
		const { service, channel, runs } = await fixture();
		let resolve!: (response: Response) => void;
		const request = vi.fn(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				}),
		);
		vi.stubGlobal("fetch", request);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "PRIVATE_DELETED_REQUEST",
		});
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.deleteMessage(sent.accepted.id);
		resolve(judgments());
		await service.whenIdle();
		expect(runs).toEqual([]);
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(m) => m.id === sent.accepted.id,
				)?.text,
		).toBe("");
	});
	it("retains current Thread context when a follow-up resolves after a human edit", async () => {
		const { service, channel } = await fixture();
		const root = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend Start authentication work.",
		});
		await service.whenIdle();
		const threadId = mustExist(root.thread).id;
		let resolve!: (response: Response) => void;
		const request = vi.fn(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				}),
		);
		vi.stubGlobal("fetch", request);
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId,
			text: "Continue authentication work.",
		});
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.updateThreadContext(threadId, {
			summary: "Human notes edited during routing.",
		});
		resolve(judgments());
		await service.whenIdle();
		expect(
			service.snapshot().threads.find((t) => t.id === threadId)?.context.memory,
		).toMatchObject({
			summary: "Human notes edited during routing.",
			origin: "user",
		});
	});
	it("rejects a decision when its owner leaves the Channel during inference", async () => {
		const { service, channel, runs } = await fixture();
		let resolve!: (response: Response) => void;
		const pending = new Promise<Response>((done) => {
			resolve = done;
		});
		const request = vi.fn(() => pending);
		vi.stubGlobal("fetch", request);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the backend.",
		});
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.mutate({
			action: "set-channel-agents",
			channelId: channel.id,
			agentIds: ["hermes"],
		});
		resolve(judgments());
		await service.whenIdle();
		expect(runs).toEqual([]);
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(m) => m.id === sent.accepted.id,
				)?.routing?.status,
		).toBe("failed");
	});
	it("makes one decision call with retrieved older evidence and delivers original text without a text classifier", async () => {
		const { service, channel, runs, root } = await fixture();
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend Refresh tokens must preserve protocol compatibility.",
		});
		await service.whenIdle();
		for (let i = 0; i < 6; i++) {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "@frontend Check the screens.",
			});
			await service.whenIdle();
		}
		runs.length = 0;
		const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
			expect(url).toBe("https://api.typesafe.ai/v1/systemone");
			const persisted = await readFile(join(root, "state.json"), "utf8");
			expect(persisted).toContain(
				"Fix refresh tokens; preserve compatibility.",
			);
			const body = String(options.body);
			expect(body).toContain("Retrieved message");
			expect(body).toContain(
				"Refresh tokens must preserve protocol compatibility.",
			);
			expect(body).not.toContain(root);
			return judgments();
		});
		vi.stubGlobal("fetch", fetchMock);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix refresh tokens; preserve compatibility.",
		});
		await service.whenIdle();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(runs).toHaveLength(1);
		expect(runs[0]?.sessionName).not.toContain("Routing");
		expect(runs[0]?.agent.id).toBe("codex");
		expect(runs[0]?.message).toContain(
			"Fix refresh tokens; preserve compatibility.",
		);
		const accepted = service
			.snapshot()
			.messages[`channel:${channel.id}`]?.find(
				(m) => m.id === sent.accepted.id,
			);
		expect(accepted?.routing).toMatchObject({
			status: "resolved",
			agentIds: ["codex"],
			reason: expect.stringContaining("Jev"),
		});
	});
	it("preserves an accepted request on uncertainty without executing or silently falling back", async () => {
		const { service, channel, runs } = await fixture();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => judgments(0.4)),
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Please fix it.",
		});
		await service.whenIdle();
		expect(runs).toEqual([]);
		const accepted = service
			.snapshot()
			.messages[`channel:${channel.id}`]?.find(
				(m) => m.id === sent.accepted.id,
			);
		expect(accepted?.text).toBe("Please fix it.");
		expect(accepted?.routing).toMatchObject({ status: "failed" });
	});
});
