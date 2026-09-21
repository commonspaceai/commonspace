import { expect, it } from "vitest";
import {
	COMMONSPACE_STATE_VERSION,
	type CommonspaceState,
} from "../packages/shared/src/contracts.ts";
import { projectChannelMemory } from "../server/src/memory.ts";

it("tracks source coverage without pretending transcript snippets are a semantic brief", () => {
	const state: CommonspaceState = {
		version: COMMONSPACE_STATE_VERSION,
		revision: 4,
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
				projectId: null,
				agentIds: ["frontend"],
				instructions: "",
				memory: {
					summary: "",
					decisions: [],
					openQuestions: [],
					threadIds: [],
					updatedAt: null,
				},
				createdAt: "2026-08-25T00:00:00Z",
			},
		],
		threads: [
			{
				id: "thread-1",
				channelId: "general",
				projectId: null,
				rootMessageId: "root-1",
				agentIds: ["frontend"],
				status: "complete",
				createdAt: "2026-08-25T00:00:00Z",
				updatedAt: "2026-08-25T00:01:00Z",
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
					text: "Checkout fails after payment. Open question: Is state reset?",
					createdAt: "2026-08-25T00:00:00Z",
					threadId: "thread-1",
				},
				{
					id: "reply-1",
					conversation: { kind: "channel", id: "general" },
					authorType: "agent",
					authorId: "frontend",
					authorName: "Frontend",
					text: "Decision: reset checkout state after success.",
					createdAt: "2026-08-25T00:01:00Z",
					threadId: "thread-1",
					parentMessageId: "root-1",
				},
			],
		},
	};
	const memory = projectChannelMemory(state, "general");
	expect(memory.summary).toBe("");
	expect(memory.decisions).toEqual([]);
	expect(memory.openQuestions).toEqual([]);
	expect(memory.status).toBe("stale");
	expect(memory.threadIds).toEqual(["thread-1"]);
});

it("tracks the newest source message across included threads", () => {
	const state: CommonspaceState = {
		version: COMMONSPACE_STATE_VERSION,
		revision: 8,
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
				memory: {
					summary: "",
					decisions: [],
					openQuestions: [],
					threadIds: [],
					updatedAt: null,
				},
				createdAt: "2026-08-25T00:00:00Z",
			},
		],
		threads: [
			{
				id: "older-thread",
				channelId: "general",
				projectId: null,
				rootMessageId: "older-root",
				agentIds: [],
				createdAt: "2026-08-25T00:00:00Z",
			},
			{
				id: "newer-thread",
				channelId: "general",
				projectId: null,
				rootMessageId: "newer-root",
				agentIds: [],
				createdAt: "2026-08-25T01:00:00Z",
			},
		],
		messages: {
			"channel:general": [
				{
					id: "older-root",
					conversation: { kind: "channel", id: "general" },
					authorType: "user",
					authorId: "user",
					authorName: "Ralph",
					text: "Older thread.",
					createdAt: "2026-08-25T00:00:00Z",
					threadId: "older-thread",
				},
				{
					id: "newer-root",
					conversation: { kind: "channel", id: "general" },
					authorType: "user",
					authorId: "user",
					authorName: "Ralph",
					text: "Newer thread.",
					createdAt: "2026-08-25T01:00:00Z",
					threadId: "newer-thread",
				},
				{
					id: "newer-reply",
					conversation: { kind: "channel", id: "general" },
					authorType: "agent",
					authorId: "agent",
					authorName: "Agent",
					text: "Newer thread reply.",
					createdAt: "2026-08-25T01:01:00Z",
					threadId: "newer-thread",
					parentMessageId: "newer-root",
				},
				{
					id: "late-older-reply",
					conversation: { kind: "channel", id: "general" },
					authorType: "user",
					authorId: "user",
					authorName: "Ralph",
					text: "Latest message in the older thread.",
					createdAt: "2026-08-25T02:00:00Z",
					threadId: "older-thread",
					parentMessageId: "older-root",
				},
			],
		},
	};

	const memory = projectChannelMemory(state, "general");

	expect(memory.compactedThroughMessageId).toBe("late-older-reply");
	expect(memory.updatedAt).toBe("2026-08-25T02:00:00Z");
	expect(memory.sourceMessageCount).toBe(4);
});
