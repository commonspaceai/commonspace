import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommonspaceApp } from "../server/src/app.ts";
import {
	CommonspaceMcpGateway,
	type CommonspaceMcpScope,
	exactOptionalTransport,
} from "../server/src/commonspace-mcp.ts";
import { CommonspaceHostService } from "../server/src/service.ts";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(closers.splice(0).map((close) => close()));
});

describe("Commonspace MCP gateway", () => {
	it("serves bounded session-scoped context over authenticated loopback HTTP", async () => {
		const readMessages = vi.fn(async () => ({
			messages: [
				{
					id: "message-older",
					authorType: "user" as const,
					authorId: "user",
					authorName: "Ralph",
					text: "Earlier context.",
					createdAt: "2026-09-01T00:00:00.000Z",
				},
			],
			nextBefore: null,
		}));
		const searchMessages = vi.fn(async () => ({
			results: [
				{
					id: "message-match",
					authorType: "user" as const,
					authorId: "user",
					authorName: "Ralph",
					text: "Session recovery details.",
					createdAt: "2026-09-01T00:00:00.000Z",
					matchedTerms: ["session recovery"],
				},
			],
		}));
		const postProgress = vi.fn(
			async (_scope: CommonspaceMcpScope, text: string) => ({
				messageId: `posted:${text}`,
			}),
		);
		const handoff = vi.fn(
			async (
				_scope: CommonspaceMcpScope,
				input: { targetAgentId: string; request: string },
			) => ({
				targetAgentId: input.targetAgentId,
				targetDisplayName: "Frontend",
			}),
		);
		const gateway = new CommonspaceMcpGateway({
			browseHistory: async () => {
				throw new Error("History not configured in this gateway fixture");
			},
			findHistory: async () => {
				throw new Error("History not configured in this gateway fixture");
			},
			readContext: async (scope) => ({
				agent: {
					id: scope.agentId,
					displayName: "Review Bot",
					adapter: "codex" as const,
				},
				conversation: { kind: "channel", id: "channel-1", name: "engineering" },
				instructions: "Keep changes scoped.",
				memory: {
					summary: "",
					decisions: [],
					openQuestions: [],
					threadIds: [],
					updatedAt: null,
				},
				pins: [],
				participants: [],
				messages: [
					{
						id: "message-1",
						authorType: "user" as const,
						authorId: "user",
						authorName: "Ralph",
						text: "Review the relay.",
						createdAt: "2026-09-01T00:00:00.000Z",
					},
				],
			}),
			readMessages,
			searchMessages,
			handoff,
			postProgress,
		});
		const credential = gateway.issue({
			agentId: "codex-review-bot",
			conversation: { kind: "channel", id: "channel-1" },
			threadId: "thread-1",
			peers: [
				{
					id: "frontend",
					displayName: "Frontend",
				},
			],
		});
		const root = await mkdtemp(join(tmpdir(), "commonspace-mcp-gateway-"));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();
		const app = createCommonspaceApp({ service, mcpGateway: gateway });
		const server = createServer(app);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (address === null || typeof address === "string")
			throw new Error("test server did not expose a TCP address");
		const url = new URL(`http://127.0.0.1:${String(address.port)}/api/mcp`);
		closers.push(async () => {
			await gateway.close();
			await service.close();
			await new Promise<void>((resolve, reject) =>
				server.close((error) =>
					error === undefined ? resolve() : reject(error),
				),
			);
			await rm(root, { recursive: true, force: true });
		});

		const unauthorized = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(unauthorized.status).toBe(401);

		const client = new Client({
			name: "commonspace-mcp-test",
			version: "1.0.0",
		});
		const transport = new StreamableHTTPClientTransport(url, {
			requestInit: { headers: { authorization: `Bearer ${credential.token}` } },
		});
		await client.connect(exactOptionalTransport(transport));
		const manifest = JSON.parse(
			await readFile(
				new URL("../server/package.json", import.meta.url),
				"utf8",
			),
		);
		expect(client.getServerVersion()).toEqual({
			name: "commonspace",
			version: manifest.version,
		});
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual([
			"commonspace_get_context",
			"commonspace_browse_history",
			"commonspace_find_history",
			"commonspace_read_messages",
			"commonspace_search",
			"commonspace_handoff",
			"commonspace_post_progress",
		]);
		expect(
			tools.tools.find((tool) => tool.name === "commonspace_handoff"),
		).toMatchObject({
			description: expect.stringContaining(
				'{"targetAgentId":"frontend","displayName":"Frontend"}',
			),
			inputSchema: {
				properties: {
					targetAgentId: { enum: ["frontend"] },
				},
			},
		});
		const contextTool = tools.tools.find(
			(tool) => tool.name === "commonspace_get_context",
		);
		expect(contextTool?.description).toContain("when needed");
		expect(contextTool?.description).not.toContain("Call once");
		const context = await client.callTool({
			name: "commonspace_get_context",
			arguments: {},
		});
		expect(context.structuredContent).toMatchObject({
			agent: { id: "codex-review-bot" },
			conversation: { id: "channel-1" },
			messages: [{ text: "Review the relay." }],
		});
		const history = await client.callTool({
			name: "commonspace_read_messages",
			arguments: { before: "message-1", limit: 7 },
		});
		expect(history.structuredContent).toMatchObject({
			messages: [{ id: "message-older", text: "Earlier context." }],
		});
		expect(readMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex-review-bot",
				conversation: { kind: "channel", id: "channel-1" },
				threadId: "thread-1",
			}),
			{ before: "message-1", limit: 7 },
		);
		const search = await client.callTool({
			name: "commonspace_search",
			arguments: { query: '"session recovery" -failed', limit: 9 },
		});
		expect(search.structuredContent).toMatchObject({
			results: [{ id: "message-match", text: "Session recovery details." }],
		});
		expect(searchMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex-review-bot",
				conversation: { kind: "channel", id: "channel-1" },
				threadId: "thread-1",
			}),
			{ query: '"session recovery" -failed', limit: 9 },
		);
		const handoffResult = await client.callTool({
			name: "commonspace_handoff",
			arguments: {
				targetAgentId: "frontend",
				request: "Review the client boundary and return blocking concerns.",
			},
		});
		expect(handoffResult.structuredContent).toEqual({
			targetAgentId: "frontend",
			targetDisplayName: "Frontend",
		});
		expect(handoff).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex-review-bot",
				threadId: "thread-1",
			}),
			{
				targetAgentId: "frontend",
				request: "Review the client boundary and return blocking concerns.",
			},
		);
		const progress = await client.callTool({
			name: "commonspace_post_progress",
			arguments: { text: "Reviewing now." },
		});
		expect(progress.structuredContent).toEqual({
			messageId: "posted:Reviewing now.",
		});
		expect(postProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex-review-bot",
				threadId: "thread-1",
			}),
			"Reviewing now.",
		);
		await client.close();
	});
});
