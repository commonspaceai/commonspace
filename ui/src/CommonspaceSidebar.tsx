import {
	AGENT_ADAPTER_KINDS,
	AGENT_ADAPTERS,
	type AgentAdapterKind,
	type CommonspaceAgentProfile,
	type CommonspaceDiagnostics,
	type CommonspaceMutation,
	type CommonspaceNotificationSettings,
	type CommonspaceNotificationVerification,
	type CommonspaceReasoning,
	type CommonspaceRetentionPreview,
	type CommonspaceRoutingProvider,
	type CommonspaceSearchResult,
	type ConversationRef,
	DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
	deriveCommonspaceInboxItems,
	type UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import {
	ArrowRightIcon,
	CheckIcon,
	ChevronDownIcon,
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
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	CollectionActionButton,
	CollectionActionMenu,
	type CommonspaceCollectionKind,
} from "@/design-system/CollectionActionMenu";
import { CommonspaceLogo } from "@/design-system/CommonspaceLogo";
import { SidebarSortControl } from "@/design-system/SidebarSortControl";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { cn } from "@/lib/utils";
import type { CommonspaceDirectoryKind } from "./CommonspaceDirectory.tsx";
import { CommonspaceSearchDialog } from "./CommonspaceSearch.tsx";
import {
	type ChannelSortMode,
	moveChannelAfter,
	moveChannelBefore,
	sortChannelSections,
	sortSidebarSections,
} from "./channel-sorting.ts";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";
import { folderName } from "./project-files-api.ts";
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

const reasoningValues: ReadonlySet<string> = new Set([
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function isReasoning(value: string): value is CommonspaceReasoning {
	return reasoningValues.has(value);
}

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

function Section(props: {
	title: string;
	count: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd?: () => void;
	actions?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="mt-3 first:mt-1">
			<div className="flex items-center">
				<button
					type="button"
					className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 text-left text-xs font-semibold text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
					aria-expanded={props.open}
					onClick={() => {
						props.onOpenChange(!props.open);
					}}
				>
					<ChevronDownIcon
						className={`size-4 transition-transform ${props.open ? "" : "-rotate-90"}`}
						aria-hidden="true"
					/>
					<span>{props.title}</span>
					<span className="ml-auto font-mono text-[11px] font-normal tabular-nums text-sidebar-foreground/45">
						{props.count}
					</span>
				</button>
				{props.actions}
				{props.onAdd !== undefined && (
					<button
						type="button"
						className="grid size-7 place-items-center rounded-sm border-0 bg-transparent text-lg text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
						aria-label={`Add ${props.title.slice(0, -1).toLowerCase()}`}
						onClick={props.onAdd}
					>
						+
					</button>
				)}
			</div>
			{props.open && (
				<div className="grid gap-0.5 pt-0.5">{props.children}</div>
			)}
		</section>
	);
}

function NavGroupLabel({ label, count }: { label: string; count?: number }) {
	return (
		<p className="mt-1 mr-2 mb-0.5 ml-[30px] flex min-h-5 items-center gap-1.5 px-1 text-[10px] font-semibold tracking-[0.07em] text-sidebar-foreground uppercase">
			<span>{label}</span>
			{count !== undefined && (
				<>
					<span
						className="h-px min-w-2 flex-1 bg-sidebar-border/70"
						aria-hidden="true"
					/>
					<span className="font-mono font-normal tracking-normal tabular-nums">
						{count}
					</span>
				</>
			)}
		</p>
	);
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
			className="mt-0.5 flex min-h-8 w-full items-center justify-between gap-2 rounded-sm border-0 border-t-0 bg-transparent px-2 py-0 text-left text-[11px] font-medium text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
		<div className="mb-5 border-b border-border/70 pb-4">
			<h2 className="font-heading text-[17px] font-bold tracking-[-0.01em]">
				{title}
			</h2>
			<p className="mt-1 text-xs text-muted-foreground">{description}</p>
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

function SettingsCheckbox({
	checked,
	label,
	onCheckedChange,
}: {
	checked: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<label className="!grid size-11 shrink-0 cursor-pointer place-items-center">
			<input
				type="checkbox"
				className="peer sr-only"
				checked={checked}
				aria-label={label}
				onChange={(event) => {
					onCheckedChange(event.target.checked);
				}}
			/>
			<span
				className="grid size-5 place-items-center rounded-sm border border-border bg-background text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
				aria-hidden="true"
			>
				<CheckIcon className="size-3.5" />
			</span>
		</label>
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
	onClose,
	children,
}: {
	title: string;
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
				className="top-[10vh] max-h-[80vh] -translate-y-0 sm:max-w-[640px]"
			>
				<DialogHeader className="border-b px-[18px] py-4">
					<DialogTitle>{title}</DialogTitle>
					{description === undefined ? null : (
						<DialogDescription>{description}</DialogDescription>
					)}
				</DialogHeader>
				<div className="min-h-0 overflow-y-auto p-[18px]">{children}</div>
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
	const [formError, setFormError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [path, setPath] = useState("");
	const [selectingPath, setSelectingPath] = useState(false);
	const [pathProjectId, setPathProjectId] = useState<string | null>(null);
	const [pathDraft, setPathDraft] = useState("");
	const [agentIds, setAgentIds] = useState<string[]>([]);
	const [channelAgentQuery, setChannelAgentQuery] = useState("");
	const [draggedCollectionItem, setDraggedCollectionItem] = useState<{
		kind: SidebarCollectionKind;
		id: string;
	} | null>(null);
	const [channelAgentFilter, setChannelAgentFilter] = useState<
		"all" | "selected"
	>("all");
	const [agentAdapter, setAgentAdapter] = useState<AgentAdapterKind | null>(
		null,
	);
	const [agentFullAccess, setAgentFullAccess] = useState(false);
	const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
	const [agentProfileName, setAgentProfileName] = useState("");
	const [agentAvatarEmoji, setAgentAvatarEmoji] = useState("");
	const [agentAccentColor, setAgentAccentColor] = useState("#6d5dfc");
	const [agentProfileFullAccess, setAgentProfileFullAccess] = useState(false);
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
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const settingsPanelRef = useRef<HTMLFormElement>(null);
	const settingsTriggerRef = useRef<HTMLButtonElement>(null);
	const settingsCloseRef = useRef<HTMLButtonElement>(null);
	const [defaultModel, setDefaultModel] = useState("");
	const [defaultReasoning, setDefaultReasoning] =
		useState<CommonspaceReasoning>("max");
	const [defaultMaxAgents, setDefaultMaxAgents] = useState(4);
	const [defaultMemoryThreads, setDefaultMemoryThreads] = useState(12);
	const [routingProvider, setRoutingProvider] =
		useState<CommonspaceRoutingProvider>("openai-compatible");
	const [routingHarnessAgentId, setRoutingHarnessAgentId] = useState("");
	const [routingModel, setRoutingModel] = useState("");
	const [routingBaseUrl, setRoutingBaseUrl] = useState(
		"https://api.openai.com/v1",
	);
	const [routingApiKey, setRoutingApiKey] = useState("");
	const [jevEnabled, setJevEnabled] = useState(false);
	const [jevModel, setJevModel] = useState("jev-1.13.0");
	const [jevApiKey, setJevApiKey] = useState("");
	const [clearJevApiKey, setClearJevApiKey] = useState(false);
	const [clearRoutingApiKey, setClearRoutingApiKey] = useState(false);
	const [savingInference, setSavingInference] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [diagnostics, setDiagnostics] = useState<CommonspaceDiagnostics | null>(
		null,
	);
	const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
	const [inferenceChecking, setInferenceChecking] = useState(false);
	const [inferenceCheckStatus, setInferenceCheckStatus] = useState<
		string | null
	>(null);
	const [importArchive, setImportArchive] =
		useState<WorkspaceImportCandidate | null>(null);
	const [importMappings, setImportMappings] = useState<
		Record<string, string[]>
	>({});
	const [importingWorkspace, setImportingWorkspace] = useState(false);
	const [retentionConversation, setRetentionConversation] = useState("");
	const [retentionPreview, setRetentionPreview] =
		useState<CommonspaceRetentionPreview | null>(null);
	const [notificationSettings, setNotificationSettings] =
		useState<CommonspaceNotificationSettings>({
			...DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
		});
	const [savingNotifications, setSavingNotifications] = useState(false);
	const [notificationsSaved, setNotificationsSaved] = useState(false);
	const [notificationSaveError, setNotificationSaveError] = useState<
		string | null
	>(null);
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
	useEffect(() => {
		if (form !== null) setSettingsOpen(false);
	}, [form]);
	useEffect(() => {
		if (createRequest === null) return;
		setForm(createRequest.kind);
		setFormError(null);
		setName("");
		if (createRequest.kind === "project") setPath("");
		if (createRequest.kind === "channel") {
			setAgentIds([]);
			setChannelAgentQuery("");
			setChannelAgentFilter("all");
		}
		if (createRequest.kind === "agent") {
			setAgentAdapter(null);
			setAgentFullAccess(false);
		}
	}, [createRequest]);
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
	const inboxItems = useMemo(
		() => (state === undefined ? [] : deriveCommonspaceInboxItems(state)),
		[state],
	);
	const inboxUnreadCount = inboxItems.filter((item) => item.unread).length;
	const threadUnreadCount = new Set(
		inboxItems
			.filter((item) => item.unread && item.threadId !== undefined)
			.map((item) => item.threadId),
	).size;
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
	const models = useMemo(
		() => [
			...new Set(
				agents
					.map((agent) => agent.model)
					.filter((model): model is string => model !== null && model !== ""),
			),
		],
		[agents],
	);
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
	const pinnedIds = (kind: SidebarCollectionKind) =>
		new Set(
			effectivePinnedKeys
				.filter((key) => key.startsWith(`${kind}:`))
				.map((key) => key.slice(kind.length + 1)),
		);
	const recentIds = (kind: SidebarCollectionKind, ids: readonly string[]) => [
		...preferences.recentKeys[kind].map((key) => key.slice(kind.length + 1)),
		...ids,
	];
	const projectPinnedIds = pinnedIds("project");
	const projectSections = sortSidebarSections({
		items: projects,
		pinnedIds: projectPinnedIds,
		mode: preferences.sortModes.project,
		customOrder: preferences.customOrders.project.map((key) =>
			key.slice("project:".length),
		),
		recentOrder: recentIds(
			"project",
			projects.map((project) => project.id),
		),
		getName: (project) => project.name,
	});
	const projectItems = {
		items: [
			...projectSections.pinned,
			...projectSections.unpinned.slice(0, 10),
		],
		pinnedCount: projectSections.pinned.length,
	};
	const channelPinnedIds = pinnedIds("channel");
	const channelLastActiveAt = new Map(
		channels.map((channel) => {
			const latestMessage = state?.messages[`channel:${channel.id}`]?.at(-1);
			return [
				channel.id,
				latestMessage?.createdAt ?? channel.createdAt,
			] as const;
		}),
	);
	const channelSections = sortChannelSections({
		channels,
		pinnedIds: channelPinnedIds,
		mode: preferences.sortModes.channel,
		customOrder: preferences.customOrders.channel.map((key) =>
			key.slice("channel:".length),
		),
		lastActiveAt: channelLastActiveAt,
	});
	const channelItems = {
		items: [
			...channelSections.pinned,
			...channelSections.unpinned.slice(0, 10),
		],
		pinnedCount: channelSections.pinned.length,
	};
	const agentPinnedIds = pinnedIds("agent");
	const agentSections = sortSidebarSections({
		items: agents,
		pinnedIds: agentPinnedIds,
		mode: preferences.sortModes.agent,
		customOrder: preferences.customOrders.agent.map((key) =>
			key.slice("agent:".length),
		),
		recentOrder: recentIds(
			"agent",
			agents.map((agent) => agent.id),
		),
		getName: (agent) => agent.displayName,
	});
	const agentItems = {
		items: [...agentSections.pinned, ...agentSections.unpinned.slice(0, 10)],
		pinnedCount: agentSections.pinned.length,
	};
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
				setDraggedCollectionItem({ kind, id: itemId });
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", itemId);
			},
			onDragOver: (event: ReactDragEvent<HTMLButtonElement>) => {
				if (
					draggedCollectionItem?.kind === kind &&
					section.includes(draggedCollectionItem.id)
				)
					event.preventDefault();
			},
			onDrop: (event: ReactDragEvent<HTMLButtonElement>) => {
				event.preventDefault();
				if (
					draggedCollectionItem?.kind !== kind ||
					!section.includes(draggedCollectionItem.id)
				)
					return;
				const bounds = event.currentTarget.getBoundingClientRect();
				moveCollectionItem(
					kind,
					draggedCollectionItem.id,
					itemId,
					event.clientY >= bounds.top + bounds.height / 2,
				);
				setDraggedCollectionItem(null);
			},
			onDragEnd: () => {
				setDraggedCollectionItem(null);
			},
		};
	};

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
		try {
			await store.mutate(mutation);
		} catch (error) {
			// Keep the form open while the application-level toast shows the error.
			setFormError(error instanceof Error ? error.message : String(error));
			return;
		}
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
		const request: UpdateRoutingConfigurationRequest =
			routingProvider === "harness"
				? { provider: "harness", harnessAgentId: routingHarnessAgentId }
				: {
						provider: "openai-compatible",
						model: routingModel,
						baseUrl: routingBaseUrl,
					};
		if (request.provider === "openai-compatible") {
			if (clearRoutingApiKey) request.apiKey = null;
			else if (routingApiKey.trim()) request.apiKey = routingApiKey;
		}
		request.jev = jevEnabled ? { model: jevModel } : null;
		if (request.jev !== null) {
			if (clearJevApiKey) request.jev.apiKey = null;
			else if (jevApiKey.trim()) request.jev.apiKey = jevApiKey;
		}
		return request;
	};

	const saveDefaults = async (event: FormEvent) => {
		event.preventDefault();
		if (savingInference) return;
		const request = {
			routing: routingUpdateRequest(),
			defaults: {
				model: defaultModel || null,
				reasoning: defaultReasoning,
				maxAgentsPerTurn: defaultMaxAgents,
				memoryThreads: defaultMemoryThreads,
			},
		};
		setSavingInference(true);
		setSettingsError(null);
		try {
			if (typeof store.updateWorkspaceSettings === "function") {
				await store.updateWorkspaceSettings(request);
			} else {
				await store.updateRoutingConfiguration(request.routing);
				await store.mutate({ action: "set-defaults", ...request.defaults });
			}
			setSettingsOpen(false);
		} catch (error) {
			setSettingsError(error instanceof Error ? error.message : String(error));
		} finally {
			setSavingInference(false);
		}
	};

	const saveNotifications = async () => {
		if (savingNotifications) return;
		setSavingNotifications(true);
		setNotificationsSaved(false);
		setNotificationSaveError(null);
		setNotificationVerification(null);
		try {
			await store.mutate({
				action: "set-notifications",
				notifications: notificationSettings,
			});
			setNotificationsSaved(true);
		} catch (error) {
			setNotificationSaveError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setSavingNotifications(false);
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

	const checkInferenceConfiguration = async () => {
		if (inferenceChecking) return;
		setInferenceChecking(true);
		setInferenceCheckStatus("Checking configuration…");
		try {
			const result = await store.diagnostics();
			setInferenceCheckStatus(
				result.inference.configured
					? `Configuration verified · ${result.inference.provider}`
					: "Configuration needs attention",
			);
		} catch {
			setInferenceCheckStatus("Configuration check failed");
		} finally {
			setInferenceChecking(false);
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

	const previewRetention = async () => {
		const separator = retentionConversation.indexOf(":");
		const kind = retentionConversation.slice(0, separator);
		const id = separator < 1 ? "" : retentionConversation.slice(separator + 1);
		if ((kind !== "channel" && kind !== "dm") || id === "") return;
		setRetentionPreview(await store.previewRetention({ kind, id }));
	};

	const applyRetention = async () => {
		if (
			retentionPreview === null ||
			!window.confirm(
				"Permanently remove the previewed conversation history and attachment bytes?",
			)
		)
			return;
		await store.applyRetention(retentionPreview);
		setRetentionPreview(null);
	};

	const saveAgentProfile = async (event: FormEvent, agentId: string) => {
		event.preventDefault();
		await store.mutate({
			action: "update-agent-profile",
			agentId,
			displayName: agentProfileName,
			avatarEmoji: agentAvatarEmoji,
			accentColor: agentAccentColor,
			fullAccess: agentProfileFullAccess,
		});
		setEditingAgentId(null);
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
			className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
			aria-label="Commonspace browser"
		>
			{onOpenSearch === undefined && (
				<header className="grid gap-2 border-b border-sidebar-border p-3">
					<div className="grid min-h-11 grid-cols-[28px_minmax(0,1fr)_24px] items-center gap-2 px-2 text-left text-sidebar-foreground">
						<CommonspaceLogo decorative className="size-6" />
						<span className="min-w-0">
							<strong className="block truncate text-[13px]">Workspace</strong>
							<small className="block truncate text-xs text-sidebar-foreground/60">
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
				<div className="p-4 text-xs text-sidebar-foreground/60">
					Loading agents…
				</div>
			)}
			{settingsOpen &&
				state !== undefined &&
				createPortal(
					<form
						ref={settingsPanelRef}
						aria-label="Workspace settings"
						onKeyDown={(event) => {
							if (event.key === "Escape" && !event.defaultPrevented) {
								event.stopPropagation();
								setSettingsOpen(false);
							}
						}}
						className="fixed top-[52px] right-0 bottom-0 left-[260px] z-40 flex min-h-0 flex-col overflow-hidden bg-background text-foreground max-[780px]:left-0"
						onSubmit={(event) => {
							void saveDefaults(event);
						}}
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
						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="mx-auto grid w-full max-w-[860px] gap-0 px-0 py-12 pb-20 max-[920px]:px-6 max-[640px]:px-4 [&_button]:min-h-11 [&_button]:rounded-sm [&_button]:border [&_button]:px-4 [&_fieldset]:min-w-0 [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_input:not([type=checkbox]):not([type=radio])]:w-full [&_input:not([type=checkbox]):not([type=radio])]:rounded-md [&_input:not([type=checkbox]):not([type=radio])]:border [&_input:not([type=checkbox]):not([type=radio])]:bg-background [&_input:not([type=checkbox]):not([type=radio])]:px-3 [&_label]:grid [&_label]:gap-1.5 [&_select]:min-h-11 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:bg-background [&_select]:px-3 [&_textarea]:min-h-24 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3">
								<section
									className="mb-10 rounded-md border bg-card p-5"
									aria-labelledby="workspace-appearance-title"
								>
									<div className="flex items-start justify-between gap-6 max-[640px]:grid">
										<div>
											<span className="font-mono text-xs tracking-[0.06em] text-primary">
												Appearance
											</span>
											<h2
												id="workspace-appearance-title"
												className="mt-2 font-heading text-2xl font-bold tracking-[-0.02em]"
											>
												Choose your color mode
											</h2>
										</div>
										<span className="inline-flex min-h-[30px] shrink-0 items-center rounded-full border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
											{colorMode === "dark"
												? "Dark mode"
												: colorMode === "system"
													? "System mode"
													: "Light mode"}
										</span>
									</div>
									<fieldset className="mt-5 grid grid-cols-3 gap-3 max-[640px]:grid-cols-1">
										<legend className="sr-only">Color mode</legend>
										<label
											className={cn(
												"grid min-h-16 cursor-pointer gap-1 rounded-sm border bg-background px-4 py-2 text-left hover:bg-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
												colorMode === "light" && "border-primary bg-primary/10",
											)}
										>
											<input
												className="sr-only"
												type="radio"
												name="commonspace-color-mode"
												value="light"
												checked={colorMode === "light"}
												onChange={() => {
													onSetColorMode?.("light");
												}}
											/>
											<strong>Light</strong>
											<span className="text-xs font-normal text-muted-foreground">
												Bright canvas and soft neutral surfaces
											</span>
										</label>
										<label
											className={cn(
												"grid min-h-16 cursor-pointer gap-1 rounded-sm border bg-background px-4 py-2 text-left hover:bg-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
												colorMode === "dark" && "border-primary bg-primary/10",
											)}
										>
											<input
												className="sr-only"
												type="radio"
												name="commonspace-color-mode"
												value="dark"
												checked={colorMode === "dark"}
												onChange={() => {
													onSetColorMode?.("dark");
												}}
											/>
											<strong>Dark</strong>
											<span className="text-xs font-normal text-muted-foreground">
												Low-glare canvas and deeper surfaces
											</span>
										</label>
										<label
											className={cn(
												"grid min-h-16 cursor-pointer gap-1 rounded-sm border bg-background px-4 py-2 text-left hover:bg-muted has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
												colorMode === "system" &&
													"border-primary bg-primary/10",
											)}
										>
											<input
												className="sr-only"
												type="radio"
												name="commonspace-color-mode"
												value="system"
												checked={colorMode === "system"}
												onChange={() => {
													onSetColorMode?.("system");
												}}
											/>
											<strong>System</strong>
											<span className="text-xs font-normal text-muted-foreground">
												Follow your operating system preference
											</span>
										</label>
									</fieldset>
								</section>
								<div className="relative pb-5">
									<span className="font-mono text-xs tracking-[0.06em] text-primary">
										Workspace intelligence
									</span>
									<span className="absolute top-0 right-0 inline-flex min-h-[30px] items-center gap-2 rounded-full border px-2.5 font-mono text-xs text-muted-foreground">
										<i
											className="size-[7px] rounded-full bg-[var(--status-success)]"
											aria-hidden="true"
										/>
										Configured
									</span>
									<h2 className="mt-2 max-w-[700px] font-heading text-[36px] leading-[1.12] font-bold tracking-[-0.025em]">
										Configure routing and context
									</h2>
									<p className="mt-2 max-w-[780px] text-sm leading-6 text-muted-foreground">
										Choose how Commonspace routes messages and compacts shared
										context. Native agent profiles keep their own model
										settings.
									</p>
								</div>
								<section className="pt-2">
									<SettingsSectionHeading
										title="Fast routing with Jev"
										description="Jev chooses participants, Projects, and delivery order from relevant conversation context. Selected agents receive the original message. Text generation handles context compaction."
									/>
									<div className="mb-8 grid gap-3 rounded-md border bg-card p-4">
										<div className="flex items-center justify-between gap-4">
											<strong className="text-[13px]">
												Use Jev for routing
											</strong>
											<SettingsCheckbox
												label="Use Jev for routing"
												checked={jevEnabled}
												onCheckedChange={setJevEnabled}
											/>
										</div>
										{jevEnabled && (
											<>
												<p className="text-xs text-muted-foreground">
													Sends message text, relevant conversation passages,
													context notes, and Agent and Project labels to
													TypeSafe.
												</p>
												<label>
													Jev model
													<input
														aria-label="Jev model"
														required
														value={jevModel}
														onChange={(event) =>
															setJevModel(event.target.value)
														}
													/>
												</label>
												<label>
													TypeSafe API key
													<input
														aria-label="TypeSafe API key"
														type="password"
														autoComplete="new-password"
														value={jevApiKey}
														placeholder={
															bootstrap?.routing?.jev?.apiKeyConfigured
																? "Configured — leave blank to keep"
																: "API key or TYPESAFE_API_KEY on the server"
														}
														onChange={(event) => {
															setJevApiKey(event.target.value);
															setClearJevApiKey(false);
														}}
													/>
												</label>
												{bootstrap?.routing?.jev?.apiKeyConfigured && (
													<div className="flex items-center justify-between gap-4">
														<div>
															<strong className="text-[13px]">
																Clear saved TypeSafe API key
															</strong>
															<p className="text-xs text-muted-foreground">
																A key set on the server still applies.
															</p>
														</div>
														<SettingsCheckbox
															label="Clear saved TypeSafe API key"
															checked={clearJevApiKey}
															onCheckedChange={setClearJevApiKey}
														/>
													</div>
												)}
											</>
										)}
									</div>
									<SettingsSectionHeading
										title="Routing source"
										description={
											jevEnabled
												? "Choose the text provider for context compaction."
												: "Choose where Commonspace gets routing and context decisions."
										}
									/>
									<fieldset className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0 max-[640px]:grid-cols-1">
										<legend className="sr-only">Routing engine</legend>
										<label
											className={cn(
												"relative grid min-h-[104px] cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-md border bg-card p-4 text-left transition-colors hover:bg-muted/50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
												routingProvider === "openai-compatible" &&
													"border-2 border-primary bg-[color-mix(in_oklch,var(--primary)_3%,var(--background))]",
											)}
										>
											<input
												className="sr-only"
												type="radio"
												name="commonspace-routing-engine"
												value="openai-compatible"
												checked={routingProvider === "openai-compatible"}
												onChange={() => {
													setRoutingProvider("openai-compatible");
													setRoutingHarnessAgentId("");
												}}
											/>
											<span
												className={cn(
													"mt-0.5 size-[18px] rounded-full border before:m-auto before:block before:size-2 before:translate-y-1 before:rounded-full",
													routingProvider === "openai-compatible" &&
														"border-primary before:bg-primary",
												)}
												aria-hidden="true"
											/>
											<span>
												<strong className="block text-[13px]">
													OpenAI-compatible API
												</strong>
												<small className="mt-2 block text-xs text-muted-foreground">
													Connect any compatible local or remote provider.
												</small>
											</span>
											{routingProvider === "openai-compatible" && (
												<em className="absolute top-4 right-4 text-xs font-semibold not-italic text-primary">
													Selected
												</em>
											)}
										</label>
										<label
											className={cn(
												"relative grid min-h-[104px] cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-md border bg-card p-4 text-left transition-colors hover:bg-muted/50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
												routingProvider === "harness" &&
													"border-2 border-primary bg-[color-mix(in_oklch,var(--primary)_3%,var(--background))]",
											)}
										>
											<input
												className="sr-only"
												type="radio"
												name="commonspace-routing-engine"
												value="harness"
												checked={routingProvider === "harness"}
												onChange={() => {
													setRoutingProvider("harness");
													if (routingHarnessAgentId === "")
														setRoutingHarnessAgentId(agents[0]?.id ?? "");
												}}
											/>
											<span
												className={cn(
													"mt-0.5 size-[18px] rounded-full border before:m-auto before:block before:size-2 before:translate-y-1 before:rounded-full",
													routingProvider === "harness" &&
														"border-primary before:bg-primary",
												)}
												aria-hidden="true"
											/>
											<span>
												<strong className="block text-[13px]">
													Native agent
												</strong>
												<small className="mt-2 block text-xs text-muted-foreground">
													Use one of your installed harness profiles.
												</small>
											</span>
											{routingProvider === "harness" && (
												<em className="absolute top-4 right-4 text-xs font-semibold not-italic text-primary">
													Selected
												</em>
											)}
										</label>
									</fieldset>
									{routingProvider === "harness" && (
										<fieldset className="mt-3 grid gap-2 rounded-md border bg-muted/50 p-3">
											<legend className="sr-only">Routing agent</legend>
											{agents.map((agent) => (
												<label
													key={agent.id}
													className={cn(
														"grid min-h-[58px] cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-sm border bg-background px-4 text-left transition-colors hover:bg-muted/50 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
														routingHarnessAgentId === agent.id &&
															"border-primary",
													)}
												>
													<input
														className="sr-only"
														type="radio"
														name="commonspace-routing-agent"
														value={agent.id}
														checked={routingHarnessAgentId === agent.id}
														onChange={() => {
															setRoutingHarnessAgentId(agent.id);
														}}
													/>
													<AgentAvatar agent={agent} />
													<span>
														<strong className="block text-[13px]">
															{agent.displayName}
														</strong>
														<small className="text-xs text-muted-foreground">
															{runtimeLabel(agent.adapter)} ·{" "}
															{agent.model ?? "harness default"}
														</small>
													</span>
													{routingHarnessAgentId === agent.id && (
														<span className="text-xs font-semibold text-primary">
															Routing agent
														</span>
													)}
												</label>
											))}
										</fieldset>
									)}
								</section>

								{routingProvider === "openai-compatible" && (
									<section className="mt-8 border-t pt-8">
										<SettingsSectionHeading
											title="Connection"
											description="Credentials stay on this device and are never included in public workspace configuration."
										/>
										<div className="overflow-hidden rounded-md border bg-card">
											<div className="grid grid-cols-2 gap-3 p-4 max-[640px]:grid-cols-1">
												<label>
													<span className="text-xs font-semibold text-muted-foreground">
														Model ID
													</span>
													<input
														aria-label="Routing model"
														placeholder="gpt-4.1-mini"
														value={routingModel}
														onChange={(event) => {
															setRoutingModel(event.target.value);
														}}
													/>
												</label>
												<label>
													<span className="text-xs font-semibold text-muted-foreground">
														API base URL
													</span>
													<input
														aria-label="Routing API base URL"
														type="url"
														value={routingBaseUrl}
														onChange={(event) => {
															setRoutingBaseUrl(event.target.value);
														}}
													/>
												</label>
											</div>
											<label className="border-t p-4">
												<span className="text-xs font-semibold text-muted-foreground">
													API key
												</span>
												<input
													aria-label="Routing API key"
													type="password"
													autoComplete="new-password"
													placeholder={
														bootstrap?.routing?.apiKeyConfigured === true
															? "Saved — leave blank to keep"
															: "Optional for local compatible APIs"
													}
													value={routingApiKey}
													onChange={(event) => {
														setRoutingApiKey(event.target.value);
														setClearRoutingApiKey(false);
													}}
												/>
											</label>
											{bootstrap?.routing?.apiKeyConfigured === true && (
												<div className="flex min-h-[62px] items-center justify-between gap-4 border-t px-4 py-3">
													<div>
														<strong className="block text-[13px]">
															Clear saved API key
														</strong>
														<p className="mt-1 text-xs text-muted-foreground">
															Removes the stored credential when you save.
														</p>
													</div>
													<SettingsCheckbox
														label="Clear routing API key"
														checked={clearRoutingApiKey}
														onCheckedChange={setClearRoutingApiKey}
													/>
												</div>
											)}
											<div className="flex min-h-[76px] items-center justify-between gap-4 border-t bg-muted/30 p-4 max-[640px]:grid">
												<div>
													<strong className="block text-[13px]">
														Used by Commonspace
													</strong>
													<p className="mt-1 text-xs text-muted-foreground">
														Message routing · context compaction · workspace
														utilities
													</p>
												</div>
												<button
													type="button"
													disabled={inferenceChecking}
													onClick={() => {
														void checkInferenceConfiguration();
													}}
												>
													{inferenceChecking
														? "Checking…"
														: "Check configuration"}
												</button>
											</div>
											{inferenceCheckStatus !== null && (
												<p
													className={cn(
														"flex items-center gap-2 border-t px-4 py-3 text-xs",
														inferenceChecking
															? "text-muted-foreground"
															: inferenceCheckStatus.startsWith(
																		"Configuration verified",
																	)
																? "text-[var(--status-success)]"
																: "text-destructive",
													)}
													role="status"
													aria-live="polite"
													aria-label="Inference configuration status"
												>
													<span aria-hidden="true">
														{inferenceChecking
															? "…"
															: inferenceCheckStatus.startsWith(
																		"Configuration verified",
																	)
																? "✓"
																: "!"}
													</span>
													{inferenceCheckStatus}
												</p>
											)}
										</div>
									</section>
								)}

								<fieldset className="mt-8 border-t pt-8">
									<legend className="sr-only">
										Workspace agent run settings
									</legend>
									<SettingsSectionHeading
										title="Workspace agent run settings"
										description="Model and reasoning apply workspace-wide to every Channel and DM."
									/>
									<div className="grid grid-cols-2 gap-4 rounded-md border bg-card p-4 max-[640px]:grid-cols-1">
										<label>
											<span className="text-xs font-semibold text-muted-foreground">
												Workspace model
											</span>
											<input
												aria-label="Workspace model"
												list="commonspace-models"
												placeholder="Use each harness default"
												value={defaultModel}
												onChange={(event) => {
													setDefaultModel(event.target.value);
												}}
											/>
										</label>
										<datalist id="commonspace-models">
											{models.map((model) => (
												<option key={model} value={model} />
											))}
										</datalist>
										<label>
											<span className="text-xs font-semibold text-muted-foreground">
												Reasoning
											</span>
											<select
												aria-label="Workspace reasoning"
												value={defaultReasoning}
												onChange={(event) => {
													if (isReasoning(event.target.value))
														setDefaultReasoning(event.target.value);
												}}
											>
												{[
													"none",
													"minimal",
													"low",
													"medium",
													"high",
													"xhigh",
													"max",
												].map((value) => (
													<option key={value} value={value}>
														{value}
													</option>
												))}
											</select>
										</label>
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
													setDefaultMemoryThreads(Number(event.target.value));
												}}
											/>
										</label>
									</div>
								</fieldset>
								{settingsError !== null && (
									<p
										role="alert"
										className="mt-4 rounded-md border border-destructive/30 bg-muted p-3 text-sm text-destructive"
									>
										{settingsError}
									</p>
								)}
								<div className="mt-4 flex items-center justify-between gap-6 rounded-md border bg-muted/30 p-4 max-[640px]:grid">
									<p className="text-xs leading-5 text-muted-foreground">
										Saves the routing source, connection, and run defaults
										together.
									</p>
									<button
										type="submit"
										className="shrink-0 border-primary bg-primary font-semibold text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] disabled:cursor-wait disabled:opacity-60"
										disabled={savingInference}
									>
										{savingInference
											? "Saving inference…"
											: "Save inference settings"}
									</button>
								</div>
								<fieldset className="mt-8 border-t pt-8">
									<legend className="sr-only">OS notifications</legend>
									<SettingsSectionHeading
										title="OS notifications"
										description="Choose which durable Inbox events also appear as native alerts on this Mac."
									/>
									<div className="overflow-hidden rounded-md border bg-card">
										<div className="flex min-h-[80px] items-center justify-between gap-6 bg-muted/20 px-4 py-3">
											<div>
												<strong className="block text-[13px]">
													Allow native notifications
												</strong>
												<p className="mt-1 text-xs leading-5 text-muted-foreground">
													Show selected Inbox events as macOS alerts. Inbox
													delivery is always preserved.
												</p>
											</div>
											<SettingsSwitch
												label="Allow native notifications"
												checked={notificationSettings.enabled}
												onCheckedChange={(enabled) => {
													setNotificationsSaved(false);
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
													<div
														className={cn(
															!notificationSettings.enabled && "opacity-80",
														)}
													>
														<strong className="block text-[13px]">
															{label}
														</strong>
														<p className="mt-1 text-xs leading-5 text-muted-foreground">
															{description}
														</p>
													</div>
													<SettingsSwitch
														label={ariaLabel}
														disabled={!notificationSettings.enabled}
														checked={notificationSettings[key]}
														onCheckedChange={(checked) => {
															setNotificationsSaved(false);
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
											role={notificationSaveError === null ? "status" : "alert"}
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
												{savingNotifications ? "Saving…" : "Save notifications"}
											</button>
										</div>
									</div>
								</fieldset>
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
												<strong className="text-[13px]">
													System readiness
												</strong>
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
													<strong className="text-[13px]">
														{diagnostics.inference.location === "remote"
															? "Remote inference"
															: "Local inference"}
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
																{harness.runReadiness}
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
												<strong className="text-[13px]">
													Export workspace
												</strong>
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
											<strong className="text-[13px]">Import archive</strong>
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
																	void chooseImportRoot(project.id, rootIndex);
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
												{importingWorkspace ? "Importing…" : "Import workspace"}
											</button>
										</section>
									)}
									<section
										className="mt-5 rounded-md border border-destructive/30 bg-destructive/[0.03] p-4"
										aria-label="Conversation retention"
									>
										<strong className="text-[13px] text-destructive">
											Remove conversation history
										</strong>
										<p className="mt-1 text-xs leading-5 text-muted-foreground">
											Preview the exact impact before permanently removing one
											Channel or Direct Message.
										</p>
										<div className="mt-4 flex items-center gap-3 max-[640px]:grid">
											<select
												aria-label="Retention conversation"
												value={retentionConversation}
												onChange={(event) => {
													setRetentionConversation(event.target.value);
													setRetentionPreview(null);
												}}
											>
												<option value="">Choose a conversation</option>
												{channels.map((channel) => (
													<option
														key={`channel:${channel.id}`}
														value={`channel:${channel.id}`}
													>
														#{channel.name}
													</option>
												))}
												{agents.map((agent) => (
													<option
														key={`dm:${agent.id}`}
														value={`dm:${agent.id}`}
													>
														DM · {agent.displayName}
													</option>
												))}
											</select>
											<button
												type="button"
												className="shrink-0"
												aria-label="Preview retention"
												disabled={retentionConversation === ""}
												onClick={() => {
													void previewRetention();
												}}
											>
												Preview impact
											</button>
										</div>
										{retentionPreview !== null && (
											<section aria-label="Retention impact">
												<p>
													{retentionPreview.messages} messages ·{" "}
													{retentionPreview.threads} threads ·{" "}
													{retentionPreview.attachments} attachments ·{" "}
													{retentionPreview.pins} pin
													{retentionPreview.pins === 1 ? "" : "s"}
												</p>
												{retentionPreview.permissions > 0 && (
													<p>
														{retentionPreview.permissions} permission request
														{retentionPreview.permissions === 1 ? "" : "s"} will
														also be removed.
													</p>
												)}
												<button
													type="button"
													aria-label="Apply retention"
													onClick={() => {
														void applyRetention();
													}}
												>
													Apply retention
												</button>
											</section>
										)}
									</section>
								</section>
								<div className="flex justify-end border-t pt-5">
									<button
										type="button"
										onClick={() => {
											setSettingsOpen(false);
										}}
									>
										Close settings
									</button>
								</div>
							</div>
						</div>
					</form>,
					document.body,
				)}

			<nav
				className="grid gap-0.5 px-2 pt-2 pb-1"
				aria-label="Workspace destinations"
			>
				<button
					type="button"
					className="relative grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 hover:bg-sidebar-accent aria-pressed:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]"
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
					<span className="text-[13px] font-medium">Inbox</span>
					{inboxUnreadCount > 0 && (
						<span
							className="grid size-5 min-w-5 place-items-center rounded-full bg-destructive px-1 font-mono text-xs text-white"
							aria-hidden="true"
						>
							{inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
						</span>
					)}
				</button>
				<button
					type="button"
					className="relative grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 hover:bg-sidebar-accent aria-pressed:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]"
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
					<span className="text-[13px] font-medium">Threads</span>
					{threadUnreadCount > 0 && (
						<span
							className="grid size-5 min-w-5 place-items-center rounded-full bg-destructive px-1 font-mono text-xs text-white"
							aria-hidden="true"
						>
							{threadUnreadCount > 99 ? "99+" : threadUnreadCount}
						</span>
					)}
				</button>
			</nav>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 [scrollbar-color:color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)_transparent] [scrollbar-width:thin]">
				<Section
					title="Projects"
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
					count={projects.length}
					open={!preferences.collapsedSections.includes("project")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("project", !open);
					}}
					onAdd={() => {
						setForm("project");
						setFormError(null);
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
								className="grid gap-3 [&_button]:min-h-11 [&_button]:rounded-sm [&_button]:border [&_button]:px-4 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
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

					{projectItems.pinnedCount > 0 && (
						<NavGroupLabel label="Pinned" count={projectItems.pinnedCount} />
					)}
					{projectItems.items.map((project, index) => {
						const active = !settingsOpen && activeProjectViewId === project.id;
						const folderSummary =
							project.paths.length === 1
								? "1 folder · working directory"
								: `${String(project.paths.length)} folders · working + references`;
						return (
							<div
								key={project.id}
								className={cn(
									"grid gap-0.5",
									draggedCollectionItem?.kind === "project" &&
										draggedCollectionItem.id === project.id &&
										"opacity-50",
								)}
							>
								{projectItems.pinnedCount > 0 &&
									index === projectItems.pinnedCount && (
										<NavGroupLabel
											label="Unpinned"
											count={projectSections.unpinned.length}
										/>
									)}
								<div className="group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-sm hover:bg-sidebar-accent focus-within:bg-sidebar-accent has-[button[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]">
									<button
										type="button"
										{...sortableCollectionButtonProps("project", project.id)}
										className={cn(
											"relative grid min-h-8 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-l-sm border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 aria-pressed:text-sidebar-foreground",
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
											{project.name.slice(0, 1).toLocaleUpperCase()}
										</span>
										<span className="min-w-0">
											<strong className="block truncate text-[13px] font-medium">
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
									</button>
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
												if (onOpenContextSettings === undefined) {
													store.selectProject(project.id);
													onOpenProject?.(project.id);
												} else onOpenContextSettings("project", project.id);
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
								</div>

								{pathProjectId === project.id && (
									<div className="p-2">
										<form
											className="grid gap-2 [&_button]:min-h-10 [&_button]:rounded-sm [&_button]:border [&_button]:px-3 [&_input]:min-h-10 [&_input]:rounded-sm [&_input]:border [&_input]:px-3"
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
						<div className="px-2 py-4 text-xs text-sidebar-foreground/60">
							Add a local filesystem project.
						</div>
					)}
					{projects.length > projectItems.items.length && (
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
				</Section>

				<Section
					title="Channels"
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
					count={channels.length}
					open={!preferences.collapsedSections.includes("channel")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("channel", !open);
					}}
					onAdd={() => {
						setForm("channel");
						setFormError(null);
						setAgentIds([]);
						setChannelAgentQuery("");
						setChannelAgentFilter("all");
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
								className="grid gap-3 [&_button]:min-h-11 [&_button]:rounded-sm [&_button]:border [&_button]:px-4 [&_fieldset]:grid [&_fieldset]:gap-2 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
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
								<fieldset className="rounded-md border p-3">
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
											<button
												key={value}
												type="button"
												className="min-h-9 rounded-full border px-3 text-xs font-semibold capitalize aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
												aria-pressed={channelAgentFilter === value}
												onClick={() => {
													setChannelAgentFilter(value);
												}}
											>
												{value}
											</button>
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
													<strong className="block text-[13px] text-foreground">
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

					{channelItems.pinnedCount > 0 && (
						<NavGroupLabel label="Pinned" count={channelItems.pinnedCount} />
					)}
					{channelItems.items.map((channel, index) => {
						const unreadCount = channelUnreadCounts.get(channel.id) ?? 0;
						const latestChannelMessage =
							state?.messages[`channel:${channel.id}`]?.at(-1);
						const channelPins = (state?.pins ?? []).filter(
							(pin) =>
								pin.removedAt === null &&
								pin.scope.kind === "channel" &&
								pin.scope.id === channel.id,
						);
						return (
							<div
								key={channel.id}
								className={cn(
									"grid gap-0.5",
									draggedCollectionItem?.kind === "channel" &&
										draggedCollectionItem.id === channel.id &&
										"opacity-50",
								)}
							>
								{channelItems.pinnedCount > 0 &&
									index === channelItems.pinnedCount && (
										<NavGroupLabel
											label="Unpinned"
											count={channelSections.unpinned.length}
										/>
									)}
								<div className="group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-sm hover:bg-sidebar-accent focus-within:bg-sidebar-accent has-[button[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]">
									<button
										type="button"
										{...sortableCollectionButtonProps("channel", channel.id)}
										className={cn(
											"relative grid min-h-8 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-l-sm border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 aria-pressed:text-sidebar-foreground",
											preferences.sortModes.channel === "custom" &&
												"cursor-grab pr-6 active:cursor-grabbing",
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
											className="grid size-5 place-items-center rounded-sm font-mono text-base text-sidebar-foreground/55"
											aria-hidden="true"
										>
											{"#"}
										</span>
										<span className="min-w-0">
											<strong className="block truncate text-[13px] font-medium">
												{channel.name}
											</strong>
											<small className="hidden">
												{channel.agentIds.length} agent
												{channel.agentIds.length === 1 ? "" : "s"}
											</small>
										</span>
										{unreadCount > 0 && (
											<span
												className="grid size-5 min-w-5 place-items-center rounded-full bg-destructive px-1 font-mono text-xs text-white"
												aria-hidden="true"
											>
												{unreadCount > 99 ? "99+" : unreadCount}
											</span>
										)}
										{preferences.sortModes.channel === "custom" && (
											<GripVerticalIcon
												aria-hidden="true"
												className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-sidebar-foreground/45 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
											/>
										)}
									</button>
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
												if (onOpenContextSettings !== undefined) {
													onOpenContextSettings("channel", channel.id);
													return;
												}
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
								</div>
								{editingChannelId === channel.id && (
									<form
										className="grid gap-3 rounded-md bg-sidebar-deep p-3 text-sidebar-foreground [&_button]:min-h-10 [&_button]:rounded-sm [&_button]:border [&_button]:px-3 [&_fieldset]:grid [&_fieldset]:gap-2 [&_input]:min-h-10 [&_input]:rounded-sm [&_input]:border [&_input]:bg-background [&_input]:px-3 [&_select]:min-h-10 [&_select]:rounded-sm [&_select]:border [&_select]:bg-background [&_select]:px-3 [&_textarea]:min-h-24 [&_textarea]:rounded-sm [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"
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
											<label className="grid gap-1.5">
												Summary
												<textarea
													aria-label={`Channel summary for ${channel.name}`}
													value={channelSummary}
													onChange={(event) => {
														setChannelSummary(event.target.value);
													}}
												/>
											</label>
											<label className="grid gap-1.5">
												Decisions
												<textarea
													aria-label={`Channel decisions for ${channel.name}`}
													value={channelDecisions}
													onChange={(event) => {
														setChannelDecisions(event.target.value);
													}}
												/>
											</label>
											<label className="grid gap-1.5">
												Open questions
												<textarea
													aria-label={`Channel open questions for ${channel.name}`}
													value={channelQuestions}
													onChange={(event) => {
														setChannelQuestions(event.target.value);
													}}
												/>
											</label>
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
													pin.note ??
													pin.attachmentId ??
													pin.messageId ??
													"Pinned source";
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
						<div className="px-2 py-4 text-xs text-sidebar-foreground/60">
							Create a channel and seat agents.
						</div>
					)}
					{channels.length > channelItems.items.length && (
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
				</Section>

				<Section
					title="Agents"
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
					count={agents.length}
					open={!preferences.collapsedSections.includes("agent")}
					onOpenChange={(open) => {
						sidebarPreferencesStore.setSectionCollapsed("agent", !open);
					}}
					onAdd={() => {
						setForm("agent");
						setName("");
						setAgentAdapter(null);
					}}
				>
					{form === "agent" && (
						<SidebarDialog
							title="Add an agent"
							description="Choose an installed harness to represent in Commonspace."
							onClose={() => {
								setForm(null);
							}}
						>
							<div className="grid gap-2">
								{AGENT_ADAPTER_KINDS.map((adapter) => (
									<button
										key={adapter}
										type="button"
										className="grid min-h-[68px] grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-background px-3 text-left hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/5"
										aria-label={`Choose ${runtimeLabel(adapter)} harness`}
										aria-pressed={agentAdapter === adapter}
										onClick={() => {
											selectAgentHarness(adapter);
										}}
									>
										<span className="grid size-10 place-items-center rounded-sm border bg-muted font-mono font-semibold">
											{AGENT_ADAPTERS[adapter].monogram}
										</span>
										<span>
											<strong className="block">{runtimeLabel(adapter)}</strong>
											<small className="block text-xs text-muted-foreground">
												Installed harness · credentials stay native
											</small>
										</span>
										<span className="text-xs text-muted-foreground">
											{agentAdapter === adapter ? "Selected" : "Choose"}
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
					{editingAgentId !== null &&
						(() => {
							const editingAgent = agents.find(
								(agent) => agent.id === editingAgentId,
							);
							if (editingAgent === undefined) return null;
							const previewAgent: CommonspaceAgentProfile = {
								...editingAgent,
								displayName: agentProfileName || editingAgent.displayName,
								accentColor: agentAccentColor,
							};
							if (agentAvatarEmoji !== "")
								previewAgent.avatarEmoji = agentAvatarEmoji;
							return (
								<SidebarDialog
									title={`Customize ${editingAgent.displayName}`}
									onClose={() => {
										setEditingAgentId(null);
									}}
								>
									<form
										className="grid gap-3 [&_button]:min-h-11 [&_button]:rounded-sm [&_button]:border [&_button]:px-4 [&_input]:min-h-11 [&_input]:rounded-md [&_input]:border [&_input]:px-3"
										onSubmit={(event) => {
											void saveAgentProfile(event, editingAgent.id);
										}}
									>
										<div className="flex items-center gap-3 rounded-md border bg-muted p-3">
											<AgentAvatar agent={previewAgent} />
											<span>
												<strong>
													{agentProfileName || editingAgent.displayName}
												</strong>
												<small>Commonspace appearance only</small>
											</span>
										</div>
										<label>
											Workspace name
											<input
												aria-label="Workspace name"
												value={agentProfileName}
												onChange={(event) => {
													setAgentProfileName(event.target.value);
												}}
											/>
										</label>
										<label>
											Avatar emoji
											<input
												aria-label="Avatar emoji"
												value={agentAvatarEmoji}
												onChange={(event) => {
													setAgentAvatarEmoji(event.target.value);
												}}
												placeholder={(
													agentProfileName || editingAgent.displayName
												)
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
												value={agentAccentColor}
												onChange={(event) => {
													setAgentAccentColor(event.target.value);
												}}
											/>
										</label>
										<label className="flex items-start gap-3 rounded-md border bg-muted p-3">
											<input
												type="checkbox"
												className="mt-0.5 size-4"
												checked={agentProfileFullAccess}
												onChange={(event) => {
													setAgentProfileFullAccess(event.target.checked);
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
										<p className="text-xs text-muted-foreground">
											The installed {runtimeLabel(editingAgent.adapter)}{" "}
											harness, routing, and sessions stay unchanged.
										</p>
										<div>
											<button type="submit">Save appearance</button>
											{state?.agents.some(
												(candidate) => candidate.id === editingAgent.id,
											) === true && (
												<button
													type="button"
													aria-label={`Remove agent ${editingAgent.displayName}`}
													onClick={() => {
														void store.mutate({
															action: "remove-agent",
															agentId: editingAgent.id,
														});
														setEditingAgentId(null);
													}}
												>
													Remove agent
												</button>
											)}
										</div>
									</form>
								</SidebarDialog>
							);
						})()}

					{agentItems.pinnedCount > 0 && (
						<NavGroupLabel label="Pinned" count={agentItems.pinnedCount} />
					)}
					{agentItems.items.map((agent, index) => {
						const effectiveStatus = activeAgentIds.has(agent.id)
							? "running"
							: agent.status;
						return (
							<div
								key={agent.id}
								className={cn(
									"grid gap-0.5",
									draggedCollectionItem?.kind === "agent" &&
										draggedCollectionItem.id === agent.id &&
										"opacity-50",
								)}
							>
								{agentItems.pinnedCount > 0 &&
									index === agentItems.pinnedCount && (
										<NavGroupLabel
											label="Unpinned"
											count={agentSections.unpinned.length}
										/>
									)}
								<div className="group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-sm hover:bg-sidebar-accent focus-within:bg-sidebar-accent has-[button[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]">
									<button
										type="button"
										{...sortableCollectionButtonProps("agent", agent.id)}
										className={cn(
											"relative grid min-h-10 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-l-sm border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 aria-pressed:text-sidebar-foreground",
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
											showStatus
											statusClassName="border-sidebar"
											className="text-sidebar-foreground/55"
										/>
										<span className="min-w-0">
											<strong className="block truncate text-[13px] font-medium">
												{agent.displayName}
											</strong>
											<small
												id={`agent-${agent.id}-model`}
												className="block truncate text-[11px] leading-4 text-sidebar-foreground/70"
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
									</button>
									{onOpenContextSettings === undefined ? (
										<CollectionActionButton
											label={`Customize agent ${agent.displayName}`}
											onClick={() => {
												setEditingAgentId(agent.id);
												setAgentProfileName(agent.displayName);
												setAgentAvatarEmoji(agent.avatarEmoji ?? "");
												setAgentAccentColor(agent.accentColor ?? "#6d5dfc");
												setAgentProfileFullAccess(agent.fullAccess === true);
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
												if (onOpenContextSettings !== undefined) {
													onOpenContextSettings("agent", agent.id);
													return;
												}
												setEditingAgentId(agent.id);
												setAgentProfileName(agent.displayName);
												setAgentAvatarEmoji(agent.avatarEmoji ?? "");
												setAgentAccentColor(agent.accentColor ?? "#6d5dfc");
												setAgentProfileFullAccess(agent.fullAccess === true);
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
								</div>
							</div>
						);
					})}
					{agents.length > agentItems.items.length && (
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
				</Section>
			</div>
			<div className="flex min-h-[60px] items-center gap-1.5 border-t border-sidebar-border bg-sidebar-deep py-2 pr-2.5 pl-[18px]">
				<span className="mr-auto text-xs text-sidebar-foreground/65">
					On this Mac
				</span>
				<button
					type="button"
					className="grid size-11 place-items-center rounded-full border-0 bg-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
					aria-label="Refresh Commonspace"
					onClick={() => {
						void store.refresh();
					}}
				>
					<RefreshCwIcon className="size-[18px]" aria-hidden="true" />
				</button>
				<button
					type="button"
					className="grid size-11 place-items-center rounded-full border-0 bg-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground aria-[current=page]:bg-[color-mix(in_srgb,var(--sidebar-foreground)_20%,transparent)]"
					aria-label="Commonspace settings"
					ref={settingsTriggerRef}
					aria-current={settingsOpen ? "page" : undefined}
					onClick={() => {
						const defaults = state?.defaults;
						if (defaults !== undefined) {
							setDefaultModel(defaults.model ?? "");
							setDefaultReasoning(defaults.reasoning);
							setDefaultMaxAgents(defaults.maxAgentsPerTurn);
							setDefaultMemoryThreads(defaults.memoryThreads);
						}
						const routing = bootstrap?.routing;
						setRoutingProvider(routing?.provider ?? "openai-compatible");
						setRoutingHarnessAgentId(routing?.harnessAgentId ?? "");
						setRoutingModel(routing?.model ?? "");
						setJevEnabled(routing?.jev !== undefined);
						setJevModel(routing?.jev?.model ?? "jev-1.13.0");
						setJevApiKey("");
						setClearJevApiKey(false);
						setRoutingBaseUrl(routing?.baseUrl ?? "https://api.openai.com/v1");
						setRoutingApiKey("");
						setClearRoutingApiKey(false);
						setInferenceCheckStatus(null);
						setSettingsError(null);
						setNotificationsSaved(false);
						setNotificationSaveError(null);
						setNotificationSettings({
							...(state?.notifications ??
								DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS),
						});
						setSettingsOpen((value) => !value);
					}}
				>
					<SettingsIcon className="size-[18px]" aria-hidden="true" />
				</button>
			</div>
		</section>
	);
}
