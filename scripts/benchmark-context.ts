import { arch, cpus, platform } from "node:os";
import type { CommonspaceMessage } from "@commonspace/shared";
import { ContextHistoryIndex } from "../server/src/context-history.ts";
import {
	HISTORY_EMBEDDING_MODEL,
	HISTORY_EMBEDDING_REVISION,
	LocalHistoryEmbeddings,
} from "../server/src/local-history-embeddings.ts";

const sizes = (process.env.COMMONSPACE_CONTEXT_SIZES ?? "100,1000")
	.split(",")
	.map(Number);
if (sizes.some((n) => !Number.isInteger(n) || n < 10 || n > 10_000))
	throw new Error("Context benchmark sizes must be 10–10000");
const local = new LocalHistoryEmbeddings(
	process.env.COMMONSPACE_EMBEDDING_CACHE,
);
let embeddedTexts = 0;
const encoder = {
	embed: async (texts: readonly string[]) => {
		embeddedTexts += texts.length;
		return local.embed(texts);
	},
};
const query = "How do we prevent duplicate charges?";
const samples = [];
try {
	for (const size of sizes) {
		process.stderr.write(`Measuring ${size} messages\n`);
		let messages: CommonspaceMessage[] = Array.from(
			{ length: size },
			(_, i) => ({
				id: `m${i}`,
				text:
					i === 5
						? "Billing writes use an idempotency key on every payment attempt."
						: `Design review ${i}: sidebar spacing and icon alignment look good.`,
				conversation: { kind: "channel", id: "synthetic" },
				authorType: "user",
				authorId: "human",
				authorName: "Human",
				createdAt: "2026-09-18T00:00:00Z",
			}),
		);
		const index = new ContextHistoryIndex(encoder);
		const buildStarted = performance.now();
		index.sync(messages);
		const first = await index.findHybrid(query, 4);
		const initialBuildAndQueryMs = performance.now() - buildStarted;
		if (
			first.method !== "hybrid" ||
			!first.results.some((h) => h.source.messageId === "m5")
		)
			throw new Error(
				"Semantic benchmark failed to retrieve required evidence",
			);
		const warm: number[] = [];
		const cached: number[] = [];
		for (let i = 0; i < 30; i++) {
			let started = performance.now();
			await index.findHybrid(`${query} Scenario ${i}.`, 4);
			warm.push(performance.now() - started);
			started = performance.now();
			await index.findHybrid(query, 4);
			cached.push(performance.now() - started);
		}
		const firstMessage = messages[0];
		if (!firstMessage) throw new Error("Missing fixture");
		const mutations = [];
		for (const change of ["append", "edit", "delete"]) {
			const before = embeddedTexts;
			const started = performance.now();
			if (change === "append")
				messages = [
					...messages,
					{
						...firstMessage,
						id: "appended",
						text: "A new export constraint: retain all unknown fields.",
					},
				];
			else if (change === "edit")
				messages = messages.map((m) =>
					m.id === "m5"
						? {
								...m,
								text: "Billing now needs a durable idempotency ledger before payment submission.",
							}
						: m,
				);
			else messages = messages.filter((m) => m.id !== "m5");
			index.sync(messages);
			const result = await index.findHybrid(query, 4);
			if (
				result.method !== "hybrid" ||
				(change === "delete" &&
					result.results.some((h) => h.source.messageId === "m5"))
			)
				throw new Error("Mutation invalidation failed");
			mutations.push({
				change,
				elapsedMs: performance.now() - started,
				embeddedTexts: embeddedTexts - before,
			});
		}
		warm.sort((a, b) => a - b);
		cached.sort((a, b) => a - b);
		samples.push({
			messages: size,
			initialBuildAndQueryMs,
			newQueryP50Ms: warm[14],
			newQueryP95Ms: warm[28],
			cachedQueryP50Ms: cached[14],
			cachedQueryP95Ms: cached[28],
			mutations,
			newQuerySamplesMs: warm,
			cachedQuerySamplesMs: cached,
			processRssBytes: process.memoryUsage().rss,
		});
	}
} finally {
	await local.close();
}
process.stdout.write(
	JSON.stringify(
		{
			model: HISTORY_EMBEDDING_MODEL,
			revision: HISTORY_EMBEDDING_REVISION,
			dtype: "q8",
			machine: {
				platform: platform(),
				arch: arch(),
				cpu: cpus()[0]?.model,
				node: process.version,
			},
			limitations:
				"Synthetic single-scope sequential retrieval. First size includes model loading/download if needed; later sizes reuse the model. New queries exclude passage indexing but include query embedding and exhaustive vector ranking. Mutation times include tree reconciliation and new passage inference. Process RSS includes the worker; no KV-cache or native-task measurement.",
			samples,
		},
		null,
		2,
	),
);
