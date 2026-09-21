import {
	type CommonspaceBootstrap,
	type ConversationRef,
	deriveCommonspaceInboxItems,
	deriveCommonspaceSessions,
} from "@commonspace/shared";
import {
	CheckCheckIcon,
	ChevronRightIcon,
	MessageSquareTextIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { CollectionToolbar } from "@/design-system/CollectionToolbar";
import { ResourceActionMenu } from "@/design-system/ResourceActionMenu";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";

interface ThreadRow {
	id: string;
	messageId: string;
	conversation: ConversationRef;
	channelName: string;
	title: string;
	detail: string;
	agentIds: string[];
	replyCount: number;
	updatedAt: string;
	unread: boolean;
	followed: boolean;
	unreadMessageIds: string[];
	sessionId?: string;
}

type ThreadAgent = CommonspaceBootstrap["agents"][number];

const enum ThreadFilter {
	All = "all",
	Following = "following",
	Unread = "unread",
}

export interface CommonspaceThreadsProps {
	bootstrap: CommonspaceBootstrap | null;
	store: CommonspaceStore;
	onOpenThread: (target: {
		messageId: string;
		conversation: ConversationRef;
		threadId: string;
	}) => void;
}

function threadRows(bootstrap: CommonspaceBootstrap | null): ThreadRow[] {
	if (bootstrap === null) return [];
	const { state } = bootstrap;
	const inboxItems = deriveCommonspaceInboxItems(state);
	const manuallyUnreadMessageIds = new Set(state.inboxUnreadMessageIds ?? []);
	const sessions = deriveCommonspaceSessions(
		state,
		bootstrap.liveActivities ?? [],
	);
	const channels = new Map(
		state.channels.map((channel) => [channel.id, channel.name]),
	);

	return state.threads
		.flatMap((thread) => {
			const conversation = { kind: "channel" as const, id: thread.channelId };
			const messages = state.messages[`channel:${thread.channelId}`] ?? [];
			const root = messages.find(
				(message) => message.id === thread.rootMessageId,
			);
			if (root === undefined) return [];
			const replies = messages.filter(
				(message) =>
					message.threadId === thread.id &&
					message.parentMessageId === thread.rootMessageId,
			);
			const latest = replies.at(-1) ?? root;
			const session = sessions.find(
				(candidate) => candidate.threadId === thread.id,
			);
			const unreadMessageIds = [
				...new Set(
					inboxItems
						.filter((item) => item.unread && item.threadId === thread.id)
						.map((item) => item.messageId),
				),
				...[root.id, ...replies.map((reply) => reply.id)].filter((id) =>
					manuallyUnreadMessageIds.has(id),
				),
			];
			const row: ThreadRow = {
				id: thread.id,
				messageId: root.id,
				conversation,
				channelName: channels.get(thread.channelId) ?? thread.channelId,
				title: root.text,
				detail: latest === root ? "No replies yet." : latest.text,
				agentIds: thread.agentIds,
				replyCount: replies.length,
				updatedAt: latest.createdAt,
				unread: unreadMessageIds.length > 0,
				followed: session?.followed ?? false,
				unreadMessageIds,
			};
			if (session !== undefined) row.sessionId = session.id;
			return [row];
		})
		.toSorted(
			(left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
		);
}

const threadTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

function formattedTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return "";
	return threadTimeFormatter.format(date);
}

function threadCounts(rows: readonly ThreadRow[]): {
	following: number;
	unread: number;
} {
	let following = 0;
	let unread = 0;
	for (const row of rows) {
		if (row.followed) following += 1;
		if (row.unread) unread += 1;
	}
	return { following, unread };
}

function filterThreadRows(
	rows: readonly ThreadRow[],
	filter: ThreadFilter,
): readonly ThreadRow[] {
	switch (filter) {
		case ThreadFilter.All:
			return rows;
		case ThreadFilter.Following:
			return rows.filter((row) => row.followed);
		case ThreadFilter.Unread:
			return rows.filter((row) => row.unread);
		default:
			return assertNever(filter);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unexpected thread filter: ${String(value)}`);
}

function indexAgents(
	agents: readonly ThreadAgent[],
): ReadonlyMap<string, ThreadAgent> {
	const agentsById = new Map<string, ThreadAgent>();
	for (const agent of agents) {
		if (!agentsById.has(agent.id)) agentsById.set(agent.id, agent);
	}
	return agentsById;
}

function ThreadFilterToolbar({
	filter,
	unreadCount,
	onFilterChange,
}: {
	filter: ThreadFilter;
	unreadCount: number;
	onFilterChange: (filter: ThreadFilter) => void;
}) {
	return (
		<CollectionToolbar className="justify-start">
			<fieldset
				aria-label="Thread filter"
				className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0"
			>
				<Button
					type="button"
					aria-pressed={filter === ThreadFilter.All}
					onClick={() => onFilterChange(ThreadFilter.All)}
					variant="tab"
					size="compact"
				>
					All
				</Button>
				<Button
					type="button"
					aria-pressed={filter === ThreadFilter.Unread}
					onClick={() => onFilterChange(ThreadFilter.Unread)}
					variant="tab"
					size="compact"
				>
					Unread {String(unreadCount)}
				</Button>
				<Button
					type="button"
					aria-pressed={filter === ThreadFilter.Following}
					onClick={() => onFilterChange(ThreadFilter.Following)}
					variant="tab"
					size="compact"
				>
					Following
				</Button>
			</fieldset>
		</CollectionToolbar>
	);
}

function ThreadList({
	agentsById,
	filter,
	onFilterChange,
	onOpenThread,
	rows,
	store,
}: {
	agentsById: ReadonlyMap<string, ThreadAgent>;
	filter: ThreadFilter;
	onFilterChange: (filter: ThreadFilter) => void;
	onOpenThread: CommonspaceThreadsProps["onOpenThread"];
	rows: readonly ThreadRow[];
	store: CommonspaceStore;
}) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
			{rows.length === 0 ? (
				<Empty className="min-h-72 border-0">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CheckCheckIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No threads match</EmptyTitle>
						<EmptyDescription>
							Change the filter or open a conversation from a channel.
						</EmptyDescription>
					</EmptyHeader>
					{filter !== ThreadFilter.All ? (
						<Button
							variant="outline"
							onClick={() => onFilterChange(ThreadFilter.All)}
						>
							Show all threads
						</Button>
					) : null}
				</Empty>
			) : (
				<ol className="mx-auto w-full max-w-[1280px] px-8 py-3 pb-10 max-[780px]:px-3">
					{rows.map((row) => (
						<ThreadListItem
							key={row.id}
							agent={agentsById.get(row.agentIds[0] ?? "")}
							row={row}
							store={store}
							onOpenThread={onOpenThread}
						/>
					))}
				</ol>
			)}
		</div>
	);
}

function ThreadListItem({
	agent,
	onOpenThread,
	row,
	store,
}: {
	agent: ThreadAgent | undefined;
	onOpenThread: CommonspaceThreadsProps["onOpenThread"];
	row: ThreadRow;
	store: CommonspaceStore;
}) {
	const openThread = () => {
		onOpenThread({
			messageId: row.messageId,
			conversation: row.conversation,
			threadId: row.id,
		});
	};
	return (
		<li className="group relative grid min-h-[72px] grid-cols-[minmax(0,1fr)_32px] items-center border-b border-border/50 bg-background transition-colors [contain-intrinsic-size:72px] [content-visibility:auto] hover:bg-hover">
			<button
				type="button"
				className="relative grid min-h-[72px] min-w-0 grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-3 rounded-sm border-0 bg-transparent px-2 py-2 text-left hover:bg-transparent focus-visible:outline-0 focus-visible:ring-2 focus-visible:ring-ring/50 max-[480px]:grid-cols-[32px_minmax(0,1fr)] max-[480px]:gap-2 max-[480px]:px-2"
				aria-label={`Open thread ${row.title}${row.unread ? ", unread" : ""}`}
				onClick={openThread}
			>
				{row.unread ? (
					<span
						className="absolute left-px size-1.5 rounded-full bg-foreground"
						aria-hidden="true"
					/>
				) : null}
				<AgentAvatar
					agent={agent}
					fallbackName={row.agentIds[0] ?? "#"}
					size="md"
					className="max-[480px]:size-8"
				/>
				<span className="min-w-0">
					<span className="flex min-w-0 items-center gap-[7px]">
						<strong className="truncate text-[15px] tracking-[-0.006em]">
							{row.title}
						</strong>
						<time
							className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
							dateTime={row.updatedAt}
						>
							{formattedTime(row.updatedAt)}
						</time>
					</span>
					<span className="mt-1.5 block truncate text-sm">{row.detail}</span>
					<span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
						<span
							className={
								row.unread
									? "font-medium text-primary"
									: "font-medium text-muted-foreground"
							}
						>
							{String(row.replyCount)}{" "}
							{row.replyCount === 1 ? "reply" : "replies"}
						</span>
						<span className="truncate text-muted-foreground">
							#{row.channelName}
							{row.followed ? " · Following" : ""}
						</span>
					</span>
				</span>
				<ChevronRightIcon
					className="size-[17px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[480px]:hidden"
					aria-hidden="true"
				/>
			</button>
			<ThreadActionMenu row={row} store={store} onOpen={openThread} />
		</li>
	);
}

function ThreadActionMenu({
	onOpen,
	row,
	store,
}: {
	onOpen: () => void;
	row: ThreadRow;
	store: CommonspaceStore;
}) {
	return (
		<ResourceActionMenu
			kind="thread"
			label={row.title}
			meta={`#${row.channelName}`}
			following={row.followed}
			unread={row.unread}
			onOpen={onOpen}
			{...(row.sessionId === undefined
				? {}
				: {
						onToggleFollow: () => {
							const sessionId = row.sessionId;
							if (sessionId === undefined) return;
							void store.mutate({
								action: "set-session-followed",
								sessionId,
								followed: !row.followed,
							});
						},
					})}
			onMarkRead={() => {
				for (const messageId of row.unreadMessageIds) {
					void store.mutate({
						action: "mark-inbox-item-read",
						messageId,
					});
				}
			}}
			onMarkUnread={() => {
				void store.mutate({
					action: "set-inbox-item-unread",
					messageId: row.messageId,
					unread: true,
				});
			}}
			onCopy={() => {
				void navigator.clipboard
					?.writeText(
						`commonspace://channel/${row.conversation.id}/thread/${row.id}`,
					)
					.catch(() => undefined);
			}}
		/>
	);
}

export function CommonspaceThreads({
	bootstrap,
	store,
	onOpenThread,
}: CommonspaceThreadsProps) {
	const [filter, setFilter] = useState(ThreadFilter.All);
	const rows = useMemo(() => threadRows(bootstrap), [bootstrap]);
	const counts = useMemo(() => threadCounts(rows), [rows]);
	const visibleRows = useMemo(
		() => filterThreadRows(rows, filter),
		[filter, rows],
	);
	const agents = bootstrap?.agents;
	const agentsById = useMemo(() => indexAgents(agents ?? []), [agents]);

	return (
		<main
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label="Threads"
		>
			<WorkspaceHeader
				title="Threads"
				subtitle={`${String(counts.unread)} unread · ${String(counts.following)} following`}
				mark={<MessageSquareTextIcon className="size-[17px]" />}
				actions={
					<Button
						type="button"
						variant="outline"
						disabled={counts.unread === 0}
						onClick={() => {
							void store
								.mutate({ action: "mark-inbox-read" })
								.catch(() => undefined);
						}}
					>
						<CheckCheckIcon className="size-4" aria-hidden="true" />
						Mark all read
					</Button>
				}
			/>
			<ThreadFilterToolbar
				filter={filter}
				unreadCount={counts.unread}
				onFilterChange={setFilter}
			/>
			<ThreadList
				agentsById={agentsById}
				filter={filter}
				onFilterChange={setFilter}
				onOpenThread={onOpenThread}
				rows={visibleRows}
				store={store}
			/>
		</main>
	);
}
