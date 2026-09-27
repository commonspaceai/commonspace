import {
	COMMONSPACE_SEARCH_KINDS,
	COMMONSPACE_STATE_VERSION,
	type CommonspaceAgentDefinition,
	type CommonspaceAgentProfile,
	type CommonspaceAgentTrace,
	type CommonspaceBootstrap,
	type CommonspaceChannel,
	type CommonspaceLiveAgentActivity,
	type CommonspaceMessage,
	type CommonspaceNotificationVerification,
	type CommonspacePermissionRequest,
	type CommonspaceProject,
	type CommonspaceQueuedFollowup,
	CommonspaceRoutingProvider,
	type CommonspaceRunAttribution,
	type CommonspaceSearchResponse,
	type CommonspaceSearchResult,
	type CommonspaceState,
	type CommonspaceThread,
	type CommonspaceTraceEntry,
	type ConversationRef,
	DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
	type HarnessCapabilityInventory,
	McpAuthenticationStatus,
	type ProjectDirectoryResponse,
	type ProjectGitDiffResponse,
	type ProjectGitStatusResponse,
} from "@commonspace/shared";
import workflowPreviewUrl from "../assets/agent-workflow-preview.mp4";
import commonspaceLogoUrl from "../assets/commonspace-logo.png";
import {
	AgentDiscoveryStatus,
	type CommonspaceClientSnapshot,
	CommonspaceClientStore,
	type CommonspaceStore,
} from "../commonspace-store";

const now = "2026-09-03T10:00:00.000Z";

export const hermesAgent: CommonspaceAgentProfile = {
	id: "agent-hermes",
	displayName: "Review Bot",
	avatarEmoji: "🔎",
	accentColor: "#635bff",
	adapter: "hermes",
	model: "gpt-5.6-sol",
	status: "running",
	description: "Reviews implementation details and reports concrete evidence.",
};

export const codexAgent: CommonspaceAgentProfile = {
	id: "agent-codex",
	displayName: "Build Smith",
	avatarEmoji: "🛠️",
	accentColor: "#e07a5f",
	adapter: "codex",
	model: "gpt-5.6-sol",
	status: "stopped",
	description: "Builds and verifies focused changes.",
};

const agentDefinitions: CommonspaceAgentDefinition[] = [
	{ ...hermesAgent, createdAt: now },
	{ ...codexAgent, createdAt: now },
];

export const primaryProject: CommonspaceProject = {
	id: "project-commonspace",
	name: "Commonspace",
	paths: ["/workspace/commonspace", "/workspace/design"],
	createdAt: now,
};

export const secondaryProject: CommonspaceProject = {
	id: "project-platform",
	name: "Platform",
	paths: ["/workspace/platform"],
	createdAt: now,
};

function memory(summary: string) {
	return {
		summary,
		decisions: ["Keep the visible work record in the conversation."],
		openQuestions: ["Which surface should be reviewed next?"],
		threadIds: [],
		updatedAt: now,
		origin: "user" as const,
		status: "current" as const,
		sourceMessageCount: 4,
		estimatedTokens: 420,
		compactedThroughMessageId: "message-root",
	};
}

function channel(
	id: string,
	name: string,
	agentIds: string[],
	instructions: string,
): CommonspaceChannel {
	return {
		id,
		name,
		agentIds,
		instructions,
		memory: memory(`Working agreements for #${name}.`),
		routingMemory: {
			summary: `Recent routing for #${name}.`,
			status: "current",
			correctionCount: 0,
			compactedThroughCorrectionId: null,
			updatedAt: now,
		},
		createdAt: now,
	};
}

export const designChannel = channel(
	"channel-design",
	"design-review",
	[hermesAgent.id, codexAgent.id],
	"Review the visual system, component states, and interaction evidence.",
);

export const buildChannel = channel(
	"channel-build",
	"builds",
	[codexAgent.id],
	"Keep build and verification discussion concise and reproducible.",
);

export const traceEntries: CommonspaceTraceEntry[] = [
	{
		type: "reasoning",
		id: "reasoning-1",
		text: "I am checking the story coverage against the visible UI surfaces.",
		createdAt: now,
		updatedAt: now,
	},
	{
		type: "plan",
		id: "plan-1",
		steps: [
			{
				text: "Inventory owned surfaces",
				priority: "high",
				status: "completed",
			},
			{
				text: "Add representative stories",
				priority: "high",
				status: "in_progress",
			},
			{
				text: "Run the Storybook build",
				priority: "medium",
				status: "pending",
			},
		],
		markdown:
			"1. Inventory owned surfaces\n2. Add representative stories\n3. Run the Storybook build",
		createdAt: now,
		updatedAt: now,
	},
	{
		type: "tool",
		id: "tool-1",
		title: "Inspect Storybook index",
		toolName: "curl",
		toolKind: "terminal",
		status: "completed",
		input: "curl -fsS http://localhost:6006/index.json",
		output: "Storybook index returned the registered entries.",
		createdAt: now,
		updatedAt: now,
	},
	{
		type: "usage",
		id: "usage",
		usedTokens: 3240,
		contextWindow: 128000,
		costAmount: 0.04,
		costCurrency: "USD",
		createdAt: now,
		updatedAt: now,
	},
];

export const trace: CommonspaceAgentTrace = {
	adapter: "hermes",
	startedAt: "2026-09-03T09:59:40.000Z",
	completedAt: now,
	entries: traceEntries,
};

export const runAttribution: CommonspaceRunAttribution = {
	startedAt: "2026-09-03T09:59:40.000Z",
	completedAt: now,
	roots: [
		{
			available: true,
			rootIndex: 0,
			projectId: primaryProject.id,
			projectRootIndex: 0,
			branch: "main",
			headBefore: "abc1234",
			headAfter: "def5678",
			preExisting: [{ path: "ui/src/index.css", status: "modified" }],
			observed: [
				{
					path: "ui/src/stories/CommonspaceApp.stories.tsx",
					status: "added",
					preExisting: false,
					additions: 48,
					deletions: 0,
					patch: "@@ -0,0 +1,48 @@\n+export const Workspace: Story = {};",
				},
			],
		},
		{
			available: false,
			rootIndex: 1,
			projectId: secondaryProject.id,
			projectRootIndex: 0,
			reason: "The reference folder was unavailable during the run.",
		},
	],
};

const rootMessage: CommonspaceMessage = {
	id: "message-root",
	conversation: { kind: "channel", id: designChannel.id },
	authorType: "user",
	authorId: "sample-user",
	authorName: "You",
	text: "Review the visual baseline and document the next component states.",
	createdAt: "2026-09-03T09:58:00.000Z",
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
	routing: {
		source: "ai",
		status: "resolved",
		startedAt: "2026-09-03T09:58:00.000Z",
		resolvedAt: "2026-09-03T09:58:00.125Z",
		durationMs: 125,
		agentIds: [hermesAgent.id],
		assignments: [
			{
				id: "assignment-design-review",
				agentId: hermesAgent.id,
				projectIds: [primaryProject.id],
			},
		],
		corrections: [],
		inferredProjectIds: [primaryProject.id],
		confidence: 0.94,
		reason: "Design review matches Hermes.",
	},
};

const agentReply: CommonspaceMessage = {
	id: "message-reply",
	conversation: { kind: "channel", id: designChannel.id },
	authorType: "agent",
	authorId: hermesAgent.id,
	authorName: hermesAgent.displayName,
	text: "I found the current visual baseline. The next pass should cover the workspace shell, project panes, and empty states.",
	createdAt: "2026-09-03T09:59:50.000Z",
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
	threadId: "thread-review",
	parentMessageId: rootMessage.id,
	sourceMessageId: rootMessage.id,
	trace,
	runAttribution,
};

const buildRoot: CommonspaceMessage = {
	id: "message-build-root",
	conversation: { kind: "channel", id: buildChannel.id },
	authorType: "user",
	authorId: "sample-user",
	authorName: "You",
	text: "Run the focused Storybook checks.",
	createdAt: "2026-09-03T09:57:00.000Z",
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
};

const dmUserMessage: CommonspaceMessage = {
	id: "message-dm-user",
	conversation: { kind: "dm", id: hermesAgent.id },
	authorType: "user",
	authorId: "sample-user",
	authorName: "You",
	text: "Can you summarize the remaining visual coverage?",
	createdAt: "2026-09-03T09:56:00.000Z",
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
};

const dmReply: CommonspaceMessage = {
	id: "message-dm-reply",
	conversation: { kind: "dm", id: hermesAgent.id },
	authorType: "agent",
	authorId: hermesAgent.id,
	authorName: hermesAgent.displayName,
	text: "The shell and project panes are the remaining high-value surfaces.",
	createdAt: "2026-09-03T09:59:00.000Z",
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
	sourceMessageId: dmUserMessage.id,
	replyStatus: "complete",
};

const reviewThread: CommonspaceThread = {
	id: "thread-review",
	channelId: designChannel.id,
	projectIds: [primaryProject.id],
	projectId: primaryProject.id,
	rootMessageId: rootMessage.id,
	agentIds: [hermesAgent.id, codexAgent.id],
	context: {
		channelSnapshot: {
			...memory("Thread context captured from the design review channel."),
			capturedAt: now,
		},
		memory: {
			...memory("The thread is tracking the next visual review pass."),
			origin: "automatic",
		},
	},
	createdAt: "2026-09-03T09:58:10.000Z",
};

function createStoryState(
	overrides: Partial<CommonspaceState> = {},
): CommonspaceState {
	return {
		version: COMMONSPACE_STATE_VERSION,
		revision: 12,
		inboxReadAt: null,
		inboxReadMessageIds: [],
		inboxUnreadMessageIds: [agentReply.id],
		inboxSavedItemIds: [agentReply.id],
		followedSessionIds: [`${rootMessage.id}:${hermesAgent.id}`],
		mutedSessionIds: [],
		notifications: { ...DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS },
		defaults: {
			maxAgentsPerTurn: 2,
			memoryThreads: 3,
		},
		agents: agentDefinitions,
		dmSessions: { [hermesAgent.id]: "fixture-a" },
		agentSessions: {
			[hermesAgent.id]: { [primaryProject.id]: "fixture-b" },
		},
		projects: [primaryProject, secondaryProject],
		channels: [designChannel, buildChannel],
		threads: [reviewThread],
		schedules: [],
		pins: [],
		permissions: [],
		messages: {
			[`channel:${designChannel.id}`]: [rootMessage, agentReply],
			[`channel:${buildChannel.id}`]: [buildRoot],
			[`dm:${hermesAgent.id}`]: [dmUserMessage, dmReply],
		},
		...overrides,
	};
}

export function createStoryBootstrap(
	overrides: Partial<CommonspaceBootstrap> = {},
): CommonspaceBootstrap {
	return {
		agents: [hermesAgent, codexAgent],
		discoveredAgents: [],
		state: createStoryState(),
		liveActivities: [],
		queuedFollowups: [],
		routing: {
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: hermesAgent.id,
		},
		...overrides,
	};
}

export const storyBootstrap = createStoryBootstrap();

const denseThreadRoots: CommonspaceMessage[] = Array.from(
	{ length: 7 },
	(_, index) => ({
		id: `message-dense-root-${String(index + 1)}`,
		conversation: { kind: "channel", id: designChannel.id },
		authorType: "user",
		authorId: "sample-user",
		authorName: "You",
		text:
			[
				"Audit the responsive workspace shell and record any clipping or focus issues.",
				"Compare the dense Inbox and Threads layouts against the current visual contract.",
				"Verify keyboard navigation through search, composer suggestions, and settings.",
				"Review the project file previews for text, image, video, and blocked content.",
				"Exercise agent permission requests and queued follow-up controls.",
				"Check long titles, metadata, and status labels at desktop and narrow widths.",
				"Summarize the remaining visual risks with exact Storybook evidence.",
			][index] ?? "Review the remaining interface state.",
		createdAt: `2026-09-03T09:${String(40 + index).padStart(2, "0")}:00.000Z`,
		projectIds: [primaryProject.id],
		projectId: primaryProject.id,
	}),
);

const denseThreads: CommonspaceThread[] = denseThreadRoots.map(
	(message, index) => ({
		id: `thread-dense-${String(index + 1)}`,
		channelId: designChannel.id,
		projectIds: [primaryProject.id],
		projectId: primaryProject.id,
		rootMessageId: message.id,
		agentIds:
			index % 2 === 0 ? [hermesAgent.id] : [hermesAgent.id, codexAgent.id],
		context: {
			channelSnapshot: {
				...memory(
					"Dense Storybook thread inherited from the design review channel.",
				),
				capturedAt: now,
			},
			memory: {
				...memory("Dense Storybook thread context."),
				origin: "automatic",
			},
		},
		createdAt: message.createdAt,
	}),
);

const denseThreadReplies: CommonspaceMessage[] = denseThreadRoots.map(
	(message, index) => ({
		id: `message-dense-reply-${String(index + 1)}`,
		conversation: message.conversation,
		authorType: "agent",
		authorId: hermesAgent.id,
		authorName: hermesAgent.displayName,
		text: `Completed review ${String(index + 1)} with reproducible interaction evidence and follow-up notes.`,
		createdAt: `2026-09-03T09:${String(48 + index).padStart(2, "0")}:30.000Z`,
		projectIds: [primaryProject.id],
		projectId: primaryProject.id,
		threadId: `thread-dense-${String(index + 1)}`,
		parentMessageId: message.id,
		sourceMessageId: message.id,
		replyStatus: "complete",
	}),
);

export const denseStoryBootstrap = (() => {
	const state = createStoryState();
	const denseUnreadIds = denseThreadReplies
		.slice(0, 4)
		.map((message) => message.id);
	return createStoryBootstrap({
		state: {
			...state,
			threads: [...state.threads, ...denseThreads],
			inboxUnreadMessageIds: [agentReply.id, ...denseUnreadIds],
			messages: {
				...state.messages,
				[`channel:${designChannel.id}`]: [
					rootMessage,
					agentReply,
					...denseThreadRoots,
					...denseThreadReplies,
				],
			},
		},
	});
})();

const liveActivity: CommonspaceLiveAgentActivity = {
	id: "activity-live-review",
	sourceMessageId: dmUserMessage.id,
	agentId: hermesAgent.id,
	agentName: hermesAgent.displayName,
	adapter: "hermes",
	conversation: { kind: "dm", id: hermesAgent.id },
	startedAt: "2026-09-03T09:59:10.000Z",
	entries: traceEntries.slice(0, 2),
};

const pendingPermission: CommonspacePermissionRequest = {
	id: "permission-run-tests",
	sourceMessageId: dmUserMessage.id,
	agentId: hermesAgent.id,
	conversation: { kind: "dm", id: hermesAgent.id },
	toolCallId: "tool-run-tests",
	title: "Run the complete browser test suite?",
	kind: "execute",
	options: [
		{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject" },
	],
	status: "pending",
	createdAt: now,
	resolvedAt: null,
};

const queuedFollowups: CommonspaceQueuedFollowup[] = [
	{
		messageId: "followup-responsive",
		conversation: { kind: "dm", id: hermesAgent.id },
		agentIds: [hermesAgent.id],
		text: "After that, verify the narrow conversation layout.",
		position: 0,
		createdAt: now,
		delivery: "queue",
	},
	{
		messageId: "followup-search",
		conversation: { kind: "dm", id: hermesAgent.id },
		agentIds: [hermesAgent.id],
		text: "Then confirm search empty and error states.",
		position: 1,
		createdAt: now,
		delivery: "steer",
	},
];

export const runtimeStoryBootstrap = (() => {
	const state = createStoryState({ permissions: [pendingPermission] });
	return createStoryBootstrap({
		state,
		liveActivities: [liveActivity],
		queuedFollowups,
	});
})();

export const discoveryStoryBootstrap = createStoryBootstrap({
	discoveredAgents: [
		{
			...hermesAgent,
			id: "discovered-hermes-reviewer",
			displayName: "Hermes Reviewer",
			status: "stopped",
			description: "Available from the local Hermes installation.",
		},
		{
			...codexAgent,
			id: "discovered-codex-builder",
			displayName: "Codex Builder",
			status: "stopped",
			description: "Available from the local Codex installation.",
		},
		{
			id: "claude-code",
			displayName: "Claude Code",
			adapter: "claude-code",
			model: null,
			status: "stopped",
			description: "Installed Claude Code harness.",
		},
		{
			id: "gemini",
			displayName: "Gemini CLI",
			adapter: "gemini",
			model: null,
			status: "stopped",
			description: "Installed Gemini CLI harness.",
		},
		{
			id: "opencode",
			displayName: "OpenCode",
			adapter: "opencode",
			model: null,
			status: "stopped",
			description: "Installed OpenCode harness.",
		},
	],
});

export const failedStoryBootstrap = (() => {
	const state = createStoryState();
	const failedReply: CommonspaceMessage = {
		id: "message-dm-failed",
		conversation: dmUserMessage.conversation,
		authorType: "system",
		authorId: "system",
		authorName: "Commonspace",
		text: "The local agent process exited before replying.",
		createdAt: dmReply.createdAt,
		sourceMessageId: dmUserMessage.id,
		projectIds: [primaryProject.id],
		projectId: primaryProject.id,
	};
	return createStoryBootstrap({
		state: {
			...state,
			inboxUnreadMessageIds: [failedReply.id],
			messages: {
				...state.messages,
				[`dm:${hermesAgent.id}`]: [
					{
						...dmUserMessage,
						replyStatus: "failed",
						replyError: failedReply.text,
					},
					failedReply,
				],
			},
		},
	});
})();

export const emptyBootstrap = createStoryBootstrap({
	state: createStoryState({
		projects: [],
		channels: [],
		threads: [],
		messages: {},
	}),
});

interface StoryStoreOptions {
	readonly interactive?: boolean;
	readonly activeConversation?: ConversationRef | null;
	readonly activeProjectId?: string | null;
	readonly activeThreadId?: string | null;
	readonly loading?: boolean;
	readonly error?: string | null;
	readonly notificationVerification?: CommonspaceNotificationVerification;
	readonly pendingSubmissions?: CommonspaceClientSnapshot["pendingSubmissions"];
	readonly send?: CommonspaceStore["send"];
	readonly retryRouting?: CommonspaceStore["retryRouting"];
	readonly diagnostics?: CommonspaceStore["diagnostics"];
	readonly mutate?: CommonspaceStore["mutate"];
	readonly compactChannelContext?: CommonspaceStore["compactChannelContext"];
	readonly updateRoutingConfiguration?: CommonspaceStore["updateRoutingConfiguration"];
	readonly addPin?: CommonspaceStore["addPin"];
	readonly removePin?: CommonspaceStore["removePin"];
	readonly discoverAgents?: CommonspaceStore["discoverAgents"];
	readonly inspectAgentCapabilities?: CommonspaceStore["inspectAgentCapabilities"];
	readonly authenticateAgentMcp?: CommonspaceStore["authenticateAgentMcp"];
}

type StoryStoreHandlers = Readonly<Partial<CommonspaceStore>>;

function createInteractiveStorySend(
	getSnapshot: () => CommonspaceClientSnapshot,
	updateSnapshot: (snapshot: CommonspaceClientSnapshot) => void,
): CommonspaceStore["send"] {
	return async ({ text, threadId }) => {
		const snapshot = getSnapshot();
		const bootstrap = snapshot.bootstrap;
		const conversation = snapshot.activeConversation;
		if (bootstrap === null || conversation === null) return;
		const key = `${conversation.kind}:${conversation.id}`;
		const message: CommonspaceMessage = {
			id: crypto.randomUUID(),
			conversation,
			text,
			authorType: "user",
			authorId: "preview-user",
			authorName: "You",
			createdAt: new Date().toISOString(),
			projectIds: [],
		};
		if (threadId !== undefined) {
			const thread = bootstrap.state.threads.find(
				(item) => item.id === threadId,
			);
			if (thread === undefined)
				throw new Error("Preview thread no longer exists.");
			message.threadId = threadId;
			message.parentMessageId = thread.rootMessageId;
		}
		updateSnapshot({
			...snapshot,
			bootstrap: {
				...bootstrap,
				state: {
					...bootstrap.state,
					messages: {
						...bootstrap.state.messages,
						[key]: [...(bootstrap.state.messages[key] ?? []), message],
					},
				},
			},
		});
	};
}

function storyStoreOptionHandlers(
	options: StoryStoreOptions,
): Partial<CommonspaceStore> {
	const handlers: Partial<CommonspaceStore> = {};
	if (options.send !== undefined) handlers.send = options.send;
	if (options.mutate !== undefined) handlers.mutate = options.mutate;
	if (options.compactChannelContext !== undefined)
		handlers.compactChannelContext = options.compactChannelContext;
	if (options.updateRoutingConfiguration !== undefined)
		handlers.updateRoutingConfiguration = options.updateRoutingConfiguration;
	if (options.diagnostics !== undefined)
		handlers.diagnostics = options.diagnostics;
	if (options.retryRouting !== undefined)
		handlers.retryRouting = options.retryRouting;
	if (options.addPin !== undefined) handlers.addPin = options.addPin;
	if (options.removePin !== undefined) handlers.removePin = options.removePin;
	if (options.discoverAgents !== undefined)
		handlers.discoverAgents = options.discoverAgents;
	if (options.inspectAgentCapabilities !== undefined)
		handlers.inspectAgentCapabilities = options.inspectAgentCapabilities;
	if (options.authenticateAgentMcp !== undefined)
		handlers.authenticateAgentMcp = options.authenticateAgentMcp;
	return handlers;
}

function createStoryStoreHandlers({
	getSnapshot,
	updateSnapshot,
	listeners,
	options,
}: {
	getSnapshot: () => CommonspaceClientSnapshot;
	updateSnapshot: (snapshot: CommonspaceClientSnapshot) => void;
	listeners: Set<() => void>;
	options: StoryStoreOptions;
}): StoryStoreHandlers {
	const handlers: Partial<CommonspaceStore> = {
		getSnapshot,
		discoverAgents: async (adapter) => {
			updateSnapshot({
				...getSnapshot(),
				discovery: {
					status: AgentDiscoveryStatus.Success,
					adapter,
					agents: getSnapshot().bootstrap?.discoveredAgents ?? [],
				},
			});
		},
		dismissError: () => {
			updateSnapshot({ ...getSnapshot(), error: null });
		},
		messages: () => {
			const snapshot = getSnapshot();
			const conversation = snapshot.activeConversation;
			if (conversation === null || snapshot.bootstrap === null) return [];
			return (
				snapshot.bootstrap.state.messages[
					`${conversation.kind}:${conversation.id}`
				] ?? []
			);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		selectThread: (threadId) => {
			const snapshot = getSnapshot();
			if (snapshot.activeThreadId === threadId) return;
			updateSnapshot({ ...snapshot, activeThreadId: threadId });
		},
		connectEvents: () => undefined,
		disconnectEvents: () => undefined,
		selectConversation: (conversation) => {
			if (!options.interactive) return;
			updateSnapshot({
				...getSnapshot(),
				activeConversation: conversation,
				activeThreadId: null,
			});
		},
		selectProject: () => undefined,
		selectDirectory: async () => null,
		verifyDesktopNotifications: async () =>
			options.notificationVerification ?? {
				status: "delivered" as const,
				message:
					"Test notification delivered. Click it to verify Commonspace opens.",
			},
		...storyStoreOptionHandlers(options),
	};
	if (handlers.send === undefined && options.interactive)
		handlers.send = createInteractiveStorySend(getSnapshot, updateSnapshot);
	return handlers;
}

function isStoryStoreHandlerKey(
	handlers: StoryStoreHandlers,
	property: string,
): property is Extract<keyof CommonspaceStore, string> {
	return Object.hasOwn(handlers, property);
}

function createStoryStoreProxy(
	store: CommonspaceClientStore,
	handlers: StoryStoreHandlers,
): CommonspaceStore {
	return new Proxy(store, {
		get(target, property) {
			if (property === Symbol.toStringTag) return "CommonspaceStoryStore";
			if (typeof property === "symbol") return undefined;
			if (property === "toString")
				return () => "[object CommonspaceStoryStore]";
			if (property === "valueOf") return () => target;
			if (isStoryStoreHandlerKey(handlers, property)) return handlers[property];
			return async () => undefined;
		},
	});
}

export function createStoryStore(
	bootstrap: CommonspaceBootstrap | null = storyBootstrap,
	options: StoryStoreOptions = {},
): CommonspaceStore {
	let snapshot: CommonspaceClientSnapshot = {
		bootstrap,
		loading: options.loading ?? false,
		discovery: null,
		pendingSubmissions: options.pendingSubmissions ?? [],
		sending: false,
		error: options.error ?? null,
		activeConversation: options.activeConversation ?? null,
		activeProjectId:
			options.activeProjectId === undefined
				? primaryProject.id
				: options.activeProjectId,
		activeThreadId: options.activeThreadId ?? null,
	};
	const listeners = new Set<() => void>();
	const getSnapshot = () => snapshot;
	const updateSnapshot = (next: CommonspaceClientSnapshot) => {
		snapshot = next;
		for (const listener of listeners) listener();
	};
	const handlers = createStoryStoreHandlers({
		getSnapshot,
		updateSnapshot,
		listeners,
		options,
	});
	return createStoryStoreProxy(new CommonspaceClientStore(), handlers);
}

export const populatedCapabilityInventory: HarnessCapabilityInventory = {
	agentId: hermesAgent.id,
	checkedAt: now,
	groups: [
		{
			id: "tools",
			status: "available",
			source: "Hermes native tool registry",
			notice: "Names reflect current configuration, not runtime approval.",
			items: [
				{
					name: "read_file",
					description: "Read workspace files",
					status: "enabled",
				},
				{
					name: "write_file",
					description: "Modify workspace files",
					status: "configured",
				},
			],
		},
		{
			id: "mcp",
			status: "unavailable",
			source: "Hermes native MCP registry",
			notice: "This harness version does not expose MCP server names.",
			items: [],
		},
		{
			id: "skills",
			status: "error",
			source: "Hermes native skill registry",
			notice: "Skill metadata could not be inspected.",
			items: [],
		},
	],
};

export const codexCapabilityInventory: HarnessCapabilityInventory = {
	agentId: codexAgent.id,
	checkedAt: now,
	groups: [
		{
			id: "mcp",
			status: "available",
			source: "codex mcp list --json",
			notice:
				"Codex user configuration. OAuth status does not verify connection health or other credentials.",
			items: [
				{
					name: "Context catalog",
					status: "enabled",
					authentication: McpAuthenticationStatus.NotAuthenticated,
				},
				{
					name: "Issue tracker",
					status: "enabled",
					authentication: McpAuthenticationStatus.Authenticated,
				},
				{
					name: "Local index",
					status: "enabled",
					authentication: McpAuthenticationStatus.Unsupported,
				},
			],
		},
	],
};

interface StoryErrorResponse {
	error: string;
}

type StoryResponseBody =
	| ProjectDirectoryResponse
	| ProjectGitDiffResponse
	| ProjectGitStatusResponse
	| CommonspaceSearchResponse
	| StoryErrorResponse;

function jsonResponse(value: StoryResponseBody, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const directory: ProjectDirectoryResponse = {
	projectId: primaryProject.id,
	rootIndex: 0,
	path: "",
	truncated: false,
	entries: [
		{ name: "ui", path: "ui", kind: "directory" },
		{
			name: "README.md",
			path: "README.md",
			kind: "file",
			size: 12_480,
			preview: "text",
			contentType: "text/markdown",
		},
		{
			name: "commonspace-logo.png",
			path: "commonspace-logo.png",
			kind: "file",
			size: 84_992,
			preview: "image",
			contentType: "image/png",
		},
		{
			name: "agent-workflow-preview.mp4",
			path: "agent-workflow-preview.mp4",
			kind: "file",
			size: 2_266,
			preview: "video",
			contentType: "video/mp4",
		},
		{
			name: ".env",
			path: ".env",
			kind: "file",
			size: 320,
			preview: "blocked",
			contentType: "text/plain",
		},
	],
};

const nestedDirectory: ProjectDirectoryResponse = {
	...directory,
	path: "ui",
	entries: [
		{ name: "src", path: "ui/src", kind: "directory" },
		{
			name: "CommonspaceApp.tsx",
			path: "ui/CommonspaceApp.tsx",
			kind: "file",
			size: 18_400,
			preview: "text",
			contentType: "text/typescript",
		},
	],
};

const gitStatus: ProjectGitStatusResponse = {
	available: true,
	branch: "main",
	head: "def5678",
	clean: false,
	truncated: false,
	files: [
		{
			path: "ui/src/CommonspaceApp.tsx",
			status: "modified",
			indexStatus: "M",
			worktreeStatus: "M",
			additions: 24,
			deletions: 8,
			preview: "text",
		},
		{
			path: "ui/src/stories/CommonspaceApp.stories.tsx",
			status: "added",
			indexStatus: "?",
			worktreeStatus: "?",
			additions: 48,
			deletions: 0,
			preview: "text",
		},
		{
			path: "docs/visual-baseline.png",
			status: "untracked",
			indexStatus: "?",
			worktreeStatus: "?",
			additions: null,
			deletions: null,
			preview: "image",
		},
	],
};

const gitDiff: ProjectGitDiffResponse = {
	path: "ui/src/CommonspaceApp.tsx",
	binary: false,
	truncated: false,
	patch:
		'@@ -106,7 +106,13 @@ export function CommonspaceApp({ store }: CommonspaceAppProps) {\n-\tconst [activeDestination, setActiveDestination] = useState("inbox");\n+\tconst [activeDestination, setActiveDestination] = useState("inbox");\n+\t// Conversation-first startup keeps attention visible.\n+\treturn <CommonspaceInbox store={store} onOpenItem={openInboxItem} />;',
};

export const storyProjectFetcher: typeof globalThis.fetch = async (input) => {
	const url = new URL(String(input), "http://storybook.local");
	if (url.pathname.endsWith("/files")) {
		return jsonResponse(
			url.searchParams.get("path") === "ui" ? nestedDirectory : directory,
		);
	}
	if (url.pathname.endsWith("/changes")) return jsonResponse(gitStatus);
	if (url.pathname.endsWith("/diff")) return jsonResponse(gitDiff);
	if (url.pathname.endsWith("/file")) {
		const path = url.searchParams.get("path");
		if (path === "commonspace-logo.png")
			return globalThis.fetch(commonspaceLogoUrl);
		if (path === "agent-workflow-preview.mp4")
			return globalThis.fetch(workflowPreviewUrl);
		return new Response("export const story = 'verified';\n", {
			status: 200,
			headers: { "content-type": "text/plain" },
		});
	}
	return jsonResponse({ error: "Unknown Storybook fixture request" }, 404);
};

export const emptyProjectFetcher: typeof globalThis.fetch = async (input) => {
	const url = new URL(String(input), "http://storybook.local");
	if (url.pathname.endsWith("/files")) {
		return jsonResponse({ ...directory, entries: [] });
	}
	if (url.pathname.endsWith("/changes")) {
		return jsonResponse({
			available: true,
			branch: "main",
			head: "def5678",
			clean: true,
			files: [],
			truncated: false,
		});
	}
	return storyProjectFetcher(input);
};

export const errorProjectFetcher: typeof globalThis.fetch = async () =>
	jsonResponse({ error: "Project files are temporarily unavailable." }, 503);

export const mediaErrorProjectFetcher: typeof globalThis.fetch = async (
	input,
) => {
	const url = new URL(String(input), "http://storybook.local");
	if (
		url.pathname.endsWith("/file") &&
		url.searchParams.get("path") === "commonspace-logo.png"
	)
		return jsonResponse({ error: "Preview data could not be read." }, 422);
	return storyProjectFetcher(input);
};

const searchResults: CommonspaceSearchResult[] = [
	{
		id: "channel-design",
		kind: "channel",
		title: "#design-review",
		detail: "Channel · 2 agents",
		receipt: "Channel",
		occurredAt: now,
		highlights: [],
		target: {
			kind: "conversation",
			conversation: { kind: "channel", id: designChannel.id },
		},
	},
	{
		id: "message-root",
		kind: "message",
		projectIds: [primaryProject.id],
		title: "Review the visual baseline",
		detail: "You · design-review",
		receipt: "design-review",
		occurredAt: rootMessage.createdAt,
		highlights: [],
		target: {
			kind: "conversation",
			conversation: { kind: "channel", id: designChannel.id },
			messageId: rootMessage.id,
		},
	},
	{
		id: "file-readme",
		kind: "file",
		projectIds: [primaryProject.id],
		title: "README.md",
		detail: "text/markdown · 12 KB",
		receipt: primaryProject.name,
		highlights: [],
		target: {
			kind: "project-file",
			projectId: primaryProject.id,
			rootIndex: 0,
			path: "README.md",
		},
	},
];

export const storySearchFetcher: typeof globalThis.fetch = async (input) => {
	const url = new URL(String(input), "http://storybook.local");
	const query = url.searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
	const kinds = COMMONSPACE_SEARCH_KINDS.filter((kind) =>
		url.searchParams.get("types")?.split(",").includes(kind),
	);
	const projectId = url.searchParams.get("project");
	const results = searchResults.filter(
		(result) =>
			`${result.title} ${result.detail}`.toLocaleLowerCase().includes(query) &&
			(kinds.length === 0 || kinds.includes(result.kind)) &&
			(projectId === null || result.projectIds?.includes(projectId) === true),
	);
	return jsonResponse({
		query,
		results,
		appliedFilters: { kinds, projectId },
		truncated: false,
	});
};

export const emptySearchFetcher: typeof globalThis.fetch = async (input) => {
	const url = new URL(String(input), "http://storybook.local");
	return jsonResponse({
		query: url.searchParams.get("q") ?? "",
		results: [],
		appliedFilters: { kinds: [], projectId: null },
		truncated: false,
	});
};

export const errorSearchFetcher: typeof globalThis.fetch = async () =>
	jsonResponse({ error: "Search is temporarily unavailable." }, 503);

export const pendingSearchFetcher: typeof globalThis.fetch = async () =>
	new Promise<Response>(() => undefined);
