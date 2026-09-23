// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMONSPACE_STATE_VERSION } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { applyMutation, createInitialState } from "../server/src/state.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("routing state migration", () => {
	it("drops saved routing knowledge whose corrected source was superseded", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-retired-routing-"));
		roots.push(root);
		let state = createInitialState();
		state.agents.push({
			id: "agent-1",
			displayName: "Backend",
			adapter: "hermes",
			model: null,
			createdAt: "2026-08-30T00:00:00.000Z",
		});
		state = applyMutation(state, {
			action: "create-channel",
			name: "engineering",
			agentIds: ["agent-1"],
		});
		const channel = state.channels[0];
		if (channel === undefined) throw new Error("missing test channel");
		channel.routingMemory = {
			summary: "Route this old request to Backend.",
			status: "current",
			correctionCount: 1,
			compactedThroughCorrectionId: "correction-1",
			updatedAt: "2026-08-30T00:00:02.000Z",
		};
		state.messages[`channel:${channel.id}`] = [
			{
				id: "source",
				conversation: { kind: "channel", id: channel.id },
				authorType: "user",
				authorId: "user",
				authorName: "Human",
				text: "Fix the old request.",
				createdAt: "2026-08-30T00:00:00.000Z",
				routing: {
					source: "ai",
					agentIds: ["agent-1"],
					assignments: [
						{ id: "from", agentId: "agent-1", projectIds: [] },
						{ id: "to", agentId: "agent-1", projectIds: [] },
					],
					corrections: [
						{
							id: "correction-1",
							fromAssignmentId: "from",
							toAssignmentId: "to",
							createdAt: "2026-08-30T00:00:01.000Z",
						},
					],
					inferredProjectIds: [],
					reason: "Initial route",
				},
			},
			{
				id: "replacement",
				conversation: { kind: "channel", id: channel.id },
				authorType: "user",
				authorId: "user",
				authorName: "Human",
				text: "Do something else.",
				createdAt: "2026-08-30T00:00:03.000Z",
				supersedesMessageId: "source",
			},
		];
		await writeFile(join(root, "state.json"), JSON.stringify(state));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();
		expect(service.snapshot().channels[0]?.routingMemory).toEqual({
			summary: "",
			status: "empty",
			correctionCount: 0,
			compactedThroughCorrectionId: null,
			updatedAt: null,
		});
		await service.close();
	});

	it("adds participant metadata to legacy resolved routing decisions", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-routing-migration-"),
		);
		roots.push(root);
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 16,
				revision: 4,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes",
						model: null,
						createdAt: "now",
					},
				],
				dmSessions: {},
				agentSessions: {},
				projects: [
					{
						id: "project-1",
						name: "App",
						paths: ["/tmp/app"],
						createdAt: "now",
					},
				],
				channels: [
					{
						id: "general",
						name: "general",
						agentIds: ["frontend"],
						instructions: "",
						memory: {
							summary: "",
							decisions: [],
							openQuestions: [],
							threadIds: ["thread-1"],
							updatedAt: null,
						},
						createdAt: "now",
					},
				],
				threads: [
					{
						id: "thread-1",
						channelId: "general",
						projectIds: ["project-1"],
						projectId: "project-1",
						rootMessageId: "root-1",
						agentIds: ["frontend"],
						createdAt: "now",
					},
				],
				messages: {
					"channel:general": [
						{
							id: "root-1",
							conversation: { kind: "channel", id: "general" },
							authorType: "user",
							authorId: "user",
							authorName: "Ralph",
							text: "Fix the API.",
							createdAt: "now",
							projectIds: ["project-1"],
							projectId: "project-1",
							threadId: "thread-1",
							routing: {
								source: "ai",
								status: "resolved",
								agentIds: ["frontend"],
								confidence: 0.9,
								reason: "Backend work.",
							},
						},
					],
				},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		const message = service.snapshot().messages["channel:general"]?.[0];
		expect(service.snapshot().version).toBe(COMMONSPACE_STATE_VERSION);
		expect(service.snapshot().pins).toEqual([]);
		expect(service.snapshot().channels[0]?.routingMemory).toEqual({
			summary: "",
			status: "empty",
			correctionCount: 0,
			compactedThroughCorrectionId: null,
			updatedAt: null,
		});
		expect(service.snapshot().threads[0]?.context.channelSnapshot).toEqual({
			summary: "",
			decisions: [],
			openQuestions: [],
			updatedAt: null,
			origin: "automatic",
			status: "empty",
			sourceMessageCount: 0,
			estimatedTokens: 0,
			compactedThroughMessageId: null,
			capturedAt: "now",
		});
		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "",
			origin: "automatic",
			status: "stale",
			sourceMessageCount: 1,
			compactedThroughMessageId: "root-1",
		});
		expect(message?.routing?.assignments).toEqual([
			{
				id: "legacy:root-1:frontend",
				agentId: "frontend",
				projectIds: ["project-1"],
			},
		]);
		expect(message?.routing?.corrections).toEqual([]);
		await service.close();
	});

	it("preserves correction history beyond the live fan-out limit", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-history-"));
		roots.push(root);
		const agents = Array.from({ length: 9 }, (_, index) => ({
			id: `agent-${String(index + 1)}`,
			displayName: `Agent ${String(index + 1)}`,
			adapter: "hermes",
			model: null,
			createdAt: "2026-08-30T00:00:00.000Z",
		}));
		const assignments = agents.map((agent, index) => ({
			id: `assignment-${String(index + 1)}`,
			agentId: agent.id,
			subRequest: `Attempt ${String(index + 1)}`,
			projectIds: [],
		}));
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 29,
				revision: 9,
				defaults: {
					maxAgentsPerTurn: 8,
					memoryThreads: 12,
				},
				agents,
				dmSessions: {},
				agentSessions: {},
				projects: [],
				channels: [
					{
						id: "general",
						name: "general",
						agentIds: agents.map((agent) => agent.id),
						instructions: "",
						memory: {
							summary: "",
							decisions: [],
							openQuestions: [],
							threadIds: ["thread-1"],
							updatedAt: null,
						},
						createdAt: "2026-08-30T00:00:00.000Z",
					},
				],
				threads: [
					{
						id: "thread-1",
						channelId: "general",
						projectIds: [],
						projectId: null,
						rootMessageId: "root-1",
						agentIds: agents.map((agent) => agent.id),
						createdAt: "2026-08-30T00:00:00.000Z",
					},
				],
				messages: {
					"channel:general": [
						{
							id: "root-1",
							conversation: { kind: "channel", id: "general" },
							authorType: "user",
							authorId: "user",
							authorName: "Ralph",
							text: "Keep every routing attempt.",
							createdAt: "2026-08-30T00:00:00.000Z",
							threadId: "thread-1",
							routing: {
								source: "ai",
								status: "resolved",
								agentIds: agents.map((agent) => agent.id),
								assignments,
								corrections: [
									{
										id: "correction-1",
										fromAssignmentId: "assignment-1",
										toAssignmentId: "assignment-9",
										createdAt: "2026-08-30T00:01:00.000Z",
									},
								],
								inferredProjectIds: [],
								reason: "Historical attempts.",
							},
						},
					],
				},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		const routing =
			service.snapshot().messages["channel:general"]?.[0]?.routing;
		expect(routing?.assignments.map((assignment) => assignment.id)).toEqual(
			assignments.map((assignment) => assignment.id),
		);
		expect(routing?.corrections).toEqual([
			{
				id: "correction-1",
				fromAssignmentId: "assignment-1",
				toAssignmentId: "assignment-9",
				createdAt: "2026-08-30T00:01:00.000Z",
			},
		]);
		expect(routing?.assignments[0]?.legacySubRequest).toBe("Attempt 1");
		const persisted = JSON.parse(
			await readFile(join(root, "state.json"), "utf8"),
		);
		expect(persisted.version).toBe(COMMONSPACE_STATE_VERSION);
		expect(
			persisted.messages["channel:general"][0].routing.assignments[0],
		).toEqual({
			id: "assignment-1",
			agentId: "agent-1",
			projectIds: [],
			legacySubRequest: "Attempt 1",
		});
		await service.close();
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await restarted.initialize();
		expect(
			restarted.snapshot().messages["channel:general"]?.[0]?.routing,
		).toEqual(routing);
		await restarted.deleteMessage("root-1");
		expect(
			restarted
				.snapshot()
				.messages["channel:general"]?.[0]?.routing?.assignments.every(
					(assignment) => assignment.legacySubRequest === undefined,
				),
		).toBe(true);
		await restarted.close();
	});

	it("marks interrupted persisted context compactions failed on restart", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-context-interrupted-"),
		);
		roots.push(root);
		const memory = {
			summary: "Last valid context.",
			decisions: [],
			openQuestions: [],
			updatedAt: "2026-08-30T00:00:00.000Z",
			origin: "user",
			status: "compacting",
			sourceMessageCount: 1,
			estimatedTokens: 10,
			compactedThroughMessageId: "root-1",
		};
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: COMMONSPACE_STATE_VERSION,
				revision: 2,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [],
				dmSessions: {},
				agentSessions: {},
				projects: [],
				channels: [
					{
						id: "general",
						name: "general",
						agentIds: [],
						instructions: "",
						memory: { ...memory, threadIds: ["thread-1"] },
						createdAt: "2026-08-30T00:00:00.000Z",
					},
				],
				threads: [
					{
						id: "thread-1",
						channelId: "general",
						projectIds: [],
						projectId: null,
						rootMessageId: "root-1",
						agentIds: [],
						context: {
							channelSnapshot: {
								...memory,
								status: "current",
								capturedAt: "2026-08-30T00:00:00.000Z",
							},
							memory,
						},
						createdAt: "2026-08-30T00:00:00.000Z",
					},
				],
				messages: {},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		expect(service.snapshot().channels[0]?.memory).toMatchObject({
			summary: "Last valid context.",
			status: "failed",
		});
		expect(service.snapshot().threads[0]?.context.memory).toMatchObject({
			summary: "Last valid context.",
			status: "failed",
		});
		await service.close();
	});
});
