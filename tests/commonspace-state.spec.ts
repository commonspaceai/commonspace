import type { CommonspaceMutation } from "@commonspace/shared";
import { CommonspaceReasoning } from "@commonspace/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	addDiscoveredAgent,
	applyMutation,
	createInitialState,
} from "../server/src/state.ts";

describe("Commonspace local state", () => {
	it("creates filesystem projects and project-independent channels with real agent membership", () => {
		const initial = createInitialState();
		const withProject = applyMutation(
			initial,
			{
				action: "create-project",
				name: "Checkout",
				paths: [
					"/Users/example/Developer/storefront",
					"/Users/example/Developer/api",
				],
			},
			{ ids: () => "project-1", now: () => "2026-08-25T00:00:00.000Z" },
		);
		const withChannel = applyMutation(
			withProject,
			{
				action: "create-channel",
				name: "checkout",
				agentIds: ["frontend", "backend"],
			},
			{ ids: () => "channel-1", now: () => "2026-08-25T00:00:01.000Z" },
		);

		expect(withChannel.projects[0]).toMatchObject({
			id: "project-1",
			name: "Checkout",
			paths: [
				"/Users/example/Developer/storefront",
				"/Users/example/Developer/api",
			],
		});
		expect(withChannel.channels[0]).toMatchObject({
			id: "channel-1",
			name: "checkout",
			agentIds: ["frontend", "backend"],
		});
		expect(withChannel.channels[0]).not.toHaveProperty("projectId");
		expect(withChannel.revision).toBe(2);
	});

	it("removing a project leaves global channels and room history unchanged", () => {
		const seeded = {
			...createInitialState(),
			revision: 2,
			projects: [{ id: "p", name: "P", paths: ["/tmp/p"], createdAt: "now" }],
			channels: [
				{
					id: "c",
					name: "general",
					agentIds: [],
					instructions: "",
					memory: {
						summary: "",
						decisions: [],
						openQuestions: [],
						threadIds: [],
						updatedAt: null,
					},
					createdAt: "now",
				},
			],
			messages: { "channel:c": [] },
		};
		const next = applyMutation(seeded, {
			action: "remove-project",
			projectId: "p",
		});
		expect(next.projects).toHaveLength(0);
		expect(next.channels).toEqual(seeded.channels);
		expect(next.messages["channel:c"]).toEqual([]);
	});

	it("keeps model and reasoning configuration workspace-wide", () => {
		let state = createInitialState();
		state = applyMutation(state, {
			action: "set-defaults",
			model: "openai/gpt-5.2",
			reasoning: CommonspaceReasoning.High,
			maxAgentsPerTurn: 8,
			memoryThreads: 1,
		});
		expect(state.defaults).toEqual({
			model: "openai/gpt-5.2",
			reasoning: CommonspaceReasoning.High,
			maxAgentsPerTurn: 8,
			memoryThreads: 1,
		});
		state = applyMutation(
			state,
			{ action: "create-project", name: "P", paths: ["/tmp/p"] },
			{ ids: () => "p", now: () => "now" },
		);
		state = applyMutation(
			state,
			{ action: "create-channel", name: "general", agentIds: [] },
			{ ids: () => "c", now: () => "now" },
		);
		expect(state.channels[0]).not.toHaveProperty("settings");
		expectTypeOf<{
			action: "set-channel-settings";
			channelId: "c";
			model: null;
			reasoning: null;
		}>().not.toMatchTypeOf<CommonspaceMutation>();
	});

	it("keeps OS notification preferences independent from durable Inbox state", () => {
		const initial = createInitialState();
		expect(initial.notifications).toEqual({
			enabled: false,
			replies: true,
			mentions: true,
			permissions: true,
			failures: true,
			sound: false,
		});

		const configured = applyMutation(initial, {
			action: "set-notifications",
			notifications: {
				enabled: true,
				replies: false,
				mentions: true,
				permissions: false,
				failures: true,
				sound: true,
			},
		});

		expect(configured.notifications).toEqual({
			enabled: true,
			replies: false,
			mentions: true,
			permissions: false,
			failures: true,
			sound: true,
		});
		expect(configured.inboxReadAt).toBeNull();
		expect(configured.revision).toBe(1);
		expectTypeOf<{
			action: "set-notifications";
			notifications: { enabled: true };
		}>().not.toMatchTypeOf<CommonspaceMutation>();
	});

	it("excludes unsupported reasoning values from mutation contracts", () => {
		expectTypeOf<{
			action: "set-defaults";
			reasoning: 'high"; malicious=true';
		}>().not.toMatchTypeOf<CommonspaceMutation>();
	});

	it("adds and removes a discovered Codex harness with its channel and session state", () => {
		const state = addDiscoveredAgent(
			createInitialState(),
			{
				id: "codex",
				displayName: "Codex",
				adapter: "codex",
				model: null,
				status: "stopped",
			},
			{ ids: () => "unused", now: () => "2026-08-25T01:00:00.000Z" },
		);

		expect(state.agents).toEqual([
			{
				id: "codex",
				displayName: "Codex",
				adapter: "codex",
				model: null,
				createdAt: "2026-08-25T01:00:00.000Z",
			},
		]);

		const seeded = {
			...state,
			channels: [
				{
					id: "channel-1",
					name: "general",
					projectId: null,
					agentIds: ["codex"],
					instructions: "",
					memory: {
						summary: "",
						decisions: [],
						openQuestions: [],
						threadIds: [],
						updatedAt: null,
					},
					createdAt: "now",
				},
			],
			agentSessions: {
				codex: { "Bot Chat": "123e4567-e89b-42d3-a456-426614174000" },
			},
			messages: { "dm:codex": [] },
		};
		const removed = applyMutation(seeded, {
			action: "remove-agent",
			agentId: "codex",
		});

		expect(removed.agents).toEqual([]);
		expect(removed.channels[0]?.agentIds).toEqual([]);
		expect(removed.agentSessions).toEqual({});
		expect(removed.messages).toEqual({});
	});

	it("keeps harness workspace names unique", () => {
		const withHermes = addDiscoveredAgent(
			createInitialState(),
			{
				id: "hermes",
				displayName: "Assistant",
				adapter: "hermes",
				model: null,
				status: "running",
			},
			{ ids: () => "unused", now: () => "now" },
		);
		const withCodex = addDiscoveredAgent(
			withHermes,
			{
				id: "codex",
				displayName: "Assistant",
				adapter: "codex",
				model: null,
				status: "unknown",
			},
			{ ids: () => "unused", now: () => "now" },
		);

		expect(
			withCodex.agents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName,
				nativeProfile: agent.nativeProfile,
			})),
		).toEqual([
			{ id: "hermes", displayName: "Assistant", nativeProfile: undefined },
			{
				id: "codex",
				displayName: "Assistant (Codex)",
				nativeProfile: undefined,
			},
		]);
	});

	it("rejects a workspace-name edit that duplicates another agent tag", () => {
		const state = {
			...createInitialState(),
			agents: [
				{
					id: "frontend",
					displayName: "Front End",
					adapter: "hermes" as const,
					model: null,
					createdAt: "now",
				},
				{
					id: "codex-reviewer",
					displayName: "Reviewer",
					adapter: "codex" as const,
					nativeProfile: "reviewer",
					model: null,
					createdAt: "now",
				},
			],
		};

		expect(() =>
			applyMutation(state, {
				action: "update-agent-profile",
				agentId: "codex-reviewer",
				displayName: "front-end",
			}),
		).toThrow("agent workspace name already exists");
	});

	it("removes native thread sessions with a deleted channel while preserving DMs", () => {
		const threadId = "123e4567-e89b-42d3-a456-426614174000";
		const sessionId = "223e4567-e89b-42d3-a456-426614174000";
		const state = {
			...createInitialState(),
			channels: [
				{
					id: "channel-1",
					name: "general",
					projectId: null,
					agentIds: ["codex-review-bot"],
					instructions: "",
					memory: {
						summary: "",
						decisions: [],
						openQuestions: [],
						threadIds: [threadId],
						updatedAt: null,
					},
					createdAt: "now",
				},
			],
			threads: [
				{
					id: threadId,
					channelId: "channel-1",
					projectId: null,
					rootMessageId: "root-1",
					agentIds: ["codex-review-bot"],
					status: "complete" as const,
					createdAt: "now",
					updatedAt: "now",
				},
			],
			agentSessions: {
				"codex-review-bot": {
					"Bot Chat": sessionId,
					[`Commonspace Thread: ${threadId}`]: sessionId,
				},
			},
		};

		expect(
			applyMutation(state, { action: "remove-channel", channelId: "channel-1" })
				.agentSessions,
		).toEqual({
			"codex-review-bot": { "Bot Chat": sessionId },
		});
	});
});
