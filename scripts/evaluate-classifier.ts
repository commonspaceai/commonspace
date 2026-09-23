import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalClassifier } from "../server/src/local-classifier.ts";
import { routeLocally } from "../server/src/local-routing.ts";
import {
	type ClassifierEvaluationCase,
	classifierEvaluationCases,
} from "./classifier-evaluation-cases.ts";

// Opt-in semantic evaluation: real model, synthetic data, one worker and one
// request at a time. No harness is launched when a local decision abstains.
const runtimeDirectory = resolve(
	process.argv[2] ??
		join(
			process.env.COMMONSPACE_HOME ?? join(homedir(), ".commonspace"),
			"classifier",
		),
);
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const started = performance.now();
const classifier = await startLocalClassifier({
	runtimeDirectory,
	assetDirectory: fileURLToPath(
		new URL("../cli/dist/classifier", import.meta.url),
	),
	log: (message) => process.stderr.write(`${message}\n`),
	signal: cancellation.signal,
});
const readyMs = performance.now() - started;
const results: {
	text: string;
	accepted: boolean;
	correct: boolean;
	requiredLocal: boolean;
	milliseconds: number;
	matches: {
		mode: boolean;
		recipients: boolean;
		projectScopes: boolean;
	} | null;
	expected: ClassifierEvaluationCase["expected"];
	actual: ClassifierEvaluationCase["expected"];
}[] = [];
let failure: { text: string; milliseconds: number; message: string } | null =
	null;
try {
	for (const item of classifierEvaluationCases) {
		const before = performance.now();
		let result: Awaited<ReturnType<typeof routeLocally>>;
		try {
			result = await routeLocally(
				item.input,
				classifier.classify.bind(classifier),
				cancellation.signal,
			);
		} catch (error) {
			failure = {
				text: item.input.text,
				milliseconds: performance.now() - before,
				message: error instanceof Error ? error.message : String(error),
			};
			break;
		}
		const accepted = result !== null;
		const actual =
			result === null
				? null
				: { mode: result.mode, assignments: result.assignments };
		const milliseconds = performance.now() - before;
		const matches =
			actual === null || item.expected === null
				? null
				: {
						mode: actual.mode === item.expected.mode,
						recipients:
							JSON.stringify(recipients(actual)) ===
							JSON.stringify(recipients(item.expected)),
						projectScopes:
							JSON.stringify(projectScopes(actual)) ===
							JSON.stringify(projectScopes(item.expected)),
					};
		const correct =
			matches?.mode === true && matches.recipients && matches.projectScopes;
		results.push({
			text: item.input.text,
			accepted,
			correct,
			requiredLocal: item.requiredLocal === true,
			milliseconds,
			matches,
			expected: item.expected,
			actual,
		});
	}
} finally {
	await classifier.close();
	process.off("SIGINT", cancel);
	process.off("SIGTERM", cancel);
}
const timings = results
	.map((result) => result.milliseconds)
	.sort((a, b) => a - b);
const incorrect = results.filter(
	(result) => result.accepted && !result.correct,
);
const missedRequired = results.filter(
	(result) => result.requiredLocal && !result.accepted,
);
const required = results.filter((result) => result.requiredLocal);
process.stdout.write(
	`${JSON.stringify(
		{
			readyMs,
			total: classifierEvaluationCases.length,
			completed: results.length,
			accepted: results.filter((result) => result.accepted).length,
			correctAccepted: results.filter((result) => result.correct).length,
			abstained: results.filter((result) => !result.accepted).length,
			medianMs: timings[Math.floor(timings.length / 2)],
			p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
			maxMs: timings.at(-1),
			required,
			incorrect,
			missedRequired,
			failure,
		},
		null,
		2,
	)}\n`,
);
if (
	failure !== null ||
	incorrect.length > 0 ||
	missedRequired.length > 0 ||
	!results.some((result) => result.accepted)
)
	process.exitCode = 1;

function recipients(route: NonNullable<ClassifierEvaluationCase["expected"]>) {
	const ids = route.assignments.map((assignment) => assignment.agentId);
	// Parallel completion order is immaterial; relay speaker order is contractual.
	return route.mode === "parallel" ? ids.toSorted() : ids;
}

function projectScopes(
	route: NonNullable<ClassifierEvaluationCase["expected"]>,
) {
	return route.assignments
		.map((assignment) => ({
			agentId: assignment.agentId,
			projectIds: assignment.projectIds.toSorted(),
		}))
		.toSorted((a, b) => a.agentId.localeCompare(b.agentId));
}
