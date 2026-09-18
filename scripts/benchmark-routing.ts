import type { CommonspaceMessage } from "@commonspace/shared";
import { RoutingMessageIndex } from "../server/src/routing-retrieval.ts";

const messages: CommonspaceMessage[] = Array.from(
	{ length: 10_000 },
	(_, i) => ({
		id: String(i),
		conversation: { kind: "channel", id: "synthetic" },
		threadId: `thread-${String(i % 100)}`,
		authorType: "user",
		authorId: "human",
		authorName: "Human",
		text:
			i % 97 === 0
				? "Refresh-token expiration belongs to Backend; preserve protocol compatibility."
				: `Review screens and implementation progress for component ${String(i % 40)}.`,
		createdAt: "2026-09-17T00:00:00Z",
	}),
);
const index = new RoutingMessageIndex();
const cold = performance.now();
index.sync(messages);
const coldIndexMs = performance.now() - cold;
const samples: number[] = [];
for (let i = 0; i < 100; i++) {
	const started = performance.now();
	const found = index.search(
		i % 2 ? "refresh-token expiration" : "screens component 12",
		i % 3 ? undefined : "thread-0",
	);
	if (found.length === 0)
		throw new Error("Synthetic retrieval benchmark lost relevant evidence");
	samples.push(performance.now() - started);
}
const refreshed = performance.now();
const first = messages[0];
if (first === undefined) throw new Error("Synthetic corpus is empty");
index.sync([
	...messages,
	{
		...first,
		id: "new",
		text: "Refresh-token protocol must remain compatible.",
	} satisfies CommonspaceMessage,
]);
const incrementalSyncMs = performance.now() - refreshed;
samples.sort((a, b) => a - b);
console.log(
	JSON.stringify(
		{
			corpusMessages: messages.length,
			coldIndexMs,
			incrementalSyncMs,
			warmQueryP50Ms: samples[49],
			warmQueryP95Ms: samples[94],
			scope:
				"Synthetic local BM25 only; excludes Jev, network, persistence, and agent execution.",
		},
		null,
		2,
	),
);
