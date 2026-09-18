import {
	AGENT_ADAPTERS,
	type CommonspaceAgentProfile,
	type CommonspaceBootstrap,
	type ConversationRef,
	deriveCommonspaceInboxItems,
} from "@commonspace/shared";
import { ArrowRightIcon, PinIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
	CollectionActionMenu,
	type CollectionActionMenuProps,
	type CommonspaceCollectionKind,
} from "@/design-system/CollectionActionMenu";
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
	id: string;
	kind: CommonspaceCollectionKind;
	name: string;
	description: string;
	meta: string;
	mark: string;
	unread: number;
	agent?: CommonspaceAgentProfile;
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
		description: "Local folders available as conversation context.",
		singular: "project",
		add: "Add project",
		filter: "Filter projects",
	},
	channels: {
		title: "Channels",
		mark: "#",
		kicker: "Channels directory",
		heading: "All channels",
		description:
			"Global shared rooms containing many independent conversations.",
		singular: "channel",
		add: "Add channel",
		filter: "Filter channels",
	},
	agents: {
		title: "Agents",
		mark: "@",
		kicker: "Agents directory",
		heading: "All agents",
		description:
			"Native harness profiles available for agent conversations and channel work.",
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
		return bootstrap.state.channels.map((channel) => ({
			id: channel.id,
			kind: "channel",
			name: channel.name,
			description: `${String(channel.agentIds.length)} ${channel.agentIds.length === 1 ? "agent" : "agents"} available`,
			meta:
				(unreadCounts.get(channel.id) ?? 0) === 0
					? "Channel"
					: `${String(unreadCounts.get(channel.id))} unread`,
			mark: "#",
			unread: unreadCounts.get(channel.id) ?? 0,
		}));
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
	const visibleItems = filteredItems.slice(0, page * PAGE_SIZE);
	const pinnedCount = allItems.filter((item) =>
		effectivePinnedKeys.includes(collectionKey(item.kind, item.id)),
	).length;

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
			<WorkspaceHeader title={config.title} mark={config.mark} />
			<header className="flex min-h-[132px] shrink-0 items-center justify-between gap-6 border-b px-8 py-6 max-[780px]:min-h-[112px] max-[780px]:px-5 max-[780px]:py-5 max-[480px]:items-start max-[480px]:flex-col max-[480px]:gap-3">
				<div className="min-w-0">
					<p className="mb-1 font-mono text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
						{config.kicker}
					</p>
					<h2 className="font-heading text-[28px] font-bold tracking-[-0.02em]">
						{config.heading}
					</h2>
					<p className="mt-1 text-[13px] text-muted-foreground">
						{config.description}
					</p>
				</div>
				<Button
					className="shrink-0 max-[480px]:w-full"
					onClick={() => {
						onAdd(kind);
					}}
				>
					{config.add}
				</Button>
			</header>
			<div className="grid shrink-0 grid-cols-[minmax(220px,1fr)_auto] items-center gap-3 border-b bg-muted px-8 py-3 max-[780px]:px-5 max-[480px]:grid-cols-[minmax(0,1fr)] max-[480px]:px-3">
				<label className="flex min-h-9 min-w-0 items-center gap-2 rounded-sm border bg-background px-3 text-muted-foreground focus-within:border-ring">
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
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 max-[780px]:px-5 max-[480px]:px-3 max-[480px]:pb-6">
				<div className="sticky top-0 z-10 flex min-h-[54px] items-center justify-between gap-4 border-b bg-background text-xs text-muted-foreground max-[480px]:items-start max-[480px]:flex-col max-[480px]:justify-center max-[480px]:gap-0.5">
					<strong className="text-foreground">
						{String(filteredItems.length)}{" "}
						{filteredItems.length === 1 ? config.singular : kind}
					</strong>
					<span>
						{query.trim() === ""
							? `${String(pinnedCount)} of ${String(allItems.length)} ${kind} pinned`
							: `Filtered from ${String(allItems.length)} ${kind}`}
					</span>
				</div>
				<ul className="m-0 list-none border-b p-0">
					{visibleItems.map((item) => {
						const pinned = effectivePinnedKeys.includes(
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
								className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_44px] items-stretch border-b border-border/70 bg-background last:border-b-0 hover:bg-surface"
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
										<AgentAvatar
											agent={item.agent}
											size="md"
											className="rounded-full text-[13px]"
										/>
									) : (
										<span
											className="grid size-9 place-items-center rounded-sm border bg-muted font-mono text-[13px] font-semibold"
											aria-hidden="true"
										>
											{item.mark}
										</span>
									)}
									<span className="min-w-0">
										<strong className="block truncate text-[13px]">
											{item.name}
										</strong>
										<small className="mt-1 block truncate text-xs text-muted-foreground">
											{item.description}
										</small>
									</span>
									<span className="text-right font-mono text-xs text-muted-foreground max-[480px]:col-start-2 max-[480px]:text-left">
										{item.meta}
									</span>
									{pinned ? (
										<PinIcon
											className="size-4 fill-current text-primary"
											aria-label="Pinned"
										/>
									) : (
										<ArrowRightIcon
											className="size-4 text-muted-foreground"
											aria-hidden="true"
										/>
									)}
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
					})}
				</ul>
				{filteredItems.length === 0 && (
					<div className="px-4 py-16 text-center">
						<h3 className="font-heading text-lg font-bold">
							No matching {kind}
						</h3>
						<p className="mt-1 text-[13px] text-muted-foreground">
							Try a different name or clear the filter.
						</p>
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
