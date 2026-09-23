import { bench, describe } from "vitest";
import { ContextHistoryIndex } from "../server/src/context-history.ts";
import type { HistoryEmbedder } from "../server/src/semantic-history.ts";
import { benchmarkHistoryMessages } from "./fixtures.ts";

const HISTORY_VECTOR_DIMENSIONS = 384;
const messages = benchmarkHistoryMessages();
const query = "benchmark needle";
const selectiveQuery = "990";
const resultLimit = 8;
const editedMessageIndex = Math.floor(messages.length / 2);
const editedMessage = messages[editedMessageIndex];
if (editedMessage === undefined)
	throw new Error("Benchmark history has no message to edit");
const editedQuery = String(editedMessageIndex);
const editedText = `${editedMessage.text} Revised benchmark detail.`;
const editedMessages = messages.map((message, index) =>
	index === editedMessageIndex ? { ...message, text: editedText } : message,
);

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
syntheticVectors.set(editedText, syntheticEmbedding(editedText));
syntheticVectors.set(query, syntheticEmbedding(query));
syntheticVectors.set(editedQuery, syntheticEmbedding(editedQuery));

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
if (lexicalIndex.find(selectiveQuery, resultLimit).results.length !== 1)
	throw new Error("Benchmark selective query must match one passage");
const editedLexicalResult = lexicalIndex.find(editedQuery, resultLimit);
if (
	editedLexicalResult.results.length !== 1 ||
	editedLexicalResult.results[0]?.source.messageId !== editedMessage.id
)
	throw new Error("Benchmark edit query must find the edited passage");

const editedTreeIndex = new ContextHistoryIndex();
editedTreeIndex.sync(messages);
let nextTreeSnapshot = editedMessages;

const hybridIndex = new ContextHistoryIndex(syntheticEmbedder);
hybridIndex.sync(messages);
const warmHybridResult = await hybridIndex.findHybrid(query, resultLimit);
if (warmHybridResult.semanticStatus !== "ready")
	throw new Error("Could not warm the synthetic history embeddings");

const editedHybridIndex = new ContextHistoryIndex(syntheticEmbedder);
editedHybridIndex.sync(messages);
const editedHybridWarmResult = await editedHybridIndex.findHybrid(
	editedQuery,
	resultLimit,
);
if (
	editedHybridWarmResult.semanticStatus !== "ready" ||
	!editedHybridWarmResult.results.some(
		(hit) =>
			hit.source.messageId === editedMessage.id &&
			hit.source.text === editedMessage.text,
	)
)
	throw new Error("Could not warm the edited history embeddings");
let nextHybridSnapshot = editedMessages;

describe("scoped history retrieval", () => {
	bench("build a tree from a 1,000-message DM history", () => {
		new ContextHistoryIndex().sync(messages);
	});

	bench("rebuild the tree after one message edit", () => {
		editedTreeIndex.sync(nextTreeSnapshot);
		nextTreeSnapshot =
			nextTreeSnapshot === editedMessages ? messages : editedMessages;
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

	bench("find a rare passage with the lexical-only baseline", () => {
		lexicalIndex.sync(messages.slice());
		lexicalIndex.find(selectiveQuery, resultLimit);
	});

	bench("rank warm hybrid results with cached synthetic vectors", async () => {
		hybridIndex.sync(messages.slice());
		const result = await hybridIndex.findHybrid(query, resultLimit);
		if (result.semanticStatus !== "ready")
			throw new Error("Synthetic history embeddings became unavailable");
	});

	bench("refresh hybrid results after one message edit", async () => {
		const snapshot = nextHybridSnapshot;
		editedHybridIndex.sync(snapshot);
		nextHybridSnapshot =
			snapshot === editedMessages ? messages : editedMessages;
		const result = await editedHybridIndex.findHybrid(editedQuery, resultLimit);
		const expectedText =
			snapshot === editedMessages ? editedText : editedMessage.text;
		if (
			result.semanticStatus !== "ready" ||
			!result.results.some(
				(hit) =>
					hit.source.messageId === editedMessage.id &&
					hit.source.text === expectedText,
			)
		)
			throw new Error("Hybrid history result did not reflect the message edit");
	});
});
