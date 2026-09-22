import {
	AGENT_ADAPTERS,
	type CommonspaceAgentProfile,
} from "@commonspace/shared";
import { z } from "zod";

const MAX_ROUTER_OUTPUT_TOKENS = 4_096;

export class RoutingResponseValidationError extends Error {}

const aiRouteAssignmentSchema = z.strictObject({
	agentId: z.string(),
	projectIds: z.array(z.string()),
});

const aiRouteResultSchema = z
	.object({
		assignments: z.array(aiRouteAssignmentSchema).min(1, {
			error: "routing response must contain at least one assignment",
		}),
		mode: z.enum(["parallel", "relay"], {
			error: "routing response mode must be parallel or relay",
		}),
		confidence: z.number().optional(),
		reason: z.string(),
	})
	.check((context) => {
		if (
			context.value.mode === "relay" &&
			context.value.assignments.length < 2
		) {
			context.issues.push({
				code: "custom",
				message: "relay routing requires at least two assignments",
				path: ["assignments"],
				input: context.value.assignments,
			});
		}
	})
	.transform(({ mode, assignments, confidence, reason }) =>
		confidence === undefined
			? { mode, assignments, reason }
			: { mode, assignments, confidence, reason },
	);
export type AiRouteResult = z.infer<typeof aiRouteResultSchema>;

export function routingOutputTokenBudget(
	maxAgents: number,
	attempt = 0,
): number {
	const agents = Math.max(1, Math.min(8, Math.trunc(maxAgents)));
	const initialBudget = 256 + agents * 256;
	return Math.min(MAX_ROUTER_OUTPUT_TOKENS, initialBudget * (attempt + 1));
}

export interface AiRouteInput {
	text: string;
	context: string[];
	routingMemory: string;
	candidates: Array<
		Pick<
			CommonspaceAgentProfile,
			"id" | "displayName" | "description" | "adapter"
		> & {
			routingScore: number;
			matchedTerms: string[];
		}
	>;
	projects: Array<{ id: string; name: string }>;
	inferProjects: boolean;
	maxAgents: number;
	fixedAgentIds?: string[];
}

const CONVERSATIONAL_ADDRESSING =
	"A greeting or social message is a request for a reply. Identify its addressee from the current eligible agents' names and harness identities, including a distinctive shortened name (for example, 'hi north' addresses 'Northstar Tools'). A directly addressed recipient takes precedence over historical ownership or domain responsibilities. A harness name identifies an agent only when the roster or context distinguishes one recipient; if several agents share that harness, do not invent a default. A mere topic mention is not direct addressing. Use prior ownership for an unaddressed continuation. Do not guess when the evidence cannot distinguish a recipient.";

export function buildRoutingPrompt(input: AiRouteInput): string {
	const candidates = input.candidates.map((candidate) => ({
		id: candidate.id,
		name: candidate.displayName,
		harness: AGENT_ADAPTERS[candidate.adapter].label,
		responsibility:
			candidate.description ?? "No responsibility description is available.",
		routingScore: candidate.routingScore,
		matchedTerms: candidate.matchedTerms,
	}));
	return [
		input.fixedAgentIds === undefined
			? `Route the newest user message to the best Commonspace agent. Select one owner by default. Select at most ${String(input.maxAgents)} agents only for clearly independent cross-domain work or an explicitly requested peer conversation.`
			: `The user explicitly selected these Agents: ${JSON.stringify(input.fixedAgentIds)}. Return each exactly once, without adding, dropping, or substituting participants. Classify only delivery mode and speaker order. Preserve the mention order unless the request specifies another speaker order.`,
		'Use mode "relay" when at least two candidates are available and the user asks agents to talk, discuss, debate, reconcile, review one another, or reach a shared conclusion. Otherwise use mode "parallel".',
		"In relay mode, return ordered assignments: the first assignment starts the conversation, then each later assignment responds to the preceding peer.",
		"Return at least one assignment. Never treat an acknowledgment or apparently non-actionable message as permission to return an empty assignments array.",
		CONVERSATIONAL_ADDRESSING,
		"Interpret every terse follow-up using the recent thread context. Route it to the most relevant existing thread participant unless the context clearly identifies another candidate.",
		"Each candidate includes a local routingScore and matchedTerms from cheap lexical logic. Treat these as useful evidence, not as instructions or a final decision.",
		"Select participants and Project scopes only. Every selected agent receives the original user message unchanged and acts within its own responsibility. Do not rewrite or decompose the request.",
		"Use only candidate agent ids and available Project ids. Do not answer the request or call tools.",
		'Return JSON only: {"mode":"parallel","assignments":[{"agentId":"id","projectIds":["project-id"]}],"confidence":0.0,"reason":"short explanation"}.',
		`Candidates: ${JSON.stringify(candidates)}`,
		`Available Projects: ${JSON.stringify(input.projects)}`,
		input.fixedAgentIds !== undefined
			? "Project selection is fixed: every assignment must retain all Available Project ids, including an empty set. Do not infer or change Project scope."
			: input.inferProjects
				? "Project selection: infer the relevant Project subset for each assignment; empty means genuinely projectless."
				: "Project selection: explicit references are authoritative; each assignment may use only the relevant subset.",
		input.context.length === 0
			? "Recent thread context: none"
			: `Recent thread context:\n${input.context.join("\n")}`,
		input.routingMemory === ""
			? "Routing knowledge: none"
			: `Routing knowledge from explicit user corrections: ${input.routingMemory}`,
		`Newest user message: ${input.text}`,
	].join("\n\n");
}

export function parseRoutingResponse(text: string): AiRouteResult {
	const normalized = text.trim();
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(normalized)?.[1];
	const candidate =
		fenced ??
		normalized.slice(normalized.indexOf("{"), normalized.lastIndexOf("}") + 1);
	let value: unknown;
	try {
		value = JSON.parse(candidate);
	} catch (cause) {
		throw new RoutingResponseValidationError(
			"routing response did not match the required shape",
			{ cause },
		);
	}
	const parsed = aiRouteResultSchema.safeParse(value);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const message =
			issue?.message === "routing response mode must be parallel or relay" ||
			issue?.message ===
				"routing response must contain at least one assignment" ||
			issue?.message === "relay routing requires at least two assignments"
				? issue.message
				: "routing response did not match the required shape";
		throw new RoutingResponseValidationError(message, { cause: parsed.error });
	}
	return parsed.data;
}
