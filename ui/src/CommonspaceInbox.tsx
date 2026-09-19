import {
	type CommonspaceInboxItem,
	type CommonspaceSessionItem,
	type ConversationRef,
	deriveCommonspaceInboxItems,
	deriveCommonspaceSessions,
} from "@commonspace/shared";
import {
	BookmarkIcon,
	CheckCheckIcon,
	ChevronRightIcon,
	Clock3Icon,
	InboxIcon,
	MessageSquareTextIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { AgentAvatar } from "@/design-system/AgentAvatar";
import { CollectionToolbar } from "@/design-system/CollectionToolbar";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { cn } from "@/lib/utils";
import type { CommonspaceStore } from "./commonspace-store.ts";

export interface CommonspaceInboxTarget {
	messageId: string;
	conversation: ConversationRef;
	threadId?: string;
}

export interface CommonspaceInboxProps {
	store: CommonspaceStore;
	onOpenItem: (item: CommonspaceInboxTarget) => void;
	viewRequest?: { view: "attention" | "sessions"; token: number } | null;
}

function kindLabel(item: CommonspaceInboxItem): string {
	switch (item.kind) {
		case "agent-reply":
			return "Agent reply";
		case "thread-reply":
			return "Thread reply";
		case "mention":
			return "Mention";
		case "failure":
			return "Failed";
		case "completion":
			return "Completed";
		case "timeout":
			return "Timed out";
		case "input-request":
			return "Needs input";
		case "possible-input-request":
			return "May need input";
		case "permission-request":
			return "Permission";
	}
}

function formattedTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return "";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function sessionStatusLabel(session: CommonspaceSessionItem): string {
	if (session.status === "running") return "Running";
	if (session.status === "completed") return "Completed";
	if (session.attentionKind === "input-request") return "Needs input";
	if (session.attentionKind === "possible-input-request")
		return "May need input";
	if (session.attentionKind === "permission-request") return "Permission";
	if (session.attentionKind === "timeout") return "Timed out";
	return "Failed";
}

function statusClass(label: string): string {
	if (label === "Running") return "text-[var(--status-success)]";
	if (label === "Mention") return "text-primary";
	if (
		label === "Needs input" ||
		label === "May need input" ||
		label === "Permission" ||
		label === "Timed out"
	)
		return "text-[color-mix(in_oklch,var(--status-warning)_72%,var(--foreground))]";
	if (label === "Failed") return "text-destructive";
	return "text-muted-foreground";
}

function isAttentionItem(item: CommonspaceInboxItem): boolean {
	return (
		item.kind !== "agent-reply" &&
		item.kind !== "thread-reply" &&
		item.kind !== "completion"
	);
}

export function CommonspaceInbox({
	store,
	onOpenItem,
	viewRequest = null,
}: CommonspaceInboxProps) {
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const [view, setView] = useState<"attention" | "activity" | "sessions">(
		"attention",
	);
	const [filter, setFilter] = useState<"all" | "unread" | "saved">("all");
	const [sessionFilter, setSessionFilter] = useState<
		"all" | CommonspaceSessionItem["status"]
	>("all");
	const [markingRead, setMarkingRead] = useState(false);
	useEffect(() => {
		if (viewRequest !== null) setView(viewRequest.view);
	}, [viewRequest]);
	const state = snapshot.bootstrap?.state;
	const agentsById = useMemo(
		() => new Map(snapshot.bootstrap?.agents.map((agent) => [agent.id, agent])),
		[snapshot.bootstrap?.agents],
	);
	const items = useMemo(
		() => (state === undefined ? [] : deriveCommonspaceInboxItems(state)),
		[state],
	);
	const attentionItems = useMemo(() => items.filter(isAttentionItem), [items]);
	const activityItems = useMemo(
		() => items.filter((item) => !isAttentionItem(item)),
		[items],
	);
	const sessions = useMemo(
		() =>
			state === undefined
				? []
				: deriveCommonspaceSessions(
						state,
						snapshot.bootstrap?.liveActivities ?? [],
					),
		[snapshot.bootstrap?.liveActivities, state],
	);
	const unreadCount = items.filter((item) => item.unread).length;
	const runningCount = sessions.filter(
		(session) => session.status === "running",
	).length;
	const currentItems = view === "attention" ? attentionItems : activityItems;
	const currentUnreadCount = currentItems.filter((item) => item.unread).length;
	const visibleItems =
		filter === "unread"
			? currentItems.filter((item) => item.unread)
			: filter === "saved"
				? currentItems.filter((item) => item.saved)
				: currentItems;
	const visibleSessions =
		sessionFilter === "all"
			? sessions
			: sessions.filter((session) => session.status === sessionFilter);

	const markAllRead = async () => {
		if (unreadCount === 0 || markingRead) return;
		setMarkingRead(true);
		try {
			await store.mutate({ action: "mark-inbox-read" });
		} finally {
			setMarkingRead(false);
		}
	};

	const openItem = (item: CommonspaceInboxItem) => {
		if (item.unread)
			void store
				.mutate({ action: "mark-inbox-item-read", messageId: item.messageId })
				.catch(() => undefined);
		onOpenItem(item);
	};

	const openSession = (session: CommonspaceSessionItem) => {
		const target: CommonspaceInboxTarget = {
			messageId: session.messageId,
			conversation: session.conversation,
		};
		if (session.threadId !== undefined) target.threadId = session.threadId;
		onOpenItem(target);
	};

	return (
		<main
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label="Inbox"
		>
			<WorkspaceHeader
				title="Inbox"
				subtitle={`${String(unreadCount)} unread · ${String(attentionItems.length)} need attention · ${String(runningCount)} running`}
				mark={<InboxIcon className="size-[17px]" />}
				actions={
					view !== "sessions" ? (
						<Button
							type="button"
							variant="outline"
							disabled={unreadCount === 0 || markingRead}
							onClick={() => {
								void markAllRead().catch(() => undefined);
							}}
						>
							<CheckCheckIcon className="size-4" aria-hidden="true" />
							<span className="max-[480px]:sr-only">
								{markingRead ? "Marking read…" : "Mark all read"}
							</span>
						</Button>
					) : undefined
				}
			/>

			<CollectionToolbar>
				<fieldset
					aria-label="Inbox view"
					className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0"
				>
					<Button
						type="button"
						aria-pressed={view === "attention"}
						onClick={() => {
							setView("attention");
						}}
						variant="tab"
						size="compact"
					>
						<InboxIcon className="size-4" aria-hidden="true" />
						Attention{" "}
						<span className="text-muted-foreground tabular-nums">
							{String(attentionItems.length)}
						</span>
					</Button>
					<Button
						type="button"
						aria-pressed={view === "activity"}
						onClick={() => {
							setView("activity");
						}}
						variant="tab"
						size="compact"
					>
						<MessageSquareTextIcon className="size-4" aria-hidden="true" />
						Activity{" "}
						<span className="text-muted-foreground tabular-nums">
							{String(activityItems.length)}
						</span>
					</Button>
					<Button
						type="button"
						aria-pressed={view === "sessions"}
						onClick={() => {
							setView("sessions");
						}}
						variant="tab"
						size="compact"
					>
						<Clock3Icon className="size-4" aria-hidden="true" />
						Sessions{" "}
						<span className="text-muted-foreground tabular-nums">
							{String(sessions.length)}
						</span>
					</Button>
				</fieldset>
				{view !== "sessions" ? (
					<fieldset
						aria-label="Inbox filter"
						className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0"
					>
						{(["all", "unread", "saved"] as const).map((value) => (
							<Button
								key={value}
								type="button"
								aria-pressed={filter === value}
								onClick={() => {
									setFilter(value);
								}}
								variant="filter"
								size="compact"
							>
								{value === "all" ? (
									"All"
								) : value === "unread" ? (
									`Unread${currentUnreadCount === 0 ? "" : ` ${String(currentUnreadCount)}`}`
								) : (
									<>
										<BookmarkIcon className="size-3.5" aria-hidden="true" />
										Saved
									</>
								)}
							</Button>
						))}
					</fieldset>
				) : (
					<fieldset
						aria-label="Session status filter"
						className="m-0 flex min-w-0 items-center gap-0.5 border-0 p-0"
					>
						{(["all", "running", "needs-attention", "completed"] as const).map(
							(value) => (
								<Button
									key={value}
									type="button"
									aria-pressed={sessionFilter === value}
									onClick={() => {
										setSessionFilter(value);
									}}
									variant="filter"
									size="compact"
								>
									{value === "all"
										? "All"
										: value === "needs-attention"
											? "Needs attention"
											: `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`}
								</Button>
							),
						)}
					</fieldset>
				)}
			</CollectionToolbar>

			<div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
				{view !== "sessions" ? (
					visibleItems.length === 0 ? (
						<Empty className="min-h-72 border-0">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<CheckCheckIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>
									{filter !== "all"
										? "No matching updates"
										: view === "activity"
											? "No replies yet"
											: "You’re all caught up"}
								</EmptyTitle>
								<EmptyDescription>
									{filter !== "all"
										? "Try another filter to see more of your activity."
										: view === "activity"
											? "Agent replies will appear here."
											: "New requests and failures will appear here."}
								</EmptyDescription>
							</EmptyHeader>
							{filter !== "all" ? (
								<Button variant="outline" onClick={() => setFilter("all")}>
									Clear filter
								</Button>
							) : view === "attention" && activityItems.length > 0 ? (
								<Button variant="outline" onClick={() => setView("activity")}>
									View activity
								</Button>
							) : null}
						</Empty>
					) : (
						<ol className="mx-auto w-full max-w-[1280px] px-8 py-3 pb-10 max-[780px]:px-3">
							{visibleItems.map((item) => {
								const label = kindLabel(item);
								return (
									<li
										key={item.id}
										className="group relative grid min-h-[88px] grid-cols-[minmax(0,1fr)_44px] items-center border-b border-border/50 bg-background transition-colors [contain-intrinsic-size:88px] [content-visibility:auto] hover:bg-hover"
									>
										<button
											className="relative grid min-h-[88px] min-w-0 grid-cols-[40px_minmax(0,1fr)_18px] items-center gap-[13px] rounded-sm border-0 bg-transparent px-2.5 py-3 text-left hover:bg-transparent focus-visible:outline-0 focus-visible:ring-2 focus-visible:ring-ring/50 max-[480px]:grid-cols-[36px_minmax(0,1fr)] max-[480px]:gap-2.5 max-[480px]:px-2"
											type="button"
											aria-label={`Open ${label.toLowerCase()} from ${item.actorName} in ${item.conversationName}${item.unread ? ", unread" : ""}`}
											onClick={() => {
												openItem(item);
											}}
										>
											{item.unread && (
												<span
													className="absolute left-px size-1.5 rounded-full bg-foreground"
													aria-hidden="true"
												/>
											)}
											<AgentAvatar
												agent={agentsById.get(item.actorId)}
												fallbackName={item.actorName}
												size="lg"
											/>
											<span className="min-w-0">
												<span className="flex min-w-0 items-center gap-[7px]">
													<strong className="shrink-0 text-[15px] tracking-[-0.006em]">
														{item.actorName}
													</strong>

													<time
														className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
														dateTime={item.createdAt}
													>
														{formattedTime(item.createdAt)}
													</time>
												</span>
												<span className="mt-1.5 block truncate text-sm">
													{item.text}
												</span>
												<span className="mt-1 flex min-w-0 items-center gap-2 text-xs">
													<span
														className={cn(
															"inline-flex min-h-5 items-center gap-1.5 text-xs tabular-nums font-semibold",
															statusClass(label),
														)}
													>
														{label}
													</span>
													<span className="truncate text-muted-foreground">
														{item.conversationName}
													</span>
												</span>
											</span>
											<ChevronRightIcon
												className="size-[17px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[480px]:hidden"
												aria-hidden="true"
											/>
										</button>
										<Button
											type="button"
											variant="ghost"
											size="icon-lg"
											className="opacity-0 group-hover:opacity-100 focus:opacity-100 max-[480px]:opacity-100"
											aria-label={
												item.saved ? "Remove from saved" : "Save for later"
											}
											aria-pressed={item.saved}
											onClick={() => {
												void store
													.mutate({
														action: "set-inbox-item-saved",
														messageId: item.messageId,
														saved: !item.saved,
													})
													.catch(() => undefined);
											}}
										>
											<BookmarkIcon
												className="size-[17px]"
												fill={item.saved ? "currentColor" : "none"}
												aria-hidden="true"
											/>
										</Button>
									</li>
								);
							})}
						</ol>
					)
				) : visibleSessions.length === 0 ? (
					<Empty className="min-h-72 border-0">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Clock3Icon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No matching sessions.</EmptyTitle>
							<EmptyDescription>
								Change the status filter to see other work.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ol className="mx-auto w-full max-w-[1280px] px-8 py-3 pb-10">
						{visibleSessions.map((session) => {
							const label = sessionStatusLabel(session);
							return (
								<li
									key={session.id}
									className="group relative grid min-h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border/50 bg-background transition-colors [contain-intrinsic-size:88px] [content-visibility:auto] hover:bg-hover"
								>
									<button
										className="grid min-h-[88px] min-w-0 grid-cols-[40px_minmax(0,1fr)_18px] items-center gap-[13px] rounded-sm border-0 bg-transparent px-2.5 py-3 text-left hover:bg-transparent focus-visible:outline-0 focus-visible:ring-2 focus-visible:ring-ring/50 max-[480px]:grid-cols-[36px_minmax(0,1fr)] max-[480px]:gap-2.5 max-[480px]:px-2"
										type="button"
										aria-label={`Open ${label.toLowerCase()} session for ${session.agentName} in ${session.conversationName}`}
										onClick={() => {
											openSession(session);
										}}
									>
										<AgentAvatar
											agent={agentsById.get(session.agentId)}
											fallbackName={session.agentName}
											size="lg"
										/>
										<span className="min-w-0">
											<span className="flex min-w-0 items-center gap-[7px]">
												<strong className="shrink-0 text-sm">
													{session.agentName}
												</strong>
												<span className="truncate text-xs text-muted-foreground">
													{session.projectName === null
														? session.conversationName
														: `${session.projectName} · ${session.conversationName}`}
												</span>
												<time
													className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
													dateTime={session.updatedAt}
												>
													{formattedTime(session.updatedAt)}
												</time>
											</span>
											<span className="mt-1.5 block truncate text-sm">
												{session.summary}
											</span>
											<span
												className={cn(
													"mt-1 block text-xs tabular-nums font-semibold",
													statusClass(label),
												)}
											>
												{label}
											</span>
										</span>
										<ChevronRightIcon
											className="size-[17px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-[480px]:hidden"
											aria-hidden="true"
										/>
									</button>
									<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-[780px]:opacity-100">
										<Button
											type="button"
											variant="filter"
											size="compact"
											aria-pressed={session.followed}
											onClick={() => {
												void store
													.mutate({
														action: "set-session-followed",
														sessionId: session.id,
														followed: !session.followed,
													})
													.catch(() => undefined);
											}}
										>
											{session.followed ? "Following" : "Follow"}
										</Button>
										<Button
											type="button"
											variant="filter"
											size="compact"
											aria-pressed={session.muted}
											onClick={() => {
												void store
													.mutate({
														action: "set-session-muted",
														sessionId: session.id,
														muted: !session.muted,
													})
													.catch(() => undefined);
											}}
										>
											{session.muted ? "Muted" : "Mute"}
										</Button>
									</div>
								</li>
							);
						})}
					</ol>
				)}
			</div>
		</main>
	);
}
