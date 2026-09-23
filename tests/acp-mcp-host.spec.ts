import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SendMessageRequest } from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const runningServers: RunningCommonspaceServer[] = [];
const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"fake-acp-agent.mjs",
);

afterEach(async () => {
	await Promise.all(runningServers.splice(0).map((server) => server.close()));
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Commonspace ACP session context", () => {
	it.each(["channel", "dm"] as const)(
		"keeps one visible reply when a %s turn posts its final text as progress",
		async (kind) => {
			const root = await mkdtemp(join(tmpdir(), "commonspace-progress-reply-"));
			roots.push(root);
			const postedIds: string[] = [];
			const resumedSessions: (string | undefined)[] = [];
			const running = await startCommonspaceServer({
				root,
				port: 0,
				dependencies: {
					discoverAgents: discoverTestHarnesses,
					runAgent: async (input) => {
						const scope = mustExist(input.commonspaceScope);
						resumedSessions.push(input.sessionId);
						if (resumedSessions.length === 1) {
							await running.service.postProgress(
								scope,
								"Checking the request.",
							);
							const posted = await running.service.postProgress(
								scope,
								"Hello all!",
							);
							postedIds.push(posted.messageId);
							return {
								text: "  Hello all!\n",
								sessionId: "native-progress-session",
								trace: {
									adapter: "codex",
									startedAt: "2026-09-23T01:00:00.000Z",
									completedAt: "2026-09-23T01:00:01.000Z",
									entries: [],
								},
							};
						}
						await running.service.postProgress(scope, "Checking again.");
						return { text: "Hello all!", sessionId: "native-progress-session" };
					},
				},
				logger: { info: () => undefined, warn: () => undefined },
			});
			runningServers.push(running);
			await addTestHarness(running.service, "codex", "Review Bot");
			const channel = mustExist(
				(
					await running.service.mutate({
						action: "create-channel",
						name: "engineering",
						agentIds: ["codex"],
					})
				).channels[0],
			);
			const conversation = {
				kind,
				id: kind === "channel" ? channel.id : "codex",
			};
			const sent = await running.service.send({
				conversation,
				text: "@Review-Bot say hello all",
			});
			await running.service.whenIdle();
			const key = `${kind}:${conversation.id}`;
			const firstReplies = (
				running.service.snapshot().messages[key] ?? []
			).filter((message) => message.authorType === "agent");
			expect(firstReplies.map((message) => message.text.trim())).toEqual([
				"Checking the request.",
				"Hello all!",
			]);
			const reply = mustExist(firstReplies[1]);
			expect(reply).toMatchObject({
				id: postedIds[0],
				sourceMessageId: sent.accepted.id,
				trace: { adapter: "codex" },
			});
			if (sent.thread !== undefined) {
				expect(reply).toMatchObject({
					threadId: sent.thread.id,
					parentMessageId: sent.thread.rootMessageId,
					routingAssignmentId: sent.accepted.routing?.assignments[0]?.id,
				});
			}
			const persisted = JSON.parse(
				await readFile(join(root, "state.json"), "utf8"),
			);
			expect(
				persisted.messages[key].filter(
					(message: { authorType: string }) => message.authorType === "agent",
				),
			).toHaveLength(2);

			const followup: SendMessageRequest = {
				conversation,
				text: "@Review-Bot say hello all again",
			};
			if (sent.thread !== undefined) followup.threadId = sent.thread.id;
			await running.service.send(followup);
			await running.service.whenIdle();
			const replies = (running.service.snapshot().messages[key] ?? []).filter(
				(message) => message.authorType === "agent",
			);
			expect(replies.map((message) => message.text.trim())).toEqual([
				"Checking the request.",
				"Hello all!",
				"Checking again.",
				"Hello all!",
			]);
			expect(resumedSessions).toEqual([undefined, "native-progress-session"]);
			if (kind === "dm")
				expect(running.service.snapshot().messages[key]?.[0]?.replyStatus).toBe(
					"complete",
				);
		},
	);

	it("attaches a bearer-scoped MCP server instead of replaying room context in the prompt", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-mcp-host-"));
		roots.push(root);
		vi.stubEnv("FAKE_ACP_USE_MCP", "1");
		const running = await startCommonspaceServer({
			root,
			port: 0,
			codexAcpCommand: process.execPath,
			codexAcpArgs: [fixturePath],
			dependencies: {
				discoverAgents: discoverTestHarnesses,
				routeAgents: async (input) => ({
					mode: "parallel",
					assignments: [
						{
							agentId: mustExist(input.candidates[0]).id,
							projectIds: input.projects.map((project) => project.id),
						},
					],
					reason: "Test inference selected the channel agent.",
				}),
			},
			logger: { info: () => undefined, warn: () => undefined },
		});
		runningServers.push(running);
		const workspace = join(root, "private-workspace");
		await mkdir(workspace);
		await addTestHarness(running.service, "codex", "Review Bot");
		const project = mustExist(
			(
				await running.service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects.find((project) => project.name === "App"),
		);
		const state = await running.service.mutate({
			action: "create-channel",
			name: "engineering",
			projectId: project.id,
			agentIds: ["codex"],
		});
		const channel = mustExist(state.channels[0]);
		await running.service.mutate({
			action: "set-channel-context",
			channelId: channel.id,
			instructions: "Keep changes scoped.",
		});

		await running.service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: project.id,
			text: "Review the relay.",
		});
		await running.service.whenIdle();

		expect(
			running.service.snapshot().messages[`channel:${channel.id}`]?.at(-1)
				?.text,
		).toContain(
			[
				"Context: engineering; instructions: Keep changes scoped.",
				"Echo: Review the relay.",
			].join("\n"),
		);
		const privateState = running.service.snapshot();
		const thread = mustExist(privateState.threads[0]);
		const context = await running.service.readContext({
			agentId: "codex",
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			sessionName: `Commonspace Thread: ${thread.id}`,
			projectId: project.id,
		});
		expect(context.project).toEqual({ id: project.id, name: "App" });
		expect(JSON.stringify(context)).not.toContain(workspace);
		const nativeSessionId =
			privateState.agentSessions["codex"]?.[`Commonspace Thread: ${thread.id}`];
		expect(nativeSessionId).toEqual(expect.any(String));
		expect(JSON.stringify(context)).not.toContain(mustExist(nativeSessionId));

		const search = await running.service.searchMessages(
			{
				agentId: "codex",
				conversation: { kind: "channel", id: channel.id },
				threadId: thread.id,
				sessionName: `Commonspace Thread: ${thread.id}`,
				projectId: project.id,
			},
			{ query: '"review the relay" -echo', limit: 20 },
		);
		expect(search).toMatchObject({
			results: [
				{
					text: "Review the relay.",
					authorName: "Ralph",
					threadId: thread.id,
				},
			],
		});

		const scope = {
			agentId: "codex",
			conversation: { kind: "channel" as const, id: channel.id },
			threadId: thread.id,
			sessionName: `Commonspace Thread: ${thread.id}`,
			projectId: project.id,
		};
		await running.service.postProgress(
			scope,
			`${"prefix ".repeat(90)}unique needle${" suffix".repeat(90)}`,
		);
		const distantMatch = await running.service.searchMessages(scope, {
			query: '"unique needle"',
			limit: 1,
		});
		expect(distantMatch).toMatchObject({
			results: [{ text: expect.stringContaining("unique needle") }],
		});
	});

	it("routes a native MCP handoff to another Channel agent with a clean prompt", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-mcp-handoff-"));
		roots.push(root);
		vi.stubEnv("FAKE_ACP_USE_MCP", "1");
		vi.stubEnv("FAKE_ACP_HANDOFF_TRIGGER", "HANDOFF_TO_FRONTEND");
		vi.stubEnv("FAKE_ACP_HANDOFF_TARGET", "frontend");
		vi.stubEnv("FAKE_ACP_HANDOFF_REQUEST", "Review the API boundary.");
		const agents = ["backend", "frontend"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "gpt-test",
			status: "stopped" as const,
		}));
		const running = await startCommonspaceServer({
			root,
			port: 0,
			hermesAcpCommand: process.execPath,
			hermesAcpArgs: [fixturePath],
			dependencies: {
				discoverAgents: async () => agents,
			},
			logger: { info: () => undefined, warn: () => undefined },
		});
		runningServers.push(running);
		await running.service.discoverAgents("hermes");
		for (const agent of agents) {
			await running.service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
				adapter: "hermes",
			});
		}
		const channel = mustExist(
			(
				await running.service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await running.service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend HANDOFF_TO_FRONTEND",
		});
		await running.service.whenIdle();

		const replies = (
			running.service.snapshot().messages[`channel:${channel.id}`] ?? []
		).filter((message) => message.authorType === "agent");
		expect(replies.map((message) => message.authorId)).toEqual([
			"backend",
			"frontend",
		]);
		expect(replies[0]?.text).toContain("@frontend Review the API boundary.");
		expect(replies[1]?.text).toContain(
			"Echo: From Backend:\n\nReview the API boundary.",
		);
	});

	it("revokes the old MCP capability at a hard DM reset boundary", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-acp-mcp-reset-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		const running = await startCommonspaceServer({
			root,
			port: 0,
			codexAcpCommand: process.execPath,
			codexAcpArgs: [fixturePath],
			dependencies: { discoverAgents: discoverTestHarnesses },
			logger: { info: () => undefined, warn: () => undefined },
		});
		runningServers.push(running);
		await addTestHarness(running.service, "codex", "Review Bot");
		await running.service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Start generation.",
		});
		await running.service.whenIdle();
		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const authorization = mustExist(
			frames
				.find((frame) => frame.method === "session/new")
				?.params.mcpServers[0].headers.find(
					(header: { name: string; value: string }) =>
						header.name === "Authorization",
				)?.value,
		);

		await running.service.mutate({ action: "reset-dm", agentId: "codex" });
		const resetScope = mustExist(
			running.service.snapshot().dmSessions["codex"],
		);
		const resetContext = await running.service.readContext({
			agentId: "codex",
			conversation: { kind: "dm", id: "codex" },
			sessionName: resetScope,
		});
		expect(resetContext.messages).toEqual([]);
		expect(
			running.service
				.snapshot()
				.messages["dm:codex"]?.map((message) => message.text),
		).toContain("Start generation.");
		const response = await fetch(`${running.url}/api/mcp`, {
			method: "POST",
			headers: { authorization, "content-type": "application/json" },
			body: "{}",
		});
		expect(response.status).toBe(401);
	});

	it("gives a Hermes profile scoped Channel context through MCP without prompt replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-hermes-acp-mcp-"));
		roots.push(root);
		const logPath = join(root, "frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", logPath);
		vi.stubEnv("FAKE_ACP_USE_MCP", "1");
		const running = await startCommonspaceServer({
			root,
			port: 0,
			hermesAcpCommand: process.execPath,
			hermesAcpArgs: [fixturePath],
			dependencies: {
				discoverAgents: async () => [
					{
						id: "default",
						displayName: "Default",
						adapter: "hermes",
						model: "gpt-test",
						status: "stopped",
					},
				],
				routeAgents: async (input) => ({
					mode: "parallel",
					assignments: [
						{
							agentId: mustExist(input.candidates[0]).id,
							projectIds: input.projects.map((project) => project.id),
						},
					],
					reason: "Test inference selected the channel agent.",
				}),
			},
			logger: { info: () => undefined, warn: () => undefined },
		});
		runningServers.push(running);
		await running.service.mutate({
			action: "add-discovered-agent",
			agentId: "default",
		});
		const channel = mustExist(
			(
				await running.service.mutate({
					action: "create-channel",
					name: "general",
					agentIds: ["default"],
				})
			).channels[0],
		);
		await running.service.mutate({
			action: "set-channel-context",
			channelId: channel.id,
			instructions: "Read this natively.",
		});

		await running.service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Only this Hermes delta.",
		});
		await running.service.whenIdle();

		expect(
			running.service.snapshot().messages[`channel:${channel.id}`]?.at(-1)
				?.text,
		).toContain(
			[
				"Context: general; instructions: Read this natively.",
				"Echo: Only this Hermes delta.",
			].join("\n"),
		);
		const frames = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(
			frames.find((frame) => frame.method === "session/prompt")?.params
				.prompt[0],
		).toEqual({ type: "text", text: "Only this Hermes delta." });
		const metadata = frames.find((frame) => frame.method === "session/prompt")
			?.params.prompt[1];
		expect(metadata?.type).toBe("text");
		expect(metadata?.text).toContain("Commonspace participation context");
		expect(metadata?.text).not.toContain("Read this natively.");
		expect(
			frames.find((frame) => frame.method === "session/new")?.params
				.mcpServers[0],
		).toMatchObject({
			type: "http",
			name: "commonspace",
		});
	});

	it("isolates MCP context between channel threads when the ACP adapter caches MCP servers per process", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-acp-mcp-thread-isolation-"),
		);
		roots.push(root);
		vi.stubEnv("FAKE_ACP_USE_MCP", "1");
		vi.stubEnv("FAKE_ACP_PROCESS_MCP", "1");
		vi.stubEnv("FAKE_ACP_THREAD_CONTEXT", "1");
		const running = await startCommonspaceServer({
			root,
			port: 0,
			hermesAcpCommand: process.execPath,
			hermesAcpArgs: [fixturePath],
			dependencies: {
				discoverAgents: async () => [
					{
						id: "default",
						displayName: "Default",
						adapter: "hermes",
						model: "gpt-test",
						status: "stopped",
					},
				],
				routeAgents: async (input) => ({
					mode: "parallel",
					assignments: [
						{
							agentId: mustExist(input.candidates[0]).id,
							projectIds: input.projects.map((project) => project.id),
						},
					],
					reason: "Test inference selected the channel agent.",
				}),
			},
			logger: { info: () => undefined, warn: () => undefined },
		});
		runningServers.push(running);
		await running.service.mutate({
			action: "add-discovered-agent",
			agentId: "default",
		});
		const channel = mustExist(
			(
				await running.service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["default"],
				})
			).channels[0],
		);

		const first = await running.service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "First root task.",
		});
		await running.service.whenIdle();
		const second = await running.service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Second unrelated root task.",
		});
		await running.service.whenIdle();

		const messages =
			running.service.snapshot().messages[`channel:${channel.id}`] ?? [];
		const secondReply = messages.find(
			(message) =>
				message.authorType === "agent" &&
				message.threadId === second.thread?.id,
		);
		expect(first.thread?.id).not.toBe(second.thread?.id);
		expect(secondReply?.text).toContain(
			`Context thread: ${second.thread?.id ?? ""}; root: Second unrelated root task.`,
		);
	});
});
