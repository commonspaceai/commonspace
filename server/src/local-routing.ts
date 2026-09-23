import type { AiRouteInput, AiRouteResult } from "./ai-router.js";
import type {
	ClassifierScores,
	RunningClassifier,
} from "./local-classifier.js";

type LocalRoute = AiRouteResult & { source: "local" };
function confidentChoice(
	scores: ClassifierScores[] | null,
	minimum: number,
): string | null {
	const [winner, runnerUp] =
		scores?.toSorted((a, b) => b.score - a.score) ?? [];
	return winner !== undefined &&
		runnerUp !== undefined &&
		winner.score >= minimum &&
		winner.score - runnerUp.score >= 0.25
		? winner.id
		: null;
}

/** Local Laya owns the first decision; ambiguous or oversized requests use the inference Agent. */
export async function routeLocally(
	input: AiRouteInput,
	classify: RunningClassifier["classify"],
	signal?: AbortSignal,
): Promise<LocalRoute | null> {
	signal?.throwIfAborted();
	if (
		input.text.trim() === "" ||
		input.candidates.length === 0 ||
		input.candidates.length > 8 ||
		// The selected checkpoint can confidently ignore corrections or infer
		// Project access from praise. Corrected decisions need the inference Agent.
		input.routingMemory !== "" ||
		(input.fixedAgentIds !== undefined && input.inferProjects)
	)
		return null;
	const state = [
		input.context.length === 0
			? ""
			: `Routing brief:\n${input.context.join("\n")}`,
		`User: ${input.text}`,
	]
		.filter(Boolean)
		.join("\n\n");
	if (input.fixedAgentIds !== undefined) {
		const mode = confidentChoice(
			await classify(
				{
					state,
					instruction:
						"How should the explicitly selected agents work on this request?",
					options: [
						{
							id: "parallel",
							description:
								"Independent work: each selected agent handles its own responsibility.",
						},
						{
							id: "relay",
							description:
								"A peer discussion: agents debate, review each other, or reach a shared conclusion.",
						},
						{
							id: "uncertain",
							description:
								"The request does not clearly identify independent work or a peer discussion.",
						},
					],
				},
				signal,
			),
			0.8,
		);
		// A relay needs an ordered speaker list; this classifier only chooses its mode.
		if (mode !== "parallel") return null;
		return {
			source: "local",
			mode,
			assignments: input.fixedAgentIds.map((agentId) => ({
				agentId,
				projectIds: input.projects.map((p) => p.id),
			})),
			reason:
				"Local classifier selected the delivery mode for the explicit recipients.",
		};
	}
	let selected =
		input.candidates.length === 1 ? input.candidates[0] : undefined;
	if (selected === undefined) {
		const scores = await classify(
			{
				state,
				instruction: "Who should receive the newest user message?",
				options: [
					...input.candidates.map((candidate, index) => ({
						id: `agent:${String(index)}`,
						description: `${candidate.displayName}: ${candidate.description ?? "No responsibility description."}`,
					})),
					{
						id: "multiple",
						description:
							"Multiple agents: separate responsibilities or a requested discussion.",
					},
					{
						id: "uncertain",
						description:
							"Unclear recipient: vague request, general greeting, or insufficient context.",
					},
				],
			},
			signal,
		);
		const winner = confidentChoice(scores, minimumOwnerScore(input));
		selected = input.candidates.find(
			(_, index) => winner === `agent:${String(index)}`,
		);
	}
	if (selected === undefined) return null;
	const projectIds = input.inferProjects
		? await inferNamedProjectScope(input, classify, signal)
		: input.projects.map((project) => project.id);
	if (projectIds === null) return null;
	return {
		source: "local",
		mode: "parallel",
		assignments: [{ agentId: selected.id, projectIds }],
		reason:
			input.inferProjects && input.projects.length > 0
				? "Local classifier selected the recipient and Project scope."
				: "Local classifier selected the recipient and retained the explicit Project scope.",
	};
}

async function inferNamedProjectScope(
	input: AiRouteInput,
	classify: RunningClassifier["classify"],
	signal?: AbortSignal,
): Promise<string[] | null> {
	if (input.projects.length === 0) return [];
	// A plain Project name is evidence, not permission to open its files.
	// More than one mention, no mention, or negated work needs the full router.
	if (hasNegation(input.text)) return null;
	const namedProjects = input.projects.filter((project) => {
		const name = project.name.trim();
		if (name === "") return false;
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
		return new RegExp(
			`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
			"iu",
		).test(input.text);
	});
	const project = namedProjects.length === 1 ? namedProjects[0] : undefined;
	if (project === undefined) return null;
	const scope = confidentChoice(
		await classify(
			{
				state: `Newest user message: ${input.text}`,
				instruction: `Does the user request work inside ${project.name}, only discuss it, or request work elsewhere?`,
				options: [
					{
						id: "work",
						description: `A request to inspect or change files in ${project.name}`,
					},
					{
						id: "comment",
						description: `A comment or praise about ${project.name}, with no requested work`,
					},
					{
						id: "other",
						description: `A comment about ${project.name} plus work elsewhere, or unclear Project scope`,
					},
				],
			},
			signal,
		),
		0.9,
	);
	return scope === "work" ? [project.id] : scope === "comment" ? [] : null;
}

function hasNegation(text: string): boolean {
	return /\b(?:no|not|never|without|instead|except|unless|stop|ignore|forget|rather|unchanged)\b|\b\w+n['’]t\b/iu.test(
		text,
	);
}

function minimumOwnerScore(input: AiRouteInput): number {
	// Compound requests can hide a second responsibility behind a confident partial match.
	if (/\b(?:and|also|plus|together|both)\b/iu.test(input.text)) return 0.85;
	if (hasNegation(input.text)) return 0.65;
	return 0.55;
}
