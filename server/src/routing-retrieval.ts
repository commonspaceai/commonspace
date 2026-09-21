import type {
	CommonspaceMessage,
	CommonspacePin,
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

interface RetrievedRoutingContextInput {
	state: CommonspaceState;
	channelId: string;
	query: string;
	index: RoutingMessageIndex;
	thread: CommonspaceThread | undefined;
	scopeThreadId: string | undefined;
}

interface RoutingMemoryEvidence {
	summary: string;
	decisions: string[];
	openQuestions: string[];
	origin?: string;
}

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

function appendMemoryEvidence(
	evidence: string[],
	label: string,
	value: RoutingMemoryEvidence,
): void {
	if (
		value.summary === "" &&
		value.decisions.length === 0 &&
		value.openQuestions.length === 0
	) {
		return;
	}
	evidence.push(
		`${label} (${value.origin ?? "automatic"}): ${JSON.stringify({ summary: value.summary, decisions: value.decisions, openQuestions: value.openQuestions })}`,
	);
}

function latestThreadOwner(
	messages: readonly CommonspaceMessage[],
	threadId: string,
): readonly string[] | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.threadId !== threadId) continue;
		const agentIds = message.routing?.agentIds;
		if (agentIds !== undefined && agentIds.length > 0) return agentIds;
	}
	return undefined;
}

function liveMessagesById(
	messages: readonly CommonspaceMessage[],
): ReadonlyMap<string, CommonspaceMessage> {
	const live = new Map<string, CommonspaceMessage>();
	for (const message of messages)
		if (message.deletedAt === undefined) live.set(message.id, message);
	return live;
}

function routingPinIsInScope(
	scope: CommonspacePin["scope"],
	channelId: string,
	threadId: string | undefined,
): boolean {
	return (
		(scope.kind === "channel" && scope.id === channelId) ||
		(scope.kind === "thread" && scope.id === threadId)
	);
}

function pinnedRoutingEvidence(
	state: CommonspaceState,
	messages: readonly CommonspaceMessage[],
	channelId: string,
	scopeThreadId: string | undefined,
): string[] {
	const evidence: string[] = [];
	let messageById: ReadonlyMap<string, CommonspaceMessage> | undefined;
	for (const pin of state.pins) {
		if (pin.removedAt !== null) continue;
		if (!routingPinIsInScope(pin.scope, channelId, scopeThreadId)) continue;
		if (pin.kind === "note") {
			if (pin.note !== "") evidence.push(`Pinned note ${pin.id}: ${pin.note}`);
			continue;
		}
		if (pin.kind !== "message") continue;
		messageById ??= liveMessagesById(messages);
		const message = messageById.get(pin.messageId);
		if (message !== undefined) {
			evidence.push(
				`Pinned message ${message.id}, ${message.authorName}: ${message.text}`,
			);
		}
	}
	return evidence;
}

function recentRoutingEvidence(
	messages: readonly CommonspaceMessage[],
	query: string,
	scopeThreadId: string | undefined,
): string[] {
	const recent: CommonspaceMessage[] = [];
	for (
		let index = messages.length - 1;
		index >= 0 && recent.length < 8;
		index -= 1
	) {
		const message = messages[index];
		if (
			message === undefined ||
			message.deletedAt !== undefined ||
			message.authorType === "system" ||
			(scopeThreadId !== undefined && message.threadId !== scopeThreadId)
		) {
			continue;
		}
		recent.push(message);
	}
	return recent
		.reverse()
		.flatMap((message) =>
			message.text === query
				? []
				: [
						`Recent message ${message.id}, ${message.authorName}: ${message.text.slice(0, 900)}`,
					],
		);
}

/** Only public conversation content enters the remote routing state. Order preserves authoritative notes first. */
export function buildRetrievedRoutingContext({
	state,
	channelId,
	query,
	index,
	thread,
	scopeThreadId,
}: RetrievedRoutingContextInput): string[] {
	const channel = state.channels.find((c) => c.id === channelId);
	const messages = state.messages[`channel:${channelId}`] ?? [];
	index.sync(messages);
	const evidence: string[] = [];
	if (channel?.instructions)
		evidence.push(`Channel instructions: ${channel.instructions}`);
	if (thread !== undefined) {
		appendMemoryEvidence(
			evidence,
			"Thread starting context",
			thread.context.channelSnapshot,
		);
		appendMemoryEvidence(evidence, "Thread context", thread.context.memory);
		const priorOwner = latestThreadOwner(messages, thread.id);
		if (priorOwner !== undefined)
			evidence.push(`Prior Thread ownership: ${JSON.stringify(priorOwner)}`);
	} else if (channel !== undefined) {
		appendMemoryEvidence(evidence, "Channel context", channel.memory);
	}
	evidence.push(
		...pinnedRoutingEvidence(state, messages, channelId, scopeThreadId),
		...recentRoutingEvidence(messages, query, scopeThreadId),
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
	/** UTF-16 offset into the canonical message text. */
	start: number;
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
			this.indexMessage(message);
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
					start: passage.start,
					author: passage.author,
					text: passage.text,
				};
				if (passage.threadId !== undefined) result.threadId = passage.threadId;
				return [result];
			});
	}

	private indexMessage(message: CommonspaceMessage): void {
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
				start: offset,
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
