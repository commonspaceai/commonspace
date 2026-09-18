import type {
	CommonspaceMessage,
	CommonspaceState,
	CommonspaceThread,
} from "@commonspace/shared";

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"do",
	"for",
	"from",
	"i",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"please",
	"that",
	"the",
	"this",
	"to",
	"we",
	"with",
	"you",
]);

function terms(text: string): string[] {
	return (
		text
			.normalize("NFKC")
			.toLowerCase()
			.match(/[\p{L}\p{N}_-]+/gu) ?? []
	).filter((term) => !STOP_WORDS.has(term));
}

function excerpt(text: string, query: string): string {
	if (text.length <= 2_000) return text;
	const sought = new Set(terms(query));
	let selected = "";
	let highest = 0;
	for (let offset = 600; offset < text.length; offset += 800) {
		const chunk = text.slice(offset, offset + 900);
		const score = new Set(terms(chunk).filter((term) => sought.has(term))).size;
		if (score > highest) {
			highest = score;
			selected = chunk;
		}
	}
	return selected
		? `${text.slice(0, 600)}\n[Relevant source excerpt]\n${selected}`
		: text.slice(0, 2_000);
}

function boundEvidence(
	items: readonly string[],
	query: string,
	budget: number,
): string[] {
	let remaining = budget;
	return items.flatMap((item) => {
		if (remaining <= 0) return [];
		let bounded = excerpt(item, query);
		while (Buffer.byteLength(bounded) > remaining)
			bounded = bounded.slice(0, Math.floor(bounded.length * 0.8));
		remaining -= Buffer.byteLength(bounded);
		return bounded ? [bounded] : [];
	});
}

/** Only public conversation content enters the remote routing state. Order preserves authoritative notes first. */
export function buildRetrievedRoutingContext(
	state: CommonspaceState,
	channelId: string,
	query: string,
	index: RoutingMessageIndex,
	thread?: CommonspaceThread,
	scopeThreadId?: string,
): string[] {
	const channel = state.channels.find((c) => c.id === channelId);
	const messages = state.messages[`channel:${channelId}`] ?? [];
	index.sync(messages);
	const evidence: string[] = [];
	if (channel?.instructions)
		evidence.push(`Channel instructions: ${channel.instructions}`);
	function memory(
		label: string,
		value: {
			summary: string;
			decisions: string[];
			openQuestions: string[];
			origin?: string;
		},
	): void {
		if (value.summary || value.decisions.length || value.openQuestions.length)
			evidence.push(
				`${label} (${value.origin ?? "automatic"}): ${JSON.stringify({ summary: value.summary, decisions: value.decisions, openQuestions: value.openQuestions })}`,
			);
	}
	if (thread !== undefined) {
		memory("Thread starting context", thread.context.channelSnapshot);
		memory("Thread context", thread.context.memory);
		const prior = [...messages]
			.reverse()
			.find((m) => m.threadId === thread.id && m.routing?.agentIds.length);
		if (prior?.routing !== undefined)
			evidence.push(
				`Prior Thread ownership: ${JSON.stringify(prior.routing.agentIds)}`,
			);
	} else if (channel !== undefined) memory("Channel context", channel.memory);
	for (const pin of state.pins) {
		if (
			pin.removedAt !== null ||
			!(
				(pin.scope.kind === "channel" && pin.scope.id === channelId) ||
				(pin.scope.kind === "thread" && pin.scope.id === scopeThreadId)
			)
		)
			continue;
		if (pin.kind === "note" && pin.note)
			evidence.push(`Pinned note ${pin.id}: ${pin.note}`);
		if (pin.kind === "message") {
			const message = messages.find(
				(m) => m.id === pin.messageId && m.deletedAt === undefined,
			);
			if (message !== undefined)
				evidence.push(
					`Pinned message ${message.id}, ${message.authorName}: ${message.text}`,
				);
		}
	}
	const recent = messages
		.filter(
			(m) =>
				m.deletedAt === undefined &&
				m.authorType !== "system" &&
				(scopeThreadId === undefined || m.threadId === scopeThreadId),
		)
		.slice(-8);
	for (const message of recent)
		if (message.text !== query)
			evidence.push(
				`Recent message ${message.id}, ${message.authorName}: ${message.text.slice(0, 900)}`,
			);
	const retrieved = boundEvidence(
		index
			.search(query, scopeThreadId)
			.map(
				(passage) =>
					`Retrieved message ${passage.messageId}, Thread ${passage.threadId ?? "channel"}, ${passage.author}: ${passage.text}`,
			),
		query,
		4_000,
	);
	return [
		...boundEvidence(
			evidence,
			query,
			14_000 - Buffer.byteLength(retrieved.join("")),
		),
		...retrieved,
	];
}

export interface RoutingPassage {
	messageId: string;
	author: string;
	text: string;
	threadId?: string;
}
interface IndexedPassage extends RoutingPassage {
	length: number;
	frequencies: Map<string, number>;
}

/** Ephemeral BM25 index of public conversation text, incrementally reconciled with canonical messages. */
export class RoutingMessageIndex {
	private readonly sources = new Map<
		string,
		{ message: CommonspaceMessage; passageIds: string[] }
	>();
	private readonly passages = new Map<string, IndexedPassage>();
	private readonly postings = new Map<string, Map<string, number>>();
	private sourceArray: readonly CommonspaceMessage[] | undefined;
	private totalLength = 0;

	sync(messages: readonly CommonspaceMessage[]): void {
		if (messages === this.sourceArray) return;
		const retained = new Set<string>();
		for (const message of messages) {
			if (
				message.deletedAt !== undefined ||
				message.authorType === "system" ||
				message.text === ""
			)
				continue;
			retained.add(message.id);
			if (this.sources.get(message.id)?.message === message) continue;
			this.remove(message.id);
			const passageIds: string[] = [];
			for (let offset = 0; offset < message.text.length; offset += 800) {
				const text = message.text.slice(offset, offset + 900);
				const tokens = terms(text);
				const frequencies = new Map<string, number>();
				for (const token of tokens)
					frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
				const id = `${message.id}:${String(offset)}`;
				const passage: IndexedPassage = {
					messageId: message.id,
					author: message.authorName,
					text,
					length: tokens.length,
					frequencies,
				};
				if (message.threadId !== undefined) passage.threadId = message.threadId;
				this.passages.set(id, passage);
				this.totalLength += tokens.length;
				passageIds.push(id);
				for (const [token, count] of frequencies) {
					let posting = this.postings.get(token);
					if (posting === undefined) {
						posting = new Map();
						this.postings.set(token, posting);
					}
					posting.set(id, count);
				}
			}
			this.sources.set(message.id, { message, passageIds });
		}
		for (const id of this.sources.keys())
			if (!retained.has(id)) this.remove(id);
		this.sourceArray = messages;
	}

	search(query: string, threadId?: string, limit = 8): RoutingPassage[] {
		if (this.passages.size === 0) return [];
		const averageLength = Math.max(1, this.totalLength / this.passages.size);
		const scores = new Map<string, number>();
		for (const token of new Set(terms(query))) {
			const posting = this.postings.get(token);
			if (posting === undefined) continue;
			const idf = Math.log(
				1 + (this.passages.size - posting.size + 0.5) / (posting.size + 0.5),
			);
			for (const [id, frequency] of posting) {
				const passage = this.passages.get(id);
				if (
					passage === undefined ||
					(threadId !== undefined && passage.threadId !== threadId)
				)
					continue;
				const score =
					(idf * frequency * 2.2) /
					(frequency + 1.2 * (0.25 + (0.75 * passage.length) / averageLength));
				scores.set(id, (scores.get(id) ?? 0) + score);
			}
		}
		return [...scores]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, limit)
			.flatMap(([id]) => {
				const passage = this.passages.get(id);
				if (passage === undefined) return [];
				const result: RoutingPassage = {
					messageId: passage.messageId,
					author: passage.author,
					text: passage.text,
				};
				if (passage.threadId !== undefined) result.threadId = passage.threadId;
				return [result];
			});
	}

	private remove(messageId: string): void {
		const source = this.sources.get(messageId);
		if (source === undefined) return;
		for (const id of source.passageIds) {
			const passage = this.passages.get(id);
			if (passage === undefined) continue;
			this.totalLength -= passage.length;
			for (const token of passage.frequencies.keys()) {
				const posting = this.postings.get(token);
				posting?.delete(id);
				if (posting?.size === 0) this.postings.delete(token);
			}
			this.passages.delete(id);
		}
		this.sources.delete(messageId);
	}
}
