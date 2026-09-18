import type {
	CommonspaceChannelMemory,
	CommonspaceMessage,
	CommonspaceState,
} from "@commonspace/shared";
import { conversationKey } from "@commonspace/shared";

function estimatedTokens(messages: readonly CommonspaceMessage[]): number {
	const characters = messages.reduce(
		(total, message) =>
			total + message.authorName.length + message.text.length + 2,
		0,
	);
	return Math.ceil(characters / 4);
}

export function projectChannelMemory(
	state: CommonspaceState,
	channelId: string,
	maxThreads = 12,
): CommonspaceChannelMemory {
	const threads = state.threads
		.filter((thread) => thread.channelId === channelId)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
		.slice(-Math.max(1, maxThreads));
	const messages =
		state.messages[conversationKey({ kind: "channel", id: channelId })] ?? [];
	const includedThreads = new Set(threads.map((thread) => thread.id));
	const sourceMessages = messages.filter(
		(message) =>
			message.deletedAt === undefined &&
			message.authorType !== "system" &&
			message.threadId !== undefined &&
			includedThreads.has(message.threadId),
	);
	return {
		summary: "",
		decisions: [],
		openQuestions: [],
		threadIds: threads.map((thread) => thread.id),
		updatedAt: sourceMessages.at(-1)?.createdAt ?? null,
		origin: "automatic",
		status: sourceMessages.length === 0 ? "empty" : "stale",
		sourceMessageCount: sourceMessages.length,
		estimatedTokens: estimatedTokens(sourceMessages),
		compactedThroughMessageId: sourceMessages.at(-1)?.id ?? null,
	};
}

/** Preserve a user/inference compacted representation while exposing when new source context makes it stale. */
export function mergeChannelMemoryProjection(
	current: CommonspaceChannelMemory,
	projection: CommonspaceChannelMemory,
): CommonspaceChannelMemory {
	if (current.origin === undefined || current.origin === "automatic")
		return projection;
	const currentThrough = current.compactedThroughMessageId ?? null;
	const projectedThrough = projection.compactedThroughMessageId ?? null;
	return {
		...current,
		threadIds: projection.threadIds,
		sourceMessageCount: projection.sourceMessageCount ?? 0,
		estimatedTokens: projection.estimatedTokens ?? 0,
		status:
			current.status === "failed"
				? "failed"
				: currentThrough === projectedThrough
					? (current.status ?? "current")
					: "stale",
	};
}
