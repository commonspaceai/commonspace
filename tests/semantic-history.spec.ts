import { describe, expect, it } from "vitest";
import {
	fuseHistoryRanks,
	SemanticHistoryIndex,
} from "../server/src/semantic-history.ts";

describe("semantic history reconciliation", () => {
	it("shares passage indexing between concurrent readers of the same revision", async () => {
		const embedded: string[][] = [];
		const index = new SemanticHistoryIndex({
			embed: async (texts) => {
				embedded.push([...texts]);
				return texts.map(() => [1, 0]);
			},
		});
		const sources = [
			{ id: "a", text: "passage A" },
			{ id: "b", text: "passage B" },
		];
		await Promise.all([
			index.search(sources, "query1", 4),
			index.search(sources, "query2", 4),
		]);
		expect(
			embedded.filter((batch) => batch.includes("passage A")),
		).toHaveLength(1);
	});
	it("reuses unchanged vectors, removes old revisions, and ranks only current scope sources", async () => {
		const embedded: string[][] = [];
		const encoder = {
			embed: async (texts: readonly string[]) => {
				embedded.push([...texts]);
				return texts.map((text) => (text === "north" ? [1, 0] : [0, 1]));
			},
		};
		const index = new SemanticHistoryIndex(encoder);
		const sources = [
			{ id: "a:v1", text: "north" },
			{ id: "b:v1", text: "south" },
		];
		expect((await index.search(sources, "north", 10))[0]).toBe("a:v1");
		embedded.length = 0;
		await index.search(sources, "north", 10);
		expect(embedded).toEqual([]);
		const changed = [{ id: "a:v2", text: "south" }];
		expect(await index.search(changed, "north", 10)).toEqual(["a:v2"]);
		expect(embedded).toEqual([["south"]]);
	});

	it("does not publish old inference after the source generation changes", async () => {
		let release: ((vectors: number[][]) => void) | undefined;
		const encoder = {
			embed: async (texts: readonly string[]) => {
				if (texts[0] === "old")
					return new Promise<number[][]>((resolve) => {
						release = resolve;
					});
				return texts.map(() => [1, 0]);
			},
		};
		const index = new SemanticHistoryIndex(encoder);
		const pending = index.search([{ id: "old", text: "old" }], "query", 10);
		index.invalidate();
		if (!release) throw new Error("Inference did not start");
		release([[1, 0]]);
		await expect(pending).rejects.toThrow(/changed/);
		expect(
			await index.search([{ id: "new", text: "new" }], "query", 10),
		).toEqual(["new"]);
	});

	it("rejects malformed vectors instead of poisoning future similarity results", async () => {
		const index = new SemanticHistoryIndex({
			embed: async () => [[Number.NaN, 0]],
		});
		await expect(
			index.search([{ id: "x", text: "x" }], "query", 10),
		).rejects.toThrow(/vector/);
	});
});

it("fuses independent ranks without comparing incompatible BM25 and cosine scores", () => {
	expect(
		fuseHistoryRanks(
			["identifier", "shared", "lexical"],
			["semantic", "shared"],
			4,
		),
	).toEqual(["shared", "identifier", "semantic", "lexical"]);
});
