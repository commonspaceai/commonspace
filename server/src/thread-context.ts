import type {
	CommonspaceChannelMemory,
	CommonspaceMessage,
	CommonspaceState,
	CommonspaceThreadContext,
	CommonspaceThreadMemory,
} from "@commonspace/shared";
import { conversationKey, referencedProjectIds } from "@commonspace/shared";
import {
	CONTEXT_BRIEF_POLICY,
	type CompactedChannelContext,
	compactionPins,
	compactionRoster,
} from "./context.js";

const MAX_COMPACTION_SOURCE_CHARS = 56_000;

interface CompactionSourceMessage {
	id: string;
	author: string;
	authorType: "agent" | "system" | "user";
	text: string;
	projects: string[];
	createdAt: string;
}

export function emptyThreadMemory(): CommonspaceThreadMemory {
	return {
		summary: "",
		decisions: [],
		openQuestions: [],
		updatedAt: null,
		origin: "automatic",
		status: "empty",
		sourceMessageCount: 0,
		estimatedTokens: 0,
		compactedThroughMessageId: null,
	};
}

export function createThreadContext(
	channelMemory: CommonspaceChannelMemory,
	capturedAt: string,
): CommonspaceThreadContext {
	return {
		channelSnapshot: {
			// Match saved Thread normalization so snapshots survive restart and archive validation.
			summary: channelMemory.summary.slice(0, 16_000).normalize("NFKC").trim(),
			decisions: [...channelMemory.decisions],
			openQuestions: [...channelMemory.openQuestions],
			updatedAt: channelMemory.updatedAt,
			origin: channelMemory.origin ?? "automatic",
			status:
				channelMemory.status ??
				(channelMemory.summary === "" ? "empty" : "current"),
			sourceMessageCount: channelMemory.sourceMessageCount ?? 0,
			estimatedTokens: channelMemory.estimatedTokens ?? 0,
			compactedThroughMessageId:
				channelMemory.compactedThroughMessageId ?? null,
			capturedAt,
		},
		memory: emptyThreadMemory(),
	};
}

export function projectThreadMemory(
	state: CommonspaceState,
	threadId: string,
): CommonspaceThreadMemory {
	const thread = state.threads.find((candidate) => candidate.id === threadId);
	if (thread === undefined) throw new Error("unknown thread");
	const messages = (
		state.messages[
			conversationKey({ kind: "channel", id: thread.channelId })
		] ?? []
	).filter(
		(message) =>
			message.threadId === thread.id &&
			message.deletedAt === undefined &&
			message.authorType !== "system",
	);
	return projectThreadMemoryFromMessages(messages);
}

export function projectThreadMemoryFromMessages(
	messages: readonly CommonspaceMessage[],
): CommonspaceThreadMemory {
	const characters = messages.reduce(
		(total, message) =>
			total + message.authorName.length + message.text.length + 2,
		0,
	);
	return {
		summary: "",
		decisions: [],
		openQuestions: [],
		updatedAt: messages.at(-1)?.createdAt ?? null,
		origin: "automatic",
		status: messages.length === 0 ? "empty" : "stale",
		sourceMessageCount: messages.length,
		estimatedTokens: Math.ceil(characters / 4),
		compactedThroughMessageId: messages.at(-1)?.id ?? null,
	};
}

export function mergeThreadMemoryProjection(
	current: CommonspaceThreadMemory,
	projection: CommonspaceThreadMemory,
): CommonspaceThreadMemory {
	if (current.origin === "automatic") return projection;
	return {
		...current,
		sourceMessageCount: projection.sourceMessageCount,
		estimatedTokens: projection.estimatedTokens,
		status:
			current.status === "failed"
				? "failed"
				: current.compactedThroughMessageId ===
						projection.compactedThroughMessageId
					? current.status
					: "stale",
	};
}

export function buildThreadContextCompactionPrompt(
	state: CommonspaceState,
	threadId: string,
): string {
	const thread = state.threads.find((candidate) => candidate.id === threadId);
	if (thread === undefined) throw new Error("unknown thread");
	const channel = state.channels.find(
		(candidate) => candidate.id === thread.channelId,
	);
	if (channel === undefined) throw new Error("unknown channel");
	const projectNames = new Map(
		state.projects.map((project) => [project.id, project.name]),
	);
	const source = (
		state.messages[
			conversationKey({ kind: "channel", id: thread.channelId })
		] ?? []
	).filter(
		(message) =>
			message.threadId === thread.id &&
			message.deletedAt === undefined &&
			message.authorType !== "system",
	);
	const bounded: CompactionSourceMessage[] = [];
	let characters = 0;
	for (const message of source.toReversed()) {
		const item: CompactionSourceMessage = {
			id: message.id,
			author: message.authorName,
			authorType: message.authorType,
			text: message.text.slice(0, 4_000),
			projects: referencedProjectIds(message)
				.map((projectId) => projectNames.get(projectId))
				.filter((projectName) => projectName !== undefined),
			createdAt: message.createdAt,
		};
		const serialized = JSON.stringify(item);
		if (
			bounded.length > 0 &&
			characters + serialized.length > MAX_COMPACTION_SOURCE_CHARS
		)
			break;
		bounded.push(item);
		characters += serialized.length;
	}
	bounded.reverse();
	return [
		"Compact the canonical shared context for one Commonspace Thread.",
		CONTEXT_BRIEF_POLICY,
		'Return JSON only with this exact shape: {"summary":"markdown summary","decisions":["decision"],"openQuestions":["question"]}.',
		`Channel: #${channel.name}`,
		`Current agents: ${JSON.stringify(compactionRoster(state, channel.id))}`,
		`Pinned context: ${JSON.stringify(compactionPins(state, channel.id, thread.id))}`,
		`Inherited Channel snapshot: ${JSON.stringify(thread.context.channelSnapshot)}`,
		`Previous Thread context: ${JSON.stringify(thread.context.memory.origin === "automatic" ? null : { origin: thread.context.memory.origin, summary: thread.context.memory.summary, decisions: thread.context.memory.decisions, openQuestions: thread.context.memory.openQuestions })}`,
		`Source messages: ${JSON.stringify(bounded)}`,
	].join("\n\n");
}

export function inferredThreadMemory(
	projection: CommonspaceThreadMemory,
	compacted: CompactedChannelContext,
	updatedAt: string,
): CommonspaceThreadMemory {
	return {
		...projection,
		...compacted,
		updatedAt,
		origin: "inference",
		status: projection.sourceMessageCount === 0 ? "empty" : "current",
	};
}
