import { createHash } from "node:crypto";
import {
	ContextHistoryIndex,
	expandHistoryQuery,
} from "../server/src/context-history.ts";
import {
	HISTORY_EMBEDDING_MODEL,
	HISTORY_EMBEDDING_REVISION,
	LocalHistoryEmbeddings,
} from "../server/src/local-history-embeddings.ts";
import { RoutingMessageIndex } from "../server/src/routing-retrieval.ts";
import {
	CANDIDATE_LIMIT,
	diversifyEvidence,
	type EvaluationPassage,
	PACKET_BYTES,
	packEvidence,
	RESULT_LIMIT,
	recentEvidence,
	scoreEvidence,
} from "./context-evaluation.ts";
import {
	type ContextEvaluationCase,
	contextEvaluationCases,
} from "./context-evaluation-cases.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--semantic"))
	throw new Error("Usage: pnpm evaluate:context [--semantic]");
const encoder = args.includes("--semantic")
	? new LocalHistoryEmbeddings(process.env.COMMONSPACE_EMBEDDING_CACHE)
	: undefined;

async function evaluateCase(evaluation: ContextEvaluationCase) {
	const started = performance.now();
	const history = new ContextHistoryIndex();
	history.sync(evaluation.messages);
	const coldIndexMs = performance.now() - started;
	const lexical = new RoutingMessageIndex();
	lexical.sync(evaluation.messages);
	const candidateStart = performance.now();
	const candidates = lexical
		.search(expandHistoryQuery(evaluation.query), undefined, CANDIDATE_LIMIT)
		.map((p) => ({ messageId: p.messageId, start: p.start, text: p.text }));
	const candidateMs = performance.now() - candidateStart;
	const candidateCoverage = scoreEvidence(evaluation, candidates);
	const strategies = [
		{ name: "recent", run: () => recentEvidence(evaluation.messages) },
		{
			name: "lexical-baseline",
			run: () => lexical.search(evaluation.query, undefined, RESULT_LIMIT),
		},
		{
			name: "expanded-lexical",
			run: () =>
				history.find(evaluation.query, RESULT_LIMIT).results.map((hit) => ({
					messageId: hit.source.messageId,
					start: hit.source.start,
					text: hit.source.text,
				})),
		},
		{
			name: "diverse-experiment",
			run: () =>
				diversifyEvidence(
					lexical.search(
						expandHistoryQuery(evaluation.query),
						undefined,
						CANDIDATE_LIMIT,
					),
				),
		},
	];
	const measurements: {
		strategy: string;
		elapsedMs: number;
		evidence: EvaluationPassage[];
		metrics: ReturnType<typeof scoreEvidence>;
		atOne: ReturnType<typeof scoreEvidence>;
	}[] = [];
	for (const strategy of strategies) {
		const queryStarted = performance.now();
		const evidence = packEvidence(strategy.run());
		measurements.push({
			strategy: strategy.name,
			elapsedMs: performance.now() - queryStarted,
			evidence,
			metrics: scoreEvidence(evaluation, evidence),
			atOne: scoreEvidence(evaluation, evidence.slice(0, 1)),
		});
	}
	let semanticColdMs: number | null = null;
	let semanticUncachedQueryMs: number | null = null;
	if (encoder) {
		const hybrid = new ContextHistoryIndex(encoder);
		hybrid.sync(evaluation.messages);
		const initial = performance.now();
		const first = await hybrid.findHybrid(evaluation.query, RESULT_LIMIT);
		semanticColdMs = performance.now() - initial;
		if (first.method !== "hybrid")
			throw new Error(
				`Local embedding evaluation unavailable for ${evaluation.id}`,
			);
		// Warm passages with a different query; then measure an uncached query embedding.
		const uncachedStarted = performance.now();
		await hybrid.findHybrid(`${evaluation.query} Explain.`, RESULT_LIMIT);
		semanticUncachedQueryMs = performance.now() - uncachedStarted;
		const queryStarted = performance.now();
		const result = await hybrid.findHybrid(evaluation.query, RESULT_LIMIT);
		const evidence = packEvidence(
			result.results.map((hit) => ({
				messageId: hit.source.messageId,
				start: hit.source.start,
				text: hit.source.text,
			})),
		);
		measurements.push({
			strategy: "hybrid-local",
			elapsedMs: performance.now() - queryStarted,
			evidence,
			metrics: scoreEvidence(evaluation, evidence),
			atOne: scoreEvidence(evaluation, evidence.slice(0, 1)),
		});
	}
	return {
		case: evaluation.id,
		query: evaluation.query,
		messages: evaluation.messages.length,
		coldIndexMs,
		candidateMs,
		candidateCoverage,
		semanticColdMs,
		semanticUncachedQueryMs,
		measurements,
	};
}

const rows: Awaited<ReturnType<typeof evaluateCase>>[] = [];
try {
	for (const evaluation of contextEvaluationCases)
		rows.push(await evaluateCase(evaluation));
} finally {
	await encoder?.close();
}

const strategyNames = [
	...new Set(rows.flatMap((row) => row.measurements.map((m) => m.strategy))),
];
const summary = strategyNames.map((strategy) => {
	const values = rows.flatMap((row) =>
		row.measurements.filter((m) => m.strategy === strategy),
	);
	const answerable = values.filter((v) => v.metrics.complete !== null);
	const absent = values.filter((v) => v.metrics.emptyOnUnanswerable !== null);
	const latencies = values.map((v) => v.elapsedMs).sort((a, b) => a - b);
	return {
		strategy,
		completeCases: answerable.filter((v) => v.metrics.complete).length,
		completeAtOne: answerable.filter((v) => v.atOne.complete).length,
		answerableCases: answerable.length,
		coveredSpans: values.reduce((n, v) => n + v.metrics.covered, 0),
		requiredSpans: values.reduce((n, v) => n + v.metrics.required, 0),
		emptyOnUnanswerable: absent.filter((v) => v.metrics.emptyOnUnanswerable)
			.length,
		unanswerableCases: absent.length,
		obsoleteWithoutAnswer: values.filter((v) => v.metrics.obsoleteWithoutAnswer)
			.length,
		meanPacketBytes:
			values.reduce((n, v) => n + v.metrics.packetBytes, 0) / values.length,
		queryP95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
	};
});

process.stdout.write(
	JSON.stringify(
		{
			protocolVersion: 2,
			embeddingModel: encoder
				? {
						model: HISTORY_EMBEDDING_MODEL,
						revision: HISTORY_EMBEDDING_REVISION,
						dtype: "q8",
					}
				: null,
			corpusHash: createHash("sha256")
				.update(JSON.stringify(contextEvaluationCases))
				.digest("hex"),
			generatedAt: new Date().toISOString(),
			budget: {
				resultLimit: RESULT_LIMIT,
				packetBytes: PACKET_BYTES,
				candidateLimit: CANDIDATE_LIMIT,
			},
			limitations:
				"Hand-authored synthetic regression cases, not a held-out statistical estimate or native-agent success test. Candidate coverage has no delivery budget and is only an upper bound for reranking. Bytes use a common evidence envelope, not full MCP traffic. Timings are single queries on small histories, not a load benchmark.",
			summary,
			rows,
		},
		null,
		2,
	),
);
