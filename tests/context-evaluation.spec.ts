import { describe, expect, it } from "vitest";
import { packEvidence, scoreEvidence } from "../scripts/context-evaluation.ts";
import { contextEvaluationCases } from "../scripts/context-evaluation-cases.ts";

describe("context evidence evaluation oracle", () => {
	it("requires the actual gold span, not another passage from the same message", () => {
		const evaluation = contextEvaluationCases.find(
			(c) => c.id === "buried-evidence",
		);
		if (!evaluation) throw new Error("Missing evaluation");
		const source = evaluation.messages[0];
		if (!source) throw new Error("Missing source");
		expect(
			scoreEvidence(evaluation, [
				{ messageId: source.id, start: 0, text: source.text.slice(0, 900) },
			]).complete,
		).toBe(false);
		const start = source.text.indexOf("requires an atomic rename");
		expect(
			scoreEvidence(evaluation, [
				{
					messageId: source.id,
					start,
					text: source.text.slice(start, start + 100),
				},
			]).complete,
		).toBe(true);
		expect(() =>
			scoreEvidence(evaluation, [
				{
					messageId: source.id,
					start: 0,
					text: "requires an atomic rename after fsync",
				},
			]),
		).toThrow("Unfaithful");
	});
	it("scores all required facts and merges contiguous source spans without bridging gaps", () => {
		const base = contextEvaluationCases[0];
		if (!base) throw new Error("Missing evaluation");
		const source = base.messages[0];
		if (!source) throw new Error("Missing source");
		const text = "alpha bravo charlie delta";
		const evaluation = {
			...base,
			messages: [{ ...source, text }],
			required: [
				{ messageId: source.id, quote: "bravo charlie" },
				{ messageId: source.id, quote: "delta" },
			],
		};
		const first = { messageId: source.id, start: 0, text: text.slice(0, 13) };
		const last = { messageId: source.id, start: 13, text: text.slice(13) };
		expect(scoreEvidence(evaluation, [first, last]).complete).toBe(true);
		expect(
			scoreEvidence(evaluation, [
				first,
				{ ...last, start: 14, text: text.slice(14) },
			]).covered,
		).toBe(1);
	});
	it("enforces a shared UTF-8 packet budget without granting credit to truncated evidence", () => {
		const packed = packEvidence(
			Array.from({ length: 8 }, (_, i) => ({
				messageId: String(i),
				start: 0,
				text: "界".repeat(600),
			})),
		);
		expect(packed).toHaveLength(2);
		expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThanOrEqual(4200);
	});
	it("rejects invalid gold labels in every fixture and keeps absent answers separate", () => {
		for (const evaluation of contextEvaluationCases) {
			const score = scoreEvidence(
				evaluation,
				evaluation.messages.map((m) => ({
					messageId: m.id,
					start: 0,
					text: m.text,
				})),
			);
			expect(score.complete).toBe(evaluation.required.length ? true : null);
		}
	});
});
