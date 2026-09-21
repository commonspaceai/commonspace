import type {
	CommonspaceAgentDefinition,
	CommonspaceAgentProfile,
	CommonspaceMutation,
	CommonspaceState,
} from "@commonspace/shared";
import {
	AGENT_ADAPTERS,
	agentTagName,
	COMMONSPACE_STATE_VERSION,
	DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS,
	isAgentAdapterKind,
	uniqueAgentDisplayName,
} from "@commonspace/shared";
import type { JsonValue } from "./json.js";
import { projectChannelMemory } from "./memory.js";
import { applyProjectMutation } from "./state/project-mutations.js";

export const DM_SESSION_BOUNDARY_AUTHOR_ID = "dm-session-boundary";

export interface StateDependencies {
	ids(): string;
	now(): string;
}

const defaults: StateDependencies = {
	ids: () => crypto.randomUUID(),
	now: () => new Date().toISOString(),
};

function optionalModel(
	value: JsonValue | undefined,
	current: string | null,
): string | null {
	if (value === undefined) return current;
	if (value === null) return null;
	if (typeof value !== "string")
		throw new Error("model must be a string or null");
	const normalized = value.trim();
	if (normalized.length > 200) throw new Error("model must fit 200 characters");
	return normalized === "" ? null : normalized;
}

interface BoundedIntegerOptions {
	current: number;
	minimum: number;
	maximum: number;
	label: string;
}

function validatedIntegerSetting(
	value: JsonValue | undefined,
	options: BoundedIntegerOptions,
): number {
	if (value === undefined) return options.current;
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${options.label} must be a finite number`);
	if (
		!Number.isInteger(value) ||
		value < options.minimum ||
		value > options.maximum
	)
		throw new Error(
			`${options.label} must be an integer from ${options.minimum} to ${options.maximum}`,
		);
	return value;
}

export function emptyChannelMemory() {
	return {
		summary: "",
		decisions: [],
		openQuestions: [],
		threadIds: [],
		updatedAt: null,
		origin: "automatic" as const,
		status: "empty" as const,
		sourceMessageCount: 0,
		estimatedTokens: 0,
		compactedThroughMessageId: null,
	};
}

export function emptyRoutingMemory() {
	return {
		summary: "",
		status: "empty" as const,
		correctionCount: 0,
		compactedThroughCorrectionId: null,
		updatedAt: null,
	};
}

function normalizedContextEntries(
	value: JsonValue | undefined,
	label: string,
): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return [
		...new Set(
			value
				.map((entry) => {
					if (typeof entry !== "string")
						throw new Error(`${label} must contain only strings`);
					return entry
						.normalize("NFKC")
						.trim()
						.replace(/\s+/g, " ")
						.slice(0, 2_000);
				})
				.filter(Boolean),
		),
	].slice(0, 50);
}

export function defaultCommonspaceDefaults() {
	return {
		maxAgentsPerTurn: 4,
		memoryThreads: 12,
	};
}

export function defaultNotificationSettings() {
	return { ...DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS };
}

function normalizedName(value: string, label: string): string {
	const name = value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
	if (name === "") throw new Error(`${label} name is required`);
	return name;
}

function normalizedAvatarEmoji(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const emoji = value.normalize("NFKC").trim().slice(0, 16);
	return emoji === "" ? undefined : emoji;
}

function normalizedAccentColor(value: string | undefined): string | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const color = value.trim().toLocaleLowerCase();
	if (!/^#[0-9a-f]{6}$/u.test(color))
		throw new Error("agent accent color must be a six-digit hex color");
	return color;
}

function normalizedChannel(value: string): string {
	const name = value
		.normalize("NFKC")
		.trim()
		.replace(/^#+/, "")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48)
		.replace(/-$/g, "");
	if (name === "") throw new Error("channel name is required");
	return name;
}

export function codexAgentId(nativeProfile: string): string {
	return `codex-${normalizedChannel(normalizedName(nativeProfile, "agent"))}`;
}

function nextRevision(state: CommonspaceState): number {
	return Math.max(0, state.revision) + 1;
}

function channelAgentIds(
	state: CommonspaceState,
	agentIds: readonly string[],
): string[] {
	const uniqueIds = [...new Set(agentIds.filter(Boolean))];
	const knownIds = new Set(state.agents.map((agent) => agent.id));
	const unknownId = uniqueIds.find((agentId) => !knownIds.has(agentId));
	if (unknownId !== undefined)
		throw new Error(`unknown channel agent: ${unknownId}`);
	return uniqueIds;
}

function validateDiscoveredAgentIdentity(agent: CommonspaceAgentProfile): void {
	if (!isAgentAdapterKind(agent.adapter))
		throw new Error("unsupported agent adapter");
	switch (agent.adapter) {
		case "hermes":
			if (
				agent.id.trim() !== agent.id ||
				agent.id === "" ||
				agent.id.length > 200 ||
				/\s/u.test(agent.id)
			)
				throw new Error("invalid discovered agent id");
			return;
		case "codex": {
			const nativeProfile = agent.nativeProfile;
			const knownHarness = agent.id === "codex" && nativeProfile === undefined;
			const legacyProfile =
				nativeProfile !== undefined &&
				nativeProfile.trim() === nativeProfile &&
				nativeProfile !== "" &&
				nativeProfile.length <= 200 &&
				!/\s/u.test(nativeProfile) &&
				codexAgentId(nativeProfile) === agent.id;
			if (!knownHarness && !legacyProfile)
				throw new Error("invalid discovered Codex identity");
			return;
		}
		case "claude-code":
		case "gemini":
		case "opencode":
			if (agent.id !== agent.adapter || agent.nativeProfile !== undefined)
				throw new Error(
					`invalid discovered ${AGENT_ADAPTERS[agent.adapter].label} identity`,
				);
			return;
	}
}

export function createInitialState(): CommonspaceState {
	return {
		version: COMMONSPACE_STATE_VERSION,
		revision: 0,
		inboxReadAt: null,
		inboxReadMessageIds: [],
		inboxUnreadMessageIds: [],
		inboxSavedItemIds: [],
		followedSessionIds: [],
		mutedSessionIds: [],
		notifications: defaultNotificationSettings(),
		defaults: defaultCommonspaceDefaults(),
		agents: [],
		dmSessions: {},
		agentSessions: {},
		projects: [],
		channels: [],
		threads: [],
		pins: [],
		permissions: [],
		messages: {},
	};
}

export function addDiscoveredAgent(
	state: CommonspaceState,
	agent: CommonspaceAgentProfile,
	dependencies: StateDependencies = defaults,
): CommonspaceState {
	validateDiscoveredAgentIdentity(agent);
	const displayName = uniqueAgentDisplayName(
		normalizedName(agent.displayName, "agent"),
		agent.adapter,
		state.agents,
	);
	const id = agent.id;
	if (state.agents.some((candidate) => candidate.id === id))
		throw new Error(`agent ${displayName} already exists`);
	const discoveredAgent: CommonspaceAgentDefinition = {
		id,
		displayName,
		adapter: agent.adapter,
		model: optionalModel(agent.model, null),
		createdAt: dependencies.now(),
	};
	if (agent.fullAccess === true) discoveredAgent.fullAccess = true;
	if (agent.nativeProfile !== undefined)
		discoveredAgent.nativeProfile = agent.nativeProfile;
	return {
		...state,
		revision: nextRevision(state),
		agents: [...state.agents, discoveredAgent],
	};
}

type MutationOf<Action extends CommonspaceMutation["action"]> = Extract<
	CommonspaceMutation,
	{ action: Action }
>;

function markInboxRead(
	state: CommonspaceState,
	dependencies: StateDependencies,
): CommonspaceState {
	const readAt = dependencies.now();
	if (
		state.inboxReadAt !== null &&
		state.inboxReadAt >= readAt &&
		state.inboxReadMessageIds.length === 0 &&
		(state.inboxUnreadMessageIds ?? []).length === 0
	)
		return state;
	return {
		...state,
		revision: nextRevision(state),
		inboxReadAt: readAt,
		inboxReadMessageIds: [],
		inboxUnreadMessageIds: [],
	};
}

function markInboxItemRead(
	state: CommonspaceState,
	mutation: MutationOf<"mark-inbox-item-read">,
): CommonspaceState {
	const messageId = mutation.messageId.trim();
	const message = Object.values(state.messages)
		.flat()
		.find((candidate) => candidate.id === messageId);
	const permission = state.permissions.some(
		(candidate) =>
			candidate.status === "pending" && candidate.sourceMessageId === messageId,
	);
	if (message === undefined && !permission)
		throw new Error("inbox item not found");
	const inboxUnreadMessageIds = (state.inboxUnreadMessageIds ?? []).filter(
		(id) => id !== messageId,
	);
	if (
		state.inboxReadMessageIds.includes(messageId) &&
		inboxUnreadMessageIds.length === (state.inboxUnreadMessageIds ?? []).length
	)
		return state;
	const inboxReadMessageIds = state.inboxReadMessageIds.includes(messageId)
		? state.inboxReadMessageIds
		: [...state.inboxReadMessageIds, messageId];
	return {
		...state,
		revision: nextRevision(state),
		inboxReadMessageIds,
		inboxUnreadMessageIds,
	};
}

function setInboxItemUnread(
	state: CommonspaceState,
	mutation: MutationOf<"set-inbox-item-unread">,
): CommonspaceState {
	const messageId = mutation.messageId.trim();
	if (messageId === "") throw new Error("inbox item message id is required");
	const messageExists = Object.values(state.messages)
		.flat()
		.some((message) => message.id === messageId);
	const permissionExists = state.permissions.some(
		(permission) =>
			permission.status === "pending" &&
			permission.sourceMessageId === messageId,
	);
	if (!messageExists && !permissionExists)
		throw new Error("inbox item not found");
	const currentUnread = state.inboxUnreadMessageIds ?? [];
	const inboxUnreadMessageIds = mutation.unread
		? [...new Set([...currentUnread, messageId])]
		: currentUnread.filter((id) => id !== messageId);
	const inboxReadMessageIds = mutation.unread
		? state.inboxReadMessageIds.filter((id) => id !== messageId)
		: [...new Set([...state.inboxReadMessageIds, messageId])];
	if (
		JSON.stringify(inboxUnreadMessageIds) === JSON.stringify(currentUnread) &&
		JSON.stringify(inboxReadMessageIds) ===
			JSON.stringify(state.inboxReadMessageIds)
	)
		return state;
	return {
		...state,
		revision: nextRevision(state),
		inboxReadMessageIds,
		inboxUnreadMessageIds,
	};
}

function setInboxItemSaved(
	state: CommonspaceState,
	mutation: MutationOf<"set-inbox-item-saved">,
): CommonspaceState {
	const messageId = mutation.messageId.trim();
	const message = Object.values(state.messages)
		.flat()
		.find(
			(candidate) =>
				candidate.id === messageId &&
				(candidate.authorType === "agent" ||
					(candidate.authorType === "system" &&
						/\brun failed:/iu.test(candidate.text)) ||
					candidate.replyStatus === "error" ||
					candidate.replyStatus === "failed" ||
					candidate.replyStatus === "timeout" ||
					candidate.replyStatus === "silent" ||
					candidate.replyStatus === "needs_input"),
		);
	const permission = state.permissions.some(
		(candidate) =>
			candidate.status === "pending" && candidate.sourceMessageId === messageId,
	);
	if (message === undefined && !permission)
		throw new Error("inbox item not found");
	const inboxSavedItemIds = mutation.saved
		? [...new Set([...state.inboxSavedItemIds, messageId])]
		: state.inboxSavedItemIds.filter((id) => id !== messageId);
	if (
		inboxSavedItemIds.length === state.inboxSavedItemIds.length &&
		inboxSavedItemIds.every(
			(id, index) => id === state.inboxSavedItemIds[index],
		)
	)
		return state;
	return { ...state, revision: nextRevision(state), inboxSavedItemIds };
}

function setSessionFollowed(
	state: CommonspaceState,
	mutation: MutationOf<"set-session-followed">,
): CommonspaceState {
	const sessionId = mutation.sessionId.trim();
	if (sessionId === "" || sessionId.length > 500)
		throw new Error("invalid session id");
	const followedSessionIds = mutation.followed
		? [...new Set([...state.followedSessionIds, sessionId])]
		: state.followedSessionIds.filter((id) => id !== sessionId);
	const mutedSessionIds = mutation.followed
		? state.mutedSessionIds.filter((id) => id !== sessionId)
		: state.mutedSessionIds;
	if (
		followedSessionIds.length === state.followedSessionIds.length &&
		mutedSessionIds.length === state.mutedSessionIds.length
	)
		return state;
	return {
		...state,
		revision: nextRevision(state),
		followedSessionIds,
		mutedSessionIds,
	};
}

function setSessionMuted(
	state: CommonspaceState,
	mutation: MutationOf<"set-session-muted">,
): CommonspaceState {
	const sessionId = mutation.sessionId.trim();
	if (sessionId === "" || sessionId.length > 500)
		throw new Error("invalid session id");
	const mutedSessionIds = mutation.muted
		? [...new Set([...state.mutedSessionIds, sessionId])]
		: state.mutedSessionIds.filter((id) => id !== sessionId);
	const followedSessionIds = mutation.muted
		? state.followedSessionIds.filter((id) => id !== sessionId)
		: state.followedSessionIds;
	if (
		mutedSessionIds.length === state.mutedSessionIds.length &&
		followedSessionIds.length === state.followedSessionIds.length
	)
		return state;
	return {
		...state,
		revision: nextRevision(state),
		followedSessionIds,
		mutedSessionIds,
	};
}

function setNotifications(
	state: CommonspaceState,
	mutation: MutationOf<"set-notifications">,
): CommonspaceState {
	const notifications = mutation.notifications;
	if (
		typeof notifications !== "object" ||
		notifications === null ||
		typeof notifications.enabled !== "boolean" ||
		typeof notifications.replies !== "boolean" ||
		typeof notifications.mentions !== "boolean" ||
		typeof notifications.permissions !== "boolean" ||
		typeof notifications.failures !== "boolean" ||
		typeof notifications.sound !== "boolean"
	)
		throw new Error("notification settings must be booleans");
	const next = {
		enabled: notifications.enabled,
		replies: notifications.replies,
		mentions: notifications.mentions,
		permissions: notifications.permissions,
		failures: notifications.failures,
		sound: notifications.sound,
	};
	if (JSON.stringify(next) === JSON.stringify(state.notifications))
		return state;
	return { ...state, revision: nextRevision(state), notifications: next };
}

function createChannel(
	state: CommonspaceState,
	mutation: MutationOf<"create-channel">,
	dependencies: StateDependencies,
): CommonspaceState {
	const name = normalizedChannel(mutation.name);
	if (state.channels.some((channel) => channel.name === name))
		throw new Error(`channel #${name} already exists`);
	const agentIds = channelAgentIds(state, mutation.agentIds);
	return {
		...state,
		revision: nextRevision(state),
		channels: [
			...state.channels,
			{
				id: dependencies.ids(),
				name,
				agentIds,
				instructions: "",
				memory: emptyChannelMemory(),
				routingMemory: emptyRoutingMemory(),
				createdAt: dependencies.now(),
			},
		],
	};
}

function setChannelAgents(
	state: CommonspaceState,
	mutation: MutationOf<"set-channel-agents">,
): CommonspaceState {
	if (!state.channels.some((channel) => channel.id === mutation.channelId))
		throw new Error("unknown channel");
	const agentIds = channelAgentIds(state, mutation.agentIds);
	const channels = state.channels.map((channel) => {
		if (channel.id !== mutation.channelId) return channel;
		return { ...channel, agentIds };
	});
	return { ...state, revision: nextRevision(state), channels };
}

function setChannelContext(
	state: CommonspaceState,
	mutation: MutationOf<"set-channel-context">,
): CommonspaceState {
	let matched = false;
	const instructions = mutation.instructions
		.normalize("NFKC")
		.trim()
		.slice(0, 8_000);
	const channels = state.channels.map((channel) => {
		if (channel.id !== mutation.channelId) return channel;
		matched = true;
		return { ...channel, instructions };
	});
	if (!matched) throw new Error("unknown channel");
	return { ...state, revision: nextRevision(state), channels };
}

function setChannelMemory(
	state: CommonspaceState,
	mutation: MutationOf<"set-channel-memory">,
	dependencies: StateDependencies,
): CommonspaceState {
	if (typeof mutation.summary !== "string")
		throw new Error("channel context summary is required");
	const summary = mutation.summary.normalize("NFKC").trim().slice(0, 16_000);
	const decisions = normalizedContextEntries(
		mutation.decisions,
		"channel context decisions",
	);
	const openQuestions = normalizedContextEntries(
		mutation.openQuestions,
		"channel context open questions",
	);
	const projection = projectChannelMemory(
		state,
		mutation.channelId,
		state.defaults.memoryThreads,
	);
	let matched = false;
	const channels = state.channels.map((channel) => {
		if (channel.id !== mutation.channelId) return channel;
		matched = true;
		return {
			...channel,
			memory: {
				summary,
				decisions,
				openQuestions,
				threadIds: projection.threadIds,
				updatedAt: dependencies.now(),
				origin: "user" as const,
				status: "current" as const,
				sourceMessageCount: projection.sourceMessageCount ?? 0,
				estimatedTokens: projection.estimatedTokens ?? 0,
				compactedThroughMessageId: projection.compactedThroughMessageId ?? null,
			},
		};
	});
	if (!matched) throw new Error("unknown channel");
	return { ...state, revision: nextRevision(state), channels };
}

function setChannelConfiguration(
	state: CommonspaceState,
	mutation: MutationOf<"set-channel-configuration">,
	dependencies: StateDependencies,
): CommonspaceState {
	if (!state.channels.some((channel) => channel.id === mutation.channelId))
		throw new Error("unknown channel");
	if (typeof mutation.instructions !== "string")
		throw new Error("channel instructions are required");
	if (typeof mutation.summary !== "string")
		throw new Error("channel context summary is required");
	const agentIds = channelAgentIds(state, mutation.agentIds);
	const instructions = mutation.instructions
		.normalize("NFKC")
		.trim()
		.slice(0, 8_000);
	const summary = mutation.summary.normalize("NFKC").trim().slice(0, 16_000);
	const decisions = normalizedContextEntries(
		mutation.decisions,
		"channel context decisions",
	);
	const openQuestions = normalizedContextEntries(
		mutation.openQuestions,
		"channel context open questions",
	);
	const projection = projectChannelMemory(
		state,
		mutation.channelId,
		state.defaults.memoryThreads,
	);
	const updatedAt = dependencies.now();
	let matched = false;
	const channels = state.channels.map((channel) => {
		if (channel.id !== mutation.channelId) return channel;
		matched = true;
		return {
			...channel,
			agentIds,
			instructions,
			memory: {
				summary,
				decisions,
				openQuestions,
				threadIds: projection.threadIds,
				updatedAt,
				origin: "user" as const,
				status: "current" as const,
				sourceMessageCount: projection.sourceMessageCount ?? 0,
				estimatedTokens: projection.estimatedTokens ?? 0,
				compactedThroughMessageId: projection.compactedThroughMessageId ?? null,
			},
		};
	});
	if (!matched) throw new Error("unknown channel");
	return { ...state, revision: nextRevision(state), channels };
}

function setDefaults(
	state: CommonspaceState,
	mutation: MutationOf<"set-defaults">,
): CommonspaceState {
	return {
		...state,
		revision: nextRevision(state),
		defaults: {
			maxAgentsPerTurn: validatedIntegerSetting(mutation.maxAgentsPerTurn, {
				current: state.defaults.maxAgentsPerTurn,
				minimum: 1,
				maximum: 8,
				label: "max agents per turn",
			}),
			memoryThreads: validatedIntegerSetting(mutation.memoryThreads, {
				current: state.defaults.memoryThreads,
				minimum: 1,
				maximum: 50,
				label: "memory thread window",
			}),
		},
	};
}

function updateAgentProfile(
	state: CommonspaceState,
	mutation: MutationOf<"update-agent-profile">,
): CommonspaceState {
	const displayName = normalizedName(mutation.displayName, "agent");
	const displayHandle = agentTagName(displayName);
	if (
		displayHandle === "all" ||
		state.agents.some(
			(agent) =>
				agent.id !== mutation.agentId &&
				agentTagName(agent.displayName) === displayHandle,
		)
	)
		throw new Error("agent workspace name already exists");
	const avatarEmoji = normalizedAvatarEmoji(mutation.avatarEmoji);
	const accentColor = normalizedAccentColor(mutation.accentColor);
	let matched = false;
	const agents = state.agents.map((agent) => {
		if (agent.id !== mutation.agentId) return agent;
		matched = true;
		const updated: CommonspaceAgentDefinition = {
			id: agent.id,
			displayName,
			adapter: agent.adapter,
			model: agent.model,
			fullAccess: mutation.fullAccess ?? agent.fullAccess === true,
			createdAt: agent.createdAt,
		};
		if (avatarEmoji !== undefined) updated.avatarEmoji = avatarEmoji;
		if (accentColor !== undefined) updated.accentColor = accentColor;
		if (agent.nativeProfile !== undefined)
			updated.nativeProfile = agent.nativeProfile;
		return updated;
	});
	if (!matched) throw new Error("unknown agent");
	const messages = Object.fromEntries(
		Object.entries(state.messages).map(([key, entries]) => [
			key,
			entries.map((message) =>
				message.authorType === "agent" && message.authorId === mutation.agentId
					? { ...message, authorName: displayName }
					: message,
			),
		]),
	);
	return { ...state, revision: nextRevision(state), agents, messages };
}

function removeAgent(
	state: CommonspaceState,
	mutation: MutationOf<"remove-agent">,
): CommonspaceState {
	if (!state.agents.some((agent) => agent.id === mutation.agentId))
		return state;
	return {
		...state,
		revision: nextRevision(state),
		agents: state.agents.filter((agent) => agent.id !== mutation.agentId),
		dmSessions: Object.fromEntries(
			Object.entries(state.dmSessions).filter(
				([agentId]) => agentId !== mutation.agentId,
			),
		),
		agentSessions: Object.fromEntries(
			Object.entries(state.agentSessions).filter(
				([agentId]) => agentId !== mutation.agentId,
			),
		),
		channels: state.channels.map((channel) => ({
			...channel,
			agentIds: channel.agentIds.filter(
				(agentId) => agentId !== mutation.agentId,
			),
		})),
		threads: state.threads.map((thread) => ({
			...thread,
			agentIds: thread.agentIds.filter(
				(agentId) => agentId !== mutation.agentId,
			),
		})),
		messages: Object.fromEntries(
			Object.entries(state.messages).filter(
				([key]) => key !== `dm:${mutation.agentId}`,
			),
		),
	};
}

function resetDirectMessage(
	state: CommonspaceState,
	mutation: MutationOf<"reset-dm">,
	dependencies: StateDependencies,
): CommonspaceState {
	const previousScope = state.dmSessions[mutation.agentId] ?? "Bot Chat";
	const nextScope = `Commonspace DM: ${dependencies.ids()}`;
	const scopes = state.agentSessions[mutation.agentId];
	const remainingScopes =
		scopes === undefined
			? undefined
			: Object.fromEntries(
					Object.entries(scopes).filter(([scope]) => scope !== previousScope),
				);
	const agentSessions = { ...state.agentSessions };
	if (
		remainingScopes === undefined ||
		Object.keys(remainingScopes).length === 0
	)
		delete agentSessions[mutation.agentId];
	else agentSessions[mutation.agentId] = remainingScopes;
	const conversation = { kind: "dm" as const, id: mutation.agentId };
	const messageKey = `dm:${mutation.agentId}`;
	const previousMessages = state.messages[messageKey] ?? [];
	const messages = {
		...state.messages,
		[messageKey]: [
			...previousMessages.map((message) =>
				message.replyStatus === "queued" || message.replyStatus === "running"
					? {
							...message,
							replyStatus: "error" as const,
							replyError: "Interrupted by /new.",
						}
					: message,
			),
			{
				id: dependencies.ids(),
				conversation,
				authorType: "system" as const,
				authorId: DM_SESSION_BOUNDARY_AUTHOR_ID,
				authorName: "Commonspace",
				text: "New session started",
				createdAt: dependencies.now(),
			},
		],
	};
	return {
		...state,
		revision: nextRevision(state),
		dmSessions: { ...state.dmSessions, [mutation.agentId]: nextScope },
		agentSessions,
		messages,
	};
}

function removeChannel(
	state: CommonspaceState,
	mutation: MutationOf<"remove-channel">,
	dependencies: StateDependencies,
): CommonspaceState {
	if (!state.channels.some((channel) => channel.id === mutation.channelId))
		return state;
	const removedSessionNames = new Set(
		state.threads
			.filter((thread) => thread.channelId === mutation.channelId)
			.map((thread) => `Commonspace Thread: ${thread.id}`),
	);
	removedSessionNames.add(`Commonspace Routing: ${mutation.channelId}`);
	const removedThreadIds = new Set(
		state.threads
			.filter((thread) => thread.channelId === mutation.channelId)
			.map((thread) => thread.id),
	);
	const removedAt = dependencies.now();
	const agentSessions: CommonspaceState["agentSessions"] = {};
	for (const [agentId, sessions] of Object.entries(state.agentSessions)) {
		const remaining = Object.fromEntries(
			Object.entries(sessions).filter(
				([name]) => !removedSessionNames.has(name),
			),
		);
		if (Object.keys(remaining).length > 0) agentSessions[agentId] = remaining;
	}
	return {
		...state,
		revision: nextRevision(state),
		channels: state.channels.filter(
			(channel) => channel.id !== mutation.channelId,
		),
		threads: state.threads.filter(
			(thread) => thread.channelId !== mutation.channelId,
		),
		pins: state.pins.map((pin) =>
			pin.removedAt === null &&
			((pin.scope.kind === "channel" && pin.scope.id === mutation.channelId) ||
				(pin.scope.kind === "thread" && removedThreadIds.has(pin.scope.id)))
				? { ...pin, removedAt }
				: pin,
		),
		agentSessions,
		messages: Object.fromEntries(
			Object.entries(state.messages).filter(
				([key]) => key !== `channel:${mutation.channelId}`,
			),
		),
	};
}

export function applyMutation(
	state: CommonspaceState,
	mutation: CommonspaceMutation,
	dependencies: StateDependencies = defaults,
): CommonspaceState {
	switch (mutation.action) {
		case "mark-inbox-read":
			return markInboxRead(state, dependencies);
		case "mark-inbox-item-read":
			return markInboxItemRead(state, mutation);
		case "set-inbox-item-unread":
			return setInboxItemUnread(state, mutation);
		case "set-inbox-item-saved":
			return setInboxItemSaved(state, mutation);
		case "set-session-followed":
			return setSessionFollowed(state, mutation);
		case "set-session-muted":
			return setSessionMuted(state, mutation);
		case "set-notifications":
			return setNotifications(state, mutation);
		case "create-project":
		case "add-project-path":
		case "remove-project":
			return applyProjectMutation(state, mutation, dependencies);
		case "create-channel":
			return createChannel(state, mutation, dependencies);
		case "set-channel-agents":
			return setChannelAgents(state, mutation);
		case "set-channel-context":
			return setChannelContext(state, mutation);
		case "set-channel-memory":
			return setChannelMemory(state, mutation, dependencies);
		case "set-channel-configuration":
			return setChannelConfiguration(state, mutation, dependencies);
		case "set-defaults":
			return setDefaults(state, mutation);
		case "add-discovered-agent": {
			throw new Error(
				"discovered agent must be resolved by the Commonspace host",
			);
		}
		case "update-agent-profile":
			return updateAgentProfile(state, mutation);
		case "remove-agent":
			return removeAgent(state, mutation);
		case "reset-dm":
			return resetDirectMessage(state, mutation, dependencies);
		case "remove-channel":
			return removeChannel(state, mutation, dependencies);
		default: {
			const neverMutation: never = mutation;
			throw new Error(`unknown mutation ${JSON.stringify(neverMutation)}`);
		}
	}
}
