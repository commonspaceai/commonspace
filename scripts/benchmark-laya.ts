import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, cpus, homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiRouteResult } from "../server/src/ai-router.ts";
import {
	type RunningClassifier,
	startLocalClassifier,
} from "../server/src/local-classifier.ts";
import { routeLocally } from "../server/src/local-routing.ts";
import { classifierEvaluationCases } from "./classifier-evaluation-cases.ts";

const rounds = 30;
const assetDirectory = fileURLToPath(
	new URL("../cli/dist/classifier", import.meta.url),
);
const runtimeDirectory = resolve(
	process.argv[2] ??
		join(
			process.env.COMMONSPACE_HOME ?? join(homedir(), ".commonspace"),
			"classifier",
		),
);
const manifestSha256 = createHash("sha256")
	.update(await readFile(join(assetDirectory, "model.json")))
	.digest("hex");
const scenarios = [
	{ name: "named greeting", text: "hi Mira Vale" },
	{ name: "group greeting", text: "Good morning, everyone!" },
	{
		name: "explicit parallel recipients",
		text: "Complete your respective implementation tasks independently.",
	},
	{
		name: "named Project scope attempt",
		text: "Add a foreign key in the Cedar repository.",
	},
].map(({ name, text }) => {
	const item = classifierEvaluationCases.find(
		(entry) => entry.input.text === text,
	);
	if (item === undefined || item.expected === null)
		throw new Error(`Missing labeled Laya benchmark case: ${name}`);
	const samplesMs: number[] = [];
	return {
		name,
		item,
		expectedKey: routeKey(item.expected),
		samplesMs,
		acceptedSamples: 0,
	};
});

function routeKey(route: Pick<AiRouteResult, "mode" | "assignments">) {
	const assignments = route.assignments.map(({ agentId, projectIds }) => ({
		agentId,
		projectIds: projectIds.toSorted(),
	}));
	if (route.mode === "parallel")
		assignments.sort((left, right) =>
			left.agentId.localeCompare(right.agentId),
		);
	return JSON.stringify({ mode: route.mode, assignments });
}

function percentile(sorted: readonly number[], proportion: number) {
	const value = sorted[Math.ceil(sorted.length * proportion) - 1];
	if (value === undefined) throw new Error("Missing Laya benchmark sample");
	return value;
}

const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const started = performance.now();
const classifier = await startLocalClassifier({
	runtimeDirectory,
	assetDirectory,
	log: (message) => process.stderr.write(`${message}\n`),
	signal: cancellation.signal,
});
const readyMs = performance.now() - started;

async function measure(scenario: (typeof scenarios)[number]) {
	let calls = 0;
	const classify: RunningClassifier["classify"] = async (request, signal) => {
		calls += 1;
		const scores = await classifier.classify(request, signal);
		if (scores === null)
			throw new Error(`Laya returned no scores for ${scenario.name}`);
		return scores;
	};
	const before = performance.now();
	const result = await routeLocally(
		scenario.item.input,
		classify,
		cancellation.signal,
	);
	const milliseconds = performance.now() - before;
	if (calls !== 1)
		throw new Error(`Laya was not called once for ${scenario.name}`);
	if (result === null) {
		if (scenario.item.requiredLocal)
			throw new Error(`Required local route abstained for ${scenario.name}`);
		return { milliseconds, accepted: false };
	}
	if (routeKey(result) !== scenario.expectedKey)
		throw new Error(`Incorrect local route for ${scenario.name}`);
	return { milliseconds, accepted: true };
}

try {
	for (const scenario of scenarios) await measure(scenario);
	for (let round = 0; round < rounds; round += 1) {
		for (const scenario of scenarios) {
			const sample = await measure(scenario);
			scenario.samplesMs.push(sample.milliseconds);
			if (sample.accepted) scenario.acceptedSamples += 1;
		}
	}
} finally {
	await classifier.close();
	process.off("SIGINT", cancel);
	process.off("SIGTERM", cancel);
}

process.stdout.write(
	`${JSON.stringify(
		{
			model: "Laya ONNX INT8",
			manifestSha256,
			machine: {
				platform: platform(),
				arch: arch(),
				cpu: cpus()[0]?.model,
				node: process.version,
			},
			readyMs,
			rounds,
			scenarios: scenarios.map((scenario) => {
				const sorted = scenario.samplesMs.toSorted((a, b) => a - b);
				return {
					name: scenario.name,
					acceptedSamples: scenario.acceptedSamples,
					p50Ms: percentile(sorted, 0.5),
					p95Ms: percentile(sorted, 0.95),
					maxMs: percentile(sorted, 1),
					samplesMs: scenario.samplesMs,
				};
			}),
			limitations:
				"Synthetic labeled requests, one warm worker, sequential routing. readyMs includes model download on a cold cache; request samples exclude startup and one warm-up per scenario. No inference Agent or native session is invoked.",
		},
		null,
		2,
	)}\n`,
);
