import type { AiRouteInput, AiRouteResult } from "./ai-router.js";
import type {
	ClassifierScores,
	RunningClassifier,
} from "./local-classifier.js";

type LocalRoute = AiRouteResult & { source: "local" };
interface LocalRouteInput extends Omit<AiRouteInput, "context"> {
	// Null means context-dependent decisions require the inference Agent.
	context: string[] | null;
}
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

/** Classify constrained decisions locally; full inference selects general recipient sets. */
export async function routeLocally(
	input: LocalRouteInput,
	classify: RunningClassifier["classify"],
	signal?: AbortSignal,
): Promise<LocalRoute | null> {
	signal?.throwIfAborted();
	if (
		input.text.trim() === "" ||
		input.candidates.length === 0 ||
		input.candidates.length > 8 ||
		(input.fixedAgentIds !== undefined && input.inferProjects)
	)
		return null;
	if (input.fixedAgentIds === undefined) {
		// The checkpoint confuses greeting-plus-work with a purely social request.
		// Require a complete standalone greeting before omitting inferred Project access.
		const greeting =
			/^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|say hello)[,\s]+(.+?)\s*[.!?]*$/iu.exec(
				input.text.normalize("NFKC").trim(),
			);
		const addressee = greeting?.[1]?.trim().toLowerCase();
		if (addressee !== undefined)
			return routeGreetingLocally(input, addressee, classify, signal);
	}
	// Current direct addressing in a standalone greeting supersedes past examples.
	// Other decisions still need inference when context or corrections apply.
	if (input.context === null || input.routingMemory !== "") return null;
	if (input.fixedAgentIds !== undefined) {
		const state = [
			input.context.length === 0
				? ""
				: `Routing brief:\n${input.context.join("\n")}`,
			`User: ${input.text}`,
		]
			.filter(Boolean)
			.join("\n\n");
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
								"Independent work: each selected agent can start without waiting for another's result.",
						},
						{
							id: "relay",
							description:
								"Ordered work: an agent waits for another's result, or agents discuss, review each other, or reach a shared conclusion.",
						},
						{
							id: "uncertain",
							description:
								"The request does not clearly identify independent or ordered work.",
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
	// A confident single match cannot establish that no other responsibility applies.
	// Leave the complete participant set to the inference Agent.
	const selected =
		input.candidates.length === 1 ? input.candidates[0] : undefined;
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
				? "Local routing retained the only eligible recipient and classified Project scope."
				: "Local routing retained the only eligible recipient and explicit Project scope.",
	};
}

async function routeGreetingLocally(
	input: LocalRouteInput,
	addressee: string,
	classify: RunningClassifier["classify"],
	signal?: AbortSignal,
): Promise<LocalRoute | null> {
	const compactAddressee = addressee.replace(/\s+/gu, "");
	const named = input.candidates.filter((candidate) => {
		const name = candidate.displayName.normalize("NFKC").toLowerCase();
		return (
			name.replace(/\s+/gu, "") === compactAddressee ||
			name.split(/\s+/u).includes(compactAddressee)
		);
	});
	// Tolerate omitted/repeated letters in collective words, not arbitrary typos.
	const collective = addressee.replace(/([a-z])\1+/gu, "$1");
	const everyone = ["al", "everyone", "everybody", "al agents"].includes(
		collective,
	);
	const collectiveNames =
		everyone &&
		input.candidates.some((candidate) => {
			const name = candidate.displayName.normalize("NFKC").toLowerCase();
			return [name, ...name.split(/\s+/u)].some(
				(part) =>
					part.replace(/\s+/gu, "").replace(/([a-z])\1+/gu, "$1") ===
					collective.replace(/\s+/gu, ""),
			);
		});
	if (
		(everyone &&
			(named.length > 0 ||
				collectiveNames ||
				input.candidates.length > input.maxAgents)) ||
		(!everyone && named.length !== 1)
	)
		return null;
	const recipient = named[0];
	const choice = confidentChoice(
		await classify(
			{
				state: `User: ${input.text}`,
				instruction: "Who is the user addressing?",
				options: [
					...input.candidates.map((candidate, index) => ({
						id: `greeting-agent:${String(index)}`,
						description:
							candidate === recipient ? addressee : candidate.displayName,
					})),
					{ id: "everyone", description: everyone ? addressee : "all" },
					{ id: "unclear", description: "unclear" },
				],
			},
			signal,
		),
		0.55,
	);
	const expected = everyone
		? "everyone"
		: `greeting-agent:${String(recipient === undefined ? -1 : input.candidates.indexOf(recipient))}`;
	if (choice !== expected) return null;
	return {
		source: "local",
		mode: "parallel",
		assignments: (everyone ? input.candidates : named).map((candidate) => ({
			agentId: candidate.id,
			projectIds: input.inferProjects
				? []
				: input.projects.map((project) => project.id),
		})),
		reason:
			"Local classifier selected the recipients of a standalone greeting.",
	};
}

async function inferNamedProjectScope(
	input: Pick<AiRouteInput, "text" | "projects">,
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
