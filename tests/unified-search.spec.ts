// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CommonspaceBootstrap,
	CommonspaceState,
} from "@commonspace/shared";
import { COMMONSPACE_STATE_VERSION } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { searchCommonspace } from "../server/src/search.ts";

const searchRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		searchRoots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

function bootstrap(): CommonspaceBootstrap {
	const state: CommonspaceState = {
		version: COMMONSPACE_STATE_VERSION,
		revision: 1,
		inboxReadAt: null,
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
				createdAt: "2026-08-01T00:00:00.000Z",
			},
		],
		dmSessions: {},
		agentSessions: {},
		projects: [
			{
				id: "storefront",
				name: "Storefront",
				paths: [],
				createdAt: "2026-08-01T00:00:00.000Z",
			},
		],
		channels: [
			{
				id: "general",
				name: "general",
				agentIds: ["backend"],
				instructions: "Coordinate launch work",
				memory: {
					summary: "Launch brief: validate the recovery checklist.",
					decisions: ["Use the blue-green recovery plan."],
					openQuestions: [],
					threadIds: ["thread-1"],
					updatedAt: "2026-08-20T00:00:00.000Z",
				},
				createdAt: "2026-08-01T00:00:00.000Z",
			},
		],
		threads: [
			{
				id: "thread-1",
				channelId: "general",
				projectId: "storefront",
				rootMessageId: "message-1",
				agentIds: ["backend"],
				createdAt: "2026-08-20T00:00:00.000Z",
			},
		],
		messages: {
			"channel:general": [
				{
					id: "message-1",
					conversation: { kind: "channel", id: "general" },
					authorType: "user",
					authorId: "ralph",
					authorName: "Ralph",
					text: "Run the recovery checklist.",
					projectId: "storefront",
					threadId: "thread-1",
					files: [
						{
							id: "file-1",
							name: "verification-notes.txt",
							mimeType: "text/plain",
							size: 128,
						},
					],
					createdAt: "2026-08-20T00:00:00.000Z",
				},
				{
					id: "message-2",
					conversation: { kind: "channel", id: "general" },
					authorType: "agent",
					authorId: "backend",
					authorName: "Backend",
					text: "Recovery run completed.",
					projectId: "storefront",
					threadId: "thread-1",
					parentMessageId: "message-1",
					sourceMessageId: "message-1",
					replyStatus: "complete",
					createdAt: "2026-08-20T00:01:00.000Z",
					trace: {
						adapter: "hermes",
						startedAt: "2026-08-20T00:00:05.000Z",
						completedAt: "2026-08-20T00:01:00.000Z",
						entries: [
							{
								type: "tool",
								id: "tool-1",
								title: "Verify recovery health endpoint",
								toolName: "terminal",
								status: "completed",
								output: "recovery healthy",
								createdAt: "2026-08-20T00:00:30.000Z",
								updatedAt: "2026-08-20T00:00:31.000Z",
							},
						],
					},
				},
			],
			"dm:backend": [
				{
					id: "dm-1",
					conversation: { kind: "dm", id: "backend" },
					authorType: "user",
					authorId: "ralph",
					authorName: "Ralph",
					text: "Recovery notes are ready.",
					createdAt: "2026-08-21T00:00:00.000Z",
				},
			],
		},
	};
	return {
		agents: [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes",
				model: null,
				status: "running",
				description: "Recovery specialist",
			},
		],
		discoveredAgents: [],
		state,
		liveActivities: [],
	};
}

describe("unified search", () => {
	it("finds Projects directly without exposing their local roots", async () => {
		const input = bootstrap();
		const project = input.state.projects[0];
		if (project === undefined) throw new Error("Missing Project");
		project.paths = ["/private/synthetic-root"];
		const result = await searchCommonspace(input, {
			query: "storefront",
			kinds: ["project"],
			projectId: project.id,
		});
		expect(result.results).toMatchObject([
			{
				kind: "project",
				title: "Storefront",
				projectIds: [project.id],
				target: { kind: "project", projectId: project.id },
			},
		]);
		expect(JSON.stringify(result)).not.toContain("/private/synthetic-root");
		const filtered = await searchCommonspace(input, {
			query: "storefront",
			kinds: ["project"],
			projectId: "other",
		});
		expect(filtered.results).toEqual([]);
	});

	it("opens the exact matching reply for messages, runs, and traces", async () => {
		const result = await searchCommonspace(bootstrap(), {
			query: "recovery",
			limit: 50,
		});
		for (const id of [
			"message:message-2",
			"run:message-2",
			"trace:message-2:tool-1",
		]) {
			expect(
				result.results.find((item) => item.id === id)?.target,
			).toMatchObject({
				kind: "conversation",
				threadId: "thread-1",
				messageId: "message-2",
			});
		}
	});
	it("finds durable message attachments by filename", async () => {
		const result = await searchCommonspace(bootstrap(), {
			query: "verification-notes",
			kinds: ["file"],
			limit: 10,
		});

		expect(result.results).toEqual([
			expect.objectContaining({
				id: "attachment:file-1",
				kind: "file",
				title: "verification-notes.txt",
				detail: "text/plain · 128 bytes",
				target: {
					kind: "conversation",
					conversation: { kind: "channel", id: "general" },
					threadId: "thread-1",
					messageId: "message-1",
				},
			}),
		]);
	});

	it("searches messages, DMs, agents, traces, decisions, runs, and briefs with inspectable receipts", async () => {
		const result = await searchCommonspace(bootstrap(), {
			query: "recovery",
			limit: 50,
		});
		const kinds = new Set(result.results.map((item) => item.kind));

		expect(kinds).toEqual(
			new Set(["message", "dm", "agent", "trace", "decision", "run", "brief"]),
		);
		expect(["message", "dm", "channel", "agent"]).toContain(
			result.results[0]?.kind,
		);
		expect(
			result.results.every(
				(item) => item.receipt !== "" && item.highlights.length > 0,
			),
		).toBe(true);
		expect(
			result.results.find((item) => item.kind === "message"),
		).toMatchObject({
			target: {
				kind: "conversation",
				conversation: { kind: "channel", id: "general" },
				threadId: "thread-1",
				messageId: "message-2",
			},
		});
		expect(result.results.find((item) => item.kind === "dm")).toMatchObject({
			target: {
				kind: "conversation",
				conversation: { kind: "dm", id: "backend" },
				messageId: "dm-1",
			},
		});
	});

	it("supports type and project filters without leaking unrelated result classes", async () => {
		const result = await searchCommonspace(bootstrap(), {
			query: "recovery",
			kinds: ["trace", "decision"],
			projectId: "storefront",
			limit: 20,
		});

		expect(result.results.map((item) => item.kind).sort()).toEqual([
			"decision",
			"trace",
		]);
		expect(result.appliedFilters).toEqual({
			kinds: ["trace", "decision"],
			projectId: "storefront",
		});
	});
});

describe("filesystem search", () => {
	it("keeps the filesystem result budget global across missing and later roots", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-search-budget-"));
		searchRoots.push(root);
		const firstRoot = join(root, "first");
		const laterRoot = join(root, "later");
		await mkdir(join(firstRoot, "nested"), { recursive: true });
		await mkdir(laterRoot);
		await Promise.all(
			Array.from({ length: 40 }, (_, index) =>
				writeFile(
					join(firstRoot, `budget-match-${String(index).padStart(2, "0")}.txt`),
					"fixture",
				),
			),
		);
		await writeFile(
			join(firstRoot, "nested", "budget-match-nested.txt"),
			"fixture",
		);
		await writeFile(join(laterRoot, "budget-match-later.txt"), "fixture");

		const input = bootstrap();
		const project = input.state.projects[0];
		if (project === undefined) throw new Error("Missing Project");
		project.paths = [join(root, "missing"), firstRoot, laterRoot];
		const result = await searchCommonspace(input, {
			query: "budget-match",
			kinds: ["file"],
			projectId: project.id,
			limit: 100,
		});

		expect(result.results).toHaveLength(40);
		expect(
			result.results.every(
				(candidate) =>
					candidate.target.kind === "project-file" &&
					candidate.target.rootIndex === 1 &&
					!candidate.target.path.includes("nested") &&
					!candidate.target.path.includes("later"),
			),
		).toBe(true);
	});
});
