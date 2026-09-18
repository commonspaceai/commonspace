import type { CommonspaceMessage } from "@commonspace/shared";
import type {
	ContextEvaluationCase,
	EvidenceLabel,
} from "./context-evaluation-cases.ts";

export interface EvaluationPassage {
	messageId: string;
	start: number;
	text: string;
}

export const RESULT_LIMIT = 4;
export const PACKET_BYTES = 4_200;
export const CANDIDATE_LIMIT = 20;

/** Same serialized evidence envelope and budget for every strategy; no gold labels. */
export function packEvidence(
	ranked: readonly EvaluationPassage[],
): EvaluationPassage[] {
	const selected: EvaluationPassage[] = [];
	for (const passage of ranked) {
		if (selected.length === RESULT_LIMIT) break;
		const candidate = {
			messageId: passage.messageId,
			start: passage.start,
			text: passage.text,
		};
		if (
			Buffer.byteLength(JSON.stringify([...selected, candidate])) <=
			PACKET_BYTES
		)
			selected.push(candidate);
	}
	return selected;
}

export function recentEvidence(
	messages: readonly CommonspaceMessage[],
): EvaluationPassage[] {
	return messages
		.filter(
			(m) =>
				m.deletedAt === undefined && m.authorType !== "system" && m.text !== "",
		)
		.toReversed()
		.flatMap((m) => {
			const passages: EvaluationPassage[] = [];
			for (let start = 0; start < m.text.length; start += 800)
				passages.push({
					messageId: m.id,
					start,
					text: m.text.slice(start, start + 900),
				});
			return passages.reverse();
		});
}

/** Experimental message diversity, retaining lower-ranked passages for unused slots. */
export function diversifyEvidence(
	ranked: readonly EvaluationPassage[],
): EvaluationPassage[] {
	const seen = new Set<string>();
	const first: EvaluationPassage[] = [];
	const remaining: EvaluationPassage[] = [];
	for (const passage of ranked) {
		if (seen.has(passage.messageId)) remaining.push(passage);
		else {
			seen.add(passage.messageId);
			first.push(passage);
		}
	}
	return [...first, ...remaining];
}

function labelSpan(evaluation: ContextEvaluationCase, label: EvidenceLabel) {
	const message = evaluation.messages.find((m) => m.id === label.messageId);
	const start = message?.text.indexOf(label.quote) ?? -1;
	if (
		label.quote === "" ||
		start < 0 ||
		message?.text.indexOf(label.quote, start + 1) !== -1
	)
		throw new Error(
			`Missing or ambiguous gold span in ${evaluation.id}: ${label.messageId}`,
		);
	return { messageId: label.messageId, start, end: start + label.quote.length };
}

function covers(
	span: ReturnType<typeof labelSpan>,
	passages: readonly EvaluationPassage[],
): boolean {
	let end = span.start;
	for (const passage of passages
		.filter((p) => p.messageId === span.messageId)
		.toSorted((a, b) => a.start - b.start)) {
		if (passage.start > end) break;
		end = Math.max(end, passage.start + passage.text.length);
	}
	return end >= span.end;
}

/** Deterministic evidence scoring, not a model's opinion of its own retrieval. */
export function scoreEvidence(
	evaluation: ContextEvaluationCase,
	passages: readonly EvaluationPassage[],
) {
	for (const passage of passages) {
		const source = evaluation.messages.find((m) => m.id === passage.messageId);
		if (
			!Number.isInteger(passage.start) ||
			passage.start < 0 ||
			passage.text === "" ||
			source?.text.slice(passage.start, passage.start + passage.text.length) !==
				passage.text
		)
			throw new Error(`Unfaithful source passage in ${evaluation.id}`);
	}
	const required = evaluation.required.map((label) =>
		labelSpan(evaluation, label),
	);
	const covered = required.filter((span) => covers(span, passages)).length;
	const useful = passages.filter((p) =>
		required.some(
			(span) =>
				span.messageId === p.messageId &&
				p.start < span.end &&
				p.start + p.text.length > span.start,
		),
	).length;
	const answerable = required.length > 0;
	return {
		required: required.length,
		covered,
		complete: answerable ? covered === required.length : null,
		evidenceRecall: answerable ? covered / required.length : null,
		usefulPassageFraction: passages.length ? useful / passages.length : null,
		emptyOnUnanswerable: answerable ? null : passages.length === 0,
		obsoleteWithoutAnswer:
			evaluation.obsolete.some((label) =>
				covers(labelSpan(evaluation, label), passages),
			) && covered !== required.length,
		packetBytes: Buffer.byteLength(JSON.stringify(passages)),
		passages: passages.length,
	};
}
