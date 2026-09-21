import {
	COMMONSPACE_STATE_VERSION,
	type CommonspaceLiveAgentActivity,
	type CommonspaceState,
	deriveCommonspaceInboxItems,
	deriveCommonspaceSessions,
} from "@commonspace/shared";
import { describe, expect, it } from "vitest";

function inboxState(): CommonspaceState {
	return {
		version: COMMONSPACE_STATE_VERSION,
		revision: 8,
		inboxReadAt: "2026-08-27T10:00:00.000Z",
		inboxReadMessageIds: [],
		inboxSavedItemIds: [],
		followedSessionIds: [],
		mutedSessionIds: [],
		defaults: {
			maxAgentsPerTurn: 4,
			memoryThreads: 12,
		},
		agents: [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes",
				model: null,
				createdAt: "2026-08-27T08:00:00.000Z",
			},
			{
				id: "reviewer",
				displayName: "Reviewer",
				adapter: "codex",
				model: null,
				createdAt: "2026-08-27T08:00:00.000Z",
			},
		],
		dmSessions: { reviewer: "Commonspace DM: private-native-scope" },
		agentSessions: { reviewer: { "Bot Chat": "private-native-session" } },
		projects: [
			{
				id: "project",
				name: "App",
				paths: ["/Users/private/workspace"],
				createdAt: "2026-08-27T08:00:00.000Z",
			},
		],
		channels: [
			{
				id: "general",
				name: "general",
				projectId: "project",
				agentIds: ["backend"],
				instructions: "",
				memory: {
					summary: "",
					decisions: [],
					openQuestions: [],
					threadIds: ["thread-1"],
					updatedAt: null,
				},
				createdAt: "2026-08-27T08:00:00.000Z",
			},
		],
		threads: [
			{
				id: "thread-1",
				channelId: "general",
				projectId: "project",
				rootMessageId: "root-1",
				agentIds: ["backend"],
				status: "complete",
				createdAt: "2026-08-27T09:59:00.000Z",
				updatedAt: "2026-08-27T10:02:00.000Z",
			},
		],
		pins: [],
		permissions: [],
		messages: {
			"channel:general": [
				{
					id: "root-1",
					conversation: { kind: "channel", id: "general" },
					authorType: "user",
					authorId: "user",
					authorName: "Ralph",
					text: "Please investigate.",
					createdAt: "2026-08-27T09:59:00.000Z",
				},
				{
					id: "reply-1",
					conversation: { kind: "channel", id: "general" },
					authorType: "agent",
					authorId: "backend",
					authorName: "Backend",
					text: "  Found the issue and fixed it.  ",
					createdAt: "2026-08-27T10:01:00.000Z",
					threadId: "thread-1",
					parentMessageId: "root-1",
				},
			],
			"dm:reviewer": [
				{
					id: "reply-old",
					conversation: { kind: "dm", id: "reviewer" },
					authorType: "agent",
					authorId: "reviewer",
					authorName: "Reviewer",
					text: "Earlier reply.",
					createdAt: "2026-08-27T10:00:00.000Z",
				},
				{
					id: "request-failed",
					conversation: { kind: "dm", id: "reviewer" },
					authorType: "user",
					authorId: "user",
					authorName: "Ralph",
					text: "Run the checks.",
					createdAt: "2026-08-27T10:03:00.000Z",
					replyStatus: "error",
					replyError: "Provider stopped unexpectedly.",
				},
			],
		},
	};
}

describe("Commonspace Inbox items", () => {
	it("surfaces pending native permission requests as durable attention items", () => {
		const state = inboxState();
		state.permissions = [
			{
				id: "permission-1",
				sourceMessageId: "root-1",
				agentId: "backend",
				conversation: { kind: "channel", id: "general" },
				threadId: "thread-1",
				toolCallId: "call-1",
				title: "Run database migration",
				kind: "execute",
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
				],
				status: "pending",
				createdAt: "2026-08-27T10:07:00.000Z",
				resolvedAt: null,
			},
		];

		expect(deriveCommonspaceInboxItems(state)[0]).toMatchObject({
			id: "permission:permission-1",
			messageId: "root-1",
			kind: "permission-request",
			actorId: "backend",
			actorName: "Backend",
			conversation: { kind: "channel", id: "general" },
			threadId: "thread-1",
			text: "Run database migration",
			unread: true,
		});
		expect(
			deriveCommonspaceSessions(state, [
				{
					id: "run-permission",
					sourceMessageId: "root-1",
					agentId: "backend",
					agentName: "Backend",
					adapter: "hermes",
					conversation: { kind: "channel", id: "general" },
					threadId: "thread-1",
					startedAt: "2026-08-27T10:06:00.000Z",
					entries: [],
				},
			])[0],
		).toMatchObject({
			status: "needs-attention",
			attentionKind: "permission-request",
		});
	});

	it("classifies replies, mentions, failures, timeouts, completions, and input requests", () => {
		const state = inboxState();
		state.messages["dm:reviewer"]?.push(
			{
				id: "request-timeout",
				conversation: { kind: "dm", id: "reviewer" },
				authorType: "user",
				authorId: "user",
				authorName: "Ralph",
				text: "Run the slow checks.",
				createdAt: "2026-08-27T10:04:00.000Z",
				replyStatus: "error",
				replyError: "Agent run timed out after 30 seconds.",
			},
			{
				id: "reply-input",
				sourceMessageId: "request-input",
				conversation: { kind: "dm", id: "reviewer" },
				authorType: "agent",
				authorId: "reviewer",
				authorName: "Reviewer",
				text: "I need your input: which environment should I deploy to?",
				createdAt: "2026-08-27T10:05:00.000Z",
			},
			{
				id: "reply-mention",
				sourceMessageId: "request-mention",
				conversation: { kind: "dm", id: "reviewer" },
				authorType: "agent",
				authorId: "reviewer",
				authorName: "Reviewer",
				text: "@Ralph the release summary is ready.",
				createdAt: "2026-08-27T10:06:00.000Z",
			},
		);
		const items = deriveCommonspaceInboxItems(state);

		expect(items.map((item) => item.kind)).toEqual([
			"mention",
			"possible-input-request",
			"timeout",
			"failure",
			"completion",
			"completion",
		]);
		expect(items.find((item) => item.messageId === "reply-1")?.text).toBe(
			"Found the issue and fixed it.",
		);
		expect(items.some((item) => item.text === "Please investigate.")).toBe(
			false,
		);
		expect(JSON.stringify(items)).not.toContain("/Users/private");
		expect(JSON.stringify(items)).not.toContain("private-native");
	});

	it("derives running, needs-attention, and completed sessions with durable preferences", () => {
		const state = inboxState();
		state.followedSessionIds = ["root-1:backend"];
		state.mutedSessionIds = ["request-failed:reviewer"];
		const liveActivities: CommonspaceLiveAgentActivity[] = [
			{
				id: "run-live",
				sourceMessageId: "root-1",
				agentId: "backend",
				agentName: "Backend",
				adapter: "hermes",
				conversation: { kind: "channel", id: "general" },
				threadId: "thread-1",
				startedAt: "2026-08-27T10:03:00.000Z",
				entries: [],
			},
		];

		const sessions = deriveCommonspaceSessions(state, liveActivities);

		expect(sessions.map((session) => session.status)).toEqual([
			"running",
			"needs-attention",
			"completed",
		]);
		expect(
			sessions.find((session) => session.id === "request-failed:reviewer"),
		).toMatchObject({
			attentionKind: "failure",
			muted: true,
		});
		expect(
			sessions.find((session) => session.id === "root-1:backend")?.followed,
		).toBe(true);
		expect(sessions[0]).toMatchObject({
			projectName: "App",
			conversationName: "#general",
		});
	});

	it("treats malformed legacy timestamps as read once a valid cursor exists", () => {
		const state = inboxState();
		state.threads = [];
		state.messages = {
			"dm:backend": [
				{
					id: "legacy-agent-reply",
					conversation: { kind: "dm", id: "backend" },
					authorType: "agent",
					authorId: "backend",
					authorName: "Backend",
					text: "Legacy reply",
					createdAt: "not-a-timestamp",
				},
			],
		};

		expect(deriveCommonspaceInboxItems(state)[0]?.unread).toBe(false);
	});
});
