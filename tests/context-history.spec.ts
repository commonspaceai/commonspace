import type { CommonspaceMessage } from "@commonspace/shared";
import { describe, expect, it } from "vitest";
import { ContextHistoryIndex } from "../server/src/context-history.ts";

function message(id: string, text: string): CommonspaceMessage {
	return {
		id,
		text,
		conversation: { kind: "channel", id: "engineering" },
		threadId: "auth",
		authorType: "user",
		authorId: "human",
		authorName: "Human",
		createdAt: "2026-09-18T00:00:00Z",
	};
}

describe("history identifier spelling", () => {
	it("retrieves identifier separator variants without losing the literal form", () => {
		const index = new ContextHistoryIndex();
		index.sync([
			message(
				"underscore",
				"AUTH_TOKEN_EXPIRED must retain the correlation ID.",
			),
			message("hyphen", "AUTH-TOKEN-EXPIRED must resume the native session."),
		]);
		for (const query of ["AUTH_TOKEN_EXPIRED", "AUTH-TOKEN-EXPIRED"]) {
			expect(
				new Set(
					index.find(query, 4).results.map((hit) => hit.source.messageId),
				),
			).toEqual(new Set(["underscore", "hyphen"]));
		}
	});
});

describe("scoped context history", () => {
	it("reports unavailable semantics while preserving usable keyword results", async () => {
		const index = new ContextHistoryIndex({
			embed: async () => {
				throw new Error("Unavailable");
			},
		});
		index.sync([message("source", "Preserve EXACT_ID bytes.")]);
		const result = await index.findHybrid("EXACT_ID", 4);
		expect(result).toMatchObject({
			method: "lexical",
			semanticStatus: "unavailable",
			results: [{ source: { messageId: "source" } }],
		});
	});
	it("keeps every source reachable through bounded branches without summarizing it", () => {
		const index = new ContextHistoryIndex();
		const messages = Array.from({ length: 130 }, (_, i) =>
			message(String(i), `Exact evidence ${i}.`),
		);
		const original = structuredClone(messages);
		index.sync(messages);
		const found: string[] = [];
		function visit(nodeId?: string): void {
			const page = index.browse(nodeId);
			expect(page.children.length).toBeLessThanOrEqual(8);
			if (page.source) found.push(page.source.text);
			for (const child of page.children) visit(child.id);
		}
		visit();
		expect(found).toEqual(messages.map((m) => m.text));
		expect(messages).toEqual(original);
	});

	it("finds old evidence deep in long messages with exact offsets and a navigable path", () => {
		const index = new ContextHistoryIndex();
		const long = message(
			"constraint",
			`${"ordinary status ".repeat(400)}Preserve REFRESH_PROTOCOL_V7 exactly.`,
		);
		index.sync([
			long,
			...Array.from({ length: 100 }, (_, i) =>
				message(String(i), "New screen update."),
			),
		]);
		const result = index.find("REFRESH_PROTOCOL_V7", 3);
		const hit = result.results[0];
		if (!hit) throw new Error("Missing evidence");
		expect(hit.source.messageId).toBe("constraint");
		expect(hit.source.text).toContain("REFRESH_PROTOCOL_V7");
		expect(hit.source.text).toBe(
			long.text.slice(hit.source.start, hit.source.end),
		);
		expect(hit.path[0]).toBe(result.rootId);
		for (let i = 1; i < hit.path.length; i++) {
			expect(index.browse(hit.path[i - 1]).children.map((c) => c.id)).toContain(
				hit.path[i],
			);
		}
		expect(index.browse(hit.nodeId).source).toEqual(hit.source);
	});

	it("invalidates edited and deleted evidence but leaves unchanged branches stable on append", () => {
		const index = new ContextHistoryIndex();
		const messages = Array.from({ length: 20 }, (_, i) =>
			message(String(i), `Record marker_${i}`),
		);
		index.sync(messages);
		const old = index.find("marker_0", 1).results[0];
		if (!old) throw new Error("Missing source");
		const firstBranch = index.browse().children[0];
		if (firstBranch?.kind !== "branch") throw new Error("Missing branch");
		const branchBefore = index.browse(firstBranch.id);
		index.sync([...messages, message("new", "Appended evidence")]);
		expect(index.browse(old.nodeId).source).toEqual(old.source);
		expect(index.browse(firstBranch.id).children).toEqual(
			branchBefore.children,
		);
		expect(index.browse(firstBranch.id).node).toEqual(branchBefore.node);
		index.sync(
			messages.map((m, i) =>
				i === 0
					? { ...m, text: "Corrected constraint" }
					: { ...m, deletedAt: "now" },
			),
		);
		expect(() => index.browse(old.nodeId)).toThrow(/stale|scope/);
		expect(index.find("marker_0 marker_1", 8).results).toEqual([]);
		expect(index.browse().node.passageCount).toBe(1);
	});

	it("returns bounded, detached source views without private message fields", () => {
		const index = new ContextHistoryIndex();
		const m = message("one", "unicode 😀 ".repeat(1000));
		index.sync([m]);
		const first = index.find("unicode", 1).results[0];
		if (!first) throw new Error("Missing source");
		expect(first.source.text.length).toBeLessThanOrEqual(900);
		expect(first.source).not.toHaveProperty("conversation");
		first.source.text = "altered caller view";
		expect(index.browse(first.nodeId).source?.text).not.toBe(
			"altered caller view",
		);
		expect(() => index.find("unicode", Number.NaN)).toThrow();
		expect(() => index.find("unicode", 100)).toThrow();
	});
});
