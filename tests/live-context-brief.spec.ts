import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CommonspaceMessage,
	CommonspaceRoutingProvider,
} from "@commonspace/shared";
import { describe, expect, it } from "vitest";
import type { CompactedChannelContext } from "../server/src/context.ts";
import { CommonspaceHostService } from "../server/src/service.ts";
import {
	createInitialState,
	emptyChannelMemory,
	emptyRoutingMemory,
} from "../server/src/state.ts";
import { createThreadContext } from "../server/src/thread-context.ts";

function expectCurrentDecisionBrief(brief: CompactedChannelContext) {
	const decisions = brief.decisions.join("\n");
	const openQuestions = brief.openQuestions.join("\n");
	const context = [brief.summary, decisions].join("\n");
	const activePolling = [brief.summary, ...brief.decisions].some((decision) => {
		const presentedAsCurrent =
			/\b(?:use|using|keep|choose|adopt)\s+polling\b|\bpolling\b.{0,30}\b(?:current|active|selected|chosen)\b/i.test(
				decision,
			);
		const explicitlyRejected =
			/\b(?:do not|no longer|never|stop)\s+(?:use|using|keep|choose|adopt)\s+polling\b|\bpolling\b.{0,30}\b(?:not|no longer)\s+(?:current|active|selected|chosen)\b/i.test(
				decision,
			);
		return presentedAsCurrent && !explicitlyRejected;
	});
	expect(decisions).toMatch(/\bWebSockets\b/i);
	expect(context).not.toMatch(
		/\b(?:do not|no longer|avoid|reject)\s+(?:use\s+)?WebSockets\b/i,
	);
	expect(activePolling).toBe(false);
	expect(
		brief.decisions.every((decision) =>
			/\b(?:WebSockets|polling|3100|AUTH_PROTOCOL)\b/i.test(decision),
		),
	).toBe(true);
	expect(
		brief.decisions.some(
			(decision) =>
				/\b3100\b/.test(decision) &&
				/\b(?:use|on|port|listener|selected|chosen|decided)\b/i.test(
					decision,
				) &&
				!/\b(?:maybe|might|could|possibly|proposed|consider)\b/i.test(decision),
		),
	).toBe(true);
	expect(openQuestions).toMatch(/\brollout\b/i);
	expect(openQuestions).not.toMatch(
		/\b(?:port|3100|listener|endpoint|polling|transport)\b/i,
	);
	expect(context).toMatch(
		/\b(?:preserve|keep|retain)\s+(?:the\s+)?AUTH_PROTOCOL\b|\bAUTH_PROTOCOL\b.{0,30}\b(?:unchanged|intact|preserved|retained)\b/i,
	);
	expect(context).not.toMatch(
		/\b(?:do not|don't|no longer|never)\s+(?:preserve|keep|retain)\s+(?:the\s+)?AUTH_PROTOCOL\b|\b(?:may|can|should|must)\s+(?:change|drop|remove)\s+(?:the\s+)?AUTH_PROTOCOL\b|\bAUTH_PROTOCOL\b.{0,30}\b(?:not|no longer|may|can|should)\s+(?:be\s+)?(?:preserved|kept|retained|unchanged|changed|removed|dropped|change)\b/i,
	);
}

const validDecisionBrief: CompactedChannelContext = {
	summary: "Keep AUTH_PROTOCOL unchanged during release.",
	decisions: ["Use WebSockets instead of polling on port 3100."],
	openQuestions: ["When should rollout begin?"],
};

describe("current Channel decision brief evaluator", () => {
	it("accepts a current brief and an equivalent paraphrase", () => {
		expectCurrentDecisionBrief(validDecisionBrief);
		expectCurrentDecisionBrief({
			summary: "AUTH_PROTOCOL must remain intact.",
			decisions: [
				"WebSockets is the active transport on listener 3100.",
				"Polling was superseded.",
			],
			openQuestions: ["What date should rollout start?"],
		});
	});

	it.each([
		{
			name: "polling presented as equally current",
			brief: {
				...validDecisionBrief,
				decisions: [
					...validDecisionBrief.decisions,
					"Use polling for this service.",
				],
			},
		},
		{
			name: "polling described as active without an imperative",
			brief: {
				...validDecisionBrief,
				decisions: [...validDecisionBrief.decisions, "Polling remains active."],
			},
		},
		{
			name: "polling presented as current in the summary",
			brief: {
				...validDecisionBrief,
				summary: `${validDecisionBrief.summary} Polling remains active.`,
			},
		},
		{
			name: "the decided port reopened with different words",
			brief: {
				...validDecisionBrief,
				openQuestions: [
					...validDecisionBrief.openQuestions,
					"Which listener should we choose?",
				],
			},
		},
		{
			name: "the unresolved rollout removed",
			brief: { ...validDecisionBrief, openQuestions: [] },
		},
		{
			name: "the preservation obligation negated",
			brief: {
				...validDecisionBrief,
				summary: "Do not preserve AUTH_PROTOCOL.",
			},
		},
		{
			name: "the preservation token left without an obligation",
			brief: { ...validDecisionBrief, summary: "AUTH_PROTOCOL may change." },
		},
		{
			name: "a hedged port answer presented as a decision",
			brief: {
				...validDecisionBrief,
				decisions: ["Use WebSockets. Maybe use port 3100."],
			},
		},
		{
			name: "an unrelated decision invented",
			brief: {
				...validDecisionBrief,
				decisions: [...validDecisionBrief.decisions, "Deploy to Mercury."],
			},
		},
	])("rejects $name", ({ brief }) => {
		expect(() => expectCurrentDecisionBrief(brief)).toThrow();
	});
});

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
						expectCurrentDecisionBrief(brief);
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
