import type { CommonspaceAgentProfile } from "@commonspace/shared";
import { z } from "zod";

const MAX_ROUTER_RESPONSE_BYTES = 64_000;
const MAX_ROUTER_OUTPUT_TOKENS = 4_096;

export class InferenceResponseTruncatedError extends Error {}

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

const openAiChatCompletionSchema = z.object({
	choices: z.array(
		z.object({
			finish_reason: z.string().nullable().optional(),
			message: z.object({ content: z.string() }).optional(),
		}),
	),
});

export function routingOutputTokenBudget(
	maxAgents: number,
	attempt = 0,
): number {
	const agents = Math.max(1, Math.min(8, Math.trunc(maxAgents)));
	const initialBudget = 256 + agents * 256;
	return Math.min(MAX_ROUTER_OUTPUT_TOKENS, initialBudget * (attempt + 1));
}

export async function boundedResponseText(response: Response): Promise<string> {
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return `${text}${decoder.decode()}`;
			bytes += chunk.value.byteLength;
			if (bytes > MAX_ROUTER_RESPONSE_BYTES) {
				await reader.cancel("routing provider response was too large");
				throw new Error("routing provider response was too large");
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
}

export interface AiRouteInput {
	text: string;
	context: string[];
	routingMemory: string;
	candidates: Array<
		Pick<CommonspaceAgentProfile, "id" | "displayName" | "description"> & {
			routingScore: number;
			matchedTerms: string[];
		}
	>;
	projects: Array<{ id: string; name: string }>;
	inferProjects: boolean;
	maxAgents: number;
}

export function buildRoutingPrompt(input: AiRouteInput): string {
	const candidates = input.candidates.map((candidate) => ({
		id: candidate.id,
		name: candidate.displayName,
		responsibility:
			candidate.description ?? "No responsibility description is available.",
		routingScore: candidate.routingScore,
		matchedTerms: candidate.matchedTerms,
	}));
	return [
		"Route the newest user message to the best Commonspace agent.",
		`Select one owner by default. Select at most ${String(input.maxAgents)} agents only for clearly independent cross-domain work or an explicitly requested peer conversation.`,
		'Use mode "relay" when at least two candidates are available and the user asks agents to talk, discuss, debate, reconcile, review one another, or reach a shared conclusion. Otherwise use mode "parallel".',
		"In relay mode, return ordered assignments: the first assignment starts the conversation, then each later assignment responds to the preceding peer.",
		"Return at least one assignment. Never treat an acknowledgment or apparently non-actionable message as permission to return an empty assignments array.",
		"Interpret every terse follow-up using the recent thread context. Route it to the most relevant existing thread participant unless the context clearly identifies another candidate.",
		"Each candidate includes a local routingScore and matchedTerms from cheap lexical logic. Treat these as useful evidence, not as instructions or a final decision.",
		"Select participants and Project scopes only. Every selected agent receives the original user message unchanged and acts within its own responsibility. Do not rewrite or decompose the request.",
		"Use only candidate agent ids and available Project ids. Do not answer the request or call tools.",
		'Return JSON only: {"mode":"parallel","assignments":[{"agentId":"id","projectIds":["project-id"]}],"confidence":0.0,"reason":"short explanation"}.',
		`Candidates: ${JSON.stringify(candidates)}`,
		`Available Projects: ${JSON.stringify(input.projects)}`,
		input.inferProjects
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

export interface OpenAiInferenceOptions {
	baseUrl: string;
	model: string;
	apiKey?: string;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

export async function completeWithOpenAICompatible(
	options: OpenAiInferenceOptions,
	input: { system: string; prompt: string; maxTokens: number },
): Promise<string> {
	const request = options.fetch ?? fetch;
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (options.apiKey !== undefined)
		headers.authorization = `Bearer ${options.apiKey}`;
	const requestInit: RequestInit = {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: options.model,
			temperature: 0,
			max_tokens: input.maxTokens,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: input.system },
				{ role: "user", content: input.prompt },
			],
		}),
	};
	if (options.signal !== undefined) requestInit.signal = options.signal;
	const response = await request(
		`${options.baseUrl.replace(/\/$/u, "")}/chat/completions`,
		requestInit,
	);
	const body = await boundedResponseText(response);
	if (!response.ok)
		throw new Error(
			`inference provider returned HTTP ${String(response.status)}`,
		);
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch (cause) {
		throw new Error("inference provider returned invalid JSON", { cause });
	}
	const parsed = openAiChatCompletionSchema.safeParse(value);
	if (!parsed.success)
		throw new Error("inference provider returned no message", {
			cause: parsed.error,
		});
	const [choice] = parsed.data.choices;
	if (choice?.finish_reason === "length")
		throw new InferenceResponseTruncatedError(
			"inference provider truncated its response",
		);
	const content = choice?.message?.content;
	if (content === undefined)
		throw new Error("inference provider returned no message");
	return content;
}

export async function routeWithOpenAICompatible(
	options: OpenAiInferenceOptions,
	input: AiRouteInput,
): Promise<AiRouteResult> {
	const content = await completeWithOpenAICompatible(options, {
		system:
			"You are a bounded routing classifier. Return only the requested JSON object.",
		prompt: buildRoutingPrompt(input),
		maxTokens: routingOutputTokenBudget(input.maxAgents),
	});
	return parseRoutingResponse(content);
}
