import {
	AGENT_ADAPTER_KINDS,
	AGENT_ADAPTERS,
	type AgentAdapterKind,
	type CommonspaceAgentProfile,
	type CommonspaceDiagnostics,
	type CommonspaceMessage,
	type CommonspaceMutation,
	type CommonspaceNotificationSettings,
	type CommonspaceNotificationVerification,
	type CommonspacePin,
	CommonspaceRoutingProvider,
	type CommonspaceSearchResult,
	type ConversationRef,
	DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
	deriveCommonspaceInboxItems,
	type UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import {
	ArrowRightIcon,
	FolderIcon,
	GripVerticalIcon,
	InboxIcon,
	MessagesSquareIcon,
	RefreshCwIcon,
	SettingsIcon,
	XIcon,
} from "lucide-react";
import {
	type FormEvent,
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { AppearanceSettings } from "@/design-system/AppearanceSettings";
import {
	CollectionActionButton,
	CollectionActionMenu,
	type CommonspaceCollectionKind,
} from "@/design-system/CollectionActionMenu";
import { CommonspaceLogo } from "@/design-system/CommonspaceLogo";
import {
	NavigationItem,
	NavigationItemGroup,
} from "@/design-system/NavigationItem";
import { NavigationSection } from "@/design-system/NavigationSection";
import { SidebarSortControl } from "@/design-system/SidebarSortControl";
import { UnreadCount } from "@/design-system/UnreadCount";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { WorkspaceSettingsLayout } from "@/design-system/WorkspaceSettingsLayout";
import { cn } from "@/lib/utils";
import type { CommonspaceDirectoryKind } from "./CommonspaceDirectory.tsx";
import { CommonspaceSearchDialog } from "./CommonspaceSearch.tsx";
import { ConversationRetention } from "./ConversationRetention";
import {
	type ChannelSortMode,
	moveChannelAfter,
	moveChannelBefore,
	sortChannelSections,
	sortSidebarSections,
} from "./channel-sorting.ts";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";
import { WorkspaceErrorNotice } from "./design-system/WorkspaceErrorNotice";
import { folderName } from "./project-files-api.ts";
import {
	type SettingsOperation,
	SettingsOperationStatus,
} from "./settings-operation";
import {
	collectionKey,
	type SidebarCollectionKind,
	sidebarPreferencesStore,
	useSidebarPreferences,
} from "./sidebar-preferences.ts";
import type { CommonspaceColorMode } from "./theme.ts";
import {
	parseWorkspaceImport,
	type WorkspaceImportCandidate,
} from "./workspace-import.ts";

export interface CommonspaceSidebarProps {
	wide: boolean;
	expandSidebar: () => void;
	store: CommonspaceStore;
	colorMode?: CommonspaceColorMode;
	onSetColorMode?: (mode: CommonspaceColorMode) => void;
	onSettingsOpenChange?: (open: boolean) => void;
	inboxActive?: boolean;
	threadsActive?: boolean;
	conversationActive?: boolean;
	directoryActive?: boolean;
	activeProjectViewId?: string | null;
	createRequest?: { kind: CommonspaceCollectionKind; token: number } | null;
	navigationToken?: number;
	onOpenSearch?: () => void;
	onOpenInbox?: () => void;
	onOpenThreads?: () => void;
	onOpenDirectory?: (kind: CommonspaceDirectoryKind) => void;
	onOpenContextSettings?: (kind: CommonspaceCollectionKind, id: string) => void;
	onMentionAgent?: (agentName: string) => void;
	onOpenAgentSessions?: () => void;
	onOpenProject?: (
		projectId: string,
		file?: { rootIndex: number; path: string },
	) => void;
	onOpenConversation?: (
		conversation: ConversationRef,
		messageId?: string,
		threadId?: string,
	) => void;
}

function BrowseButton({
	label,
	ariaLabel = label,
	onClick,
}: {
	label: string;
	ariaLabel?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="mt-0.5 flex min-h-8 w-full items-center justify-between gap-2 rounded-sm border-0 border-t-0 bg-transparent px-2 py-0 text-left text-[11px] font-medium text-sidebar-foreground/55 hover:text-sidebar-foreground"
			aria-label={ariaLabel}
			onClick={onClick}
		>
			<span className="truncate">{label}</span>
			<ArrowRightIcon
				className="size-3.5 text-sidebar-foreground/40"
				aria-hidden="true"
			/>
		</button>
	);
}

function SettingsSectionHeading({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="mb-5">
			<h2 className="font-heading text-lg font-semibold tracking-[-0.01em]">
				{title}
			</h2>
			<p className="mt-1 text-sm leading-6 text-muted-foreground">
				{description}
			</p>
		</div>
	);
}

function SettingsSwitch({
	checked,
	disabled = false,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	disabled?: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			className={cn(
				"relative !h-7 !min-h-7 !w-12 shrink-0 !rounded-full !border !p-0 transition-colors focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-ring disabled:cursor-not-allowed disabled:opacity-45",
				checked ? "!border-primary !bg-primary" : "!border-border !bg-muted",
			)}
			onClick={() => {
				onCheckedChange(!checked);
			}}
		>
			<span
				className={cn(
					"pointer-events-none block size-5 translate-x-[3px] rounded-full bg-background shadow-sm transition-transform",
					checked && "translate-x-[23px]",
				)}
				aria-hidden="true"
			/>
		</button>
	);
}

const NOTIFICATION_OPTIONS = [
	[
		"replies",
		"Replies and input requests",
		"Agent replies and requests that need your input.",
		"Reply notifications",
	],
	[
		"mentions",
		"Mentions",
		"Messages where you are explicitly mentioned.",
		"Mention notifications",
	],
	[
		"permissions",
		"Permission requests",
		"Approval requests before an agent continues.",
		"Permission notifications",
	],
	[
		"failures",
		"Failures and timeouts",
		"Failed runs, timeouts, and disconnected sessions.",
		"Failure notifications",
	],
	[
		"sound",
		"Notification sound",
		"Play a sound when a native alert is delivered.",
		"Notification sound",
	],
] as const;

function SidebarDialog({
	title,
	description,
	size = "form",
	onClose,
	children,
}: {
	title: string;
	size?: "compact" | "form";
	description?: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const restoreFocusRef = useRef<HTMLElement | null>(
		typeof document !== "undefined" &&
			document.activeElement instanceof HTMLElement
			? document.activeElement
			: null,
	);
	useEffect(
		() => () => {
			if (restoreFocusRef.current?.isConnected === true)
				restoreFocusRef.current.focus();
		},
		[],
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				closeLabel={`Close ${title}`}
				aria-describedby={undefined}
				className={cn(
					"top-[10vh] max-h-[80vh] -translate-y-0",
					size === "compact" ? "sm:max-w-[440px]" : "sm:max-w-[520px]",
				)}
			>
				<DialogHeader className="border-b px-6 py-5">
					<DialogTitle>{title}</DialogTitle>
					{description === undefined ? null : (
						<DialogDescription>{description}</DialogDescription>
					)}
				</DialogHeader>
				<div className="min-h-0 overflow-y-auto p-6">{children}</div>
			</DialogContent>
		</Dialog>
	);
}

function FormError({ message }: { message: string | null }) {
	return message === null ? null : (
		<p className="text-xs text-destructive" role="alert">
			{message}
		</p>
	);
}

function runtimeLabel(adapter: AgentAdapterKind): string {
	return AGENT_ADAPTERS[adapter].label;
}

function agentStatusLabel(status: CommonspaceAgentProfile["status"]): string {
	if (status === "running") return "online";
	if (status === "unknown") return "configured";
	return "available";
}

function copyText(value: string) {
	void navigator.clipboard?.writeText(value).catch(() => undefined);
}

function collectionIds(
	keys: readonly string[],
	kind: SidebarCollectionKind,
): string[] {
	const prefix = `${kind}:`;
	return keys.flatMap((key) =>
		key.startsWith(prefix) ? [key.slice(prefix.length)] : [],
	);
}

type CollectionDropPosition = "before" | "after";

interface CollectionDragState {
	kind: SidebarCollectionKind;
	sourceId: string;
	target: {
		id: string;
		position: CollectionDropPosition;
	} | null;
}

function collectionDropPositionFor(
	order: readonly string[],
	dragState: CollectionDragState | null,
	kind: SidebarCollectionKind,
	targetId: string,
): CollectionDropPosition | null {
	if (dragState === null || dragState.kind !== kind) return null;
	const sourceIndex = order.indexOf(dragState.sourceId);
	const targetIndex = order.indexOf(targetId);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
		return null;
	return sourceIndex < targetIndex ? "after" : "before";
}

interface AgentProfileDraft {
	agentId: string;
	displayName: string;
	avatarEmoji: string;
	accentColor: string;
	fullAccess: boolean;
}

function AgentProfileEditor({
	agent,
	draft,
	removable,
	store,
	onDraftChange,
	onClose,
}: {
	agent: CommonspaceAgentProfile;
	draft: AgentProfileDraft;
	removable: boolean;
	store: CommonspaceStore;
	onDraftChange: (fields: Partial<Omit<AgentProfileDraft, "agentId">>) => void;
	onClose: () => void;
}) {
	const previewAgent: CommonspaceAgentProfile = {
		...agent,
		displayName: draft.displayName || agent.displayName,
		accentColor: draft.accentColor,
	};
	if (draft.avatarEmoji !== "") previewAgent.avatarEmoji = draft.avatarEmoji;
	const saveAgentProfile = async (event: FormEvent) => {
		event.preventDefault();
		await store.mutate({ action: "update-agent-profile", ...draft });
		onClose();
	};

	return (
		<SidebarDialog title={`Customize ${agent.displayName}`} onClose={onClose}>
			<form
				className="grid gap-3 [&_button:not([data-slot])]:min-h-9 [&_button:not([data-slot])]:rounded-sm [&_button:not([data-slot])]:border [&_button:not([data-slot])]:px-3 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
				onSubmit={(event) => {
					void saveAgentProfile(event);
				}}
			>
				<div className="flex items-center gap-3 rounded-md border bg-muted p-3">
					<AgentAvatar agent={previewAgent} />
					<span>
						<strong>{draft.displayName || agent.displayName}</strong>
						<small>Commonspace appearance only</small>
					</span>
				</div>
				<label>
					Workspace name
					<input
						aria-label="Workspace name"
						value={draft.displayName}
						onChange={(event) => {
							onDraftChange({ displayName: event.target.value });
						}}
					/>
				</label>
				<label>
					Avatar emoji
					<input
						aria-label="Avatar emoji"
						value={draft.avatarEmoji}
						onChange={(event) => {
							onDraftChange({ avatarEmoji: event.target.value });
						}}
						placeholder={(draft.displayName || agent.displayName)
							.slice(0, 1)
							.toLocaleUpperCase()}
						maxLength={16}
					/>
				</label>
				<label>
					Accent color
					<input
						aria-label="Accent color"
						type="color"
						value={draft.accentColor}
						onChange={(event) => {
							onDraftChange({ accentColor: event.target.value });
						}}
					/>
				</label>
				<label className="flex items-start gap-3 rounded-md border bg-muted p-3">
					<input
						type="checkbox"
						className="mt-0.5 size-4"
						checked={
							agent.permissionPolicy?.source === "server"
								? agent.permissionPolicy.fullAccess
								: draft.fullAccess
						}
						disabled={agent.permissionPolicy?.source === "server"}
						onChange={(event) => {
							onDraftChange({ fullAccess: event.target.checked });
						}}
					/>
					<span>
						<strong className="block text-sm">Full access</strong>
						<small className="block text-xs leading-5 text-muted-foreground">
							{agent.permissionPolicy?.source === "server"
								? "Full access is enabled by server configuration and cannot be disabled here."
								: "Bypass approval prompts for this agent’s Commonspace runs."}
						</small>
					</span>
				</label>
				<p className="text-xs text-muted-foreground">
					Changing access stops active work; future turns keep their native
					session references.
				</p>
				<div>
					<button type="submit">Save agent settings</button>
					{removable && (
						<button
							type="button"
							aria-label={`Remove agent ${agent.displayName}`}
							onClick={() => {
								void store.mutate({
									action: "remove-agent",
									agentId: agent.id,
								});
								onClose();
							}}
						>
							Remove agent
						</button>
					)}
				</div>
			</form>
		</SidebarDialog>
	);
}

export function CommonspaceSidebar({
	wide,
	expandSidebar,
	store,
	colorMode = "light",
	onSetColorMode,
	onSettingsOpenChange,
	inboxActive = false,
	threadsActive = false,
	conversationActive = false,
	directoryActive = false,
	activeProjectViewId = null,
	createRequest = null,
	navigationToken,
	onOpenSearch,
	onOpenInbox,
	onOpenThreads,
	onOpenDirectory,
	onOpenContextSettings,
	onMentionAgent,
	onOpenAgentSessions,
	onOpenProject,
	onOpenConversation,
}: CommonspaceSidebarProps) {
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const preferences = useSidebarPreferences();
	const [form, setForm] = useState<"project" | "channel" | "agent" | null>(
		null,
	);
	const creationRevision = useRef(0);
	const [formError, setFormError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [path, setPath] = useState("");
	const [selectingPath, setSelectingPath] = useState(false);
	const [pathProjectId, setPathProjectId] = useState<string | null>(null);
	const [pathDraft, setPathDraft] = useState("");
	const [agentIds, setAgentIds] = useState<string[]>([]);
	const [channelAgentQuery, setChannelAgentQuery] = useState("");
	const [collectionDragState, setCollectionDragState] =
		useState<CollectionDragState | null>(null);
	const [channelAgentFilter, setChannelAgentFilter] = useState<
		"all" | "selected"
	>("all");
	const [agentAdapter, setAgentAdapter] = useState<AgentAdapterKind | null>(
		null,
	);
	const [agentFullAccess, setAgentFullAccess] = useState(false);
	const [agentDraft, setAgentDraft] = useState<AgentProfileDraft | null>(null);
	const editingAgentId = agentDraft?.agentId;
	const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
	const [channelAgentIds, setChannelAgentIds] = useState<string[]>([]);
	const [channelInstructions, setChannelInstructions] = useState("");
	const [channelSummary, setChannelSummary] = useState("");
	const [channelDecisions, setChannelDecisions] = useState("");
	const [channelQuestions, setChannelQuestions] = useState("");
	const [channelPinNote, setChannelPinNote] = useState("");
	const [compactingChannelId, setCompactingChannelId] = useState<string | null>(
		null,
	);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const settingsPanelRef = useRef<HTMLElement>(null);
	const settingsTriggerRef = useRef<HTMLButtonElement>(null);
	const settingsCloseRef = useRef<HTMLButtonElement>(null);
	const [defaultMaxAgents, setDefaultMaxAgents] = useState(4);
	const [defaultMemoryThreads, setDefaultMemoryThreads] = useState(12);
	const [routingHarnessAgentId, setRoutingHarnessAgentId] = useState("");
	const [runSettingsSave, setRunSettingsSave] = useState<SettingsOperation>({
		status: SettingsOperationStatus.Idle,
	});
	const [inferenceSave, setInferenceSave] = useState<SettingsOperation>({
		status: SettingsOperationStatus.Idle,
	});
	const savingInference =
		inferenceSave.status === SettingsOperationStatus.Running;
	const settingsError =
		inferenceSave.status === SettingsOperationStatus.Failed
			? inferenceSave.message
			: null;
	const [searchOpen, setSearchOpen] = useState(false);
	const [diagnostics, setDiagnostics] = useState<CommonspaceDiagnostics | null>(
		null,
	);
	const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
	const [importArchive, setImportArchive] =
		useState<WorkspaceImportCandidate | null>(null);
	const [importMappings, setImportMappings] = useState<
		Record<string, string[]>
	>({});
	const [importingWorkspace, setImportingWorkspace] = useState(false);
	const [notificationSettings, setNotificationSettings] =
		useState<CommonspaceNotificationSettings>({
			...DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
		});
	const [notificationSave, setNotificationSave] = useState<SettingsOperation>({
		status: SettingsOperationStatus.Idle,
	});
	const savingNotifications =
		notificationSave.status === SettingsOperationStatus.Running;
	const notificationsSaved =
		notificationSave.status === SettingsOperationStatus.Succeeded;
	const notificationSaveError =
		notificationSave.status === SettingsOperationStatus.Failed
			? notificationSave.message
			: null;
	const [verifyingNotifications, setVerifyingNotifications] = useState(false);
	const [notificationVerification, setNotificationVerification] =
		useState<CommonspaceNotificationVerification | null>(null);

	useEffect(() => {
		void store.refresh();
	}, [store]);
	useEffect(() => {
		onSettingsOpenChange?.(settingsOpen);
		if (!settingsOpen) return;
		const panel = settingsPanelRef.current;
		settingsCloseRef.current?.focus();
		return () => {
			if (
				document.activeElement === document.body ||
				panel?.contains(document.activeElement)
			)
				settingsTriggerRef.current?.focus();
		};
	}, [settingsOpen, onSettingsOpenChange]);
	useEffect(() => {
		void inboxActive;
		void conversationActive;
		void directoryActive;
		void threadsActive;
		void activeProjectViewId;
		void navigationToken;
		setSettingsOpen(false);
	}, [
		activeProjectViewId,
		inboxActive,
		conversationActive,
		directoryActive,
		threadsActive,
		navigationToken,
	]);
	const openCreation = useCallback((kind: CommonspaceCollectionKind) => {
		creationRevision.current += 1;
		setSettingsOpen(false);
		setForm(kind);
		setFormError(null);
		setName("");
		setPath("");
		setAgentIds([]);
		setChannelAgentQuery("");
		setChannelAgentFilter("all");
		setAgentAdapter(null);
		setAgentFullAccess(false);
	}, []);
	useEffect(() => {
		if (createRequest !== null) openCreation(createRequest.kind);
	}, [createRequest, openCreation]);
	useEffect(() => {
		const openSearch = (event: KeyboardEvent) => {
			if (
				!(event.metaKey || event.ctrlKey) ||
				event.key.toLocaleLowerCase() !== "k"
			)
				return;
			event.preventDefault();
			if (onOpenSearch === undefined) setSearchOpen(true);
			else onOpenSearch();
		};
		window.addEventListener("keydown", openSearch);
		return () => {
			window.removeEventListener("keydown", openSearch);
		};
	}, [onOpenSearch]);
	const bootstrap = snapshot.bootstrap;
	const state = bootstrap?.state;
	const savedRouting = bootstrap?.routing;
	const configuredRouting =
		savedRouting?.provider === CommonspaceRoutingProvider.Unconfigured
			? undefined
			: savedRouting;
	const inboxItems = useMemo(
		() => (state === undefined ? [] : deriveCommonspaceInboxItems(state)),
		[state],
	);
	const { inboxUnreadCount, threadUnreadCount } = useMemo(() => {
		let unreadCount = 0;
		const unreadThreadIds = new Set<string>();
		for (const item of inboxItems) {
			if (!item.unread) continue;
			unreadCount += 1;
			if (item.threadId !== undefined) unreadThreadIds.add(item.threadId);
		}
		return {
			inboxUnreadCount: unreadCount,
			threadUnreadCount: unreadThreadIds.size,
		};
	}, [inboxItems]);
	const channelUnreadCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const item of inboxItems) {
			if (!item.unread || item.conversation.kind !== "channel") continue;
			counts.set(
				item.conversation.id,
				(counts.get(item.conversation.id) ?? 0) + 1,
			);
		}
		return counts;
	}, [inboxItems]);
	const agents = bootstrap?.agents ?? [];
	const editingAgent = useMemo(
		() => agents.find((agent) => agent.id === editingAgentId),
		[agents, editingAgentId],
	);
	const editingAgentRemovable = useMemo(
		() => state?.agents.some((agent) => agent.id === editingAgentId) === true,
		[state?.agents, editingAgentId],
	);
	const normalizedChannelAgentQuery = channelAgentQuery
		.trim()
		.toLocaleLowerCase();
	const availableChannelAgents = agents.filter((agent) => {
		if (channelAgentFilter === "selected" && !agentIds.includes(agent.id))
			return false;
		return (
			normalizedChannelAgentQuery === "" ||
			`${agent.displayName} ${agent.adapter} ${agent.model ?? ""}`
				.toLocaleLowerCase()
				.includes(normalizedChannelAgentQuery)
		);
	});
	const activeAgentIds = new Set(
		(bootstrap?.liveActivities ?? []).map((activity) => activity.agentId),
	);
	const discoveredAgents = bootstrap?.discoveredAgents ?? [];
	const configuredAgentIds = new Set(agents.map((agent) => agent.id));
	const availableDiscoveredAgents = discoveredAgents.filter(
		(agent) =>
			agent.adapter === agentAdapter && !configuredAgentIds.has(agent.id),
	);
	const channelPinsById = useMemo<
		ReadonlyMap<string, readonly CommonspacePin[]>
	>(() => {
		const pinsByChannel = new Map<string, CommonspacePin[]>();
		for (const pin of state?.pins ?? []) {
			if (pin.removedAt !== null || pin.scope.kind !== "channel") continue;
			const pins = pinsByChannel.get(pin.scope.id);
			if (pins === undefined) pinsByChannel.set(pin.scope.id, [pin]);
			else pins.push(pin);
		}
		return pinsByChannel;
	}, [state?.pins]);
	const projects = state?.projects ?? [];
	const channels = state?.channels ?? [];
	const defaultPinnedKeys = useMemo(
		() =>
			[
				projects[0] === undefined
					? undefined
					: collectionKey("project", projects[0].id),
				channels[0] === undefined
					? undefined
					: collectionKey("channel", channels[0].id),
				agents[0] === undefined
					? undefined
					: collectionKey("agent", agents[0].id),
			].filter((key): key is string => key !== undefined),
		[agents, channels, projects],
	);
	const effectivePinnedKeys = preferences.hasStoredPins
		? preferences.pinnedKeys
		: defaultPinnedKeys;
	const projectPinnedIds = useMemo(
		() => new Set(collectionIds(effectivePinnedKeys, "project")),
		[effectivePinnedKeys],
	);
	const projectSections = useMemo(
		() =>
			sortSidebarSections({
				items: projects,
				pinnedIds: projectPinnedIds,
				mode: preferences.sortModes.project,
				customOrder: collectionIds(preferences.customOrders.project, "project"),
				recentOrder: [
					...collectionIds(preferences.recentKeys.project, "project"),
					...projects.map((project) => project.id),
				],
				getName: (project) => project.name,
			}),
		[
			preferences.customOrders.project,
			preferences.recentKeys.project,
			preferences.sortModes.project,
			projectPinnedIds,
			projects,
		],
	);
	const projectItems = [
		...projectSections.pinned,
		...projectSections.unpinned.slice(0, 10),
	];
	const channelPinnedIds = useMemo(
		() => new Set(collectionIds(effectivePinnedKeys, "channel")),
		[effectivePinnedKeys],
	);
	const { channelLastActiveAt, latestChannelMessageById } = useMemo(() => {
		const lastActiveAt = new Map<string, string>();
		const latestMessageById = new Map<string, CommonspaceMessage>();
		for (const channel of channels) {
			const latestMessage = state?.messages[`channel:${channel.id}`]?.at(-1);
			lastActiveAt.set(
				channel.id,
				latestMessage?.createdAt ?? channel.createdAt,
			);
			if (latestMessage !== undefined)
				latestMessageById.set(channel.id, latestMessage);
		}
		return {
			channelLastActiveAt: lastActiveAt,
			latestChannelMessageById: latestMessageById,
		};
	}, [channels, state?.messages]);
	const channelSections = useMemo(
		() =>
			sortChannelSections({
				channels,
				pinnedIds: channelPinnedIds,
				mode: preferences.sortModes.channel,
				customOrder: collectionIds(preferences.customOrders.channel, "channel"),
				lastActiveAt: channelLastActiveAt,
			}),
		[
			channelLastActiveAt,
			channelPinnedIds,
			channels,
			preferences.customOrders.channel,
			preferences.sortModes.channel,
		],
	);
	const channelItems = [
		...channelSections.pinned,
		...channelSections.unpinned.slice(0, 10),
	];
	const agentPinnedIds = useMemo(
		() => new Set(collectionIds(effectivePinnedKeys, "agent")),
		[effectivePinnedKeys],
	);
	const agentSections = useMemo(
		() =>
			sortSidebarSections({
				items: agents,
				pinnedIds: agentPinnedIds,
				mode: preferences.sortModes.agent,
				customOrder: collectionIds(preferences.customOrders.agent, "agent"),
				recentOrder: [
					...collectionIds(preferences.recentKeys.agent, "agent"),
					...agents.map((agent) => agent.id),
				],
				getName: (agent) => agent.displayName,
			}),
		[
			agentPinnedIds,
			agents,
			preferences.customOrders.agent,
			preferences.recentKeys.agent,
			preferences.sortModes.agent,
		],
	);
	const agentItems = [
		...agentSections.pinned,
		...agentSections.unpinned.slice(0, 10),
	];
	useEffect(() => {
		sidebarPreferencesStore.ensurePinnedDefaults(defaultPinnedKeys);
	}, [defaultPinnedKeys]);
	const activeMentionChannel =
		snapshot.activeConversation?.kind === "channel"
			? channels.find(
					(channel) => channel.id === snapshot.activeConversation?.id,
				)
			: undefined;
	const collectionPinned = (kind: CommonspaceCollectionKind, id: string) =>
		effectivePinnedKeys.includes(collectionKey(kind, id));
	const toggleCollectionPinned = (
		kind: CommonspaceCollectionKind,
		id: string,
	) => {
		sidebarPreferencesStore.togglePin(kind, id, defaultPinnedKeys);
	};
	const touchRecent = (kind: CommonspaceCollectionKind, id: string) => {
		sidebarPreferencesStore.touchRecent(kind, id, defaultPinnedKeys);
	};
	const setCollectionSortMode = (
		kind: SidebarCollectionKind,
		mode: ChannelSortMode,
		orderedIds: readonly string[],
	) => {
		if (
			mode === "custom" &&
			preferences.sortModes[kind] !== "custom" &&
			preferences.customOrders[kind].length === 0
		)
			sidebarPreferencesStore.setCustomOrder(kind, orderedIds);
		sidebarPreferencesStore.setSortMode(kind, mode);
	};
	const reorderableCollection = (kind: SidebarCollectionKind) => {
		if (kind === "project")
			return {
				all: projects.map((project) => project.id),
				pinned: projectSections.pinned.map((project) => project.id),
				unpinned: projectSections.unpinned.map((project) => project.id),
			};
		if (kind === "agent")
			return {
				all: agents.map((agent) => agent.id),
				pinned: agentSections.pinned.map((agent) => agent.id),
				unpinned: agentSections.unpinned.map((agent) => agent.id),
			};
		return {
			all: channels.map((channel) => channel.id),
			pinned: channelSections.pinned.map((channel) => channel.id),
			unpinned: channelSections.unpinned.map((channel) => channel.id),
		};
	};
	const moveCollectionItem = (
		kind: SidebarCollectionKind,
		sourceId: string,
		targetId: string,
		moveAfter: boolean,
	) => {
		const collection = reorderableCollection(kind);
		const move = moveAfter ? moveChannelAfter : moveChannelBefore;
		sidebarPreferencesStore.setCustomOrder(
			kind,
			move(
				preferences.customOrders[kind].map((key) => key.slice(kind.length + 1)),
				sourceId,
				targetId,
				collection.all,
			),
		);
	};
	const sortableCollectionButtonProps = (
		kind: SidebarCollectionKind,
		itemId: string,
	) => {
		const custom = preferences.sortModes[kind] === "custom";
		const collection = reorderableCollection(kind);
		const section = collection.pinned.includes(itemId)
			? collection.pinned
			: collection.unpinned;
		return {
			draggable: custom,
			"aria-keyshortcuts": custom ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
			"aria-describedby": custom ? `${kind}-custom-order-help` : undefined,
			onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
				if (
					!custom ||
					!event.altKey ||
					(event.key !== "ArrowUp" && event.key !== "ArrowDown")
				)
					return;
				event.preventDefault();
				const itemIndex = section.indexOf(itemId);
				const targetId =
					section[itemIndex + (event.key === "ArrowUp" ? -1 : 1)];
				if (targetId === undefined) return;
				moveCollectionItem(kind, itemId, targetId, event.key === "ArrowDown");
			},
			onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => {
				if (!custom) return;
				setCollectionDragState({
					kind,
					sourceId: itemId,
					target: null,
				});
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", itemId);
			},
			onDragEnd: () => {
				setCollectionDragState(null);
			},
		};
	};
	const sortableCollectionDropTargetProps = (
		kind: SidebarCollectionKind,
		itemId: string,
	) => {
		const collection = reorderableCollection(kind);
		const order = [...collection.pinned, ...collection.unpinned];
		return {
			onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
				const dragState = collectionDragState;
				const position = collectionDropPositionFor(
					order,
					dragState,
					kind,
					itemId,
				);
				if (dragState === null || position === null) {
					event.dataTransfer.dropEffect = "none";
					if (dragState !== null && dragState.target !== null)
						setCollectionDragState({ ...dragState, target: null });
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				if (
					dragState.target?.id !== itemId ||
					dragState.target.position !== position
				)
					setCollectionDragState({
						...dragState,
						target: { id: itemId, position },
					});
			},
			onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
				const dragState = collectionDragState;
				const position = collectionDropPositionFor(
					order,
					dragState,
					kind,
					itemId,
				);
				setCollectionDragState(null);
				if (dragState === null || position === null) return;
				event.preventDefault();
				if (
					collection.pinned.includes(dragState.sourceId) !==
					collection.pinned.includes(itemId)
				)
					toggleCollectionPinned(kind, dragState.sourceId);
				moveCollectionItem(
					kind,
					dragState.sourceId,
					itemId,
					position === "after",
				);
			},
		};
	};
	const collectionDropPosition = (
		kind: SidebarCollectionKind,
		itemId: string,
	): CollectionDropPosition | null =>
		collectionDragState !== null &&
		collectionDragState.kind === kind &&
		collectionDragState.target?.id === itemId
			? collectionDragState.target.position
			: null;
	const collectionDropIndicatorClassName = (
		position: CollectionDropPosition | null,
	) =>
		cn(
			"relative",
			position !== null &&
				"after:pointer-events-none after:absolute after:right-1 after:left-1 after:z-20 after:h-0.5 after:rounded-full after:bg-sidebar-primary after:content-['']",
			position === "before" && "after:top-0 after:-translate-y-1/2",
			position === "after" && "after:bottom-0 after:translate-y-1/2",
		);

	if (!wide) {
		return (
			<button
				type="button"
				className="grid h-full w-14 place-items-start bg-sidebar pt-4"
				aria-label="Expand Commonspace sidebar"
				onClick={expandSidebar}
			>
				<CommonspaceLogo decorative className="size-6" />
			</button>
		);
	}

	const chooseProjectDirectory = async () => {
		setSelectingPath(true);
		try {
			const selectedPath = await store.selectDirectory();
			if (selectedPath !== null) {
				setPath(selectedPath);
				setName((current) =>
					current.trim() === "" ? folderName(selectedPath) : current,
				);
			}
		} catch {
			// The application-level toast renders the store error once.
		} finally {
			setSelectingPath(false);
		}
	};

	const selectAgentHarness = (adapter: AgentAdapterKind) => {
		setAgentAdapter(adapter);
		setName("");
		void store.discoverAgents(adapter);
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setFormError(null);
		let mutation: CommonspaceMutation;
		if (form === "project") {
			if (name.trim() === "" || path.trim() === "") {
				setFormError("Project name and local folder are required.");
				return;
			}
			mutation = { action: "create-project", name, paths: [path] };
		} else if (form === "channel") {
			if (name.trim() === "") {
				setFormError("Channel name is required.");
				return;
			}
			mutation = {
				action: "create-channel",
				name,
				agentIds,
			};
		} else return;
		const submittedRevision = creationRevision.current;
		try {
			await store.mutate(mutation);
		} catch (error) {
			if (submittedRevision !== creationRevision.current) return;
			// Keep the form open while the application-level toast shows the error.
			setFormError(error instanceof Error ? error.message : String(error));
			return;
		}
		if (submittedRevision !== creationRevision.current) return;
		setForm(null);
		setFormError(null);
		setName("");
		setPath("");
		setAgentIds([]);
	};

	const submitPath = async (event: FormEvent, targetProjectId: string) => {
		event.preventDefault();
		await store.mutate({
			action: "add-project-path",
			projectId: targetProjectId,
			path: pathDraft,
		});
		setPathProjectId(null);
		setPathDraft("");
	};

	const addProjectFolder = async (projectId: string) => {
		setSelectingPath(true);
		try {
			const selectedPath = await store.selectDirectory();
			if (selectedPath !== null) {
				await store.mutate({
					action: "add-project-path",
					projectId,
					path: selectedPath,
				});
			}
		} catch {
			// The application-level toast renders the store error once.
		} finally {
			setSelectingPath(false);
		}
	};

	const saveChannelAgents = async (event: FormEvent, channelId: string) => {
		event.preventDefault();
		await store.mutate({
			action: "set-channel-configuration",
			channelId,
			agentIds: channelAgentIds,
			instructions: channelInstructions,
			summary: channelSummary,
			decisions: channelDecisions
				.split("\n")
				.map((value) => value.trim())
				.filter(Boolean),
			openQuestions: channelQuestions
				.split("\n")
				.map((value) => value.trim())
				.filter(Boolean),
		});
		setEditingChannelId(null);
	};

	const compactChannelContext = async (channelId: string) => {
		if (compactingChannelId !== null) return;
		setCompactingChannelId(channelId);
		try {
			await store.compactChannelContext(channelId);
		} finally {
			setCompactingChannelId(null);
		}
	};

	const addChannelPin = async (channelId: string) => {
		const note = channelPinNote.trim();
		if (note === "") return;
		await store.addPin({
			scope: { kind: "channel", id: channelId },
			kind: "note",
			note,
		});
		setChannelPinNote("");
	};

	const routingUpdateRequest = (): UpdateRoutingConfigurationRequest => {
		if (routingHarnessAgentId === "")
			throw new Error("Choose a workspace inference agent");
		return {
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: routingHarnessAgentId,
		};
	};

	const saveInferenceSettings = async (event: FormEvent) => {
		event.preventDefault();
		if (savingInference) return;
		setInferenceSave({
			status: SettingsOperationStatus.Running,
			message: "Saving inference agent…",
		});
		try {
			await store.updateRoutingConfiguration(routingUpdateRequest());
			setInferenceSave({
				status: SettingsOperationStatus.Succeeded,
				message: "Inference agent saved.",
			});
			setSettingsOpen(false);
		} catch (error) {
			setInferenceSave({
				status: SettingsOperationStatus.Failed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const saveRunSettings = async () => {
		if (runSettingsSave.status === SettingsOperationStatus.Running) return;
		if (
			!Number.isInteger(defaultMaxAgents) ||
			defaultMaxAgents < 1 ||
			defaultMaxAgents > 8 ||
			!Number.isInteger(defaultMemoryThreads) ||
			defaultMemoryThreads < 1 ||
			defaultMemoryThreads > 50
		) {
			setRunSettingsSave({
				status: SettingsOperationStatus.Failed,
				message:
					"Max agents must be a whole number from 1 to 8; memory threads must be a whole number from 1 to 50.",
			});
			return;
		}
		setRunSettingsSave({
			status: SettingsOperationStatus.Running,
			message: "Saving agent run settings…",
		});
		try {
			await store.mutate({
				action: "set-defaults",
				maxAgentsPerTurn: defaultMaxAgents,
				memoryThreads: defaultMemoryThreads,
			});
			setRunSettingsSave({
				status: SettingsOperationStatus.Succeeded,
				message: "Agent run settings saved.",
			});
		} catch (error) {
			setRunSettingsSave({
				status: SettingsOperationStatus.Failed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const saveNotifications = async () => {
		if (savingNotifications) return;
		setNotificationSave({
			status: SettingsOperationStatus.Running,
			message: "Saving notification settings…",
		});
		setNotificationVerification(null);
		try {
			await store.mutate({
				action: "set-notifications",
				notifications: notificationSettings,
			});
			setNotificationSave({
				status: SettingsOperationStatus.Succeeded,
				message: "Notification settings saved.",
			});
		} catch (error) {
			setNotificationSave({
				status: SettingsOperationStatus.Failed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const verifyNotifications = async () => {
		if (verifyingNotifications) return;
		setVerifyingNotifications(true);
		setNotificationVerification(null);
		try {
			setNotificationVerification(await store.verifyDesktopNotifications());
		} catch {
			setNotificationVerification({
				status: "failed",
				message:
					"Native alert verification could not reach Commonspace. Inbox notifications remain available; reconnect and try again.",
			});
		} finally {
			setVerifyingNotifications(false);
		}
	};

	const runDiagnostics = async () => {
		if (diagnosticsLoading) return;
		setDiagnosticsLoading(true);
		try {
			setDiagnostics(await store.diagnostics());
		} finally {
			setDiagnosticsLoading(false);
		}
	};

	const exportWorkspace = async () => {
		const archive = await store.exportWorkspace();
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(archive, null, 2)], {
				type: "application/json",
			}),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "commonspace-export.json";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	const selectImportArchive = (file: File | undefined) => {
		if (file === undefined) return;
		const reader = new FileReader();
		reader.onload = () => {
			const archive = parseWorkspaceImport(String(reader.result));
			if (archive === null) {
				setImportArchive(null);
				setImportMappings({});
				return;
			}
			setImportArchive(archive);
			setImportMappings(
				Object.fromEntries(
					archive.projects.map((project) => [
						project.id,
						Array.from({ length: project.rootCount }, () => ""),
					]),
				),
			);
		};
		reader.readAsText(file);
	};

	const chooseImportRoot = async (projectId: string, rootIndex: number) => {
		const path = await store.selectDirectory();
		if (path === null) return;
		setImportMappings((current) => ({
			...current,
			[projectId]: (current[projectId] ?? []).map((value, index) =>
				index === rootIndex ? path : value,
			),
		}));
	};

	const importWorkspace = async () => {
		if (importArchive === null || importingWorkspace) return;
		setImportingWorkspace(true);
		try {
			await store.importWorkspace(importArchive.source, importMappings);
			setImportArchive(null);
			setImportMappings({});
			setSettingsOpen(false);
		} finally {
			setImportingWorkspace(false);
		}
	};

	const startDirectMessage = (agentId: string) => {
		setSettingsOpen(false);
		const conversation = { kind: "dm", id: agentId } as const;
		store.selectConversation(conversation);
		onOpenConversation?.(conversation);
		setForm(null);
	};

	const openSearchResult = (result: CommonspaceSearchResult) => {
		if (result.target.kind === "conversation") {
			store.selectConversation(result.target.conversation);
			store.selectThread(result.target.threadId ?? null);
			onOpenConversation?.(
				result.target.conversation,
				result.target.messageId,
				result.target.threadId,
			);
		} else if (result.target.kind === "project") {
			store.selectProject(result.target.projectId);
			onOpenProject?.(result.target.projectId);
		} else if (result.target.kind === "project-file") {
			store.selectProject(result.target.projectId);
			onOpenProject?.(result.target.projectId, {
				rootIndex: result.target.rootIndex,
				path: result.target.path,
			});
		} else {
			const conversation = { kind: "dm", id: result.target.agentId } as const;
			store.selectConversation(conversation);
			onOpenConversation?.(conversation);
		}
		setSearchOpen(false);
	};

	return (
		<section
			className="flex h-full min-h-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground"
			aria-label="Commonspace browser"
		>
			{onOpenSearch === undefined && (
				<header className="grid gap-2 border-b border-sidebar-border p-3">
					<div className="grid min-h-11 grid-cols-[28px_minmax(0,1fr)_24px] items-center gap-2 px-2 text-left text-sidebar-foreground">
						<CommonspaceLogo decorative className="size-6" />
						<span className="min-w-0">
							<strong className="block truncate text-sm">Workspace</strong>
							<small className="block truncate text-xs text-muted-foreground">
								Commonspace
							</small>
						</span>
						<span aria-hidden="true">•••</span>
					</div>
					<button
						type="button"
						className="grid min-h-11 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-3 text-left text-sidebar-foreground/75"
						aria-label="Search Commonspace"
						onClick={() => {
							setSearchOpen(true);
						}}
					>
						<span aria-hidden="true">⌕</span>
						<span className="truncate">Search everything</span>
						<kbd>⌘K</kbd>
					</button>
				</header>
			)}

			{onOpenSearch === undefined && searchOpen && (
				<CommonspaceSearchDialog
					projects={projects}
					onClose={() => {
						setSearchOpen(false);
					}}
					onSelect={openSearchResult}
				/>
			)}

			{snapshot.loading && bootstrap === null && (
				<div className="p-4 text-xs text-muted-foreground">Loading agents…</div>
			)}
			{settingsOpen &&
				state !== undefined &&
				createPortal(
					<section
						ref={settingsPanelRef}
						aria-label="Workspace settings"
						onKeyDown={(event) => {
							if (event.key === "Escape" && !event.defaultPrevented) {
								event.stopPropagation();
								setSettingsOpen(false);
							}
						}}
						className="fixed top-[64px] right-0 bottom-0 left-[var(--navigation-width)] z-40 flex min-h-0 flex-col overflow-hidden bg-background text-foreground max-[780px]:left-0"
					>
						<WorkspaceHeader
							title="Workspace settings"
							mark={<SettingsIcon className="size-4" aria-hidden="true" />}
							landmark={false}
							actions={
								<button
									ref={settingsCloseRef}
									type="button"
									className="grid size-10 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
									aria-label="Close settings"
									onClick={() => {
										setSettingsOpen(false);
									}}
								>
									<XIcon className="size-4" aria-hidden="true" />
								</button>
							}
						/>
						{snapshot.error !== null && (
							<WorkspaceErrorNotice
								error={snapshot.error}
								loading={snapshot.loading}
								onDismiss={() => store.dismissError()}
								onRefresh={() => {
									void store.refresh();
								}}
							/>
						)}
						<WorkspaceSettingsLayout
							sections={{
								appearance: (
									<AppearanceSettings
										value={colorMode}
										{...(onSetColorMode === undefined
											? {}
											: { onChange: onSetColorMode })}
									/>
								),
								intelligence: (
									<>
										<div className="relative pb-5">
											<h2 className="max-w-[700px] font-heading text-xl leading-tight font-semibold">
												Routing and context
											</h2>
											<span className="mt-2 block text-xs text-muted-foreground">
												Saved inference agent:{" "}
												{configuredRouting === undefined
													? "Not configured"
													: (bootstrap?.agents.find(
															(agent) =>
																agent.id === configuredRouting.harnessAgentId,
														)?.displayName ?? "Unavailable agent")}
											</span>
											<p className="mt-2 max-w-[780px] text-sm leading-6 text-muted-foreground">
												Choose one of your agents to route unaddressed Channel
												messages and compact shared context. Commonspace uses
												the runtime&apos;s existing sign-in and never asks for
												an API key.
											</p>
										</div>
										<form
											aria-label="Inference agent settings"
											onSubmit={(event) => {
												void saveInferenceSettings(event);
											}}
										>
											<fieldset
												disabled={savingInference}
												className="min-w-0 border-0 p-0"
											>
												<legend className="sr-only">
													Inference configuration
												</legend>
												{savedRouting?.provider ===
													CommonspaceRoutingProvider.Unconfigured && (
													<p
														role="alert"
														className="my-4 rounded-md border p-3"
													>
														{savedRouting.message}
													</p>
												)}
												<section className="pt-2">
													<SettingsSectionHeading
														title="Inference agent"
														description="This agent handles routing and background compaction through its existing harness session."
													/>
													<fieldset className="m-0 grid min-w-0 overflow-hidden rounded-md border bg-card p-0">
														<legend className="sr-only">Inference agent</legend>
														{agents.map((agent) => (
															<label
																key={agent.id}
																className={cn(
																	"grid min-h-[62px] cursor-pointer grid-cols-[20px_36px_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2 text-left first:border-t-0 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[-2px] has-[input:focus-visible]:outline-ring",
																	routingHarnessAgentId === agent.id &&
																		"bg-muted/30",
																)}
															>
																<input
																	className="sr-only"
																	type="radio"
																	name="commonspace-inference-agent"
																	value={agent.id}
																	checked={routingHarnessAgentId === agent.id}
																	onChange={() => {
																		setRoutingHarnessAgentId(agent.id);
																	}}
																/>
																<span
																	className={cn(
																		"pointer-events-none size-[18px] rounded-full border before:m-auto before:block before:size-2 before:translate-y-1 before:rounded-full",
																		routingHarnessAgentId === agent.id &&
																			"border-primary before:bg-primary",
																	)}
																	aria-hidden="true"
																/>
																<AgentAvatar agent={agent} />
																<span>
																	<strong className="block text-sm">
																		{agent.displayName}
																	</strong>
																	<small className="text-xs text-muted-foreground">
																		{runtimeLabel(agent.adapter)} ·{" "}
																		{agent.model ?? "harness default"}
																	</small>
																</span>
																{routingHarnessAgentId === agent.id && (
																	<span className="text-xs font-semibold text-primary">
																		Selected
																	</span>
																)}
															</label>
														))}
													</fieldset>
													<p className="mt-3 text-xs leading-5 text-muted-foreground">
														Explicit @mentions and DMs bypass inference. The
														selected agent receives bounded public conversation
														context only.
													</p>
												</section>

												{settingsError !== null && (
													<p
														role="alert"
														className="mt-4 rounded-md border border-destructive/30 bg-muted p-3 text-sm text-destructive"
													>
														{settingsError}
													</p>
												)}
												<div className="mt-6 flex items-center justify-between gap-6 border-t pt-4 max-[640px]:grid">
													<p className="text-xs leading-5 text-muted-foreground">
														Saves only the routing and compaction agent. Agent
														run defaults have their own save button.
													</p>
													<button
														type="submit"
														className="shrink-0 border-primary bg-primary font-semibold text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] disabled:cursor-wait disabled:opacity-60"
														disabled={
															savingInference || routingHarnessAgentId === ""
														}
													>
														{savingInference
															? "Saving inference agent…"
															: "Save inference agent"}
													</button>
												</div>
											</fieldset>
										</form>
									</>
								),
								runs: (
									<form
										aria-label="Agent run settings"
										onSubmit={(event) => {
											event.preventDefault();
											void saveRunSettings();
										}}
									>
										<fieldset
											disabled={
												runSettingsSave.status ===
												SettingsOperationStatus.Running
											}
										>
											<legend className="sr-only">
												Workspace agent run settings
											</legend>
											<SettingsSectionHeading
												title="Workspace coordination defaults"
												description="Each runtime owns its model and reasoning settings. Commonspace reflects native setup and only controls workspace routing fan-out and shared-context memory here."
											/>
											<div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
												<label>
													<span className="text-xs font-semibold text-muted-foreground">
														Max agents per turn
													</span>
													<input
														aria-label="Default max agents"
														type="number"
														min="1"
														max="8"
														value={defaultMaxAgents}
														onChange={(event) => {
															setDefaultMaxAgents(Number(event.target.value));
															setRunSettingsSave({
																status: SettingsOperationStatus.Idle,
															});
														}}
													/>
												</label>
												<label>
													<span className="text-xs font-semibold text-muted-foreground">
														Memory thread window
													</span>
													<input
														aria-label="Default memory threads"
														type="number"
														min="1"
														max="50"
														value={defaultMemoryThreads}
														onChange={(event) => {
															setDefaultMemoryThreads(
																Number(event.target.value),
															);
															setRunSettingsSave({
																status: SettingsOperationStatus.Idle,
															});
														}}
													/>
												</label>
											</div>
										</fieldset>
										<div className="mt-3 flex items-center gap-3">
											<button
												type="submit"
												disabled={
													runSettingsSave.status ===
													SettingsOperationStatus.Running
												}
											>
												{" "}
												{runSettingsSave.status ===
												SettingsOperationStatus.Running
													? "Saving run settings…"
													: "Save agent run settings"}
											</button>
											{runSettingsSave.status ===
												SettingsOperationStatus.Succeeded && (
												<p role="status">Agent run settings saved.</p>
											)}
											{runSettingsSave.status ===
												SettingsOperationStatus.Failed && (
												<p role="alert">{runSettingsSave.message}</p>
											)}
										</div>
									</form>
								),
								notifications: (
									<fieldset className="mt-8 border-t pt-8">
										<legend className="sr-only">OS notifications</legend>
										<SettingsSectionHeading
											title="OS notifications"
											description="Choose which durable Inbox events also appear as native alerts on this Mac."
										/>
										<div className="overflow-hidden rounded-md border bg-card">
											<div className="flex min-h-[80px] items-center justify-between gap-6 bg-muted/20 px-4 py-3">
												<div>
													<strong className="block text-sm">
														Allow native notifications
													</strong>
													<p className="mt-1 text-xs leading-5 text-muted-foreground">
														Show selected Inbox events as macOS alerts. Inbox
														delivery is always preserved.
													</p>
												</div>
												<SettingsSwitch
													label="Allow native notifications"
													disabled={savingNotifications}
													checked={notificationSettings.enabled}
													onCheckedChange={(enabled) => {
														setNotificationSave({
															status: SettingsOperationStatus.Idle,
														});
														setNotificationSettings((current) => ({
															...current,
															enabled,
														}));
													}}
												/>
											</div>
											{NOTIFICATION_OPTIONS.map(
												([key, label, description, ariaLabel]) => (
													<div
														key={key}
														className={cn(
															"flex min-h-[68px] items-center justify-between gap-6 border-t px-4 py-3 transition-colors",
															!notificationSettings.enabled && "bg-muted/20",
														)}
													>
														<div>
															<strong className="block text-sm">{label}</strong>
															<p className="mt-1 text-xs leading-5 text-muted-foreground">
																{description}
															</p>
														</div>
														<SettingsSwitch
															label={ariaLabel}
															disabled={
																savingNotifications ||
																!notificationSettings.enabled
															}
															checked={notificationSettings[key]}
															onCheckedChange={(checked) => {
																setNotificationSave({
																	status: SettingsOperationStatus.Idle,
																});
																setNotificationSettings((current) => ({
																	...current,
																	[key]: checked,
																}));
															}}
														/>
													</div>
												),
											)}
										</div>
										<div className="mt-4 flex min-h-11 items-center justify-between gap-4 max-[640px]:items-start">
											<p
												className={cn(
													"text-xs",
													notificationSaveError !== null ||
														notificationVerification?.status === "failed"
														? "text-destructive"
														: "text-[var(--status-success)]",
												)}
												role={
													notificationSaveError === null ? "status" : "alert"
												}
												aria-live="polite"
											>
												{notificationSaveError ??
													notificationVerification?.message ??
													(notificationsSaved
														? "Notification settings saved."
														: "")}
											</p>
											<div className="flex shrink-0 gap-2 max-[640px]:flex-col">
												<button
													type="button"
													disabled={verifyingNotifications}
													onClick={() => {
														void verifyNotifications();
													}}
												>
													{verifyingNotifications
														? "Sending test…"
														: "Send test notification"}
												</button>
												<button
													type="button"
													aria-label="Save notification settings"
													disabled={savingNotifications}
													className="border-primary bg-primary font-semibold text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] disabled:cursor-wait disabled:opacity-60"
													onClick={() => {
														void saveNotifications();
													}}
												>
													{savingNotifications
														? "Saving…"
														: "Save notifications"}
												</button>
											</div>
										</div>
									</fieldset>
								),
								diagnostics: (
									<section
										className="mt-8 border-t pt-8"
										aria-label="Runtime diagnostics"
									>
										<SettingsSectionHeading
											title="Runtime diagnostics"
											description="Check the local services and connections Commonspace needs to run agents."
										/>
										<div className="overflow-hidden rounded-md border bg-card">
											<div className="flex items-center justify-between gap-6 px-4 py-4 max-[640px]:grid">
												<div>
													<strong className="text-sm">System readiness</strong>
													<p className="mt-1 text-xs leading-5 text-muted-foreground">
														Inspect installed harnesses, storage, and inference
														data flow.
													</p>
												</div>
												<button
													type="button"
													className="shrink-0"
													aria-label="Run runtime diagnostics"
													disabled={diagnosticsLoading}
													onClick={() => {
														void runDiagnostics();
													}}
												>
													{diagnosticsLoading ? "Checking…" : "Run diagnostics"}
												</button>
											</div>
											{diagnostics !== null && (
												<div className="grid gap-4 border-t px-4 py-4 text-xs">
													<div>
														<strong className="text-sm">
															{diagnostics.inference.location ===
															"runtime-managed"
																? "Selected harness controls model traffic"
																: "Inference not configured"}
														</strong>
														<p className="mt-1 text-muted-foreground">
															{diagnostics.inference.provider} ·{" "}
															{diagnostics.inference.configured
																? "configured"
																: "needs configuration"}
														</p>
														<p className="mt-1 text-muted-foreground">
															Sends {diagnostics.inference.sends.join(" · ")}
														</p>
													</div>
													<ul className="grid gap-2">
														{diagnostics.harnesses.map((harness) => (
															<li
																key={harness.adapter}
																className="rounded-sm border bg-muted/40 px-3 py-2"
															>
																<strong>{runtimeLabel(harness.adapter)}</strong>
																<span className="ml-2 text-muted-foreground">
																	{harness.installed
																		? "Installed"
																		: "Not installed"}{" "}
																	· {harness.rostered ? "Added" : "Not added"} ·{" "}
																	{
																		{
																			"has-replies": "Recorded replies",
																			"no-recorded-runs": "No recorded runs",
																			"has-failures": "Recorded failures",
																		}[harness.recordedRunStatus]
																	}
																</span>
																<small className="mt-1 block text-muted-foreground">
																	{harness.recovery}
																</small>
															</li>
														))}
													</ul>
												</div>
											)}
										</div>
									</section>
								),
								data: (
									<section
										className="mt-8 border-t pt-8"
										aria-label="Workspace data management"
									>
										<SettingsSectionHeading
											title="Workspace data"
											description="Move local Commonspace data or selectively remove conversation history."
										/>
										<div className="overflow-hidden rounded-md border bg-card">
											<div className="flex items-center justify-between gap-6 px-4 py-4 max-[640px]:grid">
												<div>
													<strong className="text-sm">Export workspace</strong>
													<p className="mt-1 text-xs leading-5 text-muted-foreground">
														Download a portable JSON archive of workspace data.
													</p>
												</div>
												<button
													type="button"
													className="shrink-0"
													aria-label="Export workspace data"
													onClick={() => {
														void exportWorkspace();
													}}
												>
													Export
												</button>
											</div>
											<label className="border-t px-4 py-4">
												<strong className="text-sm">Import archive</strong>
												<span className="text-xs leading-5 text-muted-foreground">
													Restore data from a Commonspace JSON export.
												</span>
												<input
													className="mt-2 cursor-pointer text-xs text-muted-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs file:font-semibold file:text-foreground"
													type="file"
													accept="application/json,.json"
													aria-label="Import workspace archive"
													onChange={(event) => {
														selectImportArchive(event.target.files?.[0]);
														event.target.value = "";
													}}
												/>
											</label>
										</div>
										{importArchive !== null && (
											<section aria-label="Import Project mappings">
												<p>
													Map every exported Project root to a local folder.
													Import works only in an empty workspace.
												</p>
												{importArchive.projects.map((project) => (
													<fieldset key={project.id}>
														<legend>{project.name}</legend>
														{Array.from(
															{ length: project.rootCount },
															(_, rootIndex) => ({
																key: `${project.id}:root:${String(rootIndex)}`,
																rootIndex,
															}),
														).map(({ key, rootIndex }) => (
															<div key={key}>
																<span>
																	{importMappings[project.id]?.[rootIndex] ||
																		`Root ${String(rootIndex + 1)} not mapped`}
																</span>
																<button
																	type="button"
																	aria-label={`Choose root ${String(rootIndex + 1)} for ${project.name}`}
																	onClick={() => {
																		void chooseImportRoot(
																			project.id,
																			rootIndex,
																		);
																	}}
																>
																	Choose
																</button>
															</div>
														))}
													</fieldset>
												))}
												<button
													type="button"
													aria-label="Import workspace data"
													disabled={
														importingWorkspace ||
														Object.values(importMappings).some((paths) =>
															paths.some((path) => path === ""),
														)
													}
													onClick={() => {
														void importWorkspace();
													}}
												>
													{importingWorkspace
														? "Importing…"
														: "Import workspace"}
												</button>
											</section>
										)}
										<ConversationRetention
											store={store}
											channels={channels}
											agents={agents}
										/>
									</section>
								),
							}}
						/>
					</section>,
					document.body,
				)}

			<nav
				className="grid gap-1 px-3 pt-5 pb-2"
				aria-label="Workspace destinations"
			>
				<NavigationItem
					type="button"
					className="pr-9"
					aria-label={`Open Inbox${inboxUnreadCount === 0 ? "" : `, ${String(inboxUnreadCount)} unread`}`}
					aria-pressed={inboxActive}
					onClick={() => {
						setSettingsOpen(false);
						onOpenInbox?.();
					}}
				>
					<span
						className="grid size-5 place-items-center rounded-sm text-sidebar-foreground/50"
						aria-hidden="true"
					>
						<InboxIcon className="size-[15px]" />
					</span>
					<span className="text-sm font-medium">Inbox</span>
					{inboxUnreadCount > 0 && <UnreadCount count={inboxUnreadCount} />}
				</NavigationItem>
				<NavigationItem
					type="button"
					className="pr-9"
					aria-label={`Open Threads${threadUnreadCount === 0 ? "" : `, ${String(threadUnreadCount)} unread`}`}
					aria-pressed={threadsActive}
					onClick={() => {
						setSettingsOpen(false);
						onOpenThreads?.();
					}}
				>
					<span
						className="grid size-5 place-items-center rounded-sm text-sidebar-foreground/50"
						aria-hidden="true"
					>
						<MessagesSquareIcon className="size-[15px]" />
					</span>
					<span className="text-sm font-medium">Threads</span>
					{threadUnreadCount > 0 && <UnreadCount count={threadUnreadCount} />}
				</NavigationItem>
			</nav>

			<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)_transparent] [scrollbar-width:thin]">
				<NavigationSection
					title="Channels"
					onNavigate={
						onOpenDirectory === undefined
							? undefined
							: () => onOpenDirectory("channels")
					}
					actions={
						channels.length > 1 && (
							<SidebarSortControl
								kind="channel"
								mode={preferences.sortModes.channel}
								onModeChange={(mode) => {
									setCollectionSortMode(
										"channel",
										mode,
										[
											...channelSections.pinned,
											...channelSections.unpinned,
										].map((channel) => channel.id),
									);
								}}
							/>
						)
					}
					open={!preferences.collapsedSections.includes("channel")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("channel", !open);
					}}
					onAdd={() => {
						openCreation("channel");
					}}
				>
					{form === "channel" && (
						<SidebarDialog
							title="Add a channel"
							description="Create a shared room for many independent conversations."
							onClose={() => {
								setForm(null);
							}}
						>
							<form
								className="grid gap-3 [&_button:not([data-slot])]:min-h-9 [&_button:not([data-slot])]:rounded-sm [&_button:not([data-slot])]:border [&_button:not([data-slot])]:px-3 [&>fieldset]:grid [&>fieldset]:gap-2 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
								onSubmit={(event) => {
									void submit(event);
								}}
							>
								<label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
									Channel name
									<input
										aria-label="Channel name"
										placeholder="channel-name"
										value={name}
										required
										onChange={(event) => {
											setName(event.target.value);
											setFormError(null);
										}}
									/>
								</label>
								<fieldset className="min-w-0 border-0 p-0">
									<legend className="px-1 font-heading text-sm font-bold">
										Agents
									</legend>
									<div className="mb-3 flex items-start justify-between gap-4">
										<p className="text-xs text-muted-foreground">
											Add agents who should be available in this channel.
										</p>
										<span className="shrink-0 font-mono text-xs text-muted-foreground">
											{String(agentIds.length)} selected
										</span>
									</div>
									<input
										type="search"
										aria-label="Search available agents"
										placeholder="Search name, role, or harness"
										value={channelAgentQuery}
										onChange={(event) => {
											setChannelAgentQuery(event.target.value);
										}}
									/>
									<fieldset
										className="mt-2 flex gap-1 border-0 p-0"
										aria-label="Filter available agents"
									>
										{(["all", "selected"] as const).map((value) => (
											<Button
												key={value}
												type="button"
												variant="filter"
												size="compact"
												className="capitalize"
												aria-pressed={channelAgentFilter === value}
												onClick={() => {
													setChannelAgentFilter(value);
												}}
											>
												{value}
											</Button>
										))}
									</fieldset>
									<div className="mt-2 max-h-[260px] overflow-y-auto">
										{availableChannelAgents.map((agent) => (
											<label
												className="grid min-h-[58px] grid-cols-[18px_36px_minmax(0,1fr)] items-center gap-3 border-b py-2 last:border-b-0"
												key={agent.id}
											>
												<input
													type="checkbox"
													checked={agentIds.includes(agent.id)}
													onChange={(event) => {
														setAgentIds((current) =>
															event.target.checked
																? [...current, agent.id]
																: current.filter((id) => id !== agent.id),
														);
													}}
												/>
												<AgentAvatar agent={agent} />
												<span>
													<strong className="block text-sm text-foreground">
														{agent.displayName}
													</strong>
													<small className="block text-xs font-normal text-muted-foreground">
														{runtimeLabel(agent.adapter)} ·{" "}
														{agent.model ?? "harness default"}
													</small>
												</span>
											</label>
										))}
										{availableChannelAgents.length === 0 && (
											<p className="p-4 text-center text-xs text-muted-foreground">
												No matching agents.
											</p>
										)}
									</div>
								</fieldset>
								<div className="mt-2 flex justify-end gap-2 border-t pt-3">
									<FormError message={formError} />
									<button
										type="button"
										onClick={() => {
											setForm(null);
										}}
									>
										Cancel
									</button>
									<button
										type="submit"
										className="border-primary bg-primary text-primary-foreground"
									>
										Create channel
									</button>
								</div>
							</form>
						</SidebarDialog>
					)}

					{channelItems.map((channel) => {
						const unreadCount = channelUnreadCounts.get(channel.id) ?? 0;
						const latestChannelMessage = latestChannelMessageById.get(
							channel.id,
						);
						const channelPins = channelPinsById.get(channel.id) ?? [];
						const dropPosition = collectionDropPosition("channel", channel.id);
						return (
							<div
								key={channel.id}
								{...sortableCollectionDropTargetProps("channel", channel.id)}
								data-sidebar-collection-item={collectionKey(
									"channel",
									channel.id,
								)}
								data-drop-position={dropPosition ?? undefined}
								className={cn(
									"grid gap-0.5",
									collectionDropIndicatorClassName(dropPosition),
									collectionDragState !== null &&
										collectionDragState.kind === "channel" &&
										collectionDragState.sourceId === channel.id &&
										"rounded-md bg-sidebar-accent/70",
								)}
							>
								<NavigationItemGroup>
									<NavigationItem
										type="button"
										{...sortableCollectionButtonProps("channel", channel.id)}
										className={cn(
											"",
											preferences.sortModes.channel === "custom" &&
												"cursor-grab active:cursor-grabbing",
										)}
										aria-label={`Open channel ${channel.name}${unreadCount === 0 ? "" : `, ${String(unreadCount)} unread`}`}
										aria-pressed={
											conversationActive &&
											activeProjectViewId === null &&
											snapshot.activeConversation?.kind === "channel" &&
											snapshot.activeConversation.id === channel.id
										}
										onClick={() => {
											setSettingsOpen(false);
											touchRecent("channel", channel.id);
											const conversation = {
												kind: "channel",
												id: channel.id,
											} as const;
											store.selectConversation(conversation);
											onOpenConversation?.(conversation);
										}}
									>
										<span
											className={cn(
												"grid size-5 place-items-center rounded-sm font-mono text-base text-sidebar-foreground/55",
												preferences.sortModes.channel === "custom" &&
													"group-hover:opacity-0 group-focus-within:opacity-0",
											)}
											aria-hidden="true"
										>
											{"#"}
										</span>
										<span className="min-w-0">
											<strong
												className={cn(
													"block truncate text-sm",
													unreadCount > 0 ? "font-semibold" : "font-medium",
												)}
											>
												{channel.name}
											</strong>
											<small className="hidden">
												{channel.agentIds.length} agent
												{channel.agentIds.length === 1 ? "" : "s"}
											</small>
										</span>
										{unreadCount > 0 && <UnreadCount count={unreadCount} />}
										{preferences.sortModes.channel === "custom" && (
											<GripVerticalIcon
												aria-hidden="true"
												className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-sidebar-foreground/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
											/>
										)}
									</NavigationItem>
									{onOpenContextSettings === undefined ? (
										<CollectionActionButton
											label={`Manage agents in channel ${channel.name}`}
											onClick={() => {
												setEditingChannelId(channel.id);
												setChannelAgentIds(channel.agentIds);
												setChannelInstructions(channel.instructions);
												setChannelSummary(channel.memory.summary);
												setChannelDecisions(
													channel.memory.decisions.join("\n"),
												);
												setChannelQuestions(
													channel.memory.openQuestions.join("\n"),
												);
												setChannelPinNote("");
											}}
										/>
									) : (
										<CollectionActionMenu
											kind="channel"
											label={channel.name}
											meta={`${String(channel.agentIds.length)} ${channel.agentIds.length === 1 ? "agent" : "agents"}`}
											pinned={collectionPinned("channel", channel.id)}
											unread={unreadCount > 0}
											onOpen={() => {
												setSettingsOpen(false);
												touchRecent("channel", channel.id);
												const conversation = {
													kind: "channel",
													id: channel.id,
												} as const;
												store.selectConversation(conversation);
												onOpenConversation?.(conversation);
											}}
											onSettings={() => {
												onOpenContextSettings("channel", channel.id);
											}}
											onMarkRead={() => {
												for (const item of inboxItems) {
													if (
														item.unread &&
														item.conversation.kind === "channel" &&
														item.conversation.id === channel.id
													) {
														void store.mutate({
															action: "mark-inbox-item-read",
															messageId: item.messageId,
														});
													}
												}
											}}
											onMarkUnread={() => {
												if (latestChannelMessage === undefined) return;
												void store.mutate({
													action: "set-inbox-item-unread",
													messageId: latestChannelMessage.id,
													unread: true,
												});
											}}
											onTogglePinned={() => {
												toggleCollectionPinned("channel", channel.id);
											}}
											onRemove={() =>
												store.mutate({
													action: "remove-channel",
													channelId: channel.id,
												})
											}
										/>
									)}
								</NavigationItemGroup>
								{editingChannelId === channel.id && (
									<form
										className="grid gap-3 rounded-md bg-sidebar-deep p-3 text-sidebar-foreground [&_button]:min-h-10 [&_button:not([data-slot])]:rounded-sm [&_button:not([data-slot])]:border [&_button]:px-3 [&_fieldset]:grid [&_fieldset]:gap-2 [&_input]:min-h-10 [&_input]:rounded-sm [&_input]:border [&_input]:bg-background [&_input]:px-3 [&_select]:min-h-10 [&_select]:rounded-sm [&_select]:border [&_select]:bg-background  [&_textarea]:min-h-24 [&_textarea]:rounded-sm [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"
										onSubmit={(event) => {
											void saveChannelAgents(event, channel.id);
										}}
									>
										<fieldset>
											<legend>Channel agents</legend>
											{agents.map((agent) => (
												<label key={agent.id}>
													<input
														type="checkbox"
														checked={channelAgentIds.includes(agent.id)}
														onChange={(event) => {
															setChannelAgentIds((current) =>
																event.target.checked
																	? [...current, agent.id]
																	: current.filter((id) => id !== agent.id),
															);
														}}
													/>
													{agent.displayName}
												</label>
											))}
										</fieldset>
										<label className="grid gap-1.5">
											Channel instructions
											<textarea
												aria-label={`Instructions for channel ${channel.name}`}
												value={channelInstructions}
												onChange={(event) => {
													setChannelInstructions(event.target.value);
												}}
												placeholder="What agents should remember and how they should behave in this channel"
											/>
										</label>
										<section
											className="grid gap-3 rounded-md border border-sidebar-border p-3"
											aria-label={`Channel context for ${channel.name}`}
										>
											<header>
												<strong>Canonical context</strong>
												<span data-status={channel.memory.status ?? "current"}>
													{channel.memory.status ?? "current"}
												</span>
											</header>
											{(
												[
													["Summary", channelSummary, setChannelSummary],
													["Decisions", channelDecisions, setChannelDecisions],
													[
														"Open questions",
														channelQuestions,
														setChannelQuestions,
													],
												] as const
											).map(([label, value, setValue]) => (
												<label key={label} className="grid gap-1.5">
													{label}
													<textarea
														aria-label={`Channel ${label.toLowerCase()} for ${channel.name}`}
														value={value}
														onChange={(event) => {
															setValue(event.target.value);
														}}
													/>
												</label>
											))}
											<button
												type="button"
												aria-label={`Compact context for channel ${channel.name}`}
												disabled={compactingChannelId !== null}
												onClick={() => {
													void compactChannelContext(channel.id);
												}}
											>
												{compactingChannelId === channel.id
													? "Compacting…"
													: "Compact context"}
											</button>
										</section>
										<section
											className="grid gap-2 rounded-md border border-sidebar-border p-3"
											aria-label={`Channel pins for ${channel.name}`}
										>
											<header>
												<strong>Pins</strong>
												<span>{channelPins.length}</span>
											</header>
											{channelPins.map((pin) => {
												const label =
													pin.kind === "note"
														? pin.note
														: pin.kind === "attachment"
															? pin.attachmentId
															: pin.messageId;
												return (
													<div key={pin.id}>
														<p>{label}</p>
														<button
															type="button"
															aria-label={`Remove Channel pin ${label}`}
															onClick={() => {
																void store.removePin(pin.id);
															}}
														>
															Remove
														</button>
													</div>
												);
											})}
											<div>
												<input
													aria-label={`New Channel pin note for ${channel.name}`}
													value={channelPinNote}
													onChange={(event) => {
														setChannelPinNote(event.target.value);
													}}
													placeholder="Pin a Channel note"
												/>
												<button
													type="button"
													aria-label={`Add Channel pin note for ${channel.name}`}
													disabled={channelPinNote.trim() === ""}
													onClick={() => {
														void addChannelPin(channel.id);
													}}
												>
													Pin
												</button>
											</div>
										</section>
										<div>
											<button
												type="submit"
												aria-label={`Save channel ${channel.name}`}
											>
												Save
											</button>
											<button
												type="button"
												onClick={() => {
													setEditingChannelId(null);
												}}
											>
												Cancel
											</button>
										</div>
									</form>
								)}
							</div>
						);
					})}
					{channels.length === 0 && form !== "channel" && (
						<div className="px-2 py-4 text-xs text-muted-foreground">
							Create a channel and seat agents.
						</div>
					)}
					{channels.length > channelItems.length && (
						<BrowseButton
							label="View all"
							ariaLabel="Browse all channels"
							onClick={() => {
								setSettingsOpen(false);
								if (onOpenDirectory !== undefined) onOpenDirectory("channels");
								else if (onOpenSearch === undefined) setSearchOpen(true);
								else onOpenSearch();
							}}
						/>
					)}
				</NavigationSection>

				<NavigationSection
					title="Agents"
					onNavigate={
						onOpenDirectory === undefined
							? undefined
							: () => onOpenDirectory("agents")
					}
					actions={
						agents.length > 1 && (
							<SidebarSortControl
								kind="agent"
								mode={preferences.sortModes.agent}
								onModeChange={(mode) => {
									setCollectionSortMode(
										"agent",
										mode,
										[...agentSections.pinned, ...agentSections.unpinned].map(
											(agent) => agent.id,
										),
									);
								}}
							/>
						)
					}
					open={!preferences.collapsedSections.includes("agent")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("agent", !open);
					}}
					onAdd={() => {
						openCreation("agent");
					}}
				>
					{form === "agent" && (
						<SidebarDialog
							title="Add an agent"
							size={agentAdapter === null ? "compact" : "form"}
							description="Choose an installed coding agent. Credentials stay in its native app."
							onClose={() => {
								setForm(null);
							}}
						>
							<div className="grid gap-2">
								{AGENT_ADAPTER_KINDS.map((adapter) => (
									<button
										key={adapter}
										type="button"
										className="grid min-h-12 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 text-left aria-pressed:bg-selection hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
										aria-label={`Choose ${runtimeLabel(adapter)} harness`}
										aria-pressed={agentAdapter === adapter}
										onClick={() => {
											selectAgentHarness(adapter);
										}}
									>
										<span className="grid size-8 place-items-center rounded-md bg-muted font-mono font-semibold">
											{AGENT_ADAPTERS[adapter].monogram}
										</span>
										<span>
											<strong className="block">{runtimeLabel(adapter)}</strong>
										</span>
										<span className="text-xs text-muted-foreground">
											{agentAdapter === adapter ? "Selected" : null}
										</span>
									</button>
								))}
							</div>
							{agentAdapter !== null && (
								<div className="grid gap-2">
									<strong>{runtimeLabel(agentAdapter)} harness</strong>
									{snapshot.loading && (
										<span>
											Checking for installed {runtimeLabel(agentAdapter)}…
										</span>
									)}
									{!snapshot.loading &&
										availableDiscoveredAgents.length === 0 && (
											<span>
												{runtimeLabel(agentAdapter)} is not available or is
												already added.
											</span>
										)}
									<label className="flex items-start gap-3 rounded-md border bg-muted p-3 text-left">
										<input
											type="checkbox"
											className="mt-0.5 size-4"
											checked={agentFullAccess}
											onChange={(event) => {
												setAgentFullAccess(event.target.checked);
											}}
										/>
										<span>
											<strong className="block text-sm">Full access</strong>
											<small className="block text-xs leading-5 text-muted-foreground">
												Bypass approval prompts for this agent's Commonspace
												runs.
											</small>
										</span>
									</label>
									{availableDiscoveredAgents.map((agent) => (
										<button
											key={agent.id}
											type="button"
											className="grid min-h-14 grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-sm border bg-background px-3 text-left hover:bg-muted"
											aria-label={`Add discovered agent ${agent.displayName}`}
											onClick={() => {
												void store.mutate({
													action: "add-discovered-agent",
													agentId: agent.id,
													adapter: agent.adapter,
													fullAccess: agentFullAccess,
												});
												setForm(null);
											}}
										>
											<AgentAvatar agent={agent} />
											<span>
												<strong className="block">{agent.displayName}</strong>
												<small className="block text-xs text-muted-foreground">
													{runtimeLabel(agent.adapter)} ·{" "}
													{agent.model ?? "default model"}
												</small>
											</span>
										</button>
									))}
								</div>
							)}
							<div className="mt-3 flex justify-end border-t pt-3">
								<button
									type="button"
									className="min-h-11 rounded-sm border px-4"
									onClick={() => {
										setForm(null);
									}}
								>
									Cancel
								</button>
							</div>
						</SidebarDialog>
					)}
					{agentDraft !== null && editingAgent !== undefined && (
						<AgentProfileEditor
							agent={editingAgent}
							draft={agentDraft}
							removable={editingAgentRemovable}
							store={store}
							onDraftChange={(fields) => {
								setAgentDraft((current) =>
									current === null ? null : { ...current, ...fields },
								);
							}}
							onClose={() => {
								setAgentDraft(null);
							}}
						/>
					)}

					{agentItems.map((agent) => {
						const effectiveStatus = activeAgentIds.has(agent.id)
							? "running"
							: agent.status;
						const dropPosition = collectionDropPosition("agent", agent.id);
						return (
							<div
								key={agent.id}
								{...sortableCollectionDropTargetProps("agent", agent.id)}
								data-sidebar-collection-item={collectionKey("agent", agent.id)}
								data-drop-position={dropPosition ?? undefined}
								className={cn(
									"grid gap-0.5",
									collectionDropIndicatorClassName(dropPosition),
									collectionDragState !== null &&
										collectionDragState.kind === "agent" &&
										collectionDragState.sourceId === agent.id &&
										"rounded-md bg-sidebar-accent/70",
								)}
							>
								<NavigationItemGroup>
									<NavigationItem
										type="button"
										{...sortableCollectionButtonProps("agent", agent.id)}
										className={cn(
											"",
											preferences.sortModes.agent === "custom" &&
												"cursor-grab pr-6 active:cursor-grabbing",
										)}
										aria-label={`Message agent ${agent.displayName}`}
										aria-describedby={`agent-${agent.id}-model`}
										aria-pressed={
											conversationActive &&
											activeProjectViewId === null &&
											snapshot.activeConversation?.kind === "dm" &&
											snapshot.activeConversation.id === agent.id
										}
										onClick={() => {
											touchRecent("agent", agent.id);
											startDirectMessage(agent.id);
										}}
									>
										<AgentAvatar
											agent={agent}
											size="sm"
											status={effectiveStatus}
											showStatus={effectiveStatus === "running"}
											statusClassName="border-sidebar"
										/>
										<span className="min-w-0">
											<strong className="block truncate text-sm font-medium">
												{agent.displayName}
											</strong>
											<small
												id={`agent-${agent.id}-model`}
												className="sr-only"
												title={agent.model ?? "Profile default"}
											>
												{agent.model ?? "Profile default"}
											</small>
										</span>
										{preferences.sortModes.agent === "custom" && (
											<GripVerticalIcon
												aria-hidden="true"
												className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-sidebar-foreground/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
											/>
										)}
									</NavigationItem>
									{onOpenContextSettings === undefined ? (
										<CollectionActionButton
											label={`Customize agent ${agent.displayName}`}
											onClick={() => {
												setAgentDraft({
													agentId: agent.id,
													displayName: agent.displayName,
													avatarEmoji: agent.avatarEmoji ?? "",
													accentColor: agent.accentColor ?? "#6d5dfc",
													fullAccess: agent.fullAccess === true,
												});
											}}
										/>
									) : (
										<CollectionActionMenu
											kind="agent"
											label={agent.displayName}
											meta={`${runtimeLabel(agent.adapter)} · ${agentStatusLabel(effectiveStatus)}`}
											pinned={collectionPinned("agent", agent.id)}
											onOpen={() => {
												touchRecent("agent", agent.id);
												startDirectMessage(agent.id);
											}}
											onSettings={() => {
												onOpenContextSettings("agent", agent.id);
											}}
											onStartFreshChat={() => {
												void store
													.mutate({ action: "reset-dm", agentId: agent.id })
													.then(() => {
														startDirectMessage(agent.id);
													});
											}}
											{...(activeMentionChannel !== undefined &&
											onMentionAgent !== undefined
												? {
														onMention: () => onMentionAgent(agent.displayName),
														mentionLabel: `Mention in #${activeMentionChannel.name}`,
													}
												: {})}
											{...(onOpenAgentSessions === undefined
												? {}
												: { onViewSessions: onOpenAgentSessions })}
											onCopy={() => copyText(`@${agent.displayName}`)}
											copyLabel="Copy mention"
											onTogglePinned={() => {
												toggleCollectionPinned("agent", agent.id);
											}}
											onRemove={() =>
												store.mutate({
													action: "remove-agent",
													agentId: agent.id,
												})
											}
										/>
									)}
								</NavigationItemGroup>
							</div>
						);
					})}
					{agents.length > agentItems.length && (
						<BrowseButton
							label="View all"
							ariaLabel="Browse all agents"
							onClick={() => {
								setSettingsOpen(false);
								if (onOpenDirectory !== undefined) onOpenDirectory("agents");
								else if (onOpenSearch === undefined) setSearchOpen(true);
								else onOpenSearch();
							}}
						/>
					)}
				</NavigationSection>

				<NavigationSection
					title="Projects"
					onNavigate={
						onOpenDirectory === undefined
							? undefined
							: () => onOpenDirectory("projects")
					}
					actions={
						projects.length > 1 && (
							<SidebarSortControl
								kind="project"
								mode={preferences.sortModes.project}
								onModeChange={(mode) => {
									setCollectionSortMode(
										"project",
										mode,
										[
											...projectSections.pinned,
											...projectSections.unpinned,
										].map((project) => project.id),
									);
								}}
							/>
						)
					}
					open={!preferences.collapsedSections.includes("project")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("project", !open);
					}}
					onAdd={() => {
						openCreation("project");
					}}
				>
					{form === "project" && (
						<SidebarDialog
							title="Add a project"
							description="Bind conversations to local folders."
							onClose={() => {
								setForm(null);
							}}
						>
							<form
								className="grid gap-3 [&_button:not([data-slot])]:min-h-9 [&_button:not([data-slot])]:rounded-sm [&_button:not([data-slot])]:border [&_button:not([data-slot])]:px-3 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
								onSubmit={(event) => {
									void submit(event);
								}}
							>
								<label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
									Project name
									<input
										aria-label="Project name"
										placeholder="Project name"
										value={name}
										required
										onChange={(event) => {
											setName(event.target.value);
											setFormError(null);
										}}
									/>
								</label>
								<label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
									Local folder
									<span className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
										<input
											aria-label="Project path"
											placeholder="Choose a local folder"
											value={path}
											required
											onChange={(event) => {
												setPath(event.target.value);
												setFormError(null);
											}}
										/>
										<button
											type="button"
											aria-label="Choose project folder"
											disabled={selectingPath}
											onClick={() => {
												void chooseProjectDirectory();
											}}
										>
											{selectingPath ? "Opening…" : "Browse folders"}
										</button>
									</span>
								</label>
								<div className="mt-2 flex items-end justify-end gap-2 border-t pt-3">
									<FormError message={formError} />
									<button
										type="button"
										onClick={() => {
											setForm(null);
										}}
									>
										Cancel
									</button>
									<button
										type="submit"
										disabled={name.trim() === "" || path.trim() === ""}
										className="border-primary bg-primary text-primary-foreground"
									>
										Create project
									</button>
								</div>
							</form>
						</SidebarDialog>
					)}

					{projectItems.map((project) => {
						const active = !settingsOpen && activeProjectViewId === project.id;
						const folderSummary =
							project.paths.length === 1
								? "1 folder · working directory"
								: `${String(project.paths.length)} folders · working + references`;
						const dropPosition = collectionDropPosition("project", project.id);
						return (
							<div
								key={project.id}
								{...sortableCollectionDropTargetProps("project", project.id)}
								data-sidebar-collection-item={collectionKey(
									"project",
									project.id,
								)}
								data-drop-position={dropPosition ?? undefined}
								className={cn(
									"grid gap-0.5",
									collectionDropIndicatorClassName(dropPosition),
									collectionDragState !== null &&
										collectionDragState.kind === "project" &&
										collectionDragState.sourceId === project.id &&
										"rounded-md bg-sidebar-accent/70",
								)}
							>
								<NavigationItemGroup>
									<NavigationItem
										type="button"
										{...sortableCollectionButtonProps("project", project.id)}
										className={cn(
											"",
											preferences.sortModes.project === "custom" &&
												"cursor-grab pr-6 active:cursor-grabbing",
										)}
										aria-label={`Select project ${project.name}`}
										aria-pressed={active}
										onClick={() => {
											setSettingsOpen(false);
											touchRecent("project", project.id);
											store.selectProject(project.id);
											onOpenProject?.(project.id);
										}}
									>
										<span
											className="grid size-5 place-items-center rounded-sm font-mono text-xs text-sidebar-foreground/55"
											aria-hidden="true"
										>
											<FolderIcon className="size-[18px]" aria-hidden="true" />
										</span>
										<span className="min-w-0">
											<strong className="block truncate text-sm font-medium">
												{project.name}
											</strong>
											<small className="hidden">{folderSummary}</small>
										</span>
										{preferences.sortModes.project === "custom" && (
											<GripVerticalIcon
												aria-hidden="true"
												className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-sidebar-foreground/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
											/>
										)}
									</NavigationItem>
									{onOpenContextSettings === undefined ? (
										<CollectionActionButton
											label={`Add local folder to project ${project.name}`}
											onClick={() => {
												touchRecent("project", project.id);
												store.selectProject(project.id);
												setPathProjectId(project.id);
												setPathDraft("");
											}}
										/>
									) : (
										<CollectionActionMenu
											kind="project"
											label={project.name}
											meta={folderSummary}
											pinned={collectionPinned("project", project.id)}
											onOpen={() => {
												setSettingsOpen(false);
												touchRecent("project", project.id);
												store.selectProject(project.id);
												onOpenProject?.(project.id);
											}}
											onSettings={() => {
												onOpenContextSettings("project", project.id);
											}}
											onAddFolder={() => {
												void addProjectFolder(project.id);
											}}
											onCopy={() => copyText(project.name)}
											copyLabel="Copy project name"
											onTogglePinned={() => {
												toggleCollectionPinned("project", project.id);
											}}
											onRemove={() =>
												store.mutate({
													action: "remove-project",
													projectId: project.id,
												})
											}
										/>
									)}
								</NavigationItemGroup>

								{pathProjectId === project.id && (
									<div className="p-2">
										<form
											className="grid gap-2 [&_button]:min-h-10 [&_button:not([data-slot])]:rounded-sm [&_button:not([data-slot])]:border [&_button]:px-3 [&_input]:min-h-10 [&_input]:rounded-sm [&_input]:border [&_input]:px-3"
											onSubmit={(event) => {
												void submitPath(event, project.id);
											}}
										>
											<input
												aria-label={`Workspace path for ${project.name}`}
												placeholder="/absolute/local/path"
												value={pathDraft}
												onChange={(event) => {
													setPathDraft(event.target.value);
												}}
											/>
											<div>
												<button type="submit">Add</button>
												<button
													type="button"
													onClick={() => {
														setPathProjectId(null);
													}}
												>
													Cancel
												</button>
											</div>
										</form>
									</div>
								)}
							</div>
						);
					})}
					{projects.length === 0 && form !== "project" && (
						<div className="px-2 py-4 text-xs text-muted-foreground">
							Add a local filesystem project.
						</div>
					)}
					{projects.length > projectItems.length && (
						<BrowseButton
							label="View all"
							ariaLabel="Browse all projects"
							onClick={() => {
								setSettingsOpen(false);
								if (onOpenDirectory !== undefined) onOpenDirectory("projects");
								else if (onOpenSearch === undefined) setSearchOpen(true);
								else onOpenSearch();
							}}
						/>
					)}
				</NavigationSection>
			</div>
			<div className="flex min-h-[64px] items-center gap-1.5 bg-sidebar py-2 pr-2.5 pl-[18px]">
				<button
					type="button"
					className="grid size-11 place-items-center rounded-full border-0 bg-transparent text-sidebar-foreground/80 hover:text-sidebar-foreground"
					aria-label="Refresh Commonspace"
					onClick={() => {
						void store.refresh();
					}}
				>
					<RefreshCwIcon className="size-[18px]" aria-hidden="true" />
				</button>
				<button
					type="button"
					className="order-first flex min-h-9 flex-1 items-center gap-3 rounded-md border-0 bg-transparent px-2 text-sm text-muted-foreground hover:text-sidebar-foreground aria-[current=page]:bg-selection"
					aria-label="Commonspace settings"
					ref={settingsTriggerRef}
					aria-current={settingsOpen ? "page" : undefined}
					onClick={() => {
						const defaults = state?.defaults;
						if (
							defaults !== undefined &&
							runSettingsSave.status !== SettingsOperationStatus.Running
						) {
							setRunSettingsSave({ status: SettingsOperationStatus.Idle });
							setDefaultMaxAgents(defaults.maxAgentsPerTurn);
							setDefaultMemoryThreads(defaults.memoryThreads);
						}
						if (!savingInference) {
							const routing = bootstrap?.routing;
							setRoutingHarnessAgentId(
								routing?.provider === CommonspaceRoutingProvider.Harness
									? routing.harnessAgentId
									: "",
							);
							setInferenceSave({ status: SettingsOperationStatus.Idle });
						}
						if (!savingNotifications) {
							setNotificationSave({ status: SettingsOperationStatus.Idle });
							setNotificationSettings({
								...(state?.notifications ??
									DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS),
							});
						}

						setSettingsOpen((value) => !value);
					}}
				>
					<SettingsIcon className="size-[18px]" aria-hidden="true" />
					<span>Settings</span>
				</button>
			</div>
		</section>
	);
}
