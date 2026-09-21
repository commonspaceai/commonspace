import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CommonspaceMessage,
	CommonspaceRoutingProvider,
} from "@commonspace/shared";
import { describe, expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import {
	createInitialState,
	emptyChannelMemory,
	emptyRoutingMemory,
} from "../server/src/state.ts";
import { createThreadContext } from "../server/src/thread-context.ts";

describe.skipIf(process.env.COMMONSPACE_LIVE_CONTEXT !== "1")(
	"live context brief quality through Codex ACP",
	() => {
		it.each([
			{
				name: "social conversation",
				messages: [
					"Hi.",
					"Hi! What can I help you with?",
					"What can you do?",
					"I can help with coding, files, and explanations.",
				],
				empty: true,
			},
			{
				name: "answered question and superseded decision",
				messages: [
					"Can we use polling? Initial decision: use polling.",
					"Polling is possible.",
					"Replace that decision: use WebSockets. Preserve AUTH_PROTOCOL. Which port should we use?",
					"Use port 3100.",
					"Agreed: WebSockets on 3100. I still need to choose the rollout date.",
				],
				empty: false,
			},
		])(
			"keeps useful context from $name",
			async ({ messages, empty }) => {
				const root = await mkdtemp(join(tmpdir(), "commonspace-live-brief-"));
				const state = createInitialState();
				const createdAt = "2026-09-01T00:00:00.000Z";
				state.agents = [
					{
						id: "codex",
						displayName: "Developer",
						adapter: "codex",
						model: null,
						createdAt,
					},
				];
				state.channels = [
					{
						id: "sample",
						name: "sample",
						agentIds: ["codex"],
						instructions: "",
						memory: emptyChannelMemory(),
						routingMemory: emptyRoutingMemory(),
						createdAt,
					},
				];
				state.threads = [
					{
						id: "thread",
						channelId: "sample",
						rootMessageId: "m0",
						agentIds: ["codex"],
						createdAt,
						context: createThreadContext(emptyChannelMemory(), createdAt),
					},
				];
				state.messages["channel:sample"] = messages.map(
					(text, index): CommonspaceMessage => ({
						id: `m${index}`,
						conversation: { kind: "channel", id: "sample" },
						threadId: "thread",
						authorType: index % 2 === 0 ? "user" : "agent",
						authorId: index % 2 === 0 ? "user" : "codex",
						authorName: index % 2 === 0 ? "User" : "Developer",
						text,
						createdAt: new Date(
							Date.parse(createdAt) + index * 1000,
						).toISOString(),
					}),
				);
				await writeFile(join(root, "state.json"), JSON.stringify(state));
				const service = new CommonspaceHostService({}, { root });
				try {
					await service.initialize();
					await service.updateRoutingConfiguration({
						provider: CommonspaceRoutingProvider.Harness,
						harnessAgentId: "codex",
					});
					const brief = await service.compactChannelContext("sample");
					if (empty) {
						expect(brief).toMatchObject({
							summary: "",
							decisions: [],
							openQuestions: [],
						});
					} else {
						expect(JSON.stringify(brief)).toContain("AUTH_PROTOCOL");
						expect(brief.decisions.join(" ")).toMatch(/WebSockets/i);
						expect(brief.decisions.join(" ")).toContain("3100");
						expect(brief.openQuestions.join(" ")).toMatch(/rollout/i);
						expect(brief.openQuestions.join(" ")).not.toMatch(
							/which port|can we use polling|help you/i,
						);
					}
				} finally {
					await service.close();
					await rm(root, { recursive: true, force: true });
				}
			},
			120_000,
		);
	},
);
