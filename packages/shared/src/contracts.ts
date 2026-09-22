import type { AgentAdapterKind } from "./agent-adapters.js";

export type { AgentAdapterKind } from "./agent-adapters.js";

export const COMMONSPACE_STATE_VERSION = 33 as const;
export const COMMONSPACE_EXPORT_VERSION = 1 as const;

export interface CommonspaceDefaults {
	maxAgentsPerTurn: number;
	memoryThreads: number;
}

export const enum CommonspaceRoutingProvider {
	Unconfigured = "unconfigured",
	Harness = "harness",
}

export const enum RoutingConfigurationIssue {
	Missing = "missing",
	Invalid = "invalid",
}
export interface UnconfiguredRouting {
	provider: CommonspaceRoutingProvider.Unconfigured;
	reason: RoutingConfigurationIssue;
	message: string;
}
export interface HarnessRoutingConfiguration {
	provider: CommonspaceRoutingProvider.Harness;
	harnessAgentId: string;
}
export type CommonspaceRoutingConfiguration =
	| UnconfiguredRouting
	| HarnessRoutingConfiguration;

export interface UnconfiguredInferenceDiagnostics {
	provider: CommonspaceRoutingProvider.Unconfigured;
	location: "none";
	configured: false;
	sends: string[];
}

export interface HarnessInferenceDiagnostics {
	provider: CommonspaceRoutingProvider.Harness;
	location: "runtime-managed";
	configured: boolean;
	sends: string[];
}

export type CommonspaceInferenceDiagnostics =
	| UnconfiguredInferenceDiagnostics
	| HarnessInferenceDiagnostics;

export interface CommonspaceDiagnostics {
	service: {
		status: "ready" | "attention";
		stateVersion: number;
		storage: "ready" | "attention";
		projectlessWorkspace: "ready" | "attention";
	};
	inference: CommonspaceInferenceDiagnostics;
	harnesses: Array<{
		adapter: AgentAdapterKind;
		installed: boolean;
		rostered: boolean;
		recordedRunStatus: "has-replies" | "no-recorded-runs" | "has-failures";
		recovery: string;
	}>;
}

export interface CommonspaceNotificationSettings {
	enabled: boolean;
	replies: boolean;
	mentions: boolean;
	permissions: boolean;
	failures: boolean;
	sound: boolean;
}

export const DEFAULT_COMMONSPACE_NOTIFICATION_SETTINGS: CommonspaceNotificationSettings =
	{
		enabled: false,
		replies: true,
		mentions: true,
		permissions: true,
		failures: true,
		sound: false,
	};

export interface CommonspaceDesktopNotification {
	category: "reply" | "mention" | "permission" | "failure";
	title: string;
	body: string;
	url: string;
	sound: boolean;
}

export interface CommonspaceNotificationVerification {
	status: "delivered" | "failed";
	message: string;
}

export interface CommonspacePortableProject {
	id: string;
	name: string;
	rootCount: number;
	createdAt: string;
}

export type CommonspacePortableWorkspace = Omit<
	CommonspaceState,
	"version" | "revision" | "dmSessions" | "agentSessions" | "projects"
> & {
	projects: CommonspacePortableProject[];
};

export interface CommonspaceArchiveAttachment {
	kind: "image" | "file";
	id: string;
	name: string;
	mimeType: string;
	size: number;
	data: string;
}

export interface CommonspaceWorkspaceArchive {
	format: "commonspace-workspace";
	version: typeof COMMONSPACE_EXPORT_VERSION;
	exportedAt: string;
	workspace: CommonspacePortableWorkspace;
	attachments: CommonspaceArchiveAttachment[];
}

export interface CommonspaceRetentionPreview {
	revision: number;
	conversation: ConversationRef;
	messages: number;
	threads: number;
	attachments: number;
	pins: number;
	permissions: number;
}

export interface ApplyRetentionRequest {
	conversation: ConversationRef;
	expectedRevision: number;
}

export interface UpdateHarnessRoutingRequest {
	provider: CommonspaceRoutingProvider.Harness;
	harnessAgentId: string;
}
export type UpdateRoutingConfigurationRequest = UpdateHarnessRoutingRequest;

export interface CommonspaceRoutingAssignment {
	id: string;
	agentId: string;
	/** Historical wording only; never used for new delivery. */
	legacySubRequest?: string;
	projectIds: string[];
}

export interface CommonspaceRoutingCorrection {
	id: string;
	fromAssignmentId: string;
	toAssignmentId: string;
	createdAt: string;
}

export type CommonspaceRoutingMode = "parallel" | "relay";

export interface CommonspaceRoutingDecision {
	source: "explicit" | "ai" | "local";
	/** Relay assignments speak in order; omitted legacy decisions are parallel. */
	mode?: CommonspaceRoutingMode;
	status?: "pending" | "resolved" | "failed";
	startedAt?: string;
	resolvedAt?: string;
	durationMs?: number;
	agentIds: string[];
	assignments: CommonspaceRoutingAssignment[];
	corrections: CommonspaceRoutingCorrection[];
	inferredProjectIds: string[];
	confidence?: number;
	reason: string;
}

export interface CommonspaceAgentProfile {
	id: string;
	displayName: string;
	/** Commonspace-local appearance; never used to address the native harness. */
	avatarEmoji?: string;
	accentColor?: string;
	adapter: AgentAdapterKind;
	/** @deprecated Legacy imported profile reference retained only for persisted-history compatibility. */
	nativeProfile?: string;
	model: string | null;
	/** Runs started by Commonspace bypass native approval prompts for this agent. */
	fullAccess?: boolean;
	/** Effective permission policy for a rostered agent; server overrides cannot be changed here. */
	permissionPolicy?: { source: "server" | "agent"; fullAccess: boolean };
	status: "running" | "stopped" | "unknown";
	description?: string;
}

/** @deprecated Use CommonspaceAgentProfile. */
export type HermesAgentProfile = CommonspaceAgentProfile;

export interface CommonspaceAgentDefinition {
	id: string;
	displayName: string;
	/** Commonspace-local appearance; never used to address the native harness. */
	avatarEmoji?: string;
	accentColor?: string;
	adapter: AgentAdapterKind;
	/** @deprecated Legacy imported profile reference retained only for persisted-history compatibility. */
	nativeProfile?: string;
	model: string | null;
	/** Runs started by Commonspace bypass native approval prompts for this agent. */
	fullAccess?: boolean;
	createdAt: string;
}

export interface CommonspaceProject {
	id: string;
	name: string;
	paths: string[];
	createdAt: string;
}

export type CommonspaceTracePlanStatus =
	| "pending"
	| "in_progress"
	| "completed";
export type CommonspaceTraceToolStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed";

export interface CommonspaceTracePlanStep {
	text: string;
	priority: "high" | "medium" | "low";
	status: CommonspaceTracePlanStatus;
}

export type CommonspaceTraceEntry =
	| {
			type: "compaction";
			id: string;
			status: "in_progress" | "completed" | "failed" | "cancelled";
			text: string;
			createdAt: string;
			updatedAt: string;
	  }
	| {
			type: "reasoning";
			id: string;
			text: string;
			createdAt: string;
			updatedAt: string;
	  }
	| {
			type: "plan";
			id: string;
			steps: CommonspaceTracePlanStep[];
			markdown?: string;
			createdAt: string;
			updatedAt: string;
	  }
	| {
			type: "tool";
			id: string;
			title: string;
			toolName?: string;
			toolKind?: string;
			status: CommonspaceTraceToolStatus;
			input?: string;
			output?: string;
			createdAt: string;
			updatedAt: string;
	  }
	| {
			type: "usage";
			id: "usage";
			usedTokens: number;
			contextWindow: number;
			costAmount?: number;
			costCurrency?: string;
			createdAt: string;
			updatedAt: string;
	  };

export interface CommonspaceAgentTrace {
	adapter: AgentAdapterKind;
	startedAt: string;
	completedAt: string;
	entries: CommonspaceTraceEntry[];
}

export interface CommonspaceRunFileChange {
	path: string;
	status:
		| "modified"
		| "added"
		| "deleted"
		| "renamed"
		| "untracked"
		| "conflicted";
	preExisting: boolean;
	additions: number | null;
	deletions: number | null;
	patch?: string;
	patchTruncated?: boolean;
}

export type CommonspaceRunRootAttribution =
	| {
			available: true;
			rootIndex: number;
			/** Project that owns this root when a run spans multiple Projects. */
			projectId?: string;
			/** Root index inside the owning Project. */
			projectRootIndex?: number;
			branch: string | null;
			headBefore: string | null;
			headAfter: string | null;
			preExisting: Array<{
				path: string;
				status: CommonspaceRunFileChange["status"];
			}>;
			observed: CommonspaceRunFileChange[];
	  }
	| {
			available: false;
			rootIndex: number;
			/** Project that owns this root when a run spans multiple Projects. */
			projectId?: string;
			/** Root index inside the owning Project. */
			projectRootIndex?: number;
			reason: string;
	  };

export interface CommonspaceRunAttribution {
	startedAt: string;
	completedAt: string;
	roots: CommonspaceRunRootAttribution[];
}

export interface CommonspaceChannelMemory {
	summary: string;
	decisions: string[];
	openQuestions: string[];
	threadIds: string[];
	updatedAt: string | null;
	/** How the current compacted representation was produced. */
	origin?: "automatic" | "inference" | "user";
	/** Whether newer source messages exist beyond the current representation. */
	status?: "empty" | "current" | "stale" | "compacting" | "failed";
	sourceMessageCount?: number;
	estimatedTokens?: number;
	compactedThroughMessageId?: string | null;
}

export interface CommonspaceRoutingMemory {
	summary: string;
	status: "empty" | "current" | "stale" | "failed";
	correctionCount: number;
	compactedThroughCorrectionId: string | null;
	updatedAt: string | null;
}

export interface UpdateChannelContextRequest {
	summary: string;
	decisions?: string[] | undefined;
	openQuestions?: string[] | undefined;
}

export type UpdateThreadContextRequest = UpdateChannelContextRequest;

export interface CommonspaceChannel {
	id: string;
	name: string;
	agentIds: string[];
	instructions: string;
	memory: CommonspaceChannelMemory;
	routingMemory: CommonspaceRoutingMemory;
	createdAt: string;
}

export type ConversationRef =
	| { kind: "channel"; id: string }
	| { kind: "dm"; id: string };

export type CommonspaceImageMimeType =
	| "image/png"
	| "image/jpeg"
	| "image/gif"
	| "image/webp";

/** Public metadata for image bytes managed privately by the Commonspace host. */
export interface CommonspaceImageAttachment {
	id: string;
	name: string;
	mimeType: CommonspaceImageMimeType;
	size: number;
}

/** Base64 image payload accepted only at the local send boundary. */
export interface SendImageAttachment {
	name: string;
	mimeType: CommonspaceImageMimeType;
	data: string;
}

export interface CommonspaceFileAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
}

export interface SendFileAttachment {
	name: string;
	mimeType: string;
	data: string;
}

/** Provider-emitted activity for an agent turn that is still running. */
export interface CommonspaceLiveAgentActivity {
	id: string;
	/** User message whose delivery started this agent run. */
	sourceMessageId: string;
	agentId: string;
	agentName: string;
	adapter: AgentAdapterKind;
	conversation: ConversationRef;
	threadId?: string;
	startedAt: string;
	entries: CommonspaceTraceEntry[];
}

export interface CommonspaceMessage {
	id: string;
	conversation: ConversationRef;
	authorType: "user" | "agent" | "system";
	authorId: string;
	authorName: string;
	text: string;
	attachments?: CommonspaceImageAttachment[];
	files?: CommonspaceFileAttachment[];
	createdAt: string;
	/** Authoritative Project context for this message; Channels themselves are global. */
	projectIds?: string[];
	/** @deprecated Compatibility mirror of the first projectIds entry. */
	projectId?: string;
	threadId?: string;
	parentMessageId?: string;
	/** User message that initiated the agent run represented by this message. */
	sourceMessageId?: string;
	/** First human message in this visible version chain. */
	versionRootMessageId?: string;
	/** Earlier delivered human message superseded by this branch. */
	supersedesMessageId?: string;
	/** Conversation branch created for this version. */
	branchId?: string;
	/** Delivered content was removed while retaining its transcript marker. */
	deletedAt?: string;
	/** Routing assignment that initiated this reply or failure. */
	routingAssignmentId?: string;
	/** Lifecycle of the agent reply requested by a direct-message user turn. */
	replyStatus?: CommonspaceReplyStatus;
	replyError?: string;
	/** Sanitized provider-emitted reasoning, plan, tool, and usage activity for this reply. */
	trace?: CommonspaceAgentTrace;
	/** Repository changes observed between this run's start and completion. */
	runAttribution?: CommonspaceRunAttribution;
	/** Inspectable routing decision for a channel user message. */
	routing?: CommonspaceRoutingDecision;
}

export type CommonspaceReplyStatus =
	| "queued"
	| "running"
	| "complete"
	| "needs_input"
	| "failed"
	| "cancelled"
	| "silent"
	| "timeout"
	| "error";

export interface CommonspaceThreadMemory {
	summary: string;
	decisions: string[];
	openQuestions: string[];
	updatedAt: string | null;
	origin: "automatic" | "inference" | "user";
	status: "empty" | "current" | "stale" | "compacting" | "failed";
	sourceMessageCount: number;
	estimatedTokens: number;
	compactedThroughMessageId: string | null;
}

export interface CommonspaceThreadContextSnapshot
	extends CommonspaceThreadMemory {
	capturedAt: string;
}

export interface CommonspaceThreadContext {
	channelSnapshot: CommonspaceThreadContextSnapshot;
	memory: CommonspaceThreadMemory;
}

export type CommonspacePinScope =
	| { kind: "channel"; id: string }
	| { kind: "thread"; id: string };

interface CommonspacePinBase {
	id: string;
	scope: CommonspacePinScope;
	createdAt: string;
	removedAt: string | null;
}

export interface CommonspaceMessagePin extends CommonspacePinBase {
	kind: "message";
	messageId: string;
}

export interface CommonspaceAttachmentPin extends CommonspacePinBase {
	kind: "attachment";
	messageId: string;
	attachmentId: string;
}

export interface CommonspaceNotePin extends CommonspacePinBase {
	kind: "note";
	note: string;
}

export type CommonspacePin =
	| CommonspaceMessagePin
	| CommonspaceAttachmentPin
	| CommonspaceNotePin;

export interface CommonspacePermissionOption {
	optionId: string;
	name: string;
	kind: string;
}

export interface CommonspacePermissionRequest {
	id: string;
	sourceMessageId: string;
	agentId: string;
	conversation: ConversationRef;
	threadId?: string;
	toolCallId: string;
	title: string;
	kind?: string;
	options: CommonspacePermissionOption[];
	status: "pending" | "resolved" | "cancelled" | "interrupted";
	selectedOptionId?: string;
	createdAt: string;
	resolvedAt: string | null;
}

export type AddPinRequest =
	| { scope: CommonspacePinScope; kind: "message"; messageId: string }
	| {
			scope: CommonspacePinScope;
			kind: "attachment";
			messageId: string;
			attachmentId: string;
	  }
	| { scope: CommonspacePinScope; kind: "note"; note: string };

export interface CommonspaceThread {
	id: string;
	channelId: string;
	/** Authoritative Project context inherited by every message in this thread. */
	projectIds?: string[];
	/** @deprecated Compatibility mirror of the first projectIds entry. */
	projectId: string | null;
	rootMessageId: string;
	agentIds: string[];
	branchedFromThreadId?: string;
	branchPointMessageId?: string;
	context: CommonspaceThreadContext;
	createdAt: string;
}

export interface CommonspaceState {
	version: typeof COMMONSPACE_STATE_VERSION;
	revision: number;
	/** Single-owner cursor for activity shown in the Inbox. */
	inboxReadAt: string | null;
	/** Agent message IDs opened individually after the global read cursor. */
	inboxReadMessageIds: string[];
	/** Message IDs manually marked unread, including messages outside Inbox derivation. */
	inboxUnreadMessageIds?: string[];
	inboxSavedItemIds: string[];
	followedSessionIds: string[];
	mutedSessionIds: string[];
	notifications: CommonspaceNotificationSettings;
	defaults: CommonspaceDefaults;
	agents: CommonspaceAgentDefinition[];
	/** Host-private native session scope selected for each direct message. */
	dmSessions: Record<string, string>;
	agentSessions: Record<string, Record<string, string>>;
	/** Host-private cleanup intent, committed with deletion before removing bytes. */
	pendingAttachmentDeletions?: { imageIds: string[]; fileIds: string[] };
	projects: CommonspaceProject[];
	channels: CommonspaceChannel[];
	threads: CommonspaceThread[];
	pins: CommonspacePin[];
	permissions: CommonspacePermissionRequest[];
	messages: Record<string, CommonspaceMessage[]>;
}

export interface CommonspaceBootstrap {
	agents: CommonspaceAgentProfile[];
	discoveredAgents: CommonspaceAgentProfile[];
	state: CommonspaceState;
	liveActivities?: CommonspaceLiveAgentActivity[];
	queuedFollowups?: CommonspaceQueuedFollowup[];
	routing?: CommonspaceRoutingConfiguration;
}

export interface DiscoverAgentsRequest {
	adapter: AgentAdapterKind;
}

export type CommonspaceMutation =
	| { action: "mark-inbox-read" }
	| { action: "mark-inbox-item-read"; messageId: string }
	| { action: "set-inbox-item-unread"; messageId: string; unread: boolean }
	| { action: "set-inbox-item-saved"; messageId: string; saved: boolean }
	| { action: "set-session-followed"; sessionId: string; followed: boolean }
	| { action: "set-session-muted"; sessionId: string; muted: boolean }
	| {
			action: "set-notifications";
			notifications: CommonspaceNotificationSettings;
	  }
	| { action: "create-project"; name: string; paths: string[] }
	| { action: "add-project-path"; projectId: string; path: string }
	| { action: "remove-project"; projectId: string }
	| { action: "create-channel"; name: string; agentIds: string[] }
	| { action: "set-channel-agents"; channelId: string; agentIds: string[] }
	| { action: "set-channel-context"; channelId: string; instructions: string }
	| {
			action: "set-channel-memory";
			channelId: string;
			summary: string;
			decisions?: string[] | undefined;
			openQuestions?: string[] | undefined;
	  }
	| {
			action: "set-channel-configuration";
			channelId: string;
			agentIds: string[];
			instructions: string;
			summary: string;
			decisions?: string[] | undefined;
			openQuestions?: string[] | undefined;
	  }
	| {
			action: "set-defaults";
			maxAgentsPerTurn?: number | undefined;
			memoryThreads?: number | undefined;
	  }
	| {
			action: "add-discovered-agent";
			agentId: string;
			adapter?: AgentAdapterKind | undefined;
			fullAccess?: boolean | undefined;
	  }
	| {
			action: "update-agent-profile";
			agentId: string;
			displayName: string;
			avatarEmoji?: string | undefined;
			accentColor?: string | undefined;
			fullAccess?: boolean | undefined;
	  }
	| { action: "remove-agent"; agentId: string }
	| { action: "reset-dm"; agentId: string }
	| { action: "remove-channel"; channelId: string };

export interface SendMessageRequest {
	conversation: ConversationRef;
	text: string;
	/** Zero, one, or many explicit Project references. */
	projectIds?: string[] | undefined;
	/** @deprecated Use projectIds. */
	projectId?: string | undefined;
	threadId?: string | undefined;
	/** Restrict a channel-thread reply to one current channel agent. */
	targetAgentId?: string | undefined;
	attachments?: SendImageAttachment[] | undefined;
	files?: SendFileAttachment[] | undefined;
	/** Behavior when the same conversation session already has an active run. */
	delivery?: "queue" | "steer" | "stop-and-send" | undefined;
}

export interface CommonspaceQueuedFollowup {
	messageId: string;
	conversation: ConversationRef;
	threadId?: string;
	agentIds: string[];
	text: string;
	position: number;
	createdAt: string;
	delivery: "queue" | "steer" | "stop-and-send";
}

export interface ReorderFollowupRequest {
	messageId: string;
	direction: "up" | "down";
}

export interface RemoveFollowupRequest {
	messageId: string;
}

export interface FollowupQueueResponse {
	queuedFollowups: CommonspaceQueuedFollowup[];
}

export interface SendMessageResponse {
	accepted: CommonspaceMessage;
	thread?: CommonspaceThread;
	state: CommonspaceState;
}

export interface EditMessageRequest {
	messageId: string;
	text: string;
	projectIds?: string[] | undefined;
}

export interface RerouteAssignmentRequest {
	sourceMessageId: string;
	assignmentId: string;
	agentId: string;
	projectIds: string[];
}

export interface RerouteAssignmentResponse {
	sourceMessageId: string;
	assignment: CommonspaceRoutingAssignment;
	correction: CommonspaceRoutingCorrection;
	state: CommonspaceState;
}

export type RetryRoutingRequest =
	| { sourceMessageId: string; mode: "ai" }
	| { sourceMessageId: string; mode: "manual"; agentId: string };

export interface RetryRoutingResponse {
	accepted: CommonspaceMessage;
	thread: CommonspaceThread;
	state: CommonspaceState;
}

export interface StopAgentRunsRequest {
	messageId: string;
	/** When omitted, stop every agent run initiated by the message. */
	agentId?: string | undefined;
}

export interface StopAgentRunsResponse {
	stoppedAgentIds: string[];
}

export interface CommonspaceApiError {
	error: string;
	code: string;
}

export interface SelectDirectoryResponse {
	path: string | null;
}

export function conversationKey(ref: ConversationRef): string {
	return `${ref.kind}:${ref.id}`;
}

/** Read canonical Project references while legacy singular snapshots remain supported. */
export function referencedProjectIds(value: {
	projectIds?: readonly string[];
	projectId?: string | null;
}): string[] {
	return [
		...new Set(
			[
				...(value.projectIds ?? []),
				...(value.projectId === undefined || value.projectId === null
					? []
					: [value.projectId]),
			].filter((projectId) => projectId !== ""),
		),
	];
}
