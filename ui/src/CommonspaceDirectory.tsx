import {
	AGENT_ADAPTERS,
	type CommonspaceAgentProfile,
	type CommonspaceBootstrap,
	type ConversationRef,
	deriveCommonspaceInboxItems,
} from "@commonspace/shared";
import {
	FolderIcon,
	HashIcon,
	PinIcon,
	SearchIcon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
	CollectionActionMenu,
	type CollectionActionMenuProps,
	type CommonspaceCollectionKind,
} from "@/design-system/CollectionActionMenu";
import { CollectionToolbar } from "@/design-system/CollectionToolbar";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";
import {
	collectionKey,
	sidebarPreferencesStore,
	useSidebarPreferences,
} from "./sidebar-preferences.ts";

export type CommonspaceDirectoryKind = "projects" | "channels" | "agents";

export interface CommonspaceDirectoryProps {
	kind: CommonspaceDirectoryKind;
	bootstrap: CommonspaceBootstrap | null;
	store: CommonspaceStore;
	onAdd: (kind: CommonspaceDirectoryKind) => void;
	onOpenProject: (projectId: string) => void;
	onOpenConversation: (conversation: ConversationRef) => void;
	onOpenSettings: (kind: CommonspaceCollectionKind, id: string) => void;
	onOpenSessions?: () => void;
}

interface DirectoryItem {
	readonly id: string;
	readonly kind: CommonspaceCollectionKind;
	readonly name: string;
	readonly description: string;
	readonly meta: string;
	readonly mark: string;
	readonly unread: number;
	readonly agent?: CommonspaceAgentProfile;
}

type DirectoryItemActions = Pick<
	CollectionActionMenuProps,
	| "copyLabel"
	| "onCopy"
	| "onMarkRead"
	| "onMarkUnread"
	| "onStartFreshChat"
	| "onViewSessions"
>;

const directoryConfig = {
	projects: {
		title: "Projects",
		mark: "P",
		kicker: "Projects directory",
		heading: "All projects",
		description: "Files and context for your conversations.",
		singular: "project",
		add: "Add project",
		filter: "Filter projects",
	},
	channels: {
		title: "Channels",
		mark: "#",
		kicker: "Channels directory",
		heading: "All channels",
		description: "Shared conversations with your agents.",
		singular: "channel",
		add: "Add channel",
		filter: "Filter channels",
	},
	agents: {
		title: "Agents",
		mark: "@",
		kicker: "Agents directory",
		heading: "All agents",
		description: "Your agents, ready for direct messages and channels.",
		singular: "agent",
		add: "Add agent",
		filter: "Filter agents",
	},
} as const;

const PAGE_SIZE = 24;

function directoryItems(
	kind: CommonspaceDirectoryKind,
	bootstrap: CommonspaceBootstrap | null,
): DirectoryItem[] {
	if (bootstrap === null) return [];
	if (kind === "projects")
		return bootstrap.state.projects.map((project) => ({
			id: project.id,
			kind: "project",
			name: project.name,
			description: project.paths[0] ?? "No local folder connected",
			meta: `${String(project.paths.length)} ${project.paths.length === 1 ? "folder" : "folders"}`,
			mark: project.name.slice(0, 1).toLocaleUpperCase(),
			unread: 0,
		}));
	if (kind === "channels") {
		const unreadCounts = new Map<string, number>();
		for (const item of deriveCommonspaceInboxItems(bootstrap.state)) {
			if (item.unread && item.conversation.kind === "channel")
				unreadCounts.set(
					item.conversation.id,
					(unreadCounts.get(item.conversation.id) ?? 0) + 1,
				);
		}
		return bootstrap.state.channels.map((channel) => {
			const unread = unreadCounts.get(channel.id) ?? 0;
			return {
				id: channel.id,
				kind: "channel",
				name: channel.name,
				description: `${String(channel.agentIds.length)} ${channel.agentIds.length === 1 ? "agent" : "agents"} available`,
				meta: unread === 0 ? "Channel" : `${String(unread)} unread`,
				mark: "#",
				unread,
			};
		});
	}
	return bootstrap.agents.map((agent) => ({
		id: agent.id,
		kind: "agent",
		name: agent.displayName,
		description: `${AGENT_ADAPTERS[agent.adapter].label} · ${agent.model ?? "profile default"}`,
		meta:
			agent.status === "running"
				? "Working"
				: agent.status === "unknown"
					? "Configured"
					: "Available",
		mark:
			agent.avatarEmoji ?? agent.displayName.slice(0, 1).toLocaleUpperCase(),
		unread: 0,
		agent,
	}));
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The cohesive directory controller avoids prop-heavy wrappers around tightly coupled collection actions.
export function CommonspaceDirectory({
	kind,
	bootstrap,
	store,
	onAdd,
	onOpenProject,
	onOpenConversation,
	onOpenSettings,
	onOpenSessions,
}: CommonspaceDirectoryProps) {
	const config = directoryConfig[kind];
	const allItems = useMemo(
		() => directoryItems(kind, bootstrap),
		[bootstrap, kind],
	);
	const preferences = useSidebarPreferences();
	const defaultPinnedKeys = useMemo(
		() =>
			allItems[0] === undefined
				? []
				: [collectionKey(allItems[0].kind, allItems[0].id)],
		[allItems],
	);
	const effectivePinnedKeys = preferences.hasStoredPins
		? preferences.pinnedKeys
		: defaultPinnedKeys;
	const effectivePinnedKeySet = useMemo(
		() => new Set(effectivePinnedKeys),
		[effectivePinnedKeys],
	);
	const [query, setQuery] = useState("");
	const [direction, setDirection] = useState<"name-asc" | "name-desc">(
		"name-asc",
	);
	const [page, setPage] = useState(1);

	useEffect(() => {
		sidebarPreferencesStore.ensurePinnedDefaults(defaultPinnedKeys);
	}, [defaultPinnedKeys]);

	const filteredItems = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		const items =
			normalized === ""
				? allItems
				: allItems.filter((item) =>
						`${item.name} ${item.description} ${item.meta}`
							.toLocaleLowerCase()
							.includes(normalized),
					);
		return [...items].sort(
			(left, right) =>
				left.name.localeCompare(right.name) *
				(direction === "name-asc" ? 1 : -1),
		);
	}, [allItems, direction, query]);
	const visibleItems = useMemo(
		() => filteredItems.slice(0, page * PAGE_SIZE),
		[filteredItems, page],
	);
	const pinnedCount = useMemo(() => {
		let count = 0;
		for (const item of allItems) {
			if (effectivePinnedKeySet.has(collectionKey(item.kind, item.id)))
				count += 1;
		}
		return count;
	}, [allItems, effectivePinnedKeySet]);

	const openItem = (item: DirectoryItem) => {
		sidebarPreferencesStore.touchRecent(item.kind, item.id, defaultPinnedKeys);
		if (item.kind === "project") {
			store.selectProject(item.id);
			onOpenProject(item.id);
			return;
		}
		const conversation = {
			kind: item.kind === "channel" ? "channel" : "dm",
			id: item.id,
		} as const;
		store.selectConversation(conversation);
		onOpenConversation(conversation);
	};

	const addProjectFolder = async (projectId: string) => {
		try {
			const path = await store.selectDirectory();
			if (path !== null)
				await store.mutate({ action: "add-project-path", projectId, path });
		} catch {
			// The application-level toast renders the store error once.
		}
	};

	const removeItem = async (item: DirectoryItem) => {
		if (item.kind === "project")
			await store.mutate({ action: "remove-project", projectId: item.id });
		else if (item.kind === "channel")
			await store.mutate({ action: "remove-channel", channelId: item.id });
		else await store.mutate({ action: "remove-agent", agentId: item.id });
	};

	const markChannelRead = (channelId: string) => {
		if (bootstrap === null) return;
		for (const inboxItem of deriveCommonspaceInboxItems(bootstrap.state)) {
			if (
				inboxItem.unread &&
				inboxItem.conversation.kind === "channel" &&
				inboxItem.conversation.id === channelId
			) {
				void store.mutate({
					action: "mark-inbox-item-read",
					messageId: inboxItem.messageId,
				});
			}
		}
	};

	const markChannelUnread = (channelId: string) => {
		if (bootstrap === null) return;
		const latestMessage =
			bootstrap.state.messages[`channel:${channelId}`]?.at(-1);
		if (latestMessage === undefined) return;
		void store.mutate({
			action: "set-inbox-item-unread",
			messageId: latestMessage.id,
			unread: true,
		});
	};

	const copyCollectionName = (item: DirectoryItem) => {
		const value = item.kind === "agent" ? `@${item.name}` : item.name;
		void navigator.clipboard?.writeText(value).catch(() => undefined);
	};

	return (
		<main
			className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
			aria-label={`${config.title} directory`}
		>
			<WorkspaceHeader
				title={config.title}
				mark={
					kind === "projects" ? (
						<FolderIcon className="size-4" />
					) : kind === "channels" ? (
						<HashIcon className="size-4" />
					) : (
						<UsersIcon className="size-4" />
					)
				}
				actions={<Button onClick={() => onAdd(kind)}>{config.add}</Button>}
			/>
			<CollectionToolbar className="shrink-0 gap-4">
				<label className="flex min-h-9 w-full max-w-[360px] min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground focus-within:border-ring">
					<SearchIcon className="size-4" aria-hidden="true" />
					<span className="sr-only">{config.filter}</span>
					<input
						className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
						type="search"
						aria-label={config.filter}
						placeholder={config.filter}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(1);
						}}
					/>
				</label>

				<div className="mr-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<strong className="font-normal">
						{String(filteredItems.length)}{" "}
						{filteredItems.length === 1 ? config.singular : kind}
					</strong>
					<span>
						{query.trim() === ""
							? `${String(pinnedCount)} pinned`
							: `Filtered from ${String(allItems.length)} ${kind}`}
					</span>
				</div>
				<label htmlFor="directory-sort">
					<span className="sr-only">Sort directory</span>
					<NativeSelect
						className="max-[480px]:w-full"
						id="directory-sort"
						aria-label="Sort directory"
						value={direction}
						onChange={(event) => {
							if (
								event.target.value === "name-asc" ||
								event.target.value === "name-desc"
							)
								setDirection(event.target.value);
							setPage(1);
						}}
					>
						<option value="name-asc">Name A–Z</option>
						<option value="name-desc">Name Z–A</option>
					</NativeSelect>
				</label>
			</CollectionToolbar>
			<div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 max-[780px]:px-5 max-[480px]:px-3 max-[480px]:pb-6">
				<ul className="m-0 list-none border-b p-0">
					{visibleItems.map(
						// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: A row's actions vary together by the closed collection-kind union.
						(item) => {
							const pinned = effectivePinnedKeySet.has(
								collectionKey(item.kind, item.id),
							);
							const actions: DirectoryItemActions = {};
							if (item.kind === "channel") {
								if (item.unread > 0)
									actions.onMarkRead = () => markChannelRead(item.id);
								actions.onMarkUnread = () => markChannelUnread(item.id);
							}
							if (item.kind === "agent") {
								actions.onStartFreshChat = () => {
									void store
										.mutate({ action: "reset-dm", agentId: item.id })
										.then(() => {
											openItem(item);
										});
								};
								if (onOpenSessions !== undefined)
									actions.onViewSessions = onOpenSessions;
							}
							if (item.kind === "project" || item.kind === "agent") {
								actions.onCopy = () => copyCollectionName(item);
								actions.copyLabel =
									item.kind === "agent" ? "Copy mention" : "Copy project name";
							}
							return (
								<li
									key={item.id}
									className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_44px] items-stretch border-b border-border/50 bg-background last:border-b-0 hover:bg-hover"
								>
									<button
										type="button"
										className="grid w-full min-w-0 grid-cols-[38px_minmax(0,1fr)_minmax(150px,auto)_24px] items-center gap-3 border-0 bg-transparent px-2 py-2.5 text-left max-[480px]:grid-cols-[38px_minmax(0,1fr)_20px] max-[480px]:gap-2"
										aria-label={`Open ${item.kind} ${item.name}`}
										onClick={() => {
											openItem(item);
										}}
									>
										{item.kind === "agent" ? (
											<AgentAvatar agent={item.agent} size="md" />
										) : (
											<span
												className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground"
												aria-hidden="true"
											>
												{item.kind === "project" ? (
													<FolderIcon className="size-[18px]" />
												) : (
													<HashIcon className="size-[18px]" />
												)}
											</span>
										)}
										<span className="min-w-0">
											<strong className="block truncate text-[15px] font-medium">
												{item.name}
											</strong>
											<small className="mt-1 block truncate text-xs text-muted-foreground">
												{item.description}
											</small>
										</span>
										<span className="text-right text-xs text-muted-foreground max-[480px]:col-start-2 max-[480px]:text-left">
											{item.kind === "channel" && item.unread === 0
												? null
												: item.meta}
										</span>
										{pinned ? (
											<PinIcon
												className="size-4 fill-current text-primary"
												aria-label="Pinned"
											/>
										) : null}
									</button>
									<CollectionActionMenu
										kind={item.kind}
										label={item.name}
										meta={item.meta}
										pinned={pinned}
										unread={item.unread > 0}
										onOpen={() => {
											openItem(item);
										}}
										{...actions}
										onSettings={() => {
											onOpenSettings(item.kind, item.id);
										}}
										{...(item.kind === "project"
											? {
													onAddFolder: () => {
														void addProjectFolder(item.id);
													},
												}
											: {})}
										onTogglePinned={() => {
											sidebarPreferencesStore.togglePin(
												item.kind,
												item.id,
												defaultPinnedKeys,
											);
										}}
										onRemove={() => removeItem(item)}
									/>
								</li>
							);
						},
					)}
				</ul>
				{filteredItems.length === 0 && (
					<div className="px-4 py-16 text-center">
						<h2 className="font-heading text-lg font-bold">
							{allItems.length === 0 ? `No ${kind} yet` : `No matching ${kind}`}
						</h2>
						<p className="mt-1 text-[13px] text-muted-foreground">
							{allItems.length === 0
								? `Add your first ${config.singular} to get started.`
								: "Try a different name or clear the filter."}
						</p>
						<Button
							className="mt-5"
							variant="outline"
							onClick={() => {
								if (allItems.length === 0) onAdd(kind);
								else {
									setQuery("");
									setPage(1);
								}
							}}
						>
							{allItems.length === 0 ? config.add : "Clear filter"}
						</Button>
					</div>
				)}
				{visibleItems.length < filteredItems.length && (
					<div className="flex justify-center pt-5">
						<Button
							variant="outline"
							onClick={() => {
								setPage((current) => current + 1);
							}}
						>
							Show{" "}
							{String(
								Math.min(PAGE_SIZE, filteredItems.length - visibleItems.length),
							)}{" "}
							more
						</Button>
					</div>
				)}
			</div>
		</main>
	);
}
