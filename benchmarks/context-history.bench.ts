import { bench, describe } from "vitest";
import { ContextHistoryIndex } from "../server/src/context-history.ts";
import type { HistoryEmbedder } from "../server/src/semantic-history.ts";
import { benchmarkHistoryMessages } from "./fixtures.ts";

const HISTORY_VECTOR_DIMENSIONS = 384;
const messages = benchmarkHistoryMessages();
const query = "benchmark needle";
const resultLimit = 8;

/** Stable synthetic vectors keep model inference out of the CodSpeed workload. */
function syntheticEmbedding(text: string): number[] {
	let seed = 2_166_136_261;
	for (let index = 0; index < text.length; index += 1)
		seed = Math.imul(seed ^ text.charCodeAt(index), 16_777_619) >>> 0;
	return Array.from({ length: HISTORY_VECTOR_DIMENSIONS }, (_, index) => {
		const value = (Math.imul(seed ^ index, 1_664_525) + 1_013_904_223) >>> 0;
		return value / 2_147_483_648 - 1;
	});
}

const syntheticVectors = new Map<string, number[]>();
for (const message of messages)
	syntheticVectors.set(message.text, syntheticEmbedding(message.text));
syntheticVectors.set(query, syntheticEmbedding(query));

const syntheticEmbedder: HistoryEmbedder = {
	embed: async (texts) =>
		texts.map((text) => {
			const vector = syntheticVectors.get(text);
			if (vector === undefined)
				throw new Error("Missing precomputed synthetic history embedding");
			return vector;
		}),
};

const lexicalIndex = new ContextHistoryIndex();
lexicalIndex.sync(messages);
const browseNodeId = lexicalIndex.browse().children[0]?.id;
if (browseNodeId === undefined)
	throw new Error("Benchmark history has no browsable branch");

const hybridIndex = new ContextHistoryIndex(syntheticEmbedder);
hybridIndex.sync(messages);
const warmHybridResult = await hybridIndex.findHybrid(query, resultLimit);
if (warmHybridResult.semanticStatus !== "ready")
	throw new Error("Could not warm the synthetic history embeddings");

describe("scoped history retrieval", () => {
	bench("build a tree from a 1,000-message DM history", () => {
		new ContextHistoryIndex().sync(messages);
	});

	bench(
		"run the first hybrid query with precomputed synthetic vectors",
		async () => {
			const index = new ContextHistoryIndex(syntheticEmbedder);
			index.sync(messages);
			const result = await index.findHybrid(query, resultLimit);
			if (result.semanticStatus !== "ready")
				throw new Error("Synthetic history embeddings became unavailable");
		},
	);

	bench("browse a page from an unchanged 1,000-message scope", () => {
		lexicalIndex.sync(messages.slice());
		lexicalIndex.browse(browseNodeId);
	});

	bench("find common passages with the lexical-only baseline", () => {
		lexicalIndex.sync(messages.slice());
		lexicalIndex.find(query, resultLimit);
	});

	bench("rank warm hybrid results with cached synthetic vectors", async () => {
		hybridIndex.sync(messages.slice());
		const result = await hybridIndex.findHybrid(query, resultLimit);
		if (result.semanticStatus !== "ready")
			throw new Error("Synthetic history embeddings became unavailable");
	});
});
