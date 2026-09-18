import { createHash } from "node:crypto";
import type { CommonspaceMessage } from "@commonspace/shared";
import { RoutingMessageIndex } from "./routing-retrieval.js";
import {
	fuseHistoryRanks,
	type HistoryEmbedder,
	SemanticHistoryIndex,
} from "./semantic-history.js";

const FANOUT = 8;
const PASSAGE_CHARS = 900;
const PASSAGE_STRIDE = 800;

export interface ContextSource {
	messageId: string;
	revision: string;
	authorType: CommonspaceMessage["authorType"];
	authorName: string;
	createdAt: string;
	threadId: string | null;
	/** Offsets count UTF-16 code units, as JavaScript String.slice does. */
	start: number;
	end: number;
	totalChars: number;
	text: string;
}

export interface ContextHistoryNode {
	id: string;
	kind: "branch" | "passage";
	passageCount: number;
	firstMessageId: string | null;
	lastMessageId: string | null;
	/** Navigational excerpt, not a summary or an instruction. */
	preview: string;
}

export interface ContextHistoryPage {
	rootId: string;
	node: ContextHistoryNode;
	children: ContextHistoryNode[];
	source: ContextSource | null;
}

export interface ContextHistoryHit {
	nodeId: string;
	path: string[];
	source: ContextSource;
}

export interface ContextHistoryMatches {
	rootId: string;
	method: "lexical" | "hybrid";
	semanticStatus: "not-requested" | "ready" | "unavailable";
	results: ContextHistoryHit[];
}

interface StoredNode {
	view: ContextHistoryNode;
	children: string[];
	source: ContextSource | null;
}

function digest(value: readonly (string | number | undefined)[]): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Preserve literal identifiers while also searching underscore/hyphen spellings. */
export function expandHistoryQuery(query: string): string {
	const normalized = query.normalize("NFKC");
	const variants = new Set([normalized]);
	for (const match of normalized.matchAll(
		/[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)+/gu,
	)) {
		variants.add(match[0].replace(/[_-]/g, "_"));
		variants.add(match[0].replace(/[_-]/g, "-"));
	}
	return [...variants].join(" ");
}

/** Derived, local-only tree. Input must already be authorized and generation-scoped. */
export class ContextHistoryIndex {
	private readonly retrieval = new RoutingMessageIndex();
	private readonly nodes = new Map<string, StoredNode>();
	private readonly parents = new Map<string, string>();
	private readonly passageNodes = new Map<string, Map<number, string>>();
	private messages: readonly CommonspaceMessage[] = [];
	private root: StoredNode;
	private readonly semantic: SemanticHistoryIndex | undefined;

	constructor(encoder?: HistoryEmbedder) {
		this.root = this.branch([]);
		this.semantic =
			encoder === undefined ? undefined : new SemanticHistoryIndex(encoder);
	}

	sync(messages: readonly CommonspaceMessage[]): void {
		if (
			messages.length === this.messages.length &&
			messages.every((m, i) => m === this.messages[i])
		)
			return;
		// Commonspace message values are replaced on mutation. Never retain caller-owned arrays.
		this.messages = [...messages];
		this.semantic?.invalidate();
		this.retrieval.sync(this.messages);
		this.nodes.clear();
		this.parents.clear();
		this.passageNodes.clear();
		let level: StoredNode[] = [];
		for (const message of messages) {
			if (
				message.deletedAt !== undefined ||
				message.authorType === "system" ||
				message.text === ""
			)
				continue;
			const revision = digest([
				message.id,
				message.authorType,
				message.authorName,
				message.createdAt,
				message.threadId,
				message.text,
			]);
			const offsets = new Map<number, string>();
			this.passageNodes.set(message.id, offsets);
			for (
				let start = 0;
				start < message.text.length;
				start += PASSAGE_STRIDE
			) {
				const end = Math.min(start + PASSAGE_CHARS, message.text.length);
				const source: ContextSource = {
					messageId: message.id,
					revision,
					authorType: message.authorType,
					authorName: message.authorName,
					createdAt: message.createdAt,
					threadId: message.threadId ?? null,
					start,
					end,
					totalChars: message.text.length,
					text: message.text.slice(start, end),
				};
				const id = digest([revision, start, end]);
				const node: StoredNode = {
					view: {
						id,
						kind: "passage",
						passageCount: 1,
						firstMessageId: message.id,
						lastMessageId: message.id,
						preview: source.text.slice(0, 180),
					},
					children: [],
					source,
				};
				this.nodes.set(id, node);
				offsets.set(start, id);
				level.push(node);
			}
		}
		while (level.length > FANOUT) {
			const next: StoredNode[] = [];
			for (let i = 0; i < level.length; i += FANOUT)
				next.push(this.branch(level.slice(i, i + FANOUT)));
			level = next;
		}
		this.root = this.branch(level);
	}

	browse(nodeId?: string): ContextHistoryPage {
		const node = nodeId === undefined ? this.root : this.nodes.get(nodeId);
		if (node === undefined)
			throw new Error(
				"Context node is stale or outside this scope; browse the current root again.",
			);
		return {
			rootId: this.root.view.id,
			node: { ...node.view },
			children: node.children.map((id) => ({ ...this.node(id).view })),
			source: node.source === null ? null : { ...node.source },
		};
	}

	find(query: string, limit: number): ContextHistoryMatches {
		if (!query.trim() || query.length > 500)
			throw new Error("Context query must contain 1–500 characters.");
		if (!Number.isInteger(limit) || limit < 1 || limit > 8)
			throw new Error("Context result limit must be 1–8.");
		const results = this.retrieval
			.search(expandHistoryQuery(query), undefined, limit)
			.map((passage): ContextHistoryHit => {
				const id = this.passageNodes.get(passage.messageId)?.get(passage.start);
				if (id === undefined)
					throw new Error("Context index lost its source passage.");
				const source = this.node(id).source;
				if (source === null) throw new Error("Context passage has no source.");
				const path = [id];
				let parent = this.parents.get(id);
				while (parent !== undefined) {
					path.unshift(parent);
					parent = this.parents.get(parent);
				}
				return { nodeId: id, path, source: { ...source } };
			});
		return {
			rootId: this.root.view.id,
			method: "lexical",
			semanticStatus: "not-requested",
			results,
		};
	}

	async findHybrid(
		query: string,
		limit: number,
	): Promise<ContextHistoryMatches> {
		const lexical = this.find(query, limit);
		if (this.semantic === undefined) return lexical;
		const rootId = this.root.view.id;
		const sources = [...this.nodes.values()].flatMap((node) =>
			node.source === null
				? []
				: [{ id: node.view.id, text: node.source.text }],
		);
		let semantic: string[];
		try {
			semantic = await this.semantic.search(sources, query, 10);
		} catch {
			if (rootId !== this.root.view.id)
				throw new Error("History changed during retrieval; retry.");
			return { ...lexical, semanticStatus: "unavailable" };
		}
		if (rootId !== this.root.view.id)
			throw new Error("History changed during retrieval; retry.");
		const keywordIds = this.retrieval
			.search(expandHistoryQuery(query), undefined, 10)
			.map((passage) => {
				const id = this.passageNodes.get(passage.messageId)?.get(passage.start);
				if (id === undefined)
					throw new Error("Context index lost its source passage.");
				return id;
			});
		const results = fuseHistoryRanks(keywordIds, semantic, limit).map((id) => {
			const source = this.node(id).source;
			if (source === null) throw new Error("Context passage has no source.");
			const path = [id];
			let parent = this.parents.get(id);
			while (parent !== undefined) {
				path.unshift(parent);
				parent = this.parents.get(parent);
			}
			return { nodeId: id, path, source: { ...source } };
		});
		return { rootId, method: "hybrid", semanticStatus: "ready", results };
	}

	private node(id: string): StoredNode {
		const node = this.nodes.get(id);
		if (node === undefined) throw new Error("Context index lost a tree node.");
		return node;
	}

	private branch(children: readonly StoredNode[]): StoredNode {
		const ids = children.map((child) => child.view.id);
		const id = digest(ids);
		const first = children[0]?.view;
		const last = children.at(-1)?.view;
		const node: StoredNode = {
			view: {
				id,
				kind: "branch",
				passageCount: children.reduce(
					(n, child) => n + child.view.passageCount,
					0,
				),
				firstMessageId: first?.firstMessageId ?? null,
				lastMessageId: last?.lastMessageId ?? null,
				preview:
					children.length > 1
						? `${first?.preview.slice(0, 90)} … ${last?.preview.slice(-90)}`
						: (first?.preview ?? ""),
			},
			children: ids,
			source: null,
		};
		this.nodes.set(id, node);
		for (const child of children) this.parents.set(child.view.id, id);
		return node;
	}
}
