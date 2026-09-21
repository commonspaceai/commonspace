// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMONSPACE_STATE_VERSION } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

function transcript(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `message-${String(index)}`,
		conversation: { kind: "dm", id: "codex-review-bot" },
		authorType: "user",
		authorId: "user",
		authorName: "Ralph",
		text: `Message ${String(index)}`,
		createdAt: "2026-08-31T00:00:00.000Z",
		replyStatus: "complete",
	}));
}

async function stateRoot(messageCount: number): Promise<string> {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-transcript-durability-"),
	);
	roots.push(root);
	await writeFile(
		join(root, "state.json"),
		JSON.stringify({
			version: COMMONSPACE_STATE_VERSION,
			revision: 1,
			defaults: {
				maxAgentsPerTurn: 4,
				memoryThreads: 12,
			},
			agents: [
				{
					id: "codex-review-bot",
					displayName: "Review Bot",
					adapter: "codex",
					model: null,
					createdAt: "2026-08-31T00:00:00.000Z",
				},
			],
			dmSessions: {},
			agentSessions: {},
			projects: [],
			channels: [],
			threads: [],
			messages: { "dm:codex-review-bot": transcript(messageCount) },
		}),
	);
	return root;
}

describe("Commonspace transcript durability", () => {
	it("restores every accepted message beyond the legacy 500-message boundary", async () => {
		const root = await stateRoot(501);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		const messages = service.snapshot().messages["dm:codex-review-bot"] ?? [];
		expect(messages).toHaveLength(501);
		expect(messages[0]?.id).toBe("message-0");
		expect(messages.at(-1)?.id).toBe("message-500");
	});

	it("appends a new request and reply without evicting existing messages", async () => {
		const root = await stateRoot(500);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [],
				runAgent: async () => ({ text: "New reply." }),
			},
		);
		await service.initialize();

		await service.send({
			conversation: { kind: "dm", id: "codex-review-bot" },
			text: "New request.",
		});
		await service.whenIdle();

		const messages = service.snapshot().messages["dm:codex-review-bot"] ?? [];
		expect(messages).toHaveLength(502);
		expect(messages[0]?.id).toBe("message-0");
		expect(messages.slice(-2).map((message) => message.text)).toEqual([
			"New request.",
			"New reply.",
		]);
	});
});
