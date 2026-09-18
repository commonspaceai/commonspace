import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type AgentRunInput,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const completionRequestSchema = z.object({
	messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function inferenceResponse(summary: string): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						content: JSON.stringify({
							summary,
							decisions: [],
							openQuestions: [],
						}),
					},
				},
			],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-channel-context-"));
	roots.push(root);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => ({
				text: "Decision: ship the verified implementation.",
			}),
		},
	);
	services.push(service);
	await service.initialize();
	await service.updateRoutingConfiguration({
		provider: CommonspaceRoutingProvider.OpenAiCompatible,
		model: "synthetic-router",
		baseUrl: "https://example.test/v1",
	});
	await addTestHarness(service, "codex", "Review Bot");
	const channel = mustExist(
		(
			await service.mutate({
				action: "create-channel",
				name: "engineering",
				agentIds: ["codex"],
			})
		).channels[0],
	);
	await service.send({
		conversation: { kind: "channel", id: channel.id },
		text: "@review-bot verify the implementation.",
	});
	await service.whenIdle();
	return { service, channel };
}

describe("editable shared Channel context", () => {
	it("keeps the Channel snapshot captured at Thread creation separate from newer context", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-thread-snapshot-"));
		roots.push(root);
		let scope: AgentRunInput["commonspaceScope"];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					scope = input.commonspaceScope;
					return { text: "Thread reply." };
				},
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "snapshots",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		await service.updateChannelContext(channel.id, {
			summary: "Context at Thread creation.",
			decisions: ["Keep the original boundary."],
		});

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot start from this context.",
		});
		await service.whenIdle();
		await service.updateChannelContext(channel.id, {
			summary: "Newer Channel context.",
			decisions: ["A later decision."],
		});

		const thread = service
			.snapshot()
			.threads.find((candidate) => candidate.id === sent.thread?.id);
		expect(thread?.context.channelSnapshot).toMatchObject({
			summary: "Context at Thread creation.",
			decisions: ["Keep the original boundary."],
			capturedAt: sent.thread?.createdAt,
		});
		expect(thread?.context.memory).toMatchObject({
			status: "current",
			sourceMessageCount: 2,
		});
		await expect(service.readContext(mustExist(scope))).resolves.toMatchObject({
			sharedContext: {
				currentChannel: { summary: "Newer Channel context." },
				threadSnapshot: { summary: "Context at Thread creation." },
				thread: { sourceMessageCount: 2 },
			},
		});
	});

	it("preserves human-edited Thread context and marks it stale after newer replies", async () => {
		const { service, channel } = await fixture();
		const thread = mustExist(service.snapshot().threads[0]);
		const updateThreadContext = service.updateThreadContext;

		await updateThreadContext.call(service, thread.id, {
			summary: "Human-owned Thread summary.",
			decisions: ["Keep this Thread scoped."],
			openQuestions: ["Does the focused fix pass?"],
		});
		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "Human-owned Thread summary.",
			origin: "user",
			status: "current",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			targetAgentId: "codex",
			text: "Add newer evidence.",
		});
		await service.whenIdle();

		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "Human-owned Thread summary.",
			decisions: ["Keep this Thread scoped."],
			origin: "user",
			status: "stale",
			sourceMessageCount: 4,
		});
	});

	it("compacts Thread context independently from Channel context", async () => {
		const { service } = await fixture();
		const thread = mustExist(service.snapshot().threads[0]);
		const channelMemory = structuredClone(
			mustExist(service.snapshot().channels[0]).memory,
		);
		const request = vi.fn(
			async (_resource: string | URL | Request, init?: RequestInit) => {
				const body = completionRequestSchema.parse(
					JSON.parse(String(init?.body)),
				);
				expect(
					body.messages.find((message) => message.role === "user")?.content,
				).toContain("verify the implementation");
				return inferenceResponse("Focused Thread context.");
			},
		);
		vi.stubGlobal("fetch", request);
		const compactThreadContext = service.compactThreadContext;

		await expect(
			compactThreadContext.call(service, thread.id),
		).resolves.toMatchObject({
			memory: {
				summary: "Focused Thread context.",
				origin: "inference",
				status: "current",
				sourceMessageCount: 2,
			},
		});
		expect(service.snapshot().channels[0]?.memory).toEqual(channelMemory);
		expect(request).toHaveBeenCalledOnce();
	});

	it("persists compacting and failed states without losing the last valid Thread context", async () => {
		const { service } = await fixture();
		const thread = mustExist(service.snapshot().threads[0]);
		await service.updateThreadContext(thread.id, {
			summary: "Last valid Thread context.",
		});
		const completion = deferred<Response>();
		const request = vi.fn(() => completion.promise);
		vi.stubGlobal("fetch", request);

		const compacting = service.compactThreadContext(thread.id);
		await vi.waitFor(() => {
			expect(service.snapshot().threads[0]?.context.memory.status).toBe(
				"compacting",
			);
			expect(request).toHaveBeenCalledOnce();
		});
		const compactingFailure = expect(compacting).rejects.toThrow(
			"thread compactor unavailable",
		);
		completion.reject(new Error("thread compactor unavailable"));
		await compactingFailure;

		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "Last valid Thread context.",
			origin: "user",
			status: "failed",
		});
	});

	it("delivers same-Thread follow-ups during automatic compaction and preserves a concurrent human edit", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-thread-background-"),
		);
		roots.push(root);
		const completion = deferred<Response>();
		const request = vi.fn(() => completion.promise);
		vi.stubGlobal("fetch", request);
		const delivered: string[] = [];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					delivered.push(input.message);
					return { text: `Large result ${"y".repeat(63_000)}` };
				},
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "background",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: `@review-bot first pass ${"a".repeat(15_000)}`,
		});
		await service.whenIdle();
		await service.updateChannelContext(channel.id, {
			summary: "Human Channel notes.",
		});
		const threadId = mustExist(sent.thread).id;
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId,
			targetAgentId: "codex",
			text: `second pass ${"b".repeat(15_000)}`,
		});
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.updateThreadContext(threadId, {
			summary: "Human edit while compaction is pending.",
		});
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId,
			targetAgentId: "codex",
			text: "third pass without waiting",
		});
		await vi.waitFor(() => expect(delivered).toHaveLength(3));
		let idle = false;
		const waiting = service.whenIdle().then(() => {
			idle = true;
		});
		expect(idle).toBe(false);
		completion.resolve(inferenceResponse("An obsolete inferred summary."));
		await waiting;
		expect(
			service.snapshot().threads.find((t) => t.id === threadId)?.context.memory,
		).toMatchObject({
			summary: "Human edit while compaction is pending.",
			origin: "user",
			status: "stale",
			sourceMessageCount: 6,
		});
		expect(request).toHaveBeenCalledOnce();
	});

	it("preserves a human Thread edit made at the compacting revision before inference starts", async () => {
		const { service } = await fixture();
		const threadId = mustExist(service.snapshot().threads[0]).id;
		let edit: Promise<void> | undefined;
		const unsubscribe = service.subscribeToRevisions(() => {
			if (
				edit === undefined &&
				service.snapshot().threads.find((t) => t.id === threadId)?.context
					.memory.status === "compacting"
			)
				edit = service
					.updateThreadContext(threadId, {
						summary: "Concurrent human edit at compacting boundary.",
					})
					.then(() => undefined);
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => inferenceResponse("An obsolete manual result.")),
		);
		try {
			await service.compactThreadContext(threadId);
			await edit;
			expect(
				service.snapshot().threads.find((t) => t.id === threadId)?.context
					.memory,
			).toMatchObject({
				summary: "Concurrent human edit at compacting boundary.",
				origin: "user",
			});
		} finally {
			unsubscribe();
		}
	});

	it("allows explicitly requested compaction of previously human-edited notes", async () => {
		const { service, channel } = await fixture();
		await service.updateChannelContext(channel.id, {
			summary: "Human notes before manual compaction.",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => inferenceResponse("Manually compacted notes.")),
		);
		expect((await service.compactChannelContext(channel.id)).summary).toBe(
			"Manually compacted notes.",
		);
	});

	it("discards a pending Channel compaction when covered source text is deleted", async () => {
		const { service, channel } = await fixture();
		const source = mustExist(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(m) => m.authorType === "user",
				),
		);
		const completion = deferred<Response>();
		const request = vi.fn(() => completion.promise);
		vi.stubGlobal("fetch", request);
		const pending = service.compactChannelContext(channel.id);
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.deleteMessage(source.id);
		completion.resolve(inferenceResponse("DELETED_SOURCE_FACT"));
		await pending;
		expect(
			service.snapshot().channels.find((c) => c.id === channel.id)?.memory
				.summary,
		).not.toContain("DELETED_SOURCE_FACT");
	});

	it("discards a pending Thread compaction when covered source text is deleted", async () => {
		const { service, channel } = await fixture();
		const source = mustExist(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(m) => m.authorType === "user",
				),
		);
		const threadId = mustExist(source.threadId);
		const completion = deferred<Response>();
		const request = vi.fn(() => completion.promise);
		vi.stubGlobal("fetch", request);
		const pending = service.compactThreadContext(threadId);
		await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
		await service.deleteMessage(source.id);
		completion.resolve(inferenceResponse("DELETED_SOURCE_FACT"));
		await pending;
		expect(
			service.snapshot().threads.find((t) => t.id === threadId)?.context.memory
				.summary,
		).not.toContain("DELETED_SOURCE_FACT");
	});

	it("automatically compacts Thread context under token pressure", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-thread-pressure-"));
		roots.push(root);
		const request = vi.fn(async () =>
			inferenceResponse("Pressure-compacted Thread context."),
		);
		vi.stubGlobal("fetch", request);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({
					text: `Large Thread result ${"y".repeat(63_000)}`,
				}),
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "thread-pressure",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: `@review-bot first pass ${"a".repeat(15_000)}`,
		});
		await service.whenIdle();
		await service.updateChannelContext(channel.id, {
			summary: "Human-owned Channel context.",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(sent.thread).id,
			targetAgentId: "codex",
			text: `second pass ${"b".repeat(15_000)}`,
		});
		await service.whenIdle();

		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "Pressure-compacted Thread context.",
			origin: "inference",
			status: "current",
			sourceMessageCount: 4,
		});
		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Human-owned Channel context.",
			origin: "user",
			status: "stale",
		});
		expect(request).toHaveBeenCalledOnce();
	});

	it("preserves a user edit and marks it stale when newer source messages arrive", async () => {
		const { service, channel } = await fixture();
		await service.mutate({
			action: "set-channel-memory",
			channelId: channel.id,
			summary: "Canonical user-edited summary.",
			decisions: ["Use the local service."],
			openQuestions: ["How should export work?"],
		});

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Canonical user-edited summary.",
			origin: "user",
			status: "current",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot verify another change.",
		});
		await service.whenIdle();

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Canonical user-edited summary.",
			origin: "user",
			status: "stale",
			sourceMessageCount: 4,
		});
	});

	it("uses configured Commonspace inference for manual compaction", async () => {
		const { service, channel } = await fixture();
		const request = vi.fn(
			async (_resource: string | URL | Request, init?: RequestInit) => {
				const body = completionRequestSchema.parse(
					JSON.parse(String(init?.body)),
				);
				expect(
					body.messages.find((message) => message.role === "user")?.content,
				).toContain("verify the implementation");
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: JSON.stringify({
										summary: "The implementation was verified and approved.",
										decisions: ["Ship the verified implementation."],
										openQuestions: [],
									}),
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		vi.stubGlobal("fetch", request);

		const memory = await service.compactChannelContext(channel.id);

		expect(memory).toMatchObject({
			summary: "The implementation was verified and approved.",
			decisions: ["Ship the verified implementation."],
			origin: "inference",
			status: "current",
			sourceMessageCount: 2,
		});
		expect(memory.compactedThroughMessageId).toBeTruthy();
		expect(request).toHaveBeenCalledOnce();
	});

	it("persists compacting and failed states without losing the last valid Channel context", async () => {
		const { service, channel } = await fixture();
		await service.updateChannelContext(channel.id, {
			summary: "Last valid Channel context.",
		});
		const completion = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => completion.promise),
		);

		const compacting = service.compactChannelContext(channel.id);
		await vi.waitFor(() => {
			expect(service.snapshot().channels[0]?.memory.status).toBe("compacting");
		});
		const compactingFailure = expect(compacting).rejects.toThrow(
			"compactor unavailable",
		);
		completion.reject(new Error("compactor unavailable"));
		await compactingFailure;

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Last valid Channel context.",
			origin: "user",
			status: "failed",
		});
	});

	it("marks a manual compaction stale when a message arrives during inference", async () => {
		const { service, channel } = await fixture();
		const completion = deferred<Response>();
		const request = vi.fn(async () => completion.promise);
		vi.stubGlobal("fetch", request);

		const compacting = service.compactChannelContext(channel.id);
		await vi.waitFor(() => {
			expect(request).toHaveBeenCalledOnce();
		});
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot add newer context.",
		});
		completion.resolve(
			inferenceResponse("Compacted before the newer message."),
		);

		const memory = await compacting;
		await service.whenIdle();

		expect(memory).toMatchObject({
			summary: "Compacted before the newer message.",
			origin: "inference",
			status: "stale",
		});
		expect(memory.sourceMessageCount).toBeGreaterThanOrEqual(3);
		expect(service.snapshot().channels[0]?.memory.status).toBe("stale");
	});

	it("refreshes edited context as soon as a newly accepted message starts routing", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-context-acceptance-"),
		);
		roots.push(root);
		const routing = deferred<{
			agentIds: string[];
			confidence: number;
			reason: string;
		}>();
		const service = new CommonspaceHostService(
			{ warn: () => undefined },
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Initial reply." }),
				routeAgents: async () => routing.promise,
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "routing",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot establish context.",
		});
		await service.whenIdle();
		await service.updateChannelContext(channel.id, {
			summary: "Human-owned context.",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "This routing attempt will fail.",
		});
		const memoryWhileRouting = service.snapshot().channels[0]?.memory;
		routing.reject(new Error("router unavailable"));
		await service.whenIdle();

		expect(memoryWhileRouting).toMatchObject({
			summary: "Human-owned context.",
			origin: "user",
			status: "stale",
			sourceMessageCount: 3,
		});
		expect(service.snapshot().channels[0]?.memory.status).toBe("stale");
	});

	it("does not automatically overwrite user-authored context under token pressure", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-user-context-pressure-"),
		);
		roots.push(root);
		let reply = "Initial reply.";
		const request = vi.fn(async () =>
			inferenceResponse("Inferred replacement."),
		);
		vi.stubGlobal("fetch", request);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: reply }),
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "user-pressure",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot establish context.",
		});
		await service.whenIdle();
		await service.updateChannelContext(channel.id, {
			summary: "Canonical human summary.",
			decisions: ["Keep human ownership."],
		});
		reply = `Large result ${"y".repeat(63_000)}`;

		for (let index = 0; index < 2; index += 1) {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: `@review-bot process pass ${String(index)} ${"x".repeat(49_000)}`,
			});
			await service.whenIdle();
		}

		expect(request).not.toHaveBeenCalled();
		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Canonical human summary.",
			decisions: ["Keep human ownership."],
			origin: "user",
			status: "stale",
		});
	});

	it("serializes automatic compactions and keeps the newest completed projection", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-context-race-"));
		roots.push(root);
		const completions = [deferred<Response>(), deferred<Response>()];
		const request = vi.fn(
			async () => mustExist(completions[request.mock.calls.length - 1]).promise,
		);
		vi.stubGlobal("fetch", request);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: `Large result ${"y".repeat(63_000)}` }),
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "race",
					agentIds: ["codex"],
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: `@review-bot establish pressure ${"s".repeat(49_000)}`,
		});
		await service.whenIdle();
		expect(request).not.toHaveBeenCalled();
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: `@review-bot first compaction ${"a".repeat(49_000)}`,
		});
		await vi.waitFor(() => {
			expect(request).toHaveBeenCalledOnce();
		});
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: `@review-bot second compaction ${"b".repeat(49_000)}`,
		});
		await vi.waitFor(() => {
			const replies =
				service
					.snapshot()
					.messages[`channel:${channel.id}`]?.filter(
						(message) => message.authorType === "agent",
					) ?? [];
			expect(replies).toHaveLength(3);
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(request).toHaveBeenCalledOnce();
		mustExist(completions[0]).resolve(
			inferenceResponse("Older compacted context."),
		);
		await vi.waitFor(() => {
			expect(request).toHaveBeenCalledTimes(2);
		});
		mustExist(completions[1]).resolve(
			inferenceResponse("Newest compacted context."),
		);
		await service.whenIdle();

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Newest compacted context.",
			origin: "inference",
			status: "current",
			sourceMessageCount: 6,
		});
	});

	it("automatically compacts when shared context crosses token pressure", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-context-pressure-"));
		roots.push(root);
		const request = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: JSON.stringify({
										summary: "Pressure-compacted shared context.",
										decisions: ["Keep the verified result."],
										openQuestions: [],
									}),
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", request);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: `Decision: ${"y".repeat(63_900)}` }),
			},
		);
		services.push(service);
		await service.initialize();
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.OpenAiCompatible,
			model: "synthetic-router",
			baseUrl: "https://example.test/v1",
		});
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "large-context",
					agentIds: ["codex"],
				})
			).channels[0],
		);

		for (let index = 0; index < 2; index += 1) {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: `@review-bot pass ${String(index)} ${"x".repeat(15_900)}`,
			});
			await service.whenIdle();
		}

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Pressure-compacted shared context.",
			origin: "inference",
			status: "current",
			sourceMessageCount: 4,
		});
		expect(request).toHaveBeenCalledOnce();
	});
});
