import type { CommonspaceMessage } from "@commonspace/shared";
import { afterAll, describe, expect, it } from "vitest";
import { ContextHistoryIndex } from "../server/src/context-history.ts";
import { LocalHistoryEmbeddings } from "../server/src/local-history-embeddings.ts";

const enabled = process.env.COMMONSPACE_LOCAL_EMBEDDINGS === "1";
const encoder = new LocalHistoryEmbeddings(
	process.env.COMMONSPACE_EMBEDDING_CACHE,
);
afterAll(() => encoder.close());

it("terminates pending local work on close and rejects future jobs", async () => {
	const closing = new LocalHistoryEmbeddings();
	const pending = closing.embed(["synthetic pending job"]);
	const rejected = expect(pending).rejects.toThrow(/unavailable/);
	await closing.close();
	await rejected;
	await expect(closing.embed(["after shutdown"])).rejects.toThrow(
		/unavailable/,
	);
});

describe.runIf(enabled)("real local semantic retrieval", () => {
	it.each([
		[
			"How do we prevent duplicate charges?",
			"Billing writes use an idempotency key on every payment attempt.",
		],
		[
			"Can users recover erased documents?",
			"Deleted files stay in the recycle bin for thirty days before permanent removal.",
		],
		[
			"How can we stop two people overwriting each other's changes?",
			"Optimistic concurrency checks compare revision numbers before accepting an update.",
		],
		[
			"What happens if the machine loses power halfway through saving?",
			"Atomic writes use a temporary file, fsync, and rename so interrupted persistence preserves the previous state.",
		],
	])(
		"finds source evidence for %s",
		async (query, evidence) => {
			const texts = [
				evidence,
				...Array.from(
					{ length: 32 },
					(_, i) =>
						`Design review ${i}: sidebar spacing and icon alignment look good.`,
				),
			];
			const messages: CommonspaceMessage[] = texts.map((text, i) => ({
				id: `m${i}`,
				text,
				conversation: { kind: "channel", id: "synthetic" },
				authorType: "user",
				authorId: "human",
				authorName: "Human",
				createdAt: "2026-09-18T00:00:00Z",
			}));
			const index = new ContextHistoryIndex(encoder);
			index.sync(messages);
			const result = await index.findHybrid(query, 4);
			expect(result.method).toBe("hybrid");
			expect(result.results.map((hit) => hit.source.text)).toContain(evidence);
		},
		120_000,
	);
});
