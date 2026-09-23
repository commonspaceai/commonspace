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
	milliseconds: number;
	expected: ClassifierEvaluationCase["expected"];
	actual: ClassifierEvaluationCase["expected"];
}[] = [];
try {
	for (const item of classifierEvaluationCases) {
		const before = performance.now();
		const result = await routeLocally(
			item.input,
			classifier.classify.bind(classifier),
			cancellation.signal,
		);
		const accepted = result !== null;
		const actual =
			result === null
				? null
				: { mode: result.mode, assignments: result.assignments };
		const correct =
			accepted &&
			item.expected !== null &&
			JSON.stringify(actual) === JSON.stringify(item.expected);
		results.push({
			text: item.input.text,
			accepted,
			correct,
			milliseconds: performance.now() - before,
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
process.stdout.write(
	`${JSON.stringify({ readyMs, total: results.length, accepted: results.filter((result) => result.accepted).length, medianMs: timings[Math.floor(timings.length / 2)], incorrect }, null, 2)}\n`,
);
if (incorrect.length > 0 || !results.some((result) => result.accepted))
	process.exitCode = 1;
