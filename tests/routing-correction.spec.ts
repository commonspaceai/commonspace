import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRoutingMemoryCompactionPrompt } from "../server/src/routing-memory.ts";
import {
	type AgentRunInput,
	CommonspaceHostService,
	type CommonspaceRouteResult,
} from "../server/src/service.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("routing correction", () => {
	it("retries a failed AI routing decision without duplicating the message", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-retry-"));
		roots.push(root);
		const routeAgents = vi
			.fn<() => Promise<CommonspaceRouteResult>>()
			.mockRejectedValueOnce(new Error("invalid routing response"))
			.mockResolvedValueOnce({
				mode: "parallel",
				assignments: [
					{
						agentId: "frontend",
						projectIds: [],
					},
				],
				reason: "Frontend owns the routing controls.",
			});
		const runAgent = vi.fn(async () => "Recovered.");
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes" as const,
						model: null,
						status: "stopped" as const,
					},
				],
				routeAgents,
				runAgent,
			},
		);
		await service.initialize();
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "frontend",
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["frontend"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the routing controls.",
		});
		await service.whenIdle();
		expect(sent.thread).toBeDefined();
		expect(
			service.snapshot().messages[`channel:${channel.id}`]?.[0]?.routing
				?.status,
		).toBe("failed");

		await service.retryRouting({
			sourceMessageId: sent.accepted.id,
			mode: "ai",
		});
		await service.whenIdle();

		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(
			messages.filter((message) => message.authorType === "user"),
		).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			id: sent.accepted.id,
			routing: {
				status: "resolved",
				agentIds: ["frontend"],
			},
		});
		expect(runAgent).toHaveBeenCalledOnce();
	});

	it("manually routes a failed decision to a selected channel agent", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-manual-"));
		roots.push(root);
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.id}: done`,
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes" as const,
						model: null,
						status: "stopped" as const,
					},
				],
				routeAgents: async () => {
					throw new Error("invalid routing response");
				},
				runAgent,
			},
		);
		await service.initialize();
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "frontend",
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["frontend"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the routing controls.",
		});
		await service.whenIdle();

		await service.retryRouting({
			sourceMessageId: sent.accepted.id,
			mode: "manual",
			agentId: "frontend",
		});
		await service.whenIdle();

		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(
			messages.filter((message) => message.authorType === "user"),
		).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			id: sent.accepted.id,
			routing: {
				source: "explicit",
				agentIds: ["frontend"],
			},
		});
		expect(messages.some((message) => message.text === "frontend: done")).toBe(
			true,
		);
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			agent: { id: "frontend" },
			message: "Fix the routing controls.",
		});
	});

	it("reroutes one assignment to multiple agents while preserving every attempt and reply", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-routing-correction-"),
		);
		roots.push(root);
		const firstRoot = join(root, "first");
		const secondRoot = join(root, "second");
		await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
			{
				id: "reviewer",
				displayName: "Reviewer",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
			{
				id: "qa",
				displayName: "QA",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
			{
				id: "outsider",
				displayName: "Outsider",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
		];
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.id}: ${input.message}`,
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async (input) => ({
					mode: "parallel",
					assignments: [
						{
							agentId: "backend",
							projectIds: [mustExist(input.projects[0]).id],
						},
						{
							agentId: "frontend",
							projectIds: [mustExist(input.projects[1]).id],
						},
					],
					reason: "Backend and frontend own separate work.",
				}),
			},
		);
		await service.initialize();
		for (const agent of agents)
			await service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
			});
		const first = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "First",
					paths: [firstRoot],
				})
			).projects[0],
		);
		const second = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Second",
					paths: [secondRoot],
				})
			).projects[1],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend", "reviewer", "qa"],
				})
			).channels[0],
		);

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectIds: [first.id, second.id],
			text: "Change the API and UI.",
			attachments: [
				{ name: "diagram.png", mimeType: "image/png", data: "iVBORw==" },
			],
		});
		await service.whenIdle();
		const original = service
			.snapshot()
			.messages[`channel:${channel.id}`]?.find(
				(message) => message.id === sent.accepted.id,
			);
		expect(original?.routing).toMatchObject({
			startedAt: expect.any(String),
			resolvedAt: expect.any(String),
			durationMs: expect.any(Number),
		});
		const frontendAssignment = original?.routing?.assignments.find(
			(assignment) => assignment.agentId === "frontend",
		);
		expect(frontendAssignment).toBeDefined();

		const reroute = service.rerouteAssignment;
		await expect(
			reroute.call(service, {
				sourceMessageId: sent.accepted.id,
				assignmentId: mustExist(frontendAssignment).id,
				agentIds: ["reviewer", "outsider"],
				projectIds: [second.id],
			}),
		).rejects.toThrow("reroute agent must belong to the channel");
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				)?.routing?.corrections,
		).toEqual([]);
		await reroute.call(service, {
			sourceMessageId: sent.accepted.id,
			assignmentId: mustExist(frontendAssignment).id,
			agentIds: ["reviewer", "qa", "backend"],
			projectIds: [second.id],
		});
		await service.whenIdle();

		const state = service.snapshot();
		const messages = state.messages[`channel:${channel.id}`] ?? [];
		const source = mustExist(
			messages.find((message) => message.id === sent.accepted.id),
		);
		const correction = source.routing?.corrections[0];
		const qaCorrection = source.routing?.corrections[1];
		const existingCorrection = source.routing?.corrections[2];
		const replacement = source.routing?.assignments.find(
			(assignment) => assignment.id === correction?.toAssignmentId,
		);
		const qaAssignment = source.routing?.assignments.find(
			(assignment) => assignment.id === qaCorrection?.toAssignmentId,
		);
		expect(source.routing?.assignments).toHaveLength(4);
		expect(source.routing?.corrections).toHaveLength(3);
		expect(correction).toMatchObject({
			id: expect.any(String),
			fromAssignmentId: mustExist(frontendAssignment).id,
			toAssignmentId: expect.any(String),
			createdAt: expect.any(String),
		});
		expect(replacement).toMatchObject({
			agentId: "reviewer",
			projectIds: [second.id],
		});
		expect(qaCorrection).toMatchObject({
			fromAssignmentId: mustExist(frontendAssignment).id,
			toAssignmentId: expect.any(String),
		});
		expect(qaAssignment).toMatchObject({
			agentId: "qa",
			projectIds: [second.id],
		});
		expect(existingCorrection).toMatchObject({
			fromAssignmentId: mustExist(frontendAssignment).id,
			toAssignmentId: source.routing?.assignments[0]?.id,
			projectIds: [second.id],
		});
		expect(source.routing?.assignments[0]?.projectIds).toEqual([first.id]);
		expect(
			buildRoutingMemoryCompactionPrompt(state, channel.id)?.prompt,
		).toContain('"to":{"agent":"Backend","projects":["Second"]}');
		const deliveries = runAgent.mock.calls.map((call) => ({
			agentId: call[0].agent.id,
			message: call[0].message,
		}));
		expect(deliveries).toHaveLength(4);
		expect(deliveries).toEqual(
			expect.arrayContaining([
				{ agentId: "backend", message: "Change the API and UI." },
				{ agentId: "frontend", message: "Change the API and UI." },
				{ agentId: "reviewer", message: "Change the API and UI." },
				{ agentId: "qa", message: "Change the API and UI." },
			]),
		);
		const reviewerRun = runAgent.mock.calls.find(
			([input]) => input.agent.id === "reviewer",
		)?.[0];
		const qaRun = runAgent.mock.calls.find(
			([input]) => input.agent.id === "qa",
		)?.[0];
		for (const run of [reviewerRun, qaRun]) {
			expect(run?.participationContext).toContain('"name":"Backend"');
			expect(run?.participationContext).toContain('"name":"Reviewer"');
			expect(run?.participationContext).toContain('"name":"QA"');
			expect(run?.participationContext).not.toContain('"name":"Frontend"');
		}
		const replies = messages
			.filter((message) => message.authorType === "agent")
			.map((message) => ({
				text: message.text,
				routingAssignmentId: message.routingAssignmentId,
			}));
		expect(replies).toHaveLength(4);
		expect(replies).toEqual(
			expect.arrayContaining([
				{
					text: "backend: Change the API and UI.",
					routingAssignmentId: source.routing?.assignments[0]?.id,
				},
				{
					text: "frontend: Change the API and UI.",
					routingAssignmentId: mustExist(frontendAssignment).id,
				},
				{
					text: "reviewer: Change the API and UI.",
					routingAssignmentId: replacement?.id,
				},
				{
					text: "qa: Change the API and UI.",
					routingAssignmentId: qaAssignment?.id,
				},
			]),
		);
		expect(
			state.threads.find((thread) => thread.id === sent.thread?.id)?.agentIds,
		).toEqual(["backend", "frontend", "reviewer", "qa"]);

		const backendAssignment = mustExist(
			source.routing?.assignments.find(
				(assignment) => assignment.agentId === "backend",
			),
		);
		await expect(
			service.rerouteAssignment({
				sourceMessageId: sent.accepted.id,
				assignmentId: backendAssignment.id,
				agentIds: ["backend"],
				projectIds: [first.id],
			}),
		).rejects.toThrow("reroute agent already owns this assignment");
		const remembered = await service.rerouteAssignment({
			sourceMessageId: sent.accepted.id,
			assignmentId: backendAssignment.id,
			agentIds: ["reviewer"],
			projectIds: [first.id],
		});
		await service.whenIdle();
		expect(remembered.assignments[0]?.id).toBe(replacement?.id);
		expect(remembered.corrections[0]).toMatchObject({
			fromAssignmentId: backendAssignment.id,
			toAssignmentId: replacement?.id,
		});
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				)?.routing?.assignments,
		).toHaveLength(4);
		expect(runAgent).toHaveBeenCalledTimes(4);

		const savedCorrections = mustExist(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				)?.routing,
		).corrections;
		await service.close();
		const reopened = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => agents },
		);
		await reopened.initialize();
		const reopenedMessages =
			reopened.snapshot().messages[`channel:${channel.id}`] ?? [];
		const reopenedSource = mustExist(
			reopenedMessages.find((message) => message.id === sent.accepted.id),
		);
		expect(reopenedSource.routing?.assignments).toHaveLength(4);
		expect(reopenedSource.routing?.corrections).toEqual(savedCorrections);
		expect(
			buildRoutingMemoryCompactionPrompt(reopened.snapshot(), channel.id)
				?.prompt,
		).toContain('"to":{"agent":"Backend","projects":["Second"]}');
		expect(
			reopenedMessages.filter((message) => message.authorType === "agent"),
		).toHaveLength(4);
		expect(
			reopened.snapshot().channels.find((item) => item.id === channel.id)
				?.routingMemory.correctionCount,
		).toBe(4);
		await unlink(
			join(root, "attachments", mustExist(sent.accepted.attachments?.[0]).id),
		);
		await expect(
			reopened.rerouteAssignment({
				sourceMessageId: sent.accepted.id,
				assignmentId: mustExist(replacement).id,
				agentIds: ["frontend"],
				projectIds: [second.id],
			}),
		).rejects.toThrow("ENOENT");
		expect(
			reopened
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				)?.routing?.corrections,
		).toEqual(savedCorrections);
		await reopened.close();
	});

	it("compacts explicit corrections into routing knowledge used by later decisions", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-memory-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
			{
				id: "reviewer",
				displayName: "Reviewer",
				adapter: "hermes" as const,
				model: null,
				status: "stopped" as const,
			},
		];
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.sessionName.startsWith("Commonspace Inference:")
				? '{"summary":"Route review-only requests to Reviewer."}'
				: `${input.agent.id}: done`,
		);
		const routeAgents = vi.fn(
			async (): Promise<CommonspaceRouteResult> => ({
				mode: "parallel",
				assignments: [
					{
						agentId: "backend",
						projectIds: [],
					},
				],
				reason: "Backend matched the request.",
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents,
			},
		);
		await service.initialize();
		for (const agent of agents)
			await service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
			});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "reviews",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});

		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectIds: [],
			text: "Review this change.",
		});
		await service.whenIdle();
		const assignment = service
			.snapshot()
			.messages[`channel:${channel.id}`]?.find(
				(message) => message.id === first.accepted.id,
			)?.routing?.assignments[0];
		expect(assignment).toBeDefined();
		if (assignment === undefined) return;
		const corrected = await service.rerouteAssignment({
			sourceMessageId: first.accepted.id,
			assignmentId: assignment.id,
			agentIds: ["reviewer"],
			projectIds: [],
		});
		await service.whenIdle();

		const routingMemory = service
			.snapshot()
			.channels.find((candidate) => candidate.id === channel.id)?.routingMemory;
		expect(routingMemory).toMatchObject({
			summary: "Route review-only requests to Reviewer.",
			status: "current",
			correctionCount: 1,
			compactedThroughCorrectionId: corrected.corrections[0]?.id,
			updatedAt: expect.any(String),
		});
		const routingMemoryCompaction = runAgent.mock.calls.find(([input]) =>
			input.message.includes("bounded routing feedback"),
		)?.[0];
		expect(routingMemoryCompaction).toMatchObject({
			processScopeName: `Commonspace Channel Context: ${channel.id}`,
			ephemeralSession: true,
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectIds: [],
			text: "Review another change.",
		});
		await service.whenIdle();
		expect(routeAgents.mock.calls[1]?.[0]).toMatchObject({
			routingMemory: "Route review-only requests to Reviewer.",
		});
	});
});
