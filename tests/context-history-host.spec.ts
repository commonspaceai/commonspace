import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { createCommonspaceApp } from "../server/src/app.ts";
import {
	CommonspaceMcpGateway,
	type CommonspaceMcpScope,
	exactOptionalTransport,
} from "../server/src/commonspace-mcp.ts";
import type { HistoryEmbedder } from "../server/src/semantic-history.ts";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of closers.splice(0).reverse()) await close();
});

async function workspace(
	encoder: HistoryEmbedder = {
		embed: async () => {
			throw new Error("Model unavailable in offline scope test");
		},
	},
) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-history-"));
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			historyEmbeddings: encoder,
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => "Done.",
		},
	);
	await service.initialize();
	closers.push(async () => {
		await service.close();
		await rm(root, { recursive: true, force: true });
	});
	await addTestHarness(service, "codex");
	return service;
}

function scopeFor(channelId: string, threadId: string): CommonspaceMcpScope {
	return {
		agentId: "codex",
		conversation: { kind: "channel", id: channelId },
		threadId,
		sessionName: `Commonspace Thread: ${threadId}`,
	};
}

describe("history capability boundaries", () => {
	it.each(["delete", "reset"])(
		"rejects in-flight semantic evidence after %s",
		async (mutation) => {
			let release: (() => void) | undefined;
			let started: (() => void) | undefined;
			const ready = new Promise<void>((resolve) => {
				started = resolve;
			});
			let first = true;
			const encoder: HistoryEmbedder = {
				embed: async (texts) => {
					if (first) {
						first = false;
						await new Promise<void>((resolve) => {
							release = resolve;
							started?.();
						});
					}
					return texts.map(() => [1, 0]);
				},
			};
			const service = await workspace(encoder);
			const sent = await service.send({
				conversation: { kind: "dm", id: "codex" },
				text: "Preserve this private fact.",
			});
			await service.whenIdle();
			const pending = service.findHistory(
				{
					agentId: "codex",
					conversation: { kind: "dm", id: "codex" },
					sessionName: "Bot Chat",
				},
				{ query: "private fact", limit: 4 },
			);
			await ready;
			if (mutation === "delete") await service.deleteMessage(sent.accepted.id);
			else await service.mutate({ action: "reset-dm", agentId: "codex" });
			if (!release) throw new Error("Missing inference completion");
			release();
			await expect(pending).rejects.toThrow(/changed|generation expired/);
		},
	);

	it("retrieves an edit branch's permitted prefix without its superseded future", async () => {
		const service = await workspace();
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "edits",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const conversation = { kind: "channel" as const, id: channel.id };
		const root = await service.send({
			conversation,
			text: "@Codex BASE_CONSTRAINT must remain.",
		});
		await service.whenIdle();
		const original = await service.send({
			conversation,
			threadId: mustExist(root.thread).id,
			text: "@Codex SUPERSEDED_PLAN.",
		});
		await service.whenIdle();
		const edit = await service.editMessage({
			messageId: original.accepted.id,
			text: "@Codex CORRECTED_PLAN.",
		});
		await service.whenIdle();
		const scope = scopeFor(channel.id, mustExist(edit.thread).id);
		const evidence = await service.findHistory(scope, {
			query: "BASE_CONSTRAINT SUPERSEDED_PLAN CORRECTED_PLAN",
			limit: 8,
		});
		expect(evidence.results.map((hit) => hit.source.messageId).sort()).toEqual(
			[root.accepted.id, edit.accepted.id].sort(),
		);
		expect(JSON.stringify(evidence)).not.toContain("SUPERSEDED_PLAN");
	});

	it("serves exact evidence through real MCP while rejecting another Thread's node", async () => {
		const service = await workspace();
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const conversation = { kind: "channel" as const, id: channel.id };
		await service.send({
			conversation,
			text: "@Codex Preserve REFRESH_PROTOCOL_V7.",
		});
		await service.whenIdle();
		const first = mustExist(service.snapshot().threads[0]);
		const scope = scopeFor(channel.id, first.id);
		await service.send({
			conversation,
			text: "@Codex Other private thread: BILLING_SECRET_REFERENCE.",
		});
		await service.whenIdle();
		const second = mustExist(
			service.snapshot().threads.find((t) => t.id !== first.id),
		);
		const outside = mustExist(
			(
				await service.findHistory(scopeFor(channel.id, second.id), {
					query: "BILLING_SECRET_REFERENCE",
					limit: 1,
				})
			).results[0],
		);
		const before = service.snapshot();
		const gateway = new CommonspaceMcpGateway(service);
		const credential = gateway.issue(scope);
		const server = createServer(
			createCommonspaceApp({ service, mcpGateway: gateway }),
		);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		closers.push(async () => {
			await gateway.close();
			await new Promise<void>((resolve, reject) =>
				server.close((e) => (e ? reject(e) : resolve())),
			);
		});
		const address = server.address();
		if (address === null || typeof address === "string")
			throw new Error("Missing address");
		const client = new Client({ name: "history-test", version: "1" });
		await client.connect(
			exactOptionalTransport(
				new StreamableHTTPClientTransport(
					new URL(`http://127.0.0.1:${address.port}/api/mcp`),
					{
						requestInit: {
							headers: { authorization: `Bearer ${credential.token}` },
						},
					},
				),
			),
		);
		closers.push(() => client.close());
		const found = await client.callTool({
			name: "commonspace_find_history",
			arguments: { query: "REFRESH_PROTOCOL_V7 BILLING_SECRET_REFERENCE" },
		});
		expect(found.structuredContent).toMatchObject({
			method: "lexical",
			results: [{ source: { text: "@Codex Preserve REFRESH_PROTOCOL_V7." } }],
		});
		expect(JSON.stringify(found)).not.toContain("BILLING_SECRET_REFERENCE");
		const own = mustExist(
			(
				await service.findHistory(scope, {
					query: "REFRESH_PROTOCOL_V7",
					limit: 1,
				})
			).results[0],
		);
		const page = await client.callTool({
			name: "commonspace_browse_history",
			arguments: { nodeId: own.nodeId },
		});
		expect(page.structuredContent).toMatchObject({
			source: { messageId: own.source.messageId, text: own.source.text },
		});
		const denied = await client.callTool({
			name: "commonspace_browse_history",
			arguments: { nodeId: outside.nodeId },
		});
		expect(denied.isError).toBe(true);
		expect(service.snapshot()).toEqual(before);
	});

	it("expires cached DM evidence at /new and rejects deleted sources", async () => {
		const service = await workspace();
		const conversation = { kind: "dm" as const, id: "codex" };
		await service.send({ conversation, text: "Retain OLD_GENERATION_FACT." });
		await service.whenIdle();
		const oldScope: CommonspaceMcpScope = {
			agentId: "codex",
			conversation,
			sessionName: "Bot Chat",
		};
		const old = mustExist(
			(
				await service.findHistory(oldScope, {
					query: "OLD_GENERATION_FACT",
					limit: 1,
				})
			).results[0],
		);
		await service.mutate({ action: "reset-dm", agentId: "codex" });
		await expect(service.browseHistory(oldScope, old.nodeId)).rejects.toThrow(
			/generation expired/,
		);
		await service.send({ conversation, text: "Retain NEW_GENERATION_FACT." });
		await service.whenIdle();
		const scope = {
			...oldScope,
			sessionName: mustExist(service.snapshot().dmSessions.codex),
		};
		expect(
			(
				await service.findHistory(scope, {
					query: "OLD_GENERATION_FACT",
					limit: 1,
				})
			).results,
		).toEqual([]);
		await expect(service.browseHistory(scope, old.nodeId)).rejects.toThrow(
			/stale|scope/,
		);
		const fresh = mustExist(
			(
				await service.findHistory(scope, {
					query: "NEW_GENERATION_FACT",
					limit: 1,
				})
			).results[0],
		);
		await service.deleteMessage(fresh.source.messageId);
		await expect(service.browseHistory(scope, fresh.nodeId)).rejects.toThrow(
			/stale|scope/,
		);
		expect(
			(
				await service.findHistory(scope, {
					query: "NEW_GENERATION_FACT",
					limit: 1,
				})
			).results,
		).toEqual([]);
	});
});
