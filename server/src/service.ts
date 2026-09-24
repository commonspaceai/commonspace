import {
	chmod,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { McpServer as AcpMcpServer } from "@agentclientprotocol/sdk";
import type {
	AddPinRequest,
	AgentAdapterKind,
	ApplyRetentionRequest,
	CommonspaceAgentDefinition,
	CommonspaceAgentProfile,
	CommonspaceAgentTrace,
	CommonspaceArchiveAttachment,
	CommonspaceBootstrap,
	CommonspaceChannelMemory,
	CommonspaceDesktopNotification,
	CommonspaceDiagnostics,
	CommonspaceFileAttachment,
	CommonspaceImageAttachment,
	CommonspaceImageMimeType,
	CommonspaceLiveAgentActivity,
	CommonspaceMessage,
	CommonspaceMutation,
	CommonspaceNotificationVerification,
	CommonspacePermissionOption,
	CommonspacePermissionRequest,
	CommonspacePin,
	CommonspacePinScope,
	CommonspaceQueuedFollowup,
	CommonspaceRetentionPreview,
	CommonspaceRoutingAssignment,
	CommonspaceRoutingConfiguration,
	CommonspaceRoutingCorrection,
	CommonspaceRoutingDecision,
	CommonspaceRoutingMode,
	CommonspaceRunAttribution,
	CommonspaceRunFileChange,
	CommonspaceRunRootAttribution,
	CommonspaceState,
	CommonspaceThread,
	CommonspaceThreadContext,
	CommonspaceTraceEntry,
	CommonspaceTracePlanStep,
	CommonspaceWorkspaceArchive,
	EditMessageRequest,
	FollowupQueueResponse,
	HarnessCapabilityInventory,
	HarnessCapabilityItem,
	RemoveFollowupRequest,
	ReorderFollowupRequest,
	RerouteAssignmentRequest,
	RerouteAssignmentResponse,
	RetryRoutingRequest,
	RetryRoutingResponse,
	SendFileAttachment,
	SendMessageRequest,
	SendMessageResponse,
	StopAgentRunsRequest,
	StopAgentRunsResponse,
	UpdateChannelContextRequest,
	UpdateThreadContextRequest,
} from "@commonspace/shared";
import {
	AGENT_ADAPTER_KINDS,
	AGENT_ADAPTERS,
	agentMentionName,
	COMMONSPACE_EXPORT_VERSION,
	COMMONSPACE_STATE_VERSION,
	CommonspaceRoutingProvider,
	conversationKey,
	deriveCommonspaceInboxItems,
	isAgentAdapterKind,
	projectTagName,
	referencedProjectIds,
	uniqueAgentDisplayName,
} from "@commonspace/shared";
import { type Context, context, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
	AcpAgentProcess,
	type AcpRunInput,
	AcpSessionLoadError,
	AcpSessionRunError,
} from "./acp-runtime.js";
import {
	type AgentAdapterConfig,
	createAgentAdapters,
	type NativeAgentAdapter,
} from "./adapters/index.js";
import {
	type AiRouteInput,
	buildRoutingPrompt,
	parseRoutingResponse,
	RoutingResponseValidationError,
	routingOutputTokenBudget,
} from "./ai-router.js";
import type {
	CommonspaceMcpGateway,
	CommonspaceMcpHandoffRequest,
	CommonspaceMcpHandoffResponse,
	CommonspaceMcpProvider,
	CommonspaceMcpScope,
} from "./commonspace-mcp.js";
import {
	buildChannelContextCompactionPrompt,
	hasChangedCompactionEvidence,
	hasInvalidatedContextSources,
	inferredChannelMemory,
	parseChannelContextCompaction,
} from "./context.js";
import {
	ContextHistoryIndex,
	type ContextHistoryMatches,
	type ContextHistoryPage,
} from "./context-history.js";
import { credentialBearingFileName } from "./credential-files.js";
import {
	createDesktopNotifier,
	desktopNotificationForItem,
} from "./desktop-notifications.js";
import {
	type AgentGeneratedFile,
	MAX_FILE_ATTACHMENT_BYTES,
	MAX_FILE_ATTACHMENTS,
	MAX_FILE_ATTACHMENTS_BYTES,
	type PreparedFileAttachment,
	prepareAgentFileAttachments,
} from "./file-attachments.js";
import { type JsonObject, type JsonValue, jsonObject } from "./json.js";
import type { RunningClassifier } from "./local-classifier.js";
import { LocalHistoryEmbeddings } from "./local-history-embeddings.js";
import { routeLocally } from "./local-routing.js";
import {
	mergeChannelMemoryProjection,
	projectChannelMemory,
} from "./memory.js";
import {
	finalHandoffAgent,
	mentionedAgents,
	mentionedChannelAgents,
	parseTags,
	rankChannelAgents,
} from "./relay.js";
import {
	invalidRouting,
	loadSavedRoutingConfiguration,
	missingRouting,
	type PrivateRoutingConfiguration,
	prepareRoutingConfiguration,
	publicRoutingConfiguration,
	type RoutingConfigurationRequest,
} from "./routing-configuration.js";
import {
	activeRoutingCorrectionCount,
	buildRoutingMemoryCompactionPrompt,
	currentRoutingExamples,
	parseRoutingMemoryCompaction,
	routingSummaryStillSupported,
} from "./routing-memory.js";
import {
	buildRetrievedRoutingContext,
	RoutingMessageIndex,
} from "./routing-retrieval.js";
import {
	captureRunSnapshot,
	completeRunAttribution,
	type RunSnapshot,
} from "./run-attribution.js";
import type { HistoryEmbedder } from "./semantic-history.js";
import {
	addDiscoveredAgent,
	applyMutation,
	codexAgentId,
	createInitialState,
	DM_SESSION_BOUNDARY_AUTHOR_ID,
	defaultCommonspaceDefaults,
	defaultNotificationSettings,
	emptyChannelMemory,
	emptyRoutingMemory,
} from "./state.js";
import {
	markOperationFailed,
	recordOperationException,
	serverTracer,
} from "./telemetry.js";
import {
	buildThreadContextCompactionPrompt,
	createThreadContext,
	emptyThreadMemory,
	inferredThreadMemory,
	mergeThreadMemoryProjection,
	projectThreadMemory,
	projectThreadMemoryFromMessages,
} from "./thread-context.js";
import {
	assertWorkspaceExportPlanSize,
	assertWorkspaceExportSize,
	assertWorkspaceImportSize,
	assertWorkspaceProjectMappingsSize,
} from "./workspace-portability.js";

const MAX_MESSAGE_CHARS = 16_000;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENTS_BYTES = 16 * 1024 * 1024;
const MAX_AGENT_RESPONSE_CHARS = 64_000;

function agentTimeoutReason(signal: AbortSignal): Error | undefined {
	if (!signal.aborted) return undefined;
	const reason: unknown = signal.reason;
	return reason instanceof Error && reason.name === "TimeoutError"
		? reason
		: undefined;
}
const MAX_MCP_CONTEXT_CHARS = 64_000;

const MAX_MCP_CONTEXT_MESSAGES = 30;
const MAX_MCP_CREDENTIALS = 10_000;
const MAX_MCP_SEARCH_SNIPPET_CHARS = 500;
const MAX_RELAY_PEER_RESPONSE_CHARS = 4_000;
const MAX_TRACE_ENTRIES = 128;
const MAX_TRACE_CHARS = 256_000;
const MAX_EPHEMERAL_SESSIONS_PER_PROCESS = 64;
const SHARED_CONTEXT_PRESSURE_TOKENS = 24_000;
const MANAGED_AGENT_ID_PATTERN = /^codex-[\p{L}\p{N}][\p{L}\p{N}-]{0,79}$/u;
const CANONICAL_BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const FILE_MIME_TYPE_PATTERN =
	/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;

function boundedRelayPeerResponse(text: string): string {
	if (text.length <= MAX_RELAY_PEER_RESPONSE_CHARS) return text;
	const sideLength = MAX_RELAY_PEER_RESPONSE_CHARS / 2;
	return [
		text.slice(0, sideLength),
		"[Peer response truncated; use commonspace_get_context for the full reply.]",
		text.slice(-sideLength),
	].join("\n\n");
}

function searchSnippet(text: string, includedTerms: readonly string[]): string {
	if (text.length <= MAX_MCP_SEARCH_SNIPPET_CHARS) return text;
	const searchable = text.normalize("NFKC").toLocaleLowerCase();
	const matchIndex =
		includedTerms
			.map((term) => searchable.indexOf(term))
			.filter((index) => index >= 0)
			.sort((left, right) => left - right)[0] ?? 0;
	const start = Math.max(
		0,
		matchIndex - Math.floor(MAX_MCP_SEARCH_SNIPPET_CHARS / 3),
	);
	const prefix = start > 0 ? "…" : "";
	const needsSuffix =
		text.length > start + MAX_MCP_SEARCH_SNIPPET_CHARS - prefix.length;
	const suffix = needsSuffix ? "…" : "";
	return `${prefix}${text.slice(start, start + MAX_MCP_SEARCH_SNIPPET_CHARS - prefix.length - suffix.length)}${suffix}`;
}
const THREAD_SESSION_SCOPE_PATTERN =
	/^Commonspace Thread: [0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DM_SESSION_SCOPE_PATTERN =
	/^Commonspace DM: [0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTING_SESSION_SCOPE_PREFIX = "Commonspace Routing: ";
const CHANNEL_CONTEXT_PROCESS_SCOPE_PREFIX = "Commonspace Channel Context: ";
const THREAD_CONTEXT_PROCESS_SCOPE_PREFIX = "Commonspace Thread Context: ";
const IMAGE_ATTACHMENT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

function completedReplyStatus(text: string): "complete" | "silent" {
	const value = text.trim();
	if (value === "") return "silent";
	return "complete";
}

export interface CommonspaceHostConfig extends AgentAdapterConfig {
	root?: string;
	defaultCwd?: string;
	agentYolo?: boolean | AgentAdapterKind;
	runBudgetSeconds?: number;
}

export interface CommonspaceHostEnvironment {
	logger?: {
		warn(cause: unknown): void;
	};
}

export interface AgentRunInput {
	agent: CommonspaceAgentProfile;
	cwd: string;
	additionalCwds: string[];
	sessionName: string;
	/** Reusable ACP process lane; native session history remains sessionName-scoped. */
	processScopeName?: string;
	/** Rejects a delayed process launch after its owning lane has expired. */
	processScopeIsCurrent?: () => boolean;
	/** Do not retain this fresh native session for later resume. */
	ephemeralSession?: boolean;
	/** The one newly delivered Commonspace message, without replayed context. */
	message: string;
	/** Roster and delivery metadata supplied separately from the original message. */
	participationContext?: string;
	maxResponseChars?: number;
	images?: readonly AgentImageInput[];
	files?: readonly AgentFileInput[];
	commonspaceScope?: CommonspaceMcpScope;
	sessionId?: string;
	onTraceUpdate?: (entries: readonly CommonspaceTraceEntry[]) => void;
	onPermissionRequest?: (
		request: AgentPermissionRequest,
	) => Promise<AgentPermissionOutcome>;
	/** Aborted when the user stops the Commonspace message that initiated this run. */
	signal: AbortSignal;
}

export interface AgentImageInput {
	name: string;
	mimeType: CommonspaceImageMimeType;
	data: string;
}

export interface AgentFileInput {
	name: string;
	mimeType: string;
	size: number;
	uri: string;
}

export interface AgentRunResult {
	text: string;
	sessionId?: string;
	trace?: CommonspaceAgentTrace;
	files?: AgentGeneratedFile[];
}

export type { AgentGeneratedFile } from "./file-attachments.js";

export interface AgentPermissionRequest {
	toolCallId: string;
	title: string;
	kind?: string;
	options: CommonspacePermissionOption[];
}

export interface AgentPermissionOutcome {
	optionId?: string;
}

export enum CommonspaceHostPerformancePhase {
	AcceptanceRequestPreparation = "acceptance.request-preparation",
	AcceptanceStateMutation = "acceptance.state-mutation",
	AcceptancePersistenceSerialization = "acceptance.persistence-serialization",
	AcceptancePersistenceQueue = "acceptance.persistence-queue",
	AcceptancePersistenceWrite = "acceptance.persistence-write",
	AcceptanceResponseSnapshot = "acceptance.response-snapshot",
	BootstrapStateSnapshot = "bootstrap.state-snapshot",
	BootstrapAssembly = "bootstrap.assembly",
}

export interface CommonspaceHostPerformanceMeasurement {
	phase: CommonspaceHostPerformancePhase;
	durationMs: number;
}

export interface CommonspaceHostDependencies {
	historyEmbeddings: HistoryEmbedder;
	discoverAgents(adapter: AgentAdapterKind): Promise<CommonspaceAgentProfile[]>;
	runAgent(input: AgentRunInput): Promise<string | AgentRunResult>;
	routeAgents(input: CommonspaceRouteInput): Promise<CommonspaceRouteResult>;
	classifyRouting: RunningClassifier["classify"];
	notify(notification: CommonspaceDesktopNotification): Promise<void>;
	beforeAcceptSend?(prepared: PreparedSend): Promise<void>;
	afterPersistSendAttachments?(prepared: PreparedSend): Promise<void>;
	beforePersistRoutingConfiguration?(
		configuration: CommonspaceRoutingConfiguration,
	): Promise<void>;
	onPerformanceMeasurement?(
		measurement: CommonspaceHostPerformanceMeasurement,
	): void | Promise<void>;
}

export type CommonspaceRouteInput = AiRouteInput;

export interface CommonspaceRouteResult {
	source?: "local";
	assignments: Array<
		Pick<CommonspaceRoutingAssignment, "agentId" | "projectIds">
	>;
	mode: CommonspaceRoutingMode;
	confidence?: number;
	reason: string;
}

interface PreparedChannelRoute {
	channelId: string;
	candidates: CommonspaceRouteInput["candidates"];
	projects: CommonspaceRouteInput["projects"];
	input: CommonspaceRouteInput;
}

interface ResolvedRoutingProjects {
	inferredProjectIds: string[];
	projects: CommonspaceState["projects"];
}

interface ResolvedPendingRouting {
	routing: CommonspaceRoutingDecision;
	projects: CommonspaceState["projects"];
	accepted: CommonspaceMessage;
	thread?: CommonspaceThread;
}

interface PendingRoutingDecisionInput {
	prepared: PreparedSend;
	response: SendMessageResponse;
	decision: CommonspaceRouteResult;
	assignments: CommonspaceRoutingAssignment[];
	projects: ResolvedRoutingProjects;
}

interface FailedRoutingDecision extends CommonspaceRoutingDecision {
	status: "failed";
}

interface FailedRoutingSource extends CommonspaceMessage {
	authorType: "user";
	conversation: Extract<
		SendMessageRequest["conversation"],
		{ kind: "channel" }
	>;
	routing: FailedRoutingDecision;
	threadId: string;
}

interface LocatedRoutingRetry {
	key: string;
	source: FailedRoutingSource;
	thread: CommonspaceThread;
}

interface PreparedRoutingRetrySend extends PreparedSend {
	routing: CommonspaceRoutingDecision;
}

interface PreparedRoutingRetry extends LocatedRoutingRetry {
	prepared: PreparedRoutingRetrySend;
}

interface RoutingRetryStateChange {
	accepted: CommonspaceMessage;
	thread: CommonspaceThread;
}

interface PreparedSend {
	request: SendMessageRequest;
	text: string;
	attachments: PreparedImageAttachment[];
	files: PreparedFileAttachment[];

	agents: readonly CommonspaceAgentProfile[];
	agentIds: string[];
	agentExecutionRevisions: ReadonlyMap<string, number>;
	routing?: CommonspaceRoutingDecision;
	channel?: CommonspaceState["channels"][number];
	channelAdmission?: PreparedChannelAdmission;
	projects: CommonspaceState["projects"];
	inferProjects: boolean;
	projectScopeExplicit: boolean;
	/** Compatibility primary Project while singular consumers are migrated. */
	project?: CommonspaceState["projects"][number];
	thread?: CommonspaceThread;
	dmSessionName?: string;
	version?: Pick<
		CommonspaceMessage,
		"versionRootMessageId" | "supersedesMessageId" | "branchId"
	>;
	branch?: {
		branchedFromThreadId: string;
		branchPointMessageId: string;
		channelSnapshot: CommonspaceThread["context"]["channelSnapshot"];
	};
}

interface PreparedChannelAdmission {
	channelAgentIds: readonly string[];
	thread?: {
		id: string;
		agentIds: readonly string[];
		projectIds: readonly string[];
	};
}

interface PreparedSendProjectSelection {
	requestedProjectIds: string[];
	selectionProvided: boolean;
	legacyThreadSelection: boolean;
}

interface PreparedSendInput {
	text: string;
	attachments: PreparedImageAttachment[];
	files: PreparedFileAttachment[];
	projectSelection: PreparedSendProjectSelection;
}

interface PreparedChannelContext {
	channel: CommonspaceState["channels"][number];
	admission: PreparedChannelAdmission;
	projects: CommonspaceState["projects"];
	thread?: CommonspaceThread;
}

type PreparedSendConversation =
	| {
			kind: "channel";
			agents: readonly CommonspaceAgentProfile[];
			agentIds: string[];
			channel: CommonspaceState["channels"][number];
			admission: PreparedChannelAdmission;
			projects: CommonspaceState["projects"];
			routing: CommonspaceRoutingDecision;
			thread?: CommonspaceThread;
	  }
	| {
			kind: "dm";
			agents: readonly CommonspaceAgentProfile[];
			agentIds: [string];
			projects: CommonspaceState["projects"];
			dmSessionName: string;
	  };

interface PreparedImageAttachment {
	metadata: CommonspaceImageAttachment;
	data: Buffer;
}

interface AgentDelivery {
	authorType: "user" | "agent";
	authorId: string;
	authorName: string;
	text: string;
	projectIds?: readonly string[];
	images?: readonly AgentImageInput[];
	files?: readonly AgentFileInput[];
	routingAssignmentId?: string;
}

interface ActiveAgentRun {
	id: string;
	sourceMessageId: string;
	agentId: string;
	agentExecutionRevision: number;
	phase: "running" | "terminal";
	projectIds: string[];
	conversation: SendMessageRequest["conversation"];
	routingAssignmentId?: string;
	scopeKey: string;
	progressMessageIds: Set<string>;
	abortController: AbortController;
}

interface AgentRunExecutionContext {
	run: ActiveAgentRun;
	agent: CommonspaceAgentProfile;
	authority: CommonspaceAgentDefinition | undefined;
	prepared: PreparedSend;
	thread: CommonspaceThread | undefined;
}

interface AgentSessionRunInput {
	execution: AgentRunExecutionContext;
	delivery: AgentDelivery;
	deliveryProjects: readonly CommonspaceState["projects"][number][];
	projectRoots: readonly PreparedProjectRoot[];
	memberIds: readonly string[];
	cwd: string;
	sessionName: string;
	sessionId: string | undefined;
}

interface AgentSessionRunResult {
	response: AgentRunResult;
	startedAt: string;
	snapshots: Array<PreparedProjectRoot & { snapshot: RunSnapshot }>;
}

interface ReplyDeliverySession {
	prepared: PreparedSend;
	response: SendMessageResponse;
	thread: CommonspaceThread | undefined;
	effectiveLimit: number;
	memberIds: readonly string[];
	delivered: Set<string>;
	routingAssignments: readonly CommonspaceRoutingAssignment[];
	relayMode: boolean;
	remainingRelayAssignments: CommonspaceRoutingAssignment[];
	relayEdges: Set<string>;
	deliveredTurns: number;
	maxRelayTurns: number;
	relayStopRecorded: boolean;
}

interface AgentReplyCompletionInput {
	execution: AgentRunExecutionContext;
	delivery: AgentDelivery;
	deliveryProjects: readonly CommonspaceState["projects"][number][];
	projectRoots: readonly PreparedProjectRoot[];
	sessionName: string;
	sessionRun: AgentSessionRunResult;
	requestedHandoff: CommonspaceMcpHandoffRequest | undefined;
}

interface CompletedAgentReply {
	reply: CommonspaceMessage;
	requestedHandoffTarget: CommonspaceAgentProfile | undefined;
}

interface PreparedAgentReplyRun {
	agent: CommonspaceAgentProfile;
	deliveryProjects: CommonspaceState["projects"];
	projectRoots: PreparedProjectRoot[];
	cwd: string;
	sessionName: string;
	activeRun: ActiveAgentRun;
	execution: AgentRunExecutionContext;
}

interface ReplyContinuationInput {
	session: ReplyDeliverySession;
	agent: CommonspaceAgentProfile;
	reply: CommonspaceMessage;
	delivery: AgentDelivery;
	requestedHandoff: CommonspaceMcpHandoffRequest | undefined;
	requestedHandoffTarget: CommonspaceAgentProfile | undefined;
}

interface RequestedReplyContinuationInput extends ReplyContinuationInput {
	requestedHandoff: CommonspaceMcpHandoffRequest;
}

interface PreparedAgentAssignment {
	agentId: string;
	projectIds: string[];
	routingAssignmentId?: string;
}

interface PreparedReroute {
	key: string;
	source: CommonspaceMessage;
	routing: CommonspaceRoutingDecision;
	original: CommonspaceRoutingAssignment;
	agents: readonly CommonspaceAgentProfile[];
	target: CommonspaceAgentProfile;
	agentExecutionRevisions: ReadonlyMap<string, number>;
	projects: CommonspaceState["projects"];
	thread: CommonspaceThread;
	channel: CommonspaceState["channels"][number];
}

interface RerouteStateChange {
	assignment: CommonspaceRoutingAssignment;
	correction: CommonspaceRoutingCorrection;
	source: CommonspaceMessage;
	thread: CommonspaceThread;
	channel: CommonspaceState["channels"][number];
	deliveryNeeded: boolean;
}

interface PendingFollowupInvalidation {
	runs: ActiveAgentRun[];
	interruptRouting: boolean;
	removeFollowup: boolean;
}

interface PendingRunInvalidations {
	agentRuns: ActiveAgentRun[];
	routingFollowups: PendingFollowup[];
}

interface ActiveAcpSession {
	sessionId: string;
	processScopeKey: string;
}

interface AcquiredAcpProcess {
	processClient: AcpAgentProcess;
	settings: ReturnType<NativeAgentAdapter["sessionSettings"]>;
}

interface AcpProcessLaunchPlan {
	input: AgentRunInput;
	processScopeKey: string;
	adapter: NativeAgentAdapter;
	currentAgent: CommonspaceAgentDefinition;
	fullAccess: boolean;
	settings: ReturnType<NativeAgentAdapter["sessionSettings"]>;
	processClient: AcpAgentProcess | undefined;
}

interface PreparedAcpExecution extends AcquiredAcpProcess {
	input: AgentRunInput;
	mcpServers: AcpMcpServer[];
	sessionScopeKey: string;
	processScopeKey: string;
}

type CommonspaceMutationOf<Action extends CommonspaceMutation["action"]> =
	Extract<CommonspaceMutation, { action: Action }>;

type MutationProcessCleanup =
	| { kind: "none" }
	| { kind: "remove-agent"; agentId: string }
	| { kind: "reset-dm"; runs: ActiveAgentRun[]; scopeKey: string }
	| {
			kind: "remove-channel";
			processScopeNames: ReadonlySet<string>;
			activeSessions: Array<{
				sessionScopeKey: string;
				session: ActiveAcpSession;
			}>;
	  };

interface PreparedMutation {
	previousState: CommonspaceState;
	previousRoutingConfiguration: PrivateRoutingConfiguration;
	removesInferenceSelection: boolean;
	processCleanup: MutationProcessCleanup;
}

type InferenceScope =
	| { kind: "channel-routing"; channelId: string }
	| { kind: "channel-context"; channelId: string }
	| { kind: "thread-context"; threadId: string };

function inferenceProcessScopeName(scope: InferenceScope): string {
	switch (scope.kind) {
		case "channel-routing":
			return `${ROUTING_SESSION_SCOPE_PREFIX}${scope.channelId}`;
		case "channel-context":
			return `${CHANNEL_CONTEXT_PROCESS_SCOPE_PREFIX}${scope.channelId}`;
		case "thread-context":
			return `${THREAD_CONTEXT_PROCESS_SCOPE_PREFIX}${scope.threadId}`;
	}
}

function inferenceScopeExists(
	state: CommonspaceState,
	scope: InferenceScope,
): boolean {
	switch (scope.kind) {
		case "channel-routing":
		case "channel-context":
			return state.channels.some((channel) => channel.id === scope.channelId);
		case "thread-context":
			return state.threads.some((thread) => thread.id === scope.threadId);
	}
}

function isInferenceProcessScopeName(scopeName: string): boolean {
	return (
		scopeName.startsWith(ROUTING_SESSION_SCOPE_PREFIX) ||
		scopeName.startsWith(CHANNEL_CONTEXT_PROCESS_SCOPE_PREFIX) ||
		scopeName.startsWith(THREAD_CONTEXT_PROCESS_SCOPE_PREFIX)
	);
}

type RunExecutionState =
	| { status: "current" }
	| { status: "closing" }
	| { status: "interrupted"; reason: string };

type AgentRunInvalidation =
	| { kind: "agent"; agentId: string }
	| { kind: "project"; projectId: string };

interface AgentDeliveryOptions {
	allowRepeat?: boolean;
	edge?: string;
}

function inheritDeliveryAttachments(
	source: AgentDelivery,
	target: AgentDelivery,
): void {
	if (source.images !== undefined) target.images = source.images;
	if (source.files !== undefined) target.files = source.files;
}

interface PendingFollowup {
	prepared: PreparedSend;
	response: SendMessageResponse;
	delivery: NonNullable<SendMessageRequest["delivery"]>;
	telemetryContext: Context;
}

interface PendingFollowupLocation {
	scopeKey: string;
	queue: PendingFollowup[];
	index: number;
}

type ThreadMemory = CommonspaceThreadContext["memory"];
type ThreadMemoryConflictPolicy = "preserve-current" | "discard-inference";

interface ThreadMemoryInferenceBaseline {
	threadId: string;
	channelId: string;
	memoryBeforeInference: ThreadMemory;
	projectionBeforeInference: ThreadMemory;
}

interface ThreadMemoryInferenceSnapshot extends ThreadMemoryInferenceBaseline {
	sourceState: CommonspaceState;
}

interface ResolvedPinScope {
	scope: CommonspacePinScope;
	channelId: string;
}

function sameThreadMemoryProjection(
	left: Readonly<ThreadMemory>,
	right: Readonly<ThreadMemory>,
): boolean {
	return (
		left.compactedThroughMessageId === right.compactedThroughMessageId &&
		left.sourceMessageCount === right.sourceMessageCount
	);
}

function threadMemoryInferenceHasConflict(
	snapshot: ThreadMemoryInferenceSnapshot,
	currentThread: Readonly<CommonspaceThread>,
	currentState: CommonspaceState,
): boolean {
	return (
		(currentThread.context.memory !== snapshot.memoryBeforeInference &&
			currentThread.context.memory.origin === "user") ||
		hasInvalidatedContextSources(
			snapshot.sourceState,
			currentState,
			snapshot.channelId,
			snapshot.threadId,
		)
	);
}

function messageId(): string {
	return crypto.randomUUID();
}

function now(): string {
	return new Date().toISOString();
}

function preparedAgentAssignments(
	prepared: PreparedSend,
): PreparedAgentAssignment[] {
	const routingAssignments = prepared.routing?.assignments;
	if (routingAssignments !== undefined && routingAssignments.length > 0) {
		return routingAssignments.map((assignment) => ({
			agentId: assignment.agentId,
			projectIds: assignment.projectIds,
			routingAssignmentId: assignment.id,
		}));
	}
	const projectIds = prepared.projects.map((project) => project.id);
	return prepared.agentIds.map((agentId) => ({ agentId, projectIds }));
}

function commonspaceScopeForAgentRun({
	execution,
	deliveryProjects,
	memberIds,
	sessionName,
}: AgentSessionRunInput): CommonspaceMcpScope {
	const { agent, prepared, thread } = execution;
	const scope: CommonspaceMcpScope = {
		agentId: agent.id,
		conversation: prepared.request.conversation,
		sessionName,
		projectIds: deliveryProjects.map((project) => project.id),
	};
	if (prepared.request.conversation.kind === "channel")
		scope.peers = memberIds.flatMap((memberId) => {
			if (memberId === agent.id) return [];
			const peer = prepared.agents.find(
				(candidate) => candidate.id === memberId,
			);
			return peer === undefined
				? []
				: [{ id: peer.id, displayName: peer.displayName }];
		});
	if (thread !== undefined) scope.threadId = thread.id;
	if (deliveryProjects[0] !== undefined)
		scope.projectId = deliveryProjects[0].id;
	return scope;
}

function participationContextForAgentRun({
	agent,
	prepared,
}: AgentRunExecutionContext): string {
	return [
		"Commonspace participation context. The delivered original user message remains authoritative. Follow the role explicitly requested for you; otherwise act within your roster responsibility. Coordinate with other participants and avoid unrequested duplicate implementation. Use scoped Commonspace tools for Channel/Thread instructions and deeper conversation context when needed.",
		"Your final response is automatically posted to this conversation. Reply normally to answer the user; do not call commonspace_post_progress to deliver the answer or confirm that you posted it. Reserve that tool for useful interim updates while work continues.",
		JSON.stringify({
			agent: {
				name: agent.displayName,
				responsibility: agent.description ?? null,
			},
			mode: prepared.routing?.mode ?? "parallel",
			participants: prepared.agents
				.filter((participant) => prepared.agentIds.includes(participant.id))
				.map((participant) => ({
					name: participant.displayName,
					responsibility: participant.description ?? null,
				})),
		}),
	].join("\n\n");
}

function assignmentMatchesInvalidation(
	assignment: PreparedAgentAssignment,
	invalidation: AgentRunInvalidation,
): boolean {
	switch (invalidation.kind) {
		case "agent":
			return assignment.agentId === invalidation.agentId;
		case "project":
			return assignment.projectIds.includes(invalidation.projectId);
	}
}

function pendingFollowupInvalidation(
	scopeKey: string,
	item: PendingFollowup,
	invalidation: AgentRunInvalidation,
): PendingFollowupInvalidation {
	const interruptRouting =
		invalidation.kind === "project" &&
		item.prepared.routing?.status === "pending" &&
		item.prepared.projects.some(
			(project) => project.id === invalidation.projectId,
		);
	if (interruptRouting) {
		return { runs: [], interruptRouting: true, removeFollowup: true };
	}
	const assignments = preparedAgentAssignments(item.prepared);
	const affected = assignments.filter((assignment) =>
		assignmentMatchesInvalidation(assignment, invalidation),
	);
	const runs = affected.map((assignment): ActiveAgentRun => {
		const run: ActiveAgentRun = {
			id: crypto.randomUUID(),
			sourceMessageId: item.response.accepted.id,
			agentId: assignment.agentId,
			agentExecutionRevision:
				item.prepared.agentExecutionRevisions.get(assignment.agentId) ?? -1,
			phase: "running",
			projectIds: assignment.projectIds,
			conversation: item.prepared.request.conversation,
			scopeKey,
			progressMessageIds: new Set(),
			abortController: new AbortController(),
		};
		if (assignment.routingAssignmentId !== undefined)
			run.routingAssignmentId = assignment.routingAssignmentId;
		return run;
	});
	return {
		runs,
		interruptRouting: false,
		removeFollowup:
			assignments.length > 0 && affected.length === assignments.length,
	};
}

function errorCode(cause: unknown): string | number | undefined {
	if (!(cause instanceof Error) || !("code" in cause)) return undefined;
	return typeof cause.code === "string" || typeof cause.code === "number"
		? cause.code
		: undefined;
}

function completedRoutingTiming(
	startedAt: string,
): Pick<CommonspaceRoutingDecision, "startedAt" | "resolvedAt" | "durationMs"> {
	const resolvedAt = now();
	const elapsed = Date.parse(resolvedAt) - Date.parse(startedAt);
	return {
		startedAt,
		resolvedAt,
		durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0,
	};
}

function failedRoutingDecision(
	previous: CommonspaceRoutingDecision,
	startedAt: string,
	reason: string,
): CommonspaceRoutingDecision {
	return {
		source: previous.source,
		status: "failed",
		...completedRoutingTiming(startedAt),
		agentIds: previous.source === "explicit" ? [...previous.agentIds] : [],
		assignments: [],
		corrections: [],
		inferredProjectIds: [],
		reason,
	};
}

function sameIdentifierSet(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((projectId) => right.includes(projectId))
	);
}

function sameStringSequence(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function projectReferenceFields(
	projects: readonly CommonspaceState["projects"][number][],
): Pick<CommonspaceMessage, "projectIds" | "projectId"> {
	const projectIds = projects.map((project) => project.id);
	const fields: Pick<CommonspaceMessage, "projectIds" | "projectId"> = {};
	const primaryProjectId = projectIds[0];
	if (primaryProjectId === undefined) return fields;
	fields.projectIds = projectIds;
	fields.projectId = primaryProjectId;
	return fields;
}

interface PreparedProjectRoot {
	projectId: string;
	projectRootIndex: number;
	rootIndex: number;
	path: string;
}

interface ResolvedMcpScope {
	agent: CommonspaceAgentDefinition;
	channel?: CommonspaceState["channels"][number];
	thread?: CommonspaceThread;
	projects: CommonspaceState["projects"];
	project?: CommonspaceState["projects"][number];
}

export interface McpMessageView {
	id: string;
	authorType: CommonspaceMessage["authorType"];
	authorId: string;
	authorName: string;
	text: string;
	createdAt: string;
	parentMessageId?: string;
}

type McpChannelMemory = Pick<
	CommonspaceChannelMemory,
	"summary" | "decisions" | "openQuestions" | "threadIds" | "updatedAt"
>;

type McpPinView = CommonspacePin & {
	source?: {
		authorName: string;
		text?: string;
		attachment?: CommonspaceImageAttachment | CommonspaceFileAttachment;
	};
};

function pinSourceMessages(
	messages: CommonspaceState["messages"],
	pins: readonly CommonspacePin[],
): ReadonlyMap<string, CommonspaceMessage> {
	const sourceIds = new Set<string>();
	for (const pin of pins) {
		if (pin.kind !== "note") sourceIds.add(pin.messageId);
	}
	const byId = new Map<string, CommonspaceMessage>();
	if (sourceIds.size === 0) return byId;
	for (const entries of Object.values(messages)) {
		for (const message of entries) {
			if (!sourceIds.has(message.id) || byId.has(message.id)) continue;
			byId.set(message.id, message);
			if (byId.size === sourceIds.size) return byId;
		}
	}
	return byId;
}

interface McpParticipant {
	id: string;
	displayName: string;
	adapter?: AgentAdapterKind;
	description?: string;
}

export interface McpContextResponse {
	agent: {
		id: string;
		displayName: string;
		adapter: AgentAdapterKind;
	};
	conversation: {
		kind: "channel" | "dm";
		id: string;
		name: string;
	};
	projects?: Array<{ id: string; name: string }>;
	project?: { id: string; name: string };
	thread?: { id: string; rootMessageId: string };
	instructions: string;
	memory: McpChannelMemory;
	pins: McpPinView[];
	sharedContext?: {
		currentChannel: CommonspaceChannelMemory;
		threadSnapshot: CommonspaceThreadContext["channelSnapshot"];
		thread: CommonspaceThreadContext["memory"];
	};
	collaboration?: {
		routing: string;
		handoff: string;
		limits: string;
	};
	participants: McpParticipant[];
	messages: McpMessageView[];
}

export interface McpReadMessagesResponse {
	messages: McpMessageView[];
	nextBefore: string | null;
}

interface McpSearchMessageResult extends McpMessageView {
	threadId?: string;
	matchedTerms: string[];
}

export interface McpSearchMessagesResponse {
	results: McpSearchMessageResult[];
}

function preparedProjectRoots(
	projects: readonly CommonspaceState["projects"][number][],
): PreparedProjectRoot[] {
	let rootIndex = 0;
	return projects.flatMap((project) =>
		project.paths.map((path, projectRootIndex) => ({
			projectId: project.id,
			projectRootIndex,
			rootIndex: rootIndex++,
			path,
		})),
	);
}

function isImageMimeType(
	value: JsonValue | undefined,
): value is CommonspaceImageMimeType {
	return typeof value === "string" && IMAGE_MIME_TYPES.has(value);
}

function decodeBoundedBase64(
	value: string,
	maxBytes: number,
): Buffer | undefined {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
		!CANONICAL_BASE64_PATTERN.test(value)
	) {
		return undefined;
	}
	const data = Buffer.from(value, "base64");
	return data.length > 0 &&
		data.length <= maxBytes &&
		data.toString("base64") === value
		? data
		: undefined;
}

function prepareImageAttachments(
	value: SendMessageRequest["attachments"],
): PreparedImageAttachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new Error("image attachments must be an array");
	if (value.length > MAX_IMAGE_ATTACHMENTS)
		throw new Error(
			`at most ${String(MAX_IMAGE_ATTACHMENTS)} images can be attached`,
		);
	const attachments: PreparedImageAttachment[] = [];
	let totalBytes = 0;
	for (const candidate of value) {
		if (typeof candidate !== "object" || candidate === null)
			throw new Error("invalid image attachment");
		const attachment = candidate;
		if (!isImageMimeType(attachment.mimeType))
			throw new Error("unsupported image type");
		const name = loadedString(attachment.name, 200).normalize("NFKC").trim();
		if (name === "") throw new Error("image name is required");
		const data = decodeBoundedBase64(
			attachment.data,
			MAX_IMAGE_ATTACHMENT_BYTES,
		);
		if (data === undefined) throw new Error("invalid image data");
		totalBytes += data.length;
		if (totalBytes > MAX_IMAGE_ATTACHMENTS_BYTES)
			throw new Error("image attachments are too large");
		attachments.push({
			metadata: {
				id: crypto.randomUUID(),
				name,
				mimeType: attachment.mimeType,
				size: data.length,
			},
			data,
		});
	}
	return attachments;
}

function prepareFileAttachmentMetadata(
	file: SendFileAttachment,
): Pick<SendFileAttachment, "name" | "mimeType"> {
	const name = loadedString(file.name, 200).normalize("NFKC").trim();
	if (name === "" || name.includes("/") || name.includes("\\"))
		throw new Error("file name is invalid");
	if (credentialBearingFileName(name))
		throw new Error("credential-bearing files cannot be attached");
	const mimeType = loadedString(file.mimeType, 200).trim().toLocaleLowerCase();
	if (!FILE_MIME_TYPE_PATTERN.test(mimeType))
		throw new Error("file MIME type is invalid");
	return { name, mimeType };
}

function prepareFileAttachments(
	value: SendMessageRequest["files"],
): PreparedFileAttachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new Error("file attachments must be an array");
	if (value.length > MAX_FILE_ATTACHMENTS)
		throw new Error(
			`at most ${String(MAX_FILE_ATTACHMENTS)} files can be attached`,
		);
	const files: PreparedFileAttachment[] = [];
	let totalBytes = 0;
	for (const candidate of value) {
		if (typeof candidate !== "object" || candidate === null)
			throw new Error("invalid file attachment");
		const file = candidate;
		const { name, mimeType } = prepareFileAttachmentMetadata(file);
		const data = decodeBoundedBase64(file.data, MAX_FILE_ATTACHMENT_BYTES);
		if (data === undefined) throw new Error("invalid file data");
		totalBytes += data.length;
		if (totalBytes > MAX_FILE_ATTACHMENTS_BYTES)
			throw new Error("file attachments are too large");
		files.push({
			metadata: { id: crypto.randomUUID(), name, mimeType, size: data.length },
			data,
		});
	}
	return files;
}

function isNativeSessionId(value: JsonValue | undefined): value is string {
	if (typeof value !== "string" || value.length < 1 || value.length > 512)
		return false;
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 31 || codePoint === 127) return false;
	}
	return true;
}

interface SavedAgentIdCandidate {
	id: string;
	adapter: AgentAdapterKind;
	nativeProfile: JsonValue | undefined;
}

interface LoadedAgentFields {
	id: string;
	displayName: string;
	adapter: AgentAdapterKind;
	nativeProfile: string | undefined;
	model: string | null;
	createdAt: string;
	fullAccess: boolean;
	avatarEmoji: string | undefined;
	accentColor: string | undefined;
}

function isValidSavedAgentId({
	id,
	adapter,
	nativeProfile,
}: SavedAgentIdCandidate): boolean {
	switch (adapter) {
		case "hermes":
			return (
				id.trim() === id && id !== "" && id.length <= 200 && !/\s/u.test(id)
			);
		case "claude-code":
		case "gemini":
		case "opencode":
			return id === adapter && nativeProfile === undefined;
		case "codex":
			return id === "codex" || MANAGED_AGENT_ID_PATTERN.test(id);
	}
}

function isValidSavedNativeProfile(
	value: JsonValue | undefined,
): value is string | undefined {
	return (
		value === undefined ||
		(typeof value === "string" &&
			value.trim() === value &&
			value !== "" &&
			value.length <= 200 &&
			!/\s/u.test(value))
	);
}

function isValidSavedCodexIdentity({
	id,
	adapter,
	nativeProfile,
	displayName,
}: Pick<
	LoadedAgentFields,
	"id" | "adapter" | "nativeProfile" | "displayName"
>) {
	if (adapter !== "codex") return true;
	if (id === "codex") return nativeProfile === undefined;
	try {
		return codexAgentId(nativeProfile ?? displayName) === id;
	} catch {
		return false;
	}
}

function loadAgentFields(agent: JsonObject): LoadedAgentFields | undefined {
	const adapter = agent.adapter;
	if (!isAgentAdapterKind(adapter) || typeof agent.id !== "string")
		return undefined;
	if (
		!isValidSavedAgentId({
			id: agent.id,
			adapter,
			nativeProfile: agent.nativeProfile,
		}) ||
		!isValidSavedNativeProfile(agent.nativeProfile) ||
		typeof agent.displayName !== "string" ||
		agent.displayName.trim() === "" ||
		(agent.model !== null && typeof agent.model !== "string") ||
		typeof agent.createdAt !== "string"
	)
		return undefined;
	const displayName = agent.displayName.normalize("NFKC").trim().slice(0, 80);
	const model =
		typeof agent.model === "string" ? agent.model.trim().slice(0, 200) : null;
	const avatarEmoji =
		typeof agent.avatarEmoji === "string"
			? agent.avatarEmoji.normalize("NFKC").trim().slice(0, 16)
			: undefined;
	const accentColor =
		typeof agent.accentColor === "string" &&
		/^#[0-9a-fA-F]{6}$/u.test(agent.accentColor.trim())
			? agent.accentColor.trim().toLocaleLowerCase()
			: undefined;
	const fields: LoadedAgentFields = {
		id: agent.id,
		displayName,
		adapter,
		nativeProfile: agent.nativeProfile,
		model: model === "" ? null : model,
		createdAt: agent.createdAt.slice(0, 100),
		fullAccess: agent.fullAccess === true,
		avatarEmoji: avatarEmoji === "" ? undefined : avatarEmoji,
		accentColor,
	};
	return isValidSavedCodexIdentity(fields) ? fields : undefined;
}

function sanitizeAgent(
	candidate: JsonValue,
	acceptedAgents: CommonspaceState["agents"],
): CommonspaceAgentDefinition | undefined {
	const agent = plainRecord(candidate);
	if (agent === null) return undefined;
	const fields = loadAgentFields(agent);
	if (fields === undefined) return undefined;
	let displayName: string;
	try {
		displayName = uniqueAgentDisplayName(
			fields.displayName,
			fields.adapter,
			acceptedAgents,
		);
	} catch {
		return undefined;
	}
	const sanitized: CommonspaceAgentDefinition = {
		id: fields.id,
		displayName,
		adapter: fields.adapter,
		model: fields.model,
		createdAt: fields.createdAt,
	};
	if (fields.fullAccess) sanitized.fullAccess = true;
	if (fields.avatarEmoji !== undefined)
		sanitized.avatarEmoji = fields.avatarEmoji;
	if (fields.accentColor !== undefined)
		sanitized.accentColor = fields.accentColor;
	if (fields.nativeProfile !== undefined)
		sanitized.nativeProfile = fields.nativeProfile;
	return sanitized;
}

function sanitizeAgents(
	value: JsonValue | undefined,
): CommonspaceState["agents"] {
	if (!Array.isArray(value)) return [];
	const agents: CommonspaceState["agents"] = [];
	for (const candidate of value) {
		const agent = sanitizeAgent(candidate, agents);
		if (agent !== undefined) agents.push(agent);
	}
	return [...new Map(agents.map((agent) => [agent.id, agent])).values()];
}

function sanitizeDmSessions(
	value: JsonValue | undefined,
	allowedAgentIds: ReadonlySet<string>,
): CommonspaceState["dmSessions"] {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return {};
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				(entry): entry is [string, string] =>
					allowedAgentIds.has(entry[0]) &&
					typeof entry[1] === "string" &&
					DM_SESSION_SCOPE_PATTERN.test(entry[1]),
			)
			.slice(-500),
	);
}

function sanitizeAgentSessions(
	value: JsonValue | undefined,
	allowedAgentIds: ReadonlySet<string>,
	dmSessions: CommonspaceState["dmSessions"],
	allowedChannelIds: ReadonlySet<string>,
): CommonspaceState["agentSessions"] {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return {};
	const sessions: CommonspaceState["agentSessions"] = {};
	for (const [agentId, rawScopes] of Object.entries(value)) {
		if (!allowedAgentIds.has(agentId)) continue;
		if (
			typeof rawScopes !== "object" ||
			rawScopes === null ||
			Array.isArray(rawScopes)
		)
			continue;
		const scopes = Object.fromEntries(
			Object.entries(rawScopes)
				.filter(
					(entry): entry is [string, string] =>
						((entry[0] === "Bot Chat" && dmSessions[agentId] === undefined) ||
							THREAD_SESSION_SCOPE_PATTERN.test(entry[0]) ||
							(entry[0].startsWith(ROUTING_SESSION_SCOPE_PREFIX) &&
								allowedChannelIds.has(
									entry[0].slice(ROUTING_SESSION_SCOPE_PREFIX.length),
								)) ||
							dmSessions[agentId] === entry[0]) &&
						isNativeSessionId(entry[1]),
				)
				.slice(-500),
		);
		if (Object.keys(scopes).length > 0) sessions[agentId] = scopes;
	}
	return sessions;
}

function isMissingNativeSession(cause: unknown): boolean {
	if (cause instanceof AcpSessionLoadError) return cause.missing;
	const message = cause instanceof Error ? cause.message : String(cause);
	return /(?:invalid agent session id|no (?:saved )?(?:session|conversation|thread)|no rollout found for thread id|(?:session|conversation|thread).*(?:not found|does not exist|unknown)|failed to (?:load|resume).*(?:session|conversation|thread))/i.test(
		message,
	);
}

class AcpEmptyResponseError extends Error {}

function plainRecord(value: JsonValue | undefined): JsonObject | null {
	return jsonObject(value);
}

function redactPortableValue(
	value: CommonspaceWorkspaceArchive["workspace"],
	privateValues: readonly string[],
): CommonspaceWorkspaceArchive["workspace"] {
	const redactManaged = <T>(metadata: T): T => {
		const serialized = JSON.stringify(metadata, (_key, item) => {
			if (typeof item !== "string") return item;
			let redacted = item;
			for (const privateValue of privateValues) {
				if (privateValue !== "")
					redacted = redacted.replaceAll(privateValue, "[local path]");
			}
			return redacted;
		});
		return JSON.parse(serialized);
	};
	// Authored messages, context, notes, and assignments are portable content.
	// Only managed diagnostics and permission metadata receive host redaction.
	return {
		...value,
		permissions: redactManaged(value.permissions),
		messages: Object.fromEntries(
			Object.entries(value.messages).map(([key, messages]) => [
				key,
				messages.map((message) => {
					const portable = { ...message };
					if (message.trace !== undefined)
						portable.trace = redactManaged(message.trace);
					if (message.runAttribution !== undefined)
						portable.runAttribution = redactManaged(message.runAttribution);
					if (message.replyError !== undefined)
						portable.replyError = redactManaged(message.replyError);
					if (message.routing !== undefined)
						portable.routing = {
							...message.routing,
							reason: redactManaged(message.routing.reason),
						};
					return portable;
				}),
			]),
		),
	};
}

function sanitizeNotificationSettings(
	value: JsonValue | undefined,
): CommonspaceState["notifications"] {
	const settings = plainRecord(value);
	const defaults = defaultNotificationSettings();
	if (settings === null) return defaults;
	return {
		enabled:
			typeof settings.enabled === "boolean"
				? settings.enabled
				: defaults.enabled,
		replies:
			typeof settings.replies === "boolean"
				? settings.replies
				: defaults.replies,
		mentions:
			typeof settings.mentions === "boolean"
				? settings.mentions
				: defaults.mentions,
		permissions:
			typeof settings.permissions === "boolean"
				? settings.permissions
				: defaults.permissions,
		failures:
			typeof settings.failures === "boolean"
				? settings.failures
				: defaults.failures,
		sound:
			typeof settings.sound === "boolean" ? settings.sound : defaults.sound,
	};
}

function loadedId(value: JsonValue | undefined): string | null {
	if (typeof value !== "string") return null;
	const id = value.trim().slice(0, 200);
	return id === "" ? null : id;
}

function loadedString(
	value: JsonValue | undefined,
	maximum: number,
	defaultValue = "",
): string {
	return typeof value === "string" ? value.slice(0, maximum) : defaultValue;
}

function loadedIsoTimestamp(value: JsonValue | undefined): string | null {
	if (typeof value !== "string") return null;
	const timestamp = new Date(value);
	return Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== value
		? null
		: value;
}

function loadedStringArray(
	value: JsonValue | undefined,
	maximumItems = 64,
	maximumLength = 2_000,
): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value.flatMap((candidate) => {
				if (typeof candidate !== "string") return [];
				const normalized = candidate.trim().slice(0, maximumLength);
				return normalized === "" ? [] : [normalized];
			}),
		),
	].slice(0, maximumItems);
}

function normalizedContextRequestEntries(
	value: JsonValue | undefined,
	label: string,
): string[] {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		throw new Error(`${label} must contain only strings`);
	}
	return [
		...new Set(
			value
				.map((entry) =>
					entry.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 2_000),
				)
				.filter(Boolean),
		),
	].slice(0, 50);
}

function loadedProjectIds(
	value: JsonObject,
	allowedProjectIds: ReadonlySet<string>,
): string[] {
	const singular = loadedId(value.projectId);
	return [
		...new Set([
			...loadedStringArray(value.projectIds, 32, 200),
			...(singular === null ? [] : [singular]),
		]),
	].filter((projectId) => allowedProjectIds.has(projectId));
}

function loadedBoundedInteger(
	value: JsonValue | undefined,
	defaultValue: number,
	minimum: number,
	maximum: number,
): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(minimum, Math.min(maximum, Math.trunc(value)))
		: defaultValue;
}

type TraceEntryType = CommonspaceTraceEntry["type"];
type TraceTextEntry = Extract<
	CommonspaceTraceEntry,
	{ type: "reasoning" | "compaction" }
>;
type TracePlanEntry = Extract<CommonspaceTraceEntry, { type: "plan" }>;
type TraceToolEntry = Extract<CommonspaceTraceEntry, { type: "tool" }>;
type TraceUsageEntry = Extract<CommonspaceTraceEntry, { type: "usage" }>;

interface TraceSanitizationContext {
	readonly adapter: AgentAdapterKind;
	readonly completedAt: string;
	readonly entries: readonly JsonValue[];
	readonly startedAt: string;
	remainingChars: number;
}

function loadedTraceSanitizationContext(
	value: JsonValue | undefined,
): TraceSanitizationContext | undefined {
	const trace = plainRecord(value);
	if (trace === null || !isAgentAdapterKind(trace.adapter)) return undefined;
	const startedAt = loadedString(trace.startedAt, 100);
	const completedAt = loadedString(trace.completedAt, 100);
	if (startedAt === "" || completedAt === "" || !Array.isArray(trace.entries))
		return undefined;
	return {
		adapter: trace.adapter,
		completedAt,
		entries: trace.entries,
		startedAt,
		remainingChars: MAX_TRACE_CHARS,
	};
}

function takeTraceText(
	context: TraceSanitizationContext,
	candidate: JsonValue | undefined,
	maximum: number,
): string {
	if (context.remainingChars <= 0 || typeof candidate !== "string") return "";
	const text = candidate.slice(0, Math.min(maximum, context.remainingChars));
	context.remainingChars -= text.length;
	return text;
}

function isTraceEntryType(
	value: JsonValue | undefined,
): value is TraceEntryType {
	return (
		value === "reasoning" ||
		value === "compaction" ||
		value === "plan" ||
		value === "tool" ||
		value === "usage"
	);
}

function sanitizeTraceTextEntry(
	entry: JsonObject,
	type: "reasoning" | "compaction",
	id: string,
	context: TraceSanitizationContext,
): TraceTextEntry | undefined {
	const text = takeTraceText(context, entry.text, 64_000);
	if (text === "") return undefined;
	const createdAt = loadedString(entry.createdAt, 100, context.startedAt);
	const updatedAt = loadedString(entry.updatedAt, 100, createdAt);
	if (type === "reasoning") return { type, id, text, createdAt, updatedAt };
	const status =
		entry.status === "in_progress" ||
		entry.status === "completed" ||
		entry.status === "failed" ||
		entry.status === "cancelled"
			? entry.status
			: "in_progress";
	return { type, id, status, text, createdAt, updatedAt };
}

function sanitizeTracePlanSteps(
	value: JsonValue | undefined,
	context: TraceSanitizationContext,
) {
	const steps: CommonspaceTracePlanStep[] = [];
	if (!Array.isArray(value)) return steps;
	for (const rawStep of value.slice(0, 64)) {
		const step = plainRecord(rawStep);
		if (step === null || typeof step.text !== "string") continue;
		const text = takeTraceText(context, step.text, 2_000);
		if (text === "") continue;
		const priority: CommonspaceTracePlanStep["priority"] =
			step.priority === "high" || step.priority === "low"
				? step.priority
				: "medium";
		const status: CommonspaceTracePlanStep["status"] =
			step.status === "in_progress" || step.status === "completed"
				? step.status
				: "pending";
		steps.push({ text, priority, status });
	}
	return steps;
}

function sanitizeTracePlanEntry(
	entry: JsonObject,
	id: string,
	context: TraceSanitizationContext,
): TracePlanEntry {
	const createdAt = loadedString(entry.createdAt, 100, context.startedAt);
	const updatedAt = loadedString(entry.updatedAt, 100, createdAt);
	const steps = sanitizeTracePlanSteps(entry.steps, context);
	const markdown = takeTraceText(context, entry.markdown, 64_000);
	const planEntry: TracePlanEntry = {
		type: "plan",
		id,
		steps,
		createdAt,
		updatedAt,
	};
	if (markdown !== "") planEntry.markdown = markdown;
	return planEntry;
}

function sanitizeTraceToolEntry(
	entry: JsonObject,
	id: string,
	context: TraceSanitizationContext,
): TraceToolEntry {
	const createdAt = loadedString(entry.createdAt, 100, context.startedAt);
	const updatedAt = loadedString(entry.updatedAt, 100, createdAt);
	const title = takeTraceText(context, entry.title, 1_000).trim();
	const toolName = takeTraceText(context, entry.toolName, 200).trim();
	const toolKind = takeTraceText(context, entry.toolKind, 100).trim();
	const input = takeTraceText(context, entry.input, 16_000);
	const output = takeTraceText(context, entry.output, 32_000);
	const status =
		entry.status === "in_progress" ||
		entry.status === "completed" ||
		entry.status === "failed"
			? entry.status
			: "pending";
	const toolEntry: TraceToolEntry = {
		type: "tool",
		id,
		title: title === "" ? "Tool call" : title,
		status,
		createdAt,
		updatedAt,
	};
	if (toolName !== "") toolEntry.toolName = toolName;
	if (toolKind !== "") toolEntry.toolKind = toolKind;
	if (input !== "") toolEntry.input = input;
	if (output !== "") toolEntry.output = output;
	return toolEntry;
}

function sanitizeTraceUsageEntry(
	entry: JsonObject,
	context: TraceSanitizationContext,
): TraceUsageEntry {
	const createdAt = loadedString(entry.createdAt, 100, context.startedAt);
	const updatedAt = loadedString(entry.updatedAt, 100, createdAt);
	const usedTokens = loadedBoundedInteger(
		entry.usedTokens,
		0,
		0,
		Number.MAX_SAFE_INTEGER,
	);
	const contextWindow = loadedBoundedInteger(
		entry.contextWindow,
		0,
		0,
		Number.MAX_SAFE_INTEGER,
	);
	const costAmount =
		typeof entry.costAmount === "number" && Number.isFinite(entry.costAmount)
			? entry.costAmount
			: undefined;
	const costCurrency = takeTraceText(context, entry.costCurrency, 20).trim();
	const usageEntry: TraceUsageEntry = {
		type: "usage",
		id: "usage",
		usedTokens,
		contextWindow,
		createdAt,
		updatedAt,
	};
	if (costAmount !== undefined) usageEntry.costAmount = costAmount;
	if (costCurrency !== "") usageEntry.costCurrency = costCurrency;
	return usageEntry;
}

function sanitizeTraceEntry(
	entry: JsonObject,
	type: TraceEntryType,
	id: string,
	context: TraceSanitizationContext,
): CommonspaceTraceEntry | undefined {
	switch (type) {
		case "reasoning":
		case "compaction":
			return sanitizeTraceTextEntry(entry, type, id, context);
		case "plan":
			return sanitizeTracePlanEntry(entry, id, context);
		case "tool":
			return sanitizeTraceToolEntry(entry, id, context);
		case "usage":
			return sanitizeTraceUsageEntry(entry, context);
	}
	const unhandledType: never = type;
	throw new Error(`unsupported trace entry type: ${String(unhandledType)}`);
}

function sanitizeAgentTrace(
	value: JsonValue | undefined,
): CommonspaceAgentTrace | undefined {
	const context = loadedTraceSanitizationContext(value);
	if (context === undefined) return undefined;
	const entries: CommonspaceTraceEntry[] = [];
	const seen = new Set<string>();
	for (const candidate of context.entries.slice(0, MAX_TRACE_ENTRIES)) {
		const entry = plainRecord(candidate);
		const type = entry?.type;
		const id = loadedId(entry?.id);
		if (entry === null || id === null || !isTraceEntryType(type)) continue;
		const normalizedId = type === "usage" ? "usage" : id;
		const key = `${type}:${normalizedId}`;
		if (seen.has(key)) continue;
		const sanitized = sanitizeTraceEntry(entry, type, normalizedId, context);
		if (sanitized === undefined) continue;
		entries.push(sanitized);
		seen.add(key);
		if (context.remainingChars <= 0) break;
	}
	return {
		adapter: context.adapter,
		startedAt: context.startedAt,
		completedAt: context.completedAt,
		entries,
	};
}

function sanitizeChannelMemory(
	value: JsonValue | undefined,
): CommonspaceState["channels"][number]["memory"] {
	const memory = plainRecord(value);
	if (memory === null) return emptyChannelMemory();
	const summary = loadedString(memory.summary, 16_000);
	const origin =
		memory.origin === "inference" || memory.origin === "user"
			? memory.origin
			: "automatic";
	const status =
		memory.status === "compacting"
			? "failed"
			: memory.status === "stale" ||
					memory.status === "current" ||
					memory.status === "empty" ||
					memory.status === "failed"
				? memory.status
				: summary === ""
					? "empty"
					: "current";
	const compactedThroughMessageId =
		memory.compactedThroughMessageId === null
			? null
			: loadedId(memory.compactedThroughMessageId);
	return {
		summary,
		decisions: loadedStringArray(memory.decisions, 50, 2_000),
		openQuestions: loadedStringArray(memory.openQuestions, 50, 2_000),
		threadIds: loadedStringArray(memory.threadIds, 50, 200),
		updatedAt:
			typeof memory.updatedAt === "string"
				? memory.updatedAt.slice(0, 100)
				: null,
		origin,
		status,
		sourceMessageCount: loadedBoundedInteger(
			memory.sourceMessageCount,
			0,
			0,
			10_000,
		),
		estimatedTokens: loadedBoundedInteger(
			memory.estimatedTokens,
			0,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		compactedThroughMessageId,
	};
}

function sanitizeRoutingMemory(
	value: JsonValue | undefined,
): CommonspaceState["channels"][number]["routingMemory"] {
	const memory = plainRecord(value);
	if (memory === null) return emptyRoutingMemory();
	const summary = loadedString(memory.summary, 8_000).normalize("NFKC").trim();
	const status =
		memory.status === "current" ||
		memory.status === "stale" ||
		memory.status === "failed" ||
		memory.status === "empty"
			? memory.status
			: summary === ""
				? "empty"
				: "current";
	return {
		summary,
		status,
		correctionCount: loadedBoundedInteger(
			memory.correctionCount,
			0,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		compactedThroughCorrectionId:
			memory.compactedThroughCorrectionId === null
				? null
				: loadedId(memory.compactedThroughCorrectionId),
		updatedAt: loadedIsoTimestamp(memory.updatedAt),
	};
}

function sanitizeProjects(
	value: JsonValue | undefined,
): CommonspaceState["projects"] {
	if (!Array.isArray(value)) return [];
	const projects: CommonspaceState["projects"] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const project = plainRecord(candidate);
		const id = loadedId(project?.id);
		if (project === null || id === null || ids.has(id)) continue;
		const name = loadedString(project.name, 80).normalize("NFKC").trim();
		const paths = [
			...new Set(
				loadedStringArray(project.paths, 32, 4_096).filter(isAbsolute),
			),
		];
		if (name === "" || paths.length === 0) continue;
		ids.add(id);
		projects.push({
			id,
			name,
			paths,
			createdAt: loadedString(project.createdAt, 100),
		});
	}
	return projects;
}

function sanitizeChannels(
	value: JsonValue | undefined,
): CommonspaceState["channels"] {
	if (!Array.isArray(value)) return [];
	const channels: CommonspaceState["channels"] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const channel = plainRecord(candidate);
		const id = loadedId(channel?.id);
		if (channel === null || id === null || ids.has(id)) continue;
		const name = loadedString(channel.name, 80)
			.normalize("NFKC")
			.trim()
			.replace(/^#+/, "");
		if (name === "") continue;
		ids.add(id);
		channels.push({
			id,
			name,
			agentIds: loadedStringArray(channel.agentIds, 64, 200),
			instructions: loadedString(channel.instructions, 8_000),
			memory: sanitizeChannelMemory(channel.memory),
			routingMemory: sanitizeRoutingMemory(channel.routingMemory),
			createdAt: loadedString(channel.createdAt, 100),
		});
	}
	return channels;
}

function sanitizeThreadMemory(
	value: JsonValue | undefined,
): CommonspaceThread["context"]["memory"] {
	const memory = plainRecord(value);
	if (memory === null) return emptyThreadMemory();
	const summary = loadedString(memory.summary, 16_000).normalize("NFKC").trim();
	return {
		summary,
		decisions: loadedStringArray(memory.decisions, 50, 2_000),
		openQuestions: loadedStringArray(memory.openQuestions, 50, 2_000),
		updatedAt: loadedIsoTimestamp(memory.updatedAt),
		origin:
			memory.origin === "inference" || memory.origin === "user"
				? memory.origin
				: "automatic",
		status:
			memory.status === "compacting"
				? "failed"
				: memory.status === "current" ||
						memory.status === "stale" ||
						memory.status === "empty" ||
						memory.status === "failed"
					? memory.status
					: summary === ""
						? "empty"
						: "current",
		sourceMessageCount: loadedBoundedInteger(
			memory.sourceMessageCount,
			0,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		estimatedTokens: loadedBoundedInteger(
			memory.estimatedTokens,
			0,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		compactedThroughMessageId:
			memory.compactedThroughMessageId === null
				? null
				: loadedId(memory.compactedThroughMessageId),
	};
}

function sanitizeThreadContext(
	value: JsonValue | undefined,
	createdAt: string,
): CommonspaceThread["context"] {
	const context = plainRecord(value);
	const fallback = createThreadContext(emptyChannelMemory(), createdAt);
	if (context === null) return fallback;
	const snapshot = plainRecord(context.channelSnapshot);
	const sanitizedSnapshot = sanitizeThreadMemory(snapshot);
	return {
		channelSnapshot: {
			...sanitizedSnapshot,
			capturedAt:
				snapshot === null
					? createdAt
					: loadedString(snapshot.capturedAt, 100) || createdAt,
		},
		memory: sanitizeThreadMemory(context.memory),
	};
}

function sanitizeThreads(
	value: JsonValue | undefined,
	channels: readonly CommonspaceState["channels"][number][],
	projectIds: ReadonlySet<string>,
): CommonspaceState["threads"] {
	if (!Array.isArray(value)) return [];
	const channelById = new Map(channels.map((channel) => [channel.id, channel]));
	const threads: CommonspaceState["threads"] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const thread = plainRecord(candidate);
		const id = loadedId(thread?.id);
		const channelId = loadedId(thread?.channelId);
		const rootMessageId = loadedId(thread?.rootMessageId);
		if (
			thread === null ||
			id === null ||
			ids.has(id) ||
			channelId === null ||
			rootMessageId === null
		)
			continue;
		const channel = channelById.get(channelId);
		if (channel === undefined) continue;
		const referencedProjects = loadedProjectIds(thread, projectIds);
		const createdAt = loadedString(thread.createdAt, 100);
		const branchedFromThreadId = loadedId(thread.branchedFromThreadId);
		const branchPointMessageId = loadedId(thread.branchPointMessageId);
		ids.add(id);
		const sanitizedThread: CommonspaceThread = {
			id,
			channelId,
			projectIds: referencedProjects,
			projectId: referencedProjects[0] ?? null,
			rootMessageId,
			agentIds: loadedStringArray(thread.agentIds, 64, 200),
			context: sanitizeThreadContext(thread.context, createdAt),
			createdAt,
		};
		if (branchedFromThreadId !== null && branchPointMessageId !== null) {
			sanitizedThread.branchedFromThreadId = branchedFromThreadId;
			sanitizedThread.branchPointMessageId = branchPointMessageId;
		}
		threads.push(sanitizedThread);
	}
	return threads;
}

function sanitizeImageAttachments(
	value: JsonValue | undefined,
): CommonspaceImageAttachment[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const attachments: CommonspaceImageAttachment[] = [];
	const seen = new Set<string>();
	for (const candidate of value.slice(0, MAX_IMAGE_ATTACHMENTS)) {
		const attachment = plainRecord(candidate);
		const id = loadedId(attachment?.id);
		const name = loadedString(attachment?.name, 200).normalize("NFKC").trim();
		const size = attachment?.size;
		if (
			attachment === null ||
			id === null ||
			!IMAGE_ATTACHMENT_ID_PATTERN.test(id) ||
			seen.has(id)
		)
			continue;
		if (name === "" || !isImageMimeType(attachment.mimeType)) continue;
		if (
			typeof size !== "number" ||
			!Number.isSafeInteger(size) ||
			size < 1 ||
			size > MAX_IMAGE_ATTACHMENT_BYTES
		)
			continue;
		seen.add(id);
		attachments.push({ id, name, mimeType: attachment.mimeType, size });
	}
	return attachments.length === 0 ? undefined : attachments;
}

function sanitizeFileAttachments(
	value: JsonValue | undefined,
): CommonspaceFileAttachment[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const files: CommonspaceFileAttachment[] = [];
	const seen = new Set<string>();
	for (const candidate of value.slice(0, MAX_FILE_ATTACHMENTS)) {
		const file = plainRecord(candidate);
		const id = loadedId(file?.id);
		const name = loadedString(file?.name, 200).normalize("NFKC").trim();
		const mimeType = loadedString(file?.mimeType, 200)
			.trim()
			.toLocaleLowerCase();
		const size = file?.size;
		if (
			file === null ||
			id === null ||
			!IMAGE_ATTACHMENT_ID_PATTERN.test(id) ||
			seen.has(id) ||
			name === "" ||
			credentialBearingFileName(name)
		)
			continue;
		if (!FILE_MIME_TYPE_PATTERN.test(mimeType)) continue;
		if (
			typeof size !== "number" ||
			!Number.isSafeInteger(size) ||
			size < 1 ||
			size > MAX_FILE_ATTACHMENT_BYTES
		)
			continue;
		seen.add(id);
		files.push({ id, name, mimeType, size });
	}
	return files.length === 0 ? undefined : files;
}

interface RoutingSanitizationContext {
	readonly agentIds: ReadonlySet<string>;
	readonly projectIds: ReadonlySet<string>;
	readonly messageId: string;
	readonly fallbackProjectIds: readonly string[];
}

function sanitizeRoutingAssignments(
	value: JsonValue | undefined,
	routedAgentIds: ReadonlySet<string>,
	context: RoutingSanitizationContext,
) {
	const assignments: CommonspaceRoutingAssignment[] = [];
	const assignedAgents = new Set<string>();
	const assignmentIds = new Set<string>();
	if (Array.isArray(value)) {
		for (const candidate of value) {
			const assignment = plainRecord(candidate);
			const id = loadedId(assignment?.id);
			const agentId = loadedId(assignment?.agentId);
			const legacySubRequest = loadedString(
				assignment?.legacySubRequest ?? assignment?.subRequest,
				MAX_MESSAGE_CHARS,
			)
				.normalize("NFKC")
				.trim();
			const assignmentProjectIds = loadedStringArray(
				assignment?.projectIds,
				32,
				200,
			).filter((projectId) => context.projectIds.has(projectId));
			if (
				assignment === null ||
				id === null ||
				assignmentIds.has(id) ||
				agentId === null ||
				!routedAgentIds.has(agentId)
			)
				continue;
			assignmentIds.add(id);
			assignedAgents.add(agentId);
			const sanitizedAssignment: CommonspaceRoutingAssignment = {
				id,
				agentId,
				projectIds: assignmentProjectIds,
			};
			if (legacySubRequest !== "")
				sanitizedAssignment.legacySubRequest = legacySubRequest;
			assignments.push(sanitizedAssignment);
		}
	}
	for (const agentId of routedAgentIds) {
		if (assignedAgents.has(agentId)) continue;
		const id = `legacy:${context.messageId}:${agentId}`;
		assignmentIds.add(id);
		assignments.push({
			id,
			agentId,
			projectIds: [...context.fallbackProjectIds],
		});
	}
	return { assignments, assignmentIds };
}

function sanitizeRoutingCorrections(
	value: JsonValue | undefined,
	assignmentIds: ReadonlySet<string>,
) {
	const corrections: CommonspaceRoutingCorrection[] = [];
	const correctionIds = new Set<string>();
	const correctedAssignments = new Set<string>();
	if (!Array.isArray(value)) return corrections;
	for (const candidate of value) {
		const correction = plainRecord(candidate);
		const id = loadedId(correction?.id);
		const fromAssignmentId = loadedId(correction?.fromAssignmentId);
		const toAssignmentId = loadedId(correction?.toAssignmentId);
		const createdAt = loadedIsoTimestamp(correction?.createdAt);
		if (
			correction === null ||
			id === null ||
			correctionIds.has(id) ||
			fromAssignmentId === null ||
			toAssignmentId === null ||
			createdAt === null ||
			fromAssignmentId === toAssignmentId ||
			!assignmentIds.has(fromAssignmentId) ||
			!assignmentIds.has(toAssignmentId) ||
			correctedAssignments.has(fromAssignmentId)
		)
			continue;
		correctionIds.add(id);
		correctedAssignments.add(fromAssignmentId);
		corrections.push({ id, fromAssignmentId, toAssignmentId, createdAt });
	}
	return corrections;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the flat persisted-routing field recovery policy visible after isolating assignment and correction recovery.
function sanitizeRoutingDecision(
	value: JsonValue | undefined,
	context: RoutingSanitizationContext,
): CommonspaceRoutingDecision | undefined {
	const routing = plainRecord(value);
	if (
		routing === null ||
		(routing.source !== "explicit" &&
			routing.source !== "ai" &&
			routing.source !== "local" &&
			routing.source !== "fallback")
	)
		return undefined;
	if (!Array.isArray(routing.agentIds) || typeof routing.reason !== "string")
		return undefined;
	const routedAgentIds = new Set(
		routing.agentIds.filter(
			(id): id is string => typeof id === "string" && context.agentIds.has(id),
		),
	);
	const status =
		routing.status === "pending" ||
		routing.status === "resolved" ||
		routing.status === "failed"
			? routing.status
			: undefined;
	const reason = routing.reason.normalize("NFKC").trim().slice(0, 500);
	if (
		(routedAgentIds.size === 0 &&
			status !== "pending" &&
			status !== "failed") ||
		reason === ""
	)
		return undefined;
	const confidence =
		typeof routing.confidence === "number" &&
		Number.isFinite(routing.confidence)
			? Math.max(0, Math.min(1, routing.confidence))
			: undefined;
	const startedAt = loadedIsoTimestamp(routing.startedAt);
	const resolvedAt = loadedIsoTimestamp(routing.resolvedAt);
	const durationMs =
		typeof routing.durationMs === "number" &&
		Number.isSafeInteger(routing.durationMs) &&
		routing.durationMs >= 0
			? Math.min(routing.durationMs, 86_400_000)
			: undefined;
	const inferredProjectIds = loadedStringArray(
		routing.inferredProjectIds,
		32,
		200,
	).filter((projectId) => context.projectIds.has(projectId));
	const { assignments, assignmentIds } = sanitizeRoutingAssignments(
		routing.assignments,
		routedAgentIds,
		context,
	);
	const corrections = sanitizeRoutingCorrections(
		routing.corrections,
		assignmentIds,
	);
	const decision: CommonspaceRoutingDecision = {
		source: routing.source === "fallback" ? "local" : routing.source,
		agentIds: [...routedAgentIds],
		assignments,
		corrections,
		inferredProjectIds,
		reason,
	};
	if (routing.mode === "parallel" || routing.mode === "relay")
		decision.mode = routing.mode;
	if (status !== undefined) decision.status = status;
	if (confidence !== undefined) decision.confidence = confidence;
	if (startedAt !== null) decision.startedAt = startedAt;
	if (resolvedAt !== null) decision.resolvedAt = resolvedAt;
	if (durationMs !== undefined) decision.durationMs = durationMs;
	return decision;
}

function isRunFileStatus(
	value: JsonValue | undefined,
): value is CommonspaceRunFileChange["status"] {
	return (
		value === "modified" ||
		value === "added" ||
		value === "deleted" ||
		value === "renamed" ||
		value === "untracked" ||
		value === "conflicted"
	);
}

type AvailableRunRoot = Extract<
	CommonspaceRunRootAttribution,
	{ available: true }
>;
type UnavailableRunRoot = Extract<
	CommonspaceRunRootAttribution,
	{ available: false }
>;

function sanitizePreExistingRunChange(
	value: JsonValue,
): AvailableRunRoot["preExisting"][number] | null {
	const change = plainRecord(value);
	const path = loadedString(change?.path, 2_000);
	if (change === null || path === "" || !isRunFileStatus(change.status))
		return null;
	return { path, status: change.status };
}

function sanitizeObservedRunChange(
	value: JsonValue,
): CommonspaceRunFileChange | null {
	const change = plainRecord(value);
	const path = loadedString(change?.path, 2_000);
	if (
		change === null ||
		path === "" ||
		!isRunFileStatus(change.status) ||
		typeof change.preExisting !== "boolean"
	)
		return null;
	const observed: CommonspaceRunFileChange = {
		path,
		status: change.status,
		preExisting: change.preExisting,
		additions:
			typeof change.additions === "number" && Number.isInteger(change.additions)
				? change.additions
				: null,
		deletions:
			typeof change.deletions === "number" && Number.isInteger(change.deletions)
				? change.deletions
				: null,
	};
	if (typeof change.patch === "string")
		observed.patch = change.patch.slice(0, 128_000);
	if (change.patchTruncated === true) observed.patchTruncated = true;
	return observed;
}

function sanitizePreExistingRunChanges(
	values: readonly JsonValue[],
): AvailableRunRoot["preExisting"] {
	const changes: AvailableRunRoot["preExisting"] = [];
	for (const value of values.slice(0, 1_000)) {
		const change = sanitizePreExistingRunChange(value);
		if (change !== null) changes.push(change);
	}
	return changes;
}

function sanitizeObservedRunChanges(
	values: readonly JsonValue[],
): CommonspaceRunFileChange[] {
	const changes: CommonspaceRunFileChange[] = [];
	for (const value of values.slice(0, 1_000)) {
		const change = sanitizeObservedRunChange(value);
		if (change !== null) changes.push(change);
	}
	return changes;
}

function sanitizeUnavailableRunRoot(
	root: JsonObject,
	rootIndex: number,
	projectId: string | null,
	projectRootIndex: number | undefined,
): UnavailableRunRoot {
	const unavailableRoot: UnavailableRunRoot = {
		available: false,
		rootIndex,
		reason: loadedString(root.reason, 500),
	};
	if (projectId !== null) unavailableRoot.projectId = projectId;
	if (projectRootIndex !== undefined)
		unavailableRoot.projectRootIndex = projectRootIndex;
	return unavailableRoot;
}

function sanitizeAvailableRunRoot(
	root: JsonObject,
	rootIndex: number,
	projectId: string | null,
	projectRootIndex: number | undefined,
): AvailableRunRoot | null {
	if (!Array.isArray(root.preExisting) || !Array.isArray(root.observed))
		return null;
	const availableRoot: AvailableRunRoot = {
		available: true,
		rootIndex,
		branch: typeof root.branch === "string" ? root.branch.slice(0, 500) : null,
		headBefore:
			typeof root.headBefore === "string"
				? root.headBefore.slice(0, 100)
				: null,
		headAfter:
			typeof root.headAfter === "string" ? root.headAfter.slice(0, 100) : null,
		preExisting: sanitizePreExistingRunChanges(root.preExisting),
		observed: sanitizeObservedRunChanges(root.observed),
	};
	if (projectId !== null) availableRoot.projectId = projectId;
	if (projectRootIndex !== undefined)
		availableRoot.projectRootIndex = projectRootIndex;
	return availableRoot;
}

function sanitizeRunRoot(
	value: JsonValue,
): CommonspaceRunRootAttribution | null {
	const root = plainRecord(value);
	if (
		root === null ||
		!Number.isInteger(root.rootIndex) ||
		Number(root.rootIndex) < 0
	)
		return null;
	const rootIndex = Number(root.rootIndex);
	const projectId = loadedId(root.projectId);
	const projectRootIndex =
		Number.isInteger(root.projectRootIndex) &&
		Number(root.projectRootIndex) >= 0
			? Number(root.projectRootIndex)
			: undefined;
	if (root.available === false)
		return sanitizeUnavailableRunRoot(
			root,
			rootIndex,
			projectId,
			projectRootIndex,
		);
	if (root.available !== true) return null;
	return sanitizeAvailableRunRoot(root, rootIndex, projectId, projectRootIndex);
}

function sanitizeRunAttribution(
	value: JsonValue | undefined,
): CommonspaceRunAttribution | undefined {
	const attribution = plainRecord(value);
	if (attribution === null || !Array.isArray(attribution.roots))
		return undefined;
	const startedAt = loadedIsoTimestamp(attribution.startedAt);
	const completedAt = loadedIsoTimestamp(attribution.completedAt);
	if (startedAt === null || completedAt === null) return undefined;
	const roots: CommonspaceRunRootAttribution[] = [];
	for (const candidate of attribution.roots.slice(0, 16)) {
		const root = sanitizeRunRoot(candidate);
		if (root !== null) roots.push(root);
	}
	return { startedAt, completedAt, roots };
}

interface MessageSanitizationContext {
	readonly agentIds: ReadonlySet<string>;
	readonly channelIds: ReadonlySet<string>;
	readonly projectIds: ReadonlySet<string>;
	readonly threadIds: ReadonlySet<string>;
}

interface LoadedMessageCore {
	readonly authorId: string;
	readonly authorName: string;
	readonly authorType: CommonspaceMessage["authorType"];
	readonly conversation: CommonspaceMessage["conversation"];
	readonly id: string;
	readonly message: JsonObject;
	readonly text: string;
}

const INVALID_OPTIONAL_MESSAGE_ID = Symbol("invalid optional message id");
type LoadedOptionalMessageId =
	| string
	| null
	| typeof INVALID_OPTIONAL_MESSAGE_ID;

interface LoadedMessageReferences {
	readonly branchId: string | null;
	readonly parentMessageId: string | null;
	readonly routingAssignmentId: string | null;
	readonly sourceMessageId: string | null;
	readonly supersedesMessageId: string | null;
	readonly threadId: string | null;
	readonly versionRootMessageId: string | null;
}

function loadedMessageConversation(
	key: string,
	context: MessageSanitizationContext,
): CommonspaceMessage["conversation"] | null {
	const separator = key.indexOf(":");
	if (separator < 1) return null;
	const kind = key.slice(0, separator);
	const id = key.slice(separator + 1);
	if (id === "") return null;
	if (kind === "channel")
		return context.channelIds.has(id) ? { kind, id } : null;
	if (kind === "dm") return context.agentIds.has(id) ? { kind, id } : null;
	return null;
}

function loadedMessageCore(
	value: JsonValue,
	conversation: CommonspaceMessage["conversation"],
): LoadedMessageCore | null {
	const message = plainRecord(value);
	if (message === null) return null;
	const storedConversation = plainRecord(message.conversation);
	if (
		storedConversation === null ||
		storedConversation.kind !== conversation.kind ||
		storedConversation.id !== conversation.id
	)
		return null;
	const id = loadedId(message.id);
	const authorId = loadedId(message.authorId);
	const authorName = loadedString(message.authorName, 200).trim();
	if (
		id === null ||
		authorId === null ||
		authorName === "" ||
		(message.authorType !== "user" &&
			message.authorType !== "agent" &&
			message.authorType !== "system") ||
		typeof message.text !== "string"
	)
		return null;
	return {
		authorId,
		authorName,
		authorType: message.authorType,
		conversation,
		id,
		message,
		text: message.text,
	};
}

function loadedOptionalMessageId(
	value: JsonValue | undefined,
): LoadedOptionalMessageId {
	if (value === undefined) return null;
	return loadedId(value) ?? INVALID_OPTIONAL_MESSAGE_ID;
}

function loadedMessageReferences(
	message: JsonObject,
	threadIds: ReadonlySet<string>,
): LoadedMessageReferences | null {
	const threadId = loadedOptionalMessageId(message.threadId);
	if (
		threadId === INVALID_OPTIONAL_MESSAGE_ID ||
		(threadId !== null && !threadIds.has(threadId))
	)
		return null;
	const parentMessageId = loadedOptionalMessageId(message.parentMessageId);
	if (parentMessageId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	const sourceMessageId = loadedOptionalMessageId(message.sourceMessageId);
	if (sourceMessageId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	const versionRootMessageId = loadedOptionalMessageId(
		message.versionRootMessageId,
	);
	if (versionRootMessageId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	const supersedesMessageId = loadedOptionalMessageId(
		message.supersedesMessageId,
	);
	if (supersedesMessageId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	const branchId = loadedOptionalMessageId(message.branchId);
	if (branchId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	const routingAssignmentId = loadedOptionalMessageId(
		message.routingAssignmentId,
	);
	if (routingAssignmentId === INVALID_OPTIONAL_MESSAGE_ID) return null;
	return {
		branchId,
		parentMessageId,
		routingAssignmentId,
		sourceMessageId,
		supersedesMessageId,
		threadId,
		versionRootMessageId,
	};
}

function sanitizeMessageRouting(
	core: LoadedMessageCore,
	context: MessageSanitizationContext,
	referencedProjects: string[],
	deletedAt: string | null,
): CommonspaceRoutingDecision | undefined {
	const loadedRouting = sanitizeRoutingDecision(core.message.routing, {
		agentIds: context.agentIds,
		projectIds: context.projectIds,
		messageId: core.id,
		fallbackProjectIds: referencedProjects,
	});
	if (deletedAt === null || loadedRouting === undefined) return loadedRouting;
	return {
		...loadedRouting,
		assignments: loadedRouting.assignments.map((assignment) => ({
			id: assignment.id,
			agentId: assignment.agentId,
			projectIds: assignment.projectIds,
		})),
		reason: "Routing record retained for deleted message.",
	};
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the flat persisted-message field recovery policy visible after isolating bucket, identity, reference, and routing validation.
function sanitizeMessage(
	core: LoadedMessageCore,
	context: MessageSanitizationContext,
): CommonspaceMessage | null {
	const references = loadedMessageReferences(core.message, context.threadIds);
	if (references === null) return null;
	const deletedAt = loadedIsoTimestamp(core.message.deletedAt);
	const trace =
		deletedAt === null && core.authorType === "agent"
			? sanitizeAgentTrace(core.message.trace)
			: undefined;
	const runAttribution =
		deletedAt === null && core.authorType === "agent"
			? sanitizeRunAttribution(core.message.runAttribution)
			: undefined;
	const attachments =
		deletedAt === null
			? sanitizeImageAttachments(core.message.attachments)
			: undefined;
	const files =
		deletedAt === null
			? sanitizeFileAttachments(core.message.files)
			: undefined;
	const referencedProjects = loadedProjectIds(core.message, context.projectIds);
	const routing = sanitizeMessageRouting(
		core,
		context,
		referencedProjects,
		deletedAt,
	);
	const message: CommonspaceMessage = {
		id: core.id,
		conversation: {
			kind: core.conversation.kind,
			id: core.conversation.id,
		},
		authorType: core.authorType,
		authorId: core.authorId,
		authorName: core.authorName,
		text: deletedAt === null ? core.text.slice(0, 64_000) : "",
		createdAt: loadedString(core.message.createdAt, 100),
	};
	if (attachments !== undefined) message.attachments = attachments;
	if (files !== undefined) message.files = files;
	const primaryProjectId = referencedProjects[0];
	if (primaryProjectId !== undefined) {
		message.projectIds = referencedProjects;
		message.projectId = primaryProjectId;
	}
	if (references.threadId !== null) message.threadId = references.threadId;
	if (references.parentMessageId !== null)
		message.parentMessageId = references.parentMessageId;
	if (references.sourceMessageId !== null)
		message.sourceMessageId = references.sourceMessageId;
	if (references.versionRootMessageId !== null)
		message.versionRootMessageId = references.versionRootMessageId;
	if (references.supersedesMessageId !== null)
		message.supersedesMessageId = references.supersedesMessageId;
	if (references.branchId !== null) message.branchId = references.branchId;
	if (deletedAt !== null) message.deletedAt = deletedAt;
	if (references.routingAssignmentId !== null)
		message.routingAssignmentId = references.routingAssignmentId;
	if (trace !== undefined) message.trace = trace;
	if (runAttribution !== undefined) message.runAttribution = runAttribution;
	if (routing !== undefined) message.routing = routing;
	if (
		core.conversation.kind === "dm" &&
		core.authorType === "user" &&
		(core.message.replyStatus === "queued" ||
			core.message.replyStatus === "running" ||
			core.message.replyStatus === "complete" ||
			core.message.replyStatus === "needs_input" ||
			core.message.replyStatus === "failed" ||
			core.message.replyStatus === "cancelled" ||
			core.message.replyStatus === "silent" ||
			core.message.replyStatus === "timeout" ||
			core.message.replyStatus === "error")
	) {
		message.replyStatus = core.message.replyStatus;
		if (typeof core.message.replyError === "string")
			message.replyError = core.message.replyError.slice(0, 4_000);
	}
	return message;
}

function sanitizeMessages(
	value: JsonValue | undefined,
	context: MessageSanitizationContext,
): CommonspaceState["messages"] {
	const record = plainRecord(value);
	if (record === null) return {};
	const messages: CommonspaceState["messages"] = {};
	for (const [key, rawMessages] of Object.entries(record)) {
		if (!Array.isArray(rawMessages)) continue;
		const conversation = loadedMessageConversation(key, context);
		if (conversation === null) continue;
		const seen = new Set<string>();
		const sanitized: CommonspaceMessage[] = [];
		for (const candidate of rawMessages) {
			const core = loadedMessageCore(candidate, conversation);
			if (core === null || seen.has(core.id)) continue;
			const message = sanitizeMessage(core, context);
			if (message === null) continue;
			seen.add(core.id);
			sanitized.push(message);
		}
		messages[key] = sanitized;
	}
	return messages;
}

interface LoadedMessageIndex {
	readonly byId: ReadonlyMap<string, CommonspaceMessage>;
	readonly inboxIds: ReadonlySet<string>;
}

function indexLoadedMessages(
	messages: CommonspaceState["messages"],
): LoadedMessageIndex {
	const byId = new Map<string, CommonspaceMessage>();
	const inboxIds = new Set<string>();
	for (const entries of Object.values(messages)) {
		for (const message of entries) {
			byId.set(message.id, message);
			if (
				message.authorType === "agent" ||
				message.authorType === "system" ||
				message.replyStatus === "error" ||
				message.replyStatus === "failed" ||
				message.replyStatus === "timeout"
			)
				inboxIds.add(message.id);
		}
	}
	return { byId, inboxIds };
}

interface LocatedMessage {
	readonly index: number;
	readonly key: string;
	readonly message: CommonspaceMessage;
}

interface ExistingMessageDeletion {
	readonly kind: "existing";
	readonly deleted: CommonspaceMessage;
}

interface PendingMessageDeletion {
	readonly kind: "pending";
	readonly location: LocatedMessage;
	readonly previousState: CommonspaceState;
	readonly deleted: CommonspaceMessage;
	readonly imageIds: readonly string[];
	readonly fileIds: readonly string[];
}

type PreparedMessageDeletion = ExistingMessageDeletion | PendingMessageDeletion;

function locateMessageById(
	messages: Readonly<Record<string, readonly CommonspaceMessage[]>>,
	messageId: string,
): LocatedMessage | undefined {
	for (const [key, entries] of Object.entries(messages)) {
		const index = entries.findIndex((message) => message.id === messageId);
		const message = entries[index];
		if (message !== undefined) return { index, key, message };
	}
	return undefined;
}

function deletedMessageTombstone(
	message: CommonspaceMessage,
): CommonspaceMessage {
	const deleted: CommonspaceMessage = {
		...message,
		text: "",
		deletedAt: now(),
	};
	if (message.routing !== undefined)
		deleted.routing = {
			...message.routing,
			assignments: message.routing.assignments.map((assignment) => ({
				id: assignment.id,
				agentId: assignment.agentId,
				projectIds: assignment.projectIds,
			})),
			reason: "Routing record retained for deleted message.",
		};
	delete deleted.attachments;
	delete deleted.files;
	delete deleted.trace;
	delete deleted.runAttribution;
	delete deleted.replyError;
	return deleted;
}

function isFailedRoutingSource(
	message: CommonspaceMessage,
): message is FailedRoutingSource {
	return (
		message.authorType === "user" &&
		message.conversation.kind === "channel" &&
		message.routing?.status === "failed" &&
		message.threadId !== undefined
	);
}

interface PinSanitizationContext {
	readonly channelIds: ReadonlySet<string>;
	readonly messageById: ReadonlyMap<string, CommonspaceMessage>;
	readonly threadIds: ReadonlySet<string>;
}

interface LoadedPinBase {
	readonly createdAt: string;
	readonly id: string;
	readonly removedAt: string | null;
	readonly scope: CommonspacePin["scope"];
}

function loadedPinScope(
	value: JsonValue | undefined,
	removedAt: string | null,
	context: PinSanitizationContext,
): CommonspacePin["scope"] | null {
	const scope = plainRecord(value);
	const id = loadedId(scope?.id);
	if (scope === null || id === null) return null;
	if (scope.kind === "channel")
		return removedAt !== null || context.channelIds.has(id)
			? { kind: scope.kind, id }
			: null;
	if (scope.kind === "thread")
		return removedAt !== null || context.threadIds.has(id)
			? { kind: scope.kind, id }
			: null;
	return null;
}

function messageHasAttachment(
	message: CommonspaceMessage | undefined,
	attachmentId: string,
): boolean {
	return (
		message?.attachments?.some(
			(attachment) => attachment.id === attachmentId,
		) === true ||
		message?.files?.some((file) => file.id === attachmentId) === true
	);
}

function sanitizePin(
	pin: JsonObject,
	id: string,
	context: PinSanitizationContext,
): CommonspacePin | null {
	const removedAt = loadedIsoTimestamp(pin.removedAt);
	const scope = loadedPinScope(pin.scope, removedAt, context);
	if (scope === null) return null;
	const common: LoadedPinBase = {
		id,
		scope,
		createdAt: loadedString(pin.createdAt, 100),
		removedAt,
	};
	if (pin.kind === "note") {
		const note = loadedString(pin.note, 4_000).normalize("NFKC").trim();
		return note === "" ? null : { ...common, kind: pin.kind, note };
	}
	if (pin.kind !== "message" && pin.kind !== "attachment") return null;
	const messageId = loadedId(pin.messageId);
	if (messageId === null) return null;
	const message = context.messageById.get(messageId);
	if (removedAt === null && message === undefined) return null;
	if (pin.kind === "message") return { ...common, kind: pin.kind, messageId };
	const attachmentId = loadedId(pin.attachmentId);
	if (
		attachmentId === null ||
		(removedAt === null && !messageHasAttachment(message, attachmentId))
	)
		return null;
	return { ...common, kind: pin.kind, messageId, attachmentId };
}

function sanitizePins(
	value: JsonValue | undefined,
	context: PinSanitizationContext,
): CommonspacePin[] {
	if (!Array.isArray(value)) return [];
	const pins: CommonspacePin[] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const pin = plainRecord(candidate);
		const id = loadedId(pin?.id);
		if (pin === null || id === null || ids.has(id)) continue;
		const sanitized = sanitizePin(pin, id, context);
		if (sanitized === null) continue;
		ids.add(id);
		pins.push(sanitized);
	}
	return pins;
}

interface PermissionSanitizationContext {
	readonly agentIds: ReadonlySet<string>;
	readonly messageById: ReadonlyMap<string, CommonspaceMessage>;
}

interface SanitizedPermissionOptions {
	readonly ids: ReadonlySet<string>;
	readonly options: CommonspacePermissionOption[];
}

function sanitizePermissionOptions(
	value: JsonValue | undefined,
): SanitizedPermissionOptions {
	const options: CommonspacePermissionOption[] = [];
	const ids = new Set<string>();
	if (!Array.isArray(value)) return { ids, options };
	for (const candidate of value.slice(0, 16)) {
		const option = plainRecord(candidate);
		const optionId = loadedId(option?.optionId);
		const name = loadedString(option?.name, 200).normalize("NFKC").trim();
		const kind = loadedString(option?.kind, 100).trim();
		if (
			option === null ||
			optionId === null ||
			ids.has(optionId) ||
			name === "" ||
			kind === ""
		)
			continue;
		ids.add(optionId);
		options.push({ optionId, name, kind });
	}
	return { ids, options };
}

function sanitizePermission(
	permission: JsonObject,
	id: string,
	context: PermissionSanitizationContext,
): CommonspacePermissionRequest | null {
	const conversation = plainRecord(permission.conversation);
	if (
		conversation === null ||
		(conversation.kind !== "channel" && conversation.kind !== "dm") ||
		typeof conversation.id !== "string"
	)
		return null;
	const sourceMessageId = loadedId(permission.sourceMessageId);
	const agentId = loadedId(permission.agentId);
	const toolCallId = loadedId(permission.toolCallId);
	if (
		sourceMessageId === null ||
		agentId === null ||
		toolCallId === null ||
		!context.agentIds.has(agentId) ||
		!context.messageById.has(sourceMessageId)
	)
		return null;
	const sanitizedOptions = sanitizePermissionOptions(permission.options);
	if (sanitizedOptions.options.length === 0) return null;
	const status =
		permission.status === "resolved" ||
		permission.status === "cancelled" ||
		permission.status === "interrupted"
			? permission.status
			: "interrupted";
	const selectedOptionId = loadedId(permission.selectedOptionId);
	const threadId = loadedId(permission.threadId);
	const sanitized: CommonspacePermissionRequest = {
		id,
		sourceMessageId,
		agentId,
		conversation: { kind: conversation.kind, id: conversation.id },
		toolCallId,
		title:
			loadedString(permission.title, 1_000).normalize("NFKC").trim() ||
			"Permission requested",
		options: sanitizedOptions.options,
		status,
		createdAt: loadedString(permission.createdAt, 100),
		resolvedAt: loadedIsoTimestamp(permission.resolvedAt),
	};
	if (threadId !== null) sanitized.threadId = threadId;
	if (typeof permission.kind === "string" && permission.kind.trim() !== "")
		sanitized.kind = permission.kind.trim().slice(0, 100);
	if (
		status === "resolved" &&
		selectedOptionId !== null &&
		sanitizedOptions.ids.has(selectedOptionId)
	)
		sanitized.selectedOptionId = selectedOptionId;
	return sanitized;
}

function sanitizePermissions(
	value: JsonValue | undefined,
	context: PermissionSanitizationContext,
): CommonspacePermissionRequest[] {
	if (!Array.isArray(value)) return [];
	const permissions: CommonspacePermissionRequest[] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const permission = plainRecord(candidate);
		const id = loadedId(permission?.id);
		if (permission === null || id === null || ids.has(id)) continue;
		const sanitized = sanitizePermission(permission, id, context);
		if (sanitized === null) continue;
		ids.add(id);
		permissions.push(sanitized);
	}
	return permissions;
}

function sanitizeLoadedDefaults(
	value: JsonValue | undefined,
): CommonspaceState["defaults"] {
	const defaults = plainRecord(value) ?? {};
	const fallback = defaultCommonspaceDefaults();
	return {
		maxAgentsPerTurn: loadedBoundedInteger(
			defaults.maxAgentsPerTurn,
			fallback.maxAgentsPerTurn,
			1,
			8,
		),
		memoryThreads: loadedBoundedInteger(
			defaults.memoryThreads,
			fallback.memoryThreads,
			1,
			50,
		),
	};
}

interface LoadedStateSource {
	readonly record: JsonObject;
	readonly version: number;
}

function loadedStateSource(value: JsonValue): LoadedStateSource {
	const record = plainRecord(value);
	if (
		record === null ||
		typeof record.version !== "number" ||
		!Number.isInteger(record.version) ||
		record.version < 1 ||
		record.version > COMMONSPACE_STATE_VERSION
	) {
		throw new Error(
			`Commonspace state has an unsupported version; expected 1-${COMMONSPACE_STATE_VERSION}`,
		);
	}
	return { record, version: record.version };
}

function loadedAttachmentDeletionIds(value: JsonValue | undefined): string[] {
	if (!Array.isArray(value))
		throw new Error("Invalid pending attachment deletion IDs");
	return value.map((id) => {
		if (typeof id !== "string" || !IMAGE_ATTACHMENT_ID_PATTERN.test(id))
			throw new Error("Invalid pending attachment deletion ID");
		return id;
	});
}

function loadedAttachmentDeletions(
	value: JsonValue | undefined,
	messages: CommonspaceState["messages"],
): CommonspaceState["pendingAttachmentDeletions"] {
	if (value === undefined) return undefined;
	const record = plainRecord(value);
	const pending = {
		imageIds: loadedAttachmentDeletionIds(record?.imageIds),
		fileIds: loadedAttachmentDeletionIds(record?.fileIds),
	};
	const liveIds = new Set(
		Object.values(messages).flatMap((entries) =>
			entries.flatMap((message) => [
				...(message.attachments ?? []).map((attachment) => attachment.id),
				...(message.files ?? []).map((file) => file.id),
			]),
		),
	);
	if ([...pending.imageIds, ...pending.fileIds].some((id) => liveIds.has(id)))
		throw new Error("Pending attachment deletion references retained content");
	return pending;
}

function sanitizeLoadedState(value: JsonValue): CommonspaceState {
	const { record, version } = loadedStateSource(value);
	const defaults = sanitizeLoadedDefaults(record.defaults);
	const projects = sanitizeProjects(record.projects);
	const agents = sanitizeAgents(record.agents);
	const agentIds = new Set(agents.map((agent) => agent.id));
	const projectIds = new Set(projects.map((project) => project.id));
	let channels = sanitizeChannels(record.channels).map((channel) => ({
		...channel,
		agentIds: channel.agentIds.filter((agentId) => agentIds.has(agentId)),
	}));
	const channelIds = new Set(channels.map((channel) => channel.id));
	let threads = sanitizeThreads(record.threads, channels, projectIds).map(
		(thread) => ({
			...thread,
			agentIds: thread.agentIds.filter((agentId) => agentIds.has(agentId)),
		}),
	);
	const threadIds = new Set(threads.map((thread) => thread.id));
	channels = channels.map((channel) => ({
		...channel,
		memory: {
			...channel.memory,
			threadIds: channel.memory.threadIds.filter((id) => threadIds.has(id)),
		},
	}));
	const dmSessions = sanitizeDmSessions(record.dmSessions, agentIds);
	const messages = sanitizeMessages(record.messages, {
		agentIds,
		channelIds,
		projectIds,
		threadIds,
	});
	if (version < 19) {
		threads = threads.map((thread) => ({
			...thread,
			context: {
				...thread.context,
				memory: projectThreadMemoryFromMessages(
					(
						messages[
							conversationKey({ kind: "channel", id: thread.channelId })
						] ?? []
					).filter((message) => message.threadId === thread.id),
				),
			},
		}));
	}
	const messageIndex = indexLoadedMessages(messages);
	const pins = sanitizePins(record.pins, {
		channelIds,
		messageById: messageIndex.byId,
		threadIds,
	});
	const permissions = sanitizePermissions(record.permissions, {
		agentIds,
		messageById: messageIndex.byId,
	});
	const sanitized: CommonspaceState = {
		version: COMMONSPACE_STATE_VERSION,
		revision: loadedBoundedInteger(
			record.revision,
			0,
			0,
			Number.MAX_SAFE_INTEGER,
		),
		inboxReadAt: loadedIsoTimestamp(record.inboxReadAt),
		inboxReadMessageIds: loadedStringArray(
			record.inboxReadMessageIds,
			10_000,
			200,
		).filter((messageId) => messageIndex.inboxIds.has(messageId)),
		inboxUnreadMessageIds: loadedStringArray(
			record.inboxUnreadMessageIds,
			10_000,
			200,
		).filter((messageId) => messageIndex.byId.has(messageId)),
		inboxSavedItemIds: loadedStringArray(
			record.inboxSavedItemIds,
			10_000,
			200,
		).filter((messageId) => messageIndex.inboxIds.has(messageId)),
		followedSessionIds: loadedStringArray(
			record.followedSessionIds,
			10_000,
			500,
		),
		mutedSessionIds: loadedStringArray(record.mutedSessionIds, 10_000, 500),
		notifications: sanitizeNotificationSettings(record.notifications),
		defaults,
		agents,
		dmSessions,
		agentSessions: sanitizeAgentSessions(
			record.agentSessions,
			agentIds,
			dmSessions,
			channelIds,
		),
		projects,
		channels,
		threads,
		pins,
		permissions,
		messages,
	};
	const pending = loadedAttachmentDeletions(
		record.pendingAttachmentDeletions,
		messages,
	);
	if (pending !== undefined) sanitized.pendingAttachmentDeletions = pending;
	return sanitized;
}

function appendArchiveAttachment(
	attachments: CommonspaceArchiveAttachment[],
	seen: Set<string>,
	kind: CommonspaceArchiveAttachment["kind"],
	metadata: Omit<CommonspaceArchiveAttachment, "data" | "kind">,
): void {
	if (seen.has(metadata.id)) return;
	seen.add(metadata.id);
	attachments.push({ kind, ...metadata, data: "" });
}

function collectArchiveAttachments(
	messages: Readonly<Record<string, readonly CommonspaceMessage[]>>,
): CommonspaceArchiveAttachment[] {
	const attachments: CommonspaceArchiveAttachment[] = [];
	const seen = new Set<string>();
	for (const entries of Object.values(messages)) {
		for (const message of entries) {
			for (const attachment of message.attachments ?? []) {
				appendArchiveAttachment(attachments, seen, "image", attachment);
			}
			for (const file of message.files ?? []) {
				appendArchiveAttachment(attachments, seen, "file", file);
			}
		}
	}
	return attachments;
}

interface DecodedWorkspaceArchive {
	readonly workspace: JsonObject;
	readonly importedWorkspace: JsonObject;
	readonly projects: JsonValue[];
	readonly attachments: JsonValue[];
}

interface PreparedWorkspaceImport {
	readonly state: CommonspaceState;
	readonly images: PreparedImageAttachment[];
	readonly files: PreparedFileAttachment[];
}

type ImportedAttachmentExpectation =
	| { kind: "image"; metadata: CommonspaceImageAttachment }
	| { kind: "file"; metadata: CommonspaceFileAttachment };

function assertWorkspaceImportTargetEmpty(state: CommonspaceState): void {
	if (
		state.revision !== 0 ||
		state.agents.length > 0 ||
		state.projects.length > 0 ||
		state.channels.length > 0 ||
		state.threads.length > 0 ||
		Object.values(state.messages).some((messages) => messages.length > 0)
	)
		throw new Error("workspace import requires an empty workspace");
}

function decodeWorkspaceArchive(
	archiveValue: JsonValue,
	projectMappings: Record<string, string[]>,
): DecodedWorkspaceArchive {
	const archive = plainRecord(archiveValue);
	const workspace = plainRecord(archive?.workspace);
	if (
		archive === null ||
		workspace === null ||
		archive.format !== "commonspace-workspace" ||
		archive.version !== COMMONSPACE_EXPORT_VERSION
	)
		throw new Error("unsupported Commonspace workspace archive");
	if (
		!Array.isArray(workspace.projects) ||
		!Array.isArray(archive.attachments) ||
		plainRecord(projectMappings) === null
	)
		throw new Error("workspace archive is invalid");
	return {
		workspace,
		importedWorkspace: workspace,
		projects: workspace.projects,
		attachments: archive.attachments,
	};
}

async function resolveImportedProjects(
	candidates: readonly JsonValue[],
	projectMappings: Record<string, string[]>,
	validDirectory: (path: string) => Promise<string>,
): Promise<CommonspaceState["projects"]> {
	const projects: CommonspaceState["projects"] = [];
	const mappedIds = new Set(Object.keys(projectMappings));
	for (const candidate of candidates) {
		const project = plainRecord(candidate);
		const id = loadedId(project?.id);
		const name = loadedString(project?.name, 80).normalize("NFKC").trim();
		const rootCount = project?.rootCount;
		if (
			project === null ||
			id === null ||
			name === "" ||
			typeof rootCount !== "number" ||
			!Number.isSafeInteger(rootCount) ||
			rootCount < 1 ||
			rootCount > 32
		)
			throw new Error("workspace archive contains an invalid Project");
		const mapping = projectMappings[id];
		if (!Array.isArray(mapping) || mapping.length !== rootCount)
			throw new Error(
				`Project ${name} requires ${String(rootCount)} mapped local roots`,
			);
		const paths = await Promise.all(mapping.map(validDirectory));
		if (new Set(paths).size !== paths.length)
			throw new Error(`Project ${name} mappings must be unique`);
		mappedIds.delete(id);
		projects.push({
			id,
			name,
			paths,
			createdAt: loadedString(project.createdAt, 100),
		});
	}
	if (mappedIds.size > 0)
		throw new Error("Project mappings contain unknown archive Projects");
	return projects;
}

function sanitizeImportedWorkspace(
	decoded: DecodedWorkspaceArchive,
	projects: CommonspaceState["projects"],
): CommonspaceState {
	const importedValue: JsonValue = JSON.parse(
		JSON.stringify({
			...decoded.importedWorkspace,
			version: COMMONSPACE_STATE_VERSION,
			revision: 1,
			projects,
			dmSessions: {},
			agentSessions: {},
		}),
	);
	const imported = sanitizeLoadedState(importedValue);
	if (imported.projects.length !== projects.length)
		throw new Error("workspace archive Project validation failed");
	const canonicalWorkspace: CommonspaceWorkspaceArchive["workspace"] = {
		inboxReadAt: imported.inboxReadAt,
		inboxReadMessageIds: imported.inboxReadMessageIds,
		inboxSavedItemIds: imported.inboxSavedItemIds,
		followedSessionIds: imported.followedSessionIds,
		mutedSessionIds: imported.mutedSessionIds,
		notifications: imported.notifications,
		defaults: imported.defaults,
		agents: imported.agents,
		projects: imported.projects.map((project) => ({
			id: project.id,
			name: project.name,
			rootCount: project.paths.length,
			createdAt: project.createdAt,
		})),
		channels: imported.channels,
		threads: imported.threads,
		pins: imported.pins,
		permissions: imported.permissions,
		messages: imported.messages,
	};
	if (decoded.workspace.inboxUnreadMessageIds !== undefined)
		canonicalWorkspace.inboxUnreadMessageIds =
			imported.inboxUnreadMessageIds ?? [];
	if (!isDeepStrictEqual(canonicalWorkspace, decoded.importedWorkspace))
		throw new Error("workspace archive failed structural validation");
	return imported;
}

function expectedImportedAttachments(
	state: CommonspaceState,
): Map<string, ImportedAttachmentExpectation> {
	const expected = new Map<string, ImportedAttachmentExpectation>();
	for (const message of Object.values(state.messages).flat()) {
		for (const attachment of message.attachments ?? [])
			expected.set(attachment.id, { kind: "image", metadata: attachment });
		for (const file of message.files ?? [])
			expected.set(file.id, { kind: "file", metadata: file });
	}
	return expected;
}

function decodeImportedAttachment(
	candidate: JsonValue,
	expected: ReadonlyMap<string, ImportedAttachmentExpectation>,
	importedIds: ReadonlySet<string>,
): {
	readonly id: string;
	readonly expectation: ImportedAttachmentExpectation;
	readonly data: Buffer;
} {
	const attachment = plainRecord(candidate);
	const id = loadedId(attachment?.id);
	const expectation = id === null ? undefined : expected.get(id);
	if (
		attachment === null ||
		id === null ||
		importedIds.has(id) ||
		expectation === undefined ||
		attachment.kind !== expectation.kind ||
		attachment.name !== expectation.metadata.name ||
		attachment.mimeType !== expectation.metadata.mimeType ||
		attachment.size !== expectation.metadata.size ||
		typeof attachment.data !== "string" ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
			attachment.data,
		)
	)
		throw new Error("workspace archive attachment validation failed");
	const data = Buffer.from(attachment.data, "base64");
	if (
		data.length !== expectation.metadata.size ||
		data.toString("base64") !== attachment.data
	)
		throw new Error("workspace archive attachment data is invalid");
	return { id, expectation, data };
}

function prepareImportedAttachments(
	candidates: readonly JsonValue[],
	state: CommonspaceState,
): Pick<PreparedWorkspaceImport, "images" | "files"> {
	const expected = expectedImportedAttachments(state);
	const images: PreparedImageAttachment[] = [];
	const files: PreparedFileAttachment[] = [];
	const importedIds = new Set<string>();
	for (const candidate of candidates) {
		const { id, expectation, data } = decodeImportedAttachment(
			candidate,
			expected,
			importedIds,
		);
		importedIds.add(id);
		if (expectation.kind === "image")
			images.push({ metadata: expectation.metadata, data });
		else files.push({ metadata: expectation.metadata, data });
	}
	if (importedIds.size !== expected.size)
		throw new Error("workspace archive is missing attachment data");
	return { images, files };
}

async function prepareWorkspaceImport(
	archiveValue: JsonValue,
	projectMappings: Record<string, string[]>,
	validDirectory: (path: string) => Promise<string>,
): Promise<PreparedWorkspaceImport> {
	const decoded = decodeWorkspaceArchive(archiveValue, projectMappings);
	const projects = await resolveImportedProjects(
		decoded.projects,
		projectMappings,
		validDirectory,
	);
	const state = sanitizeImportedWorkspace(decoded, projects);
	return { state, ...prepareImportedAttachments(decoded.attachments, state) };
}

type RetentionConversation = ApplyRetentionRequest["conversation"];

interface RetentionSessionPlan {
	readonly agentSessions: CommonspaceState["agentSessions"];
	readonly dmSessions: CommonspaceState["dmSessions"];
	readonly removedProcessScopeNames: ReadonlySet<string>;
}

interface PreparedRetention {
	readonly state: CommonspaceState;
	readonly removedProcessScopeNames: ReadonlySet<string>;
}

function retentionThreads(
	state: CommonspaceState,
	conversation: RetentionConversation,
): CommonspaceThread[] {
	return conversation.kind === "channel"
		? state.threads.filter((thread) => thread.channelId === conversation.id)
		: [];
}

function prepareRetentionSessions(
	state: CommonspaceState,
	conversation: RetentionConversation,
	removedThreads: readonly CommonspaceThread[],
): RetentionSessionPlan {
	const removedSessionNames = new Set(
		removedThreads.map((thread) => `Commonspace Thread: ${thread.id}`),
	);
	const removedProcessScopeNames = new Set([
		...removedSessionNames,
		...removedThreads.map(
			(thread) => `${THREAD_CONTEXT_PROCESS_SCOPE_PREFIX}${thread.id}`,
		),
	]);
	if (conversation.kind === "channel") {
		removedProcessScopeNames.add(
			`${ROUTING_SESSION_SCOPE_PREFIX}${conversation.id}`,
		);
		removedProcessScopeNames.add(
			`${CHANNEL_CONTEXT_PROCESS_SCOPE_PREFIX}${conversation.id}`,
		);
	}
	if (conversation.kind === "dm") {
		removedSessionNames.add("Bot Chat");
		removedProcessScopeNames.add("Bot Chat");
		for (const name of Object.keys(
			state.agentSessions[conversation.id] ?? {},
		)) {
			if (!name.startsWith("Commonspace DM: ")) continue;
			removedSessionNames.add(name);
			removedProcessScopeNames.add(name);
		}
	}
	const agentSessions: CommonspaceState["agentSessions"] = {};
	for (const [agentId, sessions] of Object.entries(state.agentSessions)) {
		if (conversation.kind === "dm" && agentId !== conversation.id) {
			agentSessions[agentId] = sessions;
			continue;
		}
		const remaining = Object.fromEntries(
			Object.entries(sessions).filter(
				([name]) => !removedSessionNames.has(name),
			),
		);
		if (Object.keys(remaining).length > 0) agentSessions[agentId] = remaining;
	}
	const dmSessions = { ...state.dmSessions };
	if (conversation.kind === "dm") delete dmSessions[conversation.id];
	return { agentSessions, dmSessions, removedProcessScopeNames };
}

function pinSurvivesRetention(
	pin: CommonspacePin,
	conversation: RetentionConversation,
	removedThreadIds: ReadonlySet<string>,
	removedMessageIds: ReadonlySet<string>,
): boolean {
	const messageId = pin.kind === "note" ? undefined : pin.messageId;
	return !(
		(pin.scope.kind === "channel" &&
			conversation.kind === "channel" &&
			pin.scope.id === conversation.id) ||
		(pin.scope.kind === "thread" && removedThreadIds.has(pin.scope.id)) ||
		(messageId !== undefined && removedMessageIds.has(messageId))
	);
}

function prepareRetention(
	state: CommonspaceState,
	conversation: RetentionConversation,
	removedThreads: readonly CommonspaceThread[],
): PreparedRetention {
	const key = conversationKey(conversation);
	const removedMessages = state.messages[key] ?? [];
	const removedMessageIds = new Set(
		removedMessages.map((message) => message.id),
	);
	const imageIds = removedMessages.flatMap(
		(message) => message.attachments?.map((attachment) => attachment.id) ?? [],
	);
	const fileIds = removedMessages.flatMap(
		(message) => message.files?.map((file) => file.id) ?? [],
	);
	const removedThreadIds = new Set(removedThreads.map((thread) => thread.id));
	const sessionPlan = prepareRetentionSessions(
		state,
		conversation,
		removedThreads,
	);
	const messages = { ...state.messages };
	delete messages[key];
	return {
		removedProcessScopeNames: sessionPlan.removedProcessScopeNames,
		state: {
			...state,
			pendingAttachmentDeletions: {
				imageIds: [
					...(state.pendingAttachmentDeletions?.imageIds ?? []),
					...imageIds,
				],
				fileIds: [
					...(state.pendingAttachmentDeletions?.fileIds ?? []),
					...fileIds,
				],
			},
			revision: state.revision + 1,
			inboxReadMessageIds: state.inboxReadMessageIds.filter(
				(id) => !removedMessageIds.has(id),
			),
			inboxUnreadMessageIds: (state.inboxUnreadMessageIds ?? []).filter(
				(id) => !removedMessageIds.has(id),
			),
			inboxSavedItemIds: state.inboxSavedItemIds.filter(
				(id) => !removedMessageIds.has(id),
			),
			dmSessions: sessionPlan.dmSessions,
			agentSessions: sessionPlan.agentSessions,
			channels:
				conversation.kind === "channel"
					? state.channels.map((channel) =>
							channel.id === conversation.id
								? {
										...channel,
										memory: emptyChannelMemory(),
										routingMemory: emptyRoutingMemory(),
									}
								: channel,
						)
					: state.channels,
			threads: state.threads.filter(
				(thread) => !removedThreadIds.has(thread.id),
			),
			pins: state.pins.filter((pin) =>
				pinSurvivesRetention(
					pin,
					conversation,
					removedThreadIds,
					removedMessageIds,
				),
			),
			permissions: state.permissions.filter(
				(permission) =>
					permission.conversation.kind !== conversation.kind ||
					permission.conversation.id !== conversation.id,
			),
			messages,
		},
	};
}

function canonicalizeLoadedMessageProjects(
	message: Readonly<CommonspaceMessage>,
	projectIds: ReadonlySet<string>,
): CommonspaceMessage {
	const references = referencedProjectIds(message).filter((projectId) =>
		projectIds.has(projectId),
	);
	const sanitized = { ...message };
	if (references.length === 0) {
		delete sanitized.projectIds;
		delete sanitized.projectId;
	} else {
		sanitized.projectIds = references;
		const primaryProjectId = references[0];
		if (primaryProjectId !== undefined) sanitized.projectId = primaryProjectId;
	}
	if (sanitized.runAttribution === undefined) return sanitized;
	if (references.length === 0) {
		delete sanitized.runAttribution;
		return sanitized;
	}
	const referenced = new Set(references);
	const roots = sanitized.runAttribution.roots.filter(
		(root) => root.projectId === undefined || referenced.has(root.projectId),
	);
	if (roots.length === 0) delete sanitized.runAttribution;
	else sanitized.runAttribution = { ...sanitized.runAttribution, roots };
	return sanitized;
}

interface ValidatedPermissionSelection {
	readonly index: number;
	readonly permission: CommonspacePermissionRequest;
}

function validatePermissionSelection(
	permissions: readonly CommonspacePermissionRequest[],
	permissionId: string,
	optionId: string,
): ValidatedPermissionSelection {
	if (typeof permissionId !== "string" || permissionId === "")
		throw new Error("permission id is required");
	if (typeof optionId !== "string" || optionId === "")
		throw new Error("permission option is required");
	const index = permissions.findIndex(
		(permission) => permission.id === permissionId,
	);
	const permission = permissions[index];
	if (permission === undefined) throw new Error("unknown permission request");
	if (permission.status !== "pending")
		throw new Error("permission request is no longer pending");
	if (!permission.options.some((option) => option.optionId === optionId))
		throw new Error("permission option was not advertised");
	return { index, permission };
}

export class CommonspaceHostService implements CommonspaceMcpProvider {
	readonly root: string;
	private readonly statePath: string;
	private readonly stateBackupPath: string;
	private readonly stateCorruptPath: string;
	private readonly routingPath: string;
	private readonly attachmentsRoot: string;
	private defaultCwd: string;
	private state: CommonspaceState = createInitialState();
	private routingConfiguration: PrivateRoutingConfiguration = missingRouting;
	private writeTail = Promise.resolve();
	private deletionTail = Promise.resolve();
	private routingConfigurationTail: Promise<void> = Promise.resolve();
	private readonly agentSessionTails = new Map<string, Promise<unknown>>();
	private readonly channelMemoryTails = new Map<string, Promise<unknown>>();
	private readonly threadMemoryTails = new Map<string, Promise<unknown>>();
	private readonly revisionListeners = new Set<(revision: number) => void>();
	private readonly routingListeners = new Set<() => void>();
	private readonly liveActivityListeners = new Set<
		(activities: readonly CommonspaceLiveAgentActivity[]) => void
	>();
	private readonly liveActivitiesById = new Map<
		string,
		CommonspaceLiveAgentActivity
	>();
	private readonly knownInboxItemIds = new Set<string>();
	private readonly activeAgentRuns = new Map<string, ActiveAgentRun>();
	private readonly agentExecutionRevisions = new Map<string, number>();
	private readonly executingAgentRunsByScope = new Map<
		string,
		ActiveAgentRun
	>();
	private readonly pendingAgentHandoffs = new Map<
		string,
		CommonspaceMcpHandoffRequest
	>();
	private readonly permissionResolvers = new Map<
		string,
		(outcome: AgentPermissionOutcome) => void
	>();
	private readonly backgroundRuns = new Set<Promise<void>>();
	private readonly routingIndexes = new Map<string, RoutingMessageIndex>();
	private readonly historyIndexes = new Map<string, ContextHistoryIndex>();
	private readonly historyEmbeddings = new LocalHistoryEmbeddings();
	private readonly contextRefreshes = new Map<string, { dirty: boolean }>();
	private readonly inferenceShutdown = new AbortController();
	private readonly activeConversationRuns = new Map<string, Promise<void>>();
	private readonly pendingFollowups = new Map<string, PendingFollowup[]>();
	private activeAdmissions = 0;
	private exclusiveAdmission = false;
	private readonly admissionIdleWaiters = new Set<() => void>();
	private readonly acpProcesses = new Map<string, AcpAgentProcess>();
	private readonly acpLaunchAccess = new WeakMap<AcpAgentProcess, boolean>();
	private readonly acpEphemeralSessionCounts = new WeakMap<
		AcpAgentProcess,
		number
	>();
	private readonly acpProcessClosures = new Map<string, Promise<void>>();
	private readonly activeAcpSessions = new Map<string, ActiveAcpSession>();
	private readonly mcpCredentials = new Map<
		string,
		{ fingerprint: string; scope: CommonspaceMcpScope; token: string }
	>();
	private readonly adapters: Record<AgentAdapterKind, NativeAgentAdapter>;
	private readonly agentYolo: boolean | AgentAdapterKind;
	private readonly runBudgetSeconds: number | undefined;
	private readonly managedDefaultCwd: boolean;
	private readonly notifyDesktop: (
		notification: CommonspaceDesktopNotification,
	) => Promise<void>;
	private discoveredAgentCandidates: CommonspaceAgentProfile[] = [];
	private closeOperation: Promise<void> | undefined;
	private drainOperation: Promise<void> | undefined;
	private closing = false;
	private draining = false;
	private mcpGateway: CommonspaceMcpGateway | undefined;
	private mcpEndpoint: string | undefined;
	private clientUrl: string | undefined;

	constructor(
		private readonly environment: CommonspaceHostEnvironment,
		config: CommonspaceHostConfig = {},
		private readonly overrides: Partial<CommonspaceHostDependencies> = {},
	) {
		this.root = config.root ?? join(homedir(), ".commonspace");
		this.statePath = join(this.root, "state.json");
		this.stateBackupPath = join(this.root, "state.backup.json");
		this.stateCorruptPath = join(this.root, "state.corrupt.json");
		this.routingPath = join(this.root, "routing.json");
		this.attachmentsRoot = join(this.root, "attachments");
		this.managedDefaultCwd = config.defaultCwd === undefined;
		this.defaultCwd = config.defaultCwd ?? join(this.root, "workspace");
		this.adapters = createAgentAdapters(config);
		this.agentYolo = config.agentYolo ?? false;
		this.runBudgetSeconds =
			config.runBudgetSeconds === undefined
				? undefined
				: Math.min(3_600, Math.max(30, config.runBudgetSeconds));
		this.notifyDesktop = overrides.notify ?? createDesktopNotifier();
	}

	async initialize(): Promise<void> {
		await this.prepareStorage();
		await this.restoreRoutingConfiguration();
		await this.restorePersistedState();
		this.state = await this.canonicalizeLoadedProjectPaths(this.state);
		this.state = this.redactLoadedTraces(this.state);
		await this.removeInvalidInferenceAgent();
		this.refreshLoadedChannelMemory();
		this.markInterruptedRuns(
			"The previous Commonspace process ended before the agent completed.",
		);
		await this.persist();
		try {
			await this.removePendingAttachmentDeletions();
		} catch {
			this.environment.logger?.warn(
				"Attachment cleanup is pending. Retry deletion or restart Commonspace after restoring storage access.",
			);
		}
		this.synchronizeNotificationBaseline();
	}

	private async prepareStorage(): Promise<void> {
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		await chmod(this.root, 0o700);
		await mkdir(this.attachmentsRoot, { recursive: true, mode: 0o700 });
		await chmod(this.attachmentsRoot, 0o700);
		if (this.managedDefaultCwd) {
			await mkdir(this.defaultCwd, { recursive: true, mode: 0o700 });
			await chmod(this.defaultCwd, 0o700);
		}
		this.defaultCwd = await realpath(this.defaultCwd);
	}

	private async restoreRoutingConfiguration(): Promise<void> {
		try {
			const saved = loadSavedRoutingConfiguration(
				await readFile(this.routingPath, "utf8"),
			);
			if (saved === undefined) {
				await rm(this.routingPath, { force: true });
				this.routingConfiguration = missingRouting;
				this.environment.logger?.warn(
					"Commonspace removed an unsupported inference configuration",
				);
			} else {
				this.routingConfiguration = saved;
			}
		} catch (error) {
			if (errorCode(error) !== "ENOENT")
				this.environment.logger?.warn(
					"Commonspace inference is unavailable: saved routing configuration could not be read",
				);
			this.routingConfiguration =
				errorCode(error) === "ENOENT" ? missingRouting : invalidRouting;
		}
	}

	private async readPersistedState(path: string): Promise<CommonspaceState> {
		return sanitizeLoadedState(JSON.parse(await readFile(path, "utf8")));
	}

	private async hasCorruptState(): Promise<boolean> {
		try {
			await readFile(this.stateCorruptPath, "utf8");
			return true;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
			return false;
		}
	}

	private async restorePersistedState(): Promise<void> {
		try {
			this.state = await this.readPersistedState(this.statePath);
		} catch (primaryError) {
			const primaryMissing = errorCode(primaryError) === "ENOENT";
			try {
				this.state = await this.readPersistedState(this.stateBackupPath);
				if (!primaryMissing) {
					await rm(this.stateCorruptPath, { force: true });
					await rename(this.statePath, this.stateCorruptPath);
				}
				this.environment.logger?.warn(
					"Commonspace recovered unavailable state.json from state.backup.json",
				);
			} catch (recoveryError) {
				if (!primaryMissing || errorCode(recoveryError) !== "ENOENT") {
					this.environment.logger?.warn(primaryError);
					this.environment.logger?.warn(recoveryError);
					throw new AggregateError(
						[primaryError, recoveryError],
						"Commonspace state and rollback backup are both invalid",
						{ cause: recoveryError },
					);
				}
				if (await this.hasCorruptState())
					throw new Error(
						"Commonspace saved state is corrupt and no rollback backup is available",
						{ cause: recoveryError },
					);
				this.state = createInitialState();
			}
		}
	}

	private async removeInvalidInferenceAgent(): Promise<void> {
		const savedInferenceAgentId =
			this.routingConfiguration.provider === CommonspaceRoutingProvider.Harness
				? this.routingConfiguration.harnessAgentId
				: undefined;
		if (
			savedInferenceAgentId !== undefined &&
			!this.state.agents.some((agent) => agent.id === savedInferenceAgentId)
		) {
			await this.persistRoutingConfiguration(missingRouting);
			this.routingConfiguration = missingRouting;
			this.environment.logger?.warn(
				"Commonspace removed an inference Agent selection that is not in the workspace",
			);
		}
	}

	private refreshLoadedChannelMemory(): void {
		let memoryChanged = false;
		const channels = this.state.channels.map((channel) => {
			const memory = mergeChannelMemoryProjection(
				channel.memory,
				projectChannelMemory(
					this.state,
					channel.id,
					this.state.defaults.memoryThreads,
				),
			);
			const feedback = buildRoutingMemoryCompactionPrompt(
				this.state,
				channel.id,
			);
			const summarySupported = routingSummaryStillSupported(
				this.state,
				channel.id,
				channel.routingMemory.compactedThroughCorrectionId,
				channel.routingMemory.updatedAt,
			);
			const summaryCurrent =
				feedback !== null &&
				channel.routingMemory.status === "current" &&
				channel.routingMemory.correctionCount === feedback.correctionCount &&
				channel.routingMemory.compactedThroughCorrectionId ===
					feedback.compactedThroughCorrectionId &&
				summarySupported;
			const routingMemory =
				feedback === null
					? emptyRoutingMemory()
					: {
							...channel.routingMemory,
							summary: summarySupported ? channel.routingMemory.summary : "",
							status: summaryCurrent
								? ("current" as const)
								: ("stale" as const),
							correctionCount: feedback.correctionCount,
							compactedThroughCorrectionId: summarySupported
								? channel.routingMemory.compactedThroughCorrectionId
								: null,
							updatedAt: summarySupported
								? channel.routingMemory.updatedAt
								: null,
						};
			const changed =
				JSON.stringify(memory) !== JSON.stringify(channel.memory) ||
				JSON.stringify(routingMemory) !== JSON.stringify(channel.routingMemory);
			if (changed) memoryChanged = true;
			return changed ? { ...channel, memory, routingMemory } : channel;
		});
		if (memoryChanged) {
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				channels,
			};
		}
	}

	private async canonicalizeLoadedProjectPaths(
		state: CommonspaceState,
	): Promise<CommonspaceState> {
		const projects: CommonspaceState["projects"] = [];
		for (const project of state.projects) {
			const paths = new Set<string>();
			for (const path of project.paths) {
				try {
					const canonical = await this.validDirectory(path);
					paths.add(canonical);
				} catch {
					// Invalid persisted paths are dropped before they can reach an agent process.
				}
			}
			if (paths.size > 0) projects.push({ ...project, paths: [...paths] });
		}
		const projectIds = new Set(projects.map((project) => project.id));
		const threads = state.threads.map((thread) => {
			const references = referencedProjectIds(thread).filter((projectId) =>
				projectIds.has(projectId),
			);
			return {
				...thread,
				projectIds: references,
				projectId: references[0] ?? null,
			};
		});
		const messages = Object.fromEntries(
			Object.entries(state.messages).map(([key, entries]) => [
				key,
				entries.map((message) =>
					canonicalizeLoadedMessageProjects(message, projectIds),
				),
			]),
		);
		return { ...state, projects, threads, messages };
	}

	snapshot(): CommonspaceState {
		return structuredClone(this.state);
	}

	private performancePhaseStartedAt(): number | undefined {
		return this.overrides.onPerformanceMeasurement === undefined
			? undefined
			: performance.now();
	}

	private recordPerformanceMeasurement(
		phase: CommonspaceHostPerformancePhase,
		startedAt: number | undefined,
	): void {
		if (startedAt === undefined) return;
		try {
			const observation = this.overrides.onPerformanceMeasurement?.({
				phase,
				durationMs: performance.now() - startedAt,
			});
			if (observation !== undefined) void observation.catch(() => undefined);
		} catch {
			// Benchmark instrumentation must never change service behavior.
		}
	}

	private publicSnapshot(): CommonspaceState {
		const snapshot = this.snapshot();
		delete snapshot.pendingAttachmentDeletions;
		return {
			...snapshot,
			dmSessions: {},
			agentSessions: {},
			projects: snapshot.projects.map((project) => ({
				...project,
				paths: project.paths.map((_path, index) =>
					index === 0
						? "Working folder"
						: `Reference folder ${String(index + 1)}`,
				),
			})),
		};
	}

	private async withAdmission<T>(
		operation: () => Promise<T>,
		mode: "shared" | "exclusive" = "shared",
	): Promise<T> {
		if (this.closing) throw new Error("Commonspace is shutting down");
		if (this.draining) throw new Error("Commonspace is restarting");
		if (this.exclusiveAdmission)
			throw new Error("workspace import is in progress");
		if (mode === "exclusive" && this.activeAdmissions > 0)
			throw new Error("workspace import requires no in-flight operations");
		if (mode === "exclusive") this.exclusiveAdmission = true;
		this.activeAdmissions += 1;
		try {
			return await operation();
		} finally {
			this.activeAdmissions -= 1;
			if (mode === "exclusive") this.exclusiveAdmission = false;
			if (this.activeAdmissions === 0) {
				for (const resolveIdle of this.admissionIdleWaiters) resolveIdle();
				this.admissionIdleWaiters.clear();
			}
		}
	}

	private async whenAdmissionsIdle(): Promise<void> {
		if (this.activeAdmissions === 0) return;
		await new Promise<void>((resolveIdle) => {
			this.admissionIdleWaiters.add(resolveIdle);
		});
	}

	async whenIdle(): Promise<void> {
		while (this.backgroundRuns.size > 0) {
			await Promise.all(
				[...this.backgroundRuns].map((operation) =>
					operation.catch(() => undefined),
				),
			);
		}
	}

	async drainAndClose(): Promise<void> {
		this.drainOperation ??= (async () => {
			await this.whenIdle();
			this.draining = true;
			await this.whenAdmissionsIdle();
			await this.whenIdle();
			await this.close();
		})();
		await this.drainOperation;
	}

	async close(): Promise<void> {
		this.closing = true;
		this.inferenceShutdown.abort(new Error("Commonspace is shutting down"));
		this.routingIndexes.clear();
		this.historyIndexes.clear();
		this.closeOperation ??= (async () => {
			await this.historyEmbeddings.close();
			const permissionsInterrupted = this.interruptPendingPermissions();
			const processes = [...this.acpProcesses.values()];
			this.acpProcesses.clear();
			this.activeAcpSessions.clear();
			for (const run of this.activeAgentRuns.values())
				run.abortController.abort(new Error("Commonspace is shutting down"));
			this.activeAgentRuns.clear();
			this.liveActivitiesById.clear();
			this.broadcastLiveActivities();
			await Promise.all(
				processes.map((processClient) =>
					processClient.close().catch((error) => {
						this.environment.logger?.warn(error);
					}),
				),
			);
			await this.whenIdle();
			if (
				this.markInterruptedRuns(
					"Commonspace shut down before the agent completed.",
				) ||
				permissionsInterrupted
			) {
				await this.persist();
				this.broadcastRevision();
			}
			await this.writeTail;
			this.mcpCredentials.clear();
			await this.mcpGateway?.close();
		})();
		await this.closeOperation;
	}

	attachMcpGateway(gateway: CommonspaceMcpGateway, endpoint: string): void {
		if (this.closing) throw new Error("Commonspace is shutting down");
		const url = new URL(endpoint);
		if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
			throw new Error("Commonspace MCP endpoint must use loopback HTTP");
		}
		if (
			this.mcpGateway !== undefined &&
			(this.mcpGateway !== gateway || this.mcpEndpoint !== url.href)
		) {
			throw new Error("Commonspace MCP gateway is already attached");
		}
		this.mcpGateway = gateway;
		this.mcpEndpoint = url.href;
	}

	attachClientUrl(value: string): void {
		if (this.closing) throw new Error("Commonspace is shutting down");
		const url = new URL(value);
		if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
			throw new Error("Commonspace client URL must use loopback HTTP");
		url.pathname = "/";
		url.search = "";
		url.hash = "";
		this.clientUrl = url.href;
	}

	private mcpPinViews(scoped: ResolvedMcpScope): McpPinView[] {
		if (scoped.channel === undefined) return [];
		const pins = this.state.pins.filter(
			(pin) =>
				pin.removedAt === null &&
				((pin.scope.kind === "channel" &&
					pin.scope.id === scoped.channel?.id) ||
					(pin.scope.kind === "thread" && pin.scope.id === scoped.thread?.id)),
		);
		const sourceById = pinSourceMessages(this.state.messages, pins);
		return pins.map((pin): McpPinView => {
			if (pin.kind === "note") return pin;
			const source = sourceById.get(pin.messageId);
			if (source === undefined) return pin;
			if (pin.kind === "message") {
				return {
					...pin,
					source: { authorName: source.authorName, text: source.text },
				};
			}
			const attachment =
				source.attachments?.find(
					(candidate) => candidate.id === pin.attachmentId,
				) ??
				source.files?.find((candidate) => candidate.id === pin.attachmentId);
			const view: McpPinView = {
				...pin,
				source: { authorName: source.authorName },
			};
			if (attachment !== undefined && view.source !== undefined)
				view.source.attachment = attachment;
			return view;
		});
	}

	private mcpParticipants(scoped: ResolvedMcpScope): McpParticipant[] {
		if (scoped.channel === undefined)
			return [{ id: scoped.agent.id, displayName: scoped.agent.displayName }];
		if (scoped.channel.agentIds.length === 0) return [];
		const profilesById = new Map<string, CommonspaceAgentProfile>();
		for (const profile of this.configuredAgents()) {
			if (!profilesById.has(profile.id)) profilesById.set(profile.id, profile);
		}
		const participants: McpParticipant[] = [];
		for (const id of scoped.channel.agentIds) {
			const profile = profilesById.get(id);
			if (profile === undefined) continue;
			const participant: McpParticipant = {
				id: profile.id,
				displayName: profile.displayName,
				adapter: profile.adapter,
			};
			if (profile.description !== undefined)
				participant.description = profile.description;
			participants.push(participant);
		}
		return participants;
	}

	async readContext(scope: CommonspaceMcpScope): Promise<McpContextResponse> {
		const scoped = this.resolveMcpScope(scope);
		const messages = this.boundedMcpMessages(
			this.messagesForMcpScope(scope),
			MAX_MCP_CONTEXT_MESSAGES,
		);
		const conversation: McpContextResponse["conversation"] =
			scoped.channel === undefined
				? {
						kind: "dm",
						id: scope.conversation.id,
						name: `Direct message with ${scoped.agent.displayName}`,
					}
				: { kind: "channel", id: scoped.channel.id, name: scoped.channel.name };
		const scopedPins = this.mcpPinViews(scoped);
		const context: McpContextResponse = {
			agent: {
				id: scoped.agent.id,
				displayName: scoped.agent.displayName,
				adapter: scoped.agent.adapter,
			},
			conversation,
			instructions: scoped.channel?.instructions ?? "",
			memory: scoped.channel?.memory ?? {
				summary: "",
				decisions: [],
				openQuestions: [],
				threadIds: [],
				updatedAt: null,
			},
			pins: scopedPins,
			participants: this.mcpParticipants(scoped),
			messages,
		};
		if (scoped.projects.length > 0)
			context.projects = scoped.projects.map((project) => ({
				id: project.id,
				name: project.name,
			}));
		if (scoped.project !== undefined)
			context.project = { id: scoped.project.id, name: scoped.project.name };
		if (scoped.thread !== undefined)
			context.thread = {
				id: scoped.thread.id,
				rootMessageId: scoped.thread.rootMessageId,
			};
		if (scoped.channel !== undefined && scoped.thread !== undefined)
			context.sharedContext = {
				currentChannel: scoped.channel.memory,
				threadSnapshot: scoped.thread.context.channelSnapshot,
				thread: scoped.thread.context.memory,
			};
		if (scoped.channel !== undefined)
			context.collaboration = {
				routing:
					"Human @mentions are explicit assignments. Unmentioned work is routed by participant responsibilities.",
				handoff:
					"Use commonspace_handoff for one concrete peer request. An unquoted final paragraph beginning with @name remains a supported fallback.",
				limits:
					"Handoff to at most one peer at a time. Do not mention peers for status, acknowledgement, or work you can complete yourself.",
			};
		return context;
	}

	async browseHistory(
		scope: CommonspaceMcpScope,
		nodeId?: string,
	): Promise<ContextHistoryPage> {
		return this.historyIndex(scope).browse(nodeId);
	}

	async findHistory(
		scope: CommonspaceMcpScope,
		input: { query: string; limit: number },
	): Promise<ContextHistoryMatches> {
		const index = this.historyIndex(scope);
		const result = await index.findHybrid(input.query, input.limit);
		// Scope or sources can change while the worker is running, including /new.
		if (
			this.closing ||
			this.historyIndex(scope).browse().rootId !== result.rootId
		)
			throw new Error("History changed during retrieval; retry.");
		return result;
	}

	private historyIndex(scope: CommonspaceMcpScope): ContextHistoryIndex {
		// Recheck live membership and generation before touching any cached source.
		this.resolveMcpScope(scope);
		const key = JSON.stringify([
			scope.conversation,
			scope.threadId,
			scope.sessionName,
		]);
		let index = this.historyIndexes.get(key);
		this.historyIndexes.delete(key);
		if (index === undefined)
			index = new ContextHistoryIndex(
				this.overrides.historyEmbeddings ?? this.historyEmbeddings,
			);
		this.historyIndexes.set(key, index);
		if (this.historyIndexes.size > 16) {
			const oldest = this.historyIndexes.keys().next();
			if (!oldest.done) this.historyIndexes.delete(oldest.value);
		}
		index.sync(this.messagesForMcpScope(scope));
		return index;
	}

	async readMessages(
		scope: CommonspaceMcpScope,
		input: { before?: string; limit: number },
	): Promise<McpReadMessagesResponse> {
		this.resolveMcpScope(scope);
		const source = this.messagesForMcpScope(scope);
		const end =
			input.before === undefined
				? source.length
				: source.findIndex((message) => message.id === input.before);
		if (end < 0)
			throw new Error("message cursor is not in this Commonspace scope");
		const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
		const pageSource = source.slice(Math.max(0, end - limit), end);
		const messages = this.boundedMcpMessages(pageSource, limit);
		const firstId = messages[0]?.id;
		const firstIndex =
			firstId === undefined
				? end
				: source.findIndex((message) => message.id === firstId);
		return {
			messages,
			nextBefore: firstIndex > 0 && firstId !== undefined ? firstId : null,
		};
	}

	async searchMessages(
		scope: CommonspaceMcpScope,
		input: { query: string; limit: number },
	): Promise<McpSearchMessagesResponse> {
		this.resolveMcpScope(scope);
		const terms = [
			...input.query.normalize("NFKC").matchAll(/(-?)(?:"([^"]+)"|(\S+))/g),
		]
			.map((match) => ({
				excluded: match[1] === "-",
				value: (match[2] ?? match[3] ?? "").toLocaleLowerCase(),
			}))
			.filter((term) => term.value !== "");
		const included = terms
			.filter((term) => !term.excluded)
			.map((term) => term.value);
		const excluded = terms
			.filter((term) => term.excluded)
			.map((term) => term.value);
		const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
		const results = this.messagesForMcpScope(scope)
			.filter((message) => {
				const searchable = `${message.authorName}\n${message.text}`
					.normalize("NFKC")
					.toLocaleLowerCase();
				return (
					included.every((term) => searchable.includes(term)) &&
					excluded.every((term) => !searchable.includes(term))
				);
			})
			.slice(-limit)
			.reverse()
			.map((message): McpSearchMessageResult => {
				const result: McpSearchMessageResult = {
					id: message.id,
					authorType: message.authorType,
					authorId: message.authorId,
					authorName: message.authorName,
					text: searchSnippet(message.text, included),
					createdAt: message.createdAt,
					matchedTerms: included,
				};
				if (message.threadId !== undefined) result.threadId = message.threadId;
				if (message.parentMessageId !== undefined)
					result.parentMessageId = message.parentMessageId;
				return result;
			});
		return { results };
	}

	async postProgress(
		scope: CommonspaceMcpScope,
		rawText: string,
	): Promise<{ messageId: string }> {
		if (this.closing) throw new Error("Commonspace is shutting down");
		const scoped = this.resolveMcpScope(scope);
		const text = rawText.normalize("NFKC").trim().slice(0, 4_000);
		if (text === "") throw new Error("progress text is required");
		if (scoped.channel !== undefined) {
			const peerMentions = mentionedChannelAgents(
				scoped.channel.agentIds,
				text,
				this.configuredAgents(),
			).filter((agentId) => agentId !== scoped.agent.id);
			if (peerMentions.length > 0)
				throw new Error(
					"post progress cannot address peers; use commonspace_handoff",
				);
		}
		const message: CommonspaceMessage = {
			id: messageId(),
			conversation: scope.conversation,
			authorType: "agent",
			authorId: scoped.agent.id,
			authorName: scoped.agent.displayName,
			text,
			createdAt: now(),
		};
		if (scoped.thread !== undefined) {
			message.threadId = scoped.thread.id;
			message.parentMessageId = scoped.thread.rootMessageId;
		}
		this.append(message);
		if (scope.sessionName !== undefined)
			this.executingAgentRunsByScope
				.get(`${scoped.agent.id}\u0000${scope.sessionName}`)
				?.progressMessageIds.add(message.id);
		await this.persist();
		this.broadcastRevision();
		return { messageId: message.id };
	}

	async handoff(
		scope: CommonspaceMcpScope,
		input: CommonspaceMcpHandoffRequest,
	): Promise<CommonspaceMcpHandoffResponse> {
		if (this.closing) throw new Error("Commonspace is shutting down");
		const scoped = this.resolveMcpScope(scope);
		if (
			scoped.channel === undefined ||
			scoped.thread === undefined ||
			scope.sessionName === undefined
		)
			throw new Error("peer handoffs require an active Channel thread");
		const activeRun = this.executingAgentRunsByScope.get(
			`${scoped.agent.id}\u0000${scope.sessionName}`,
		);
		if (activeRun === undefined)
			throw new Error("peer handoffs require an active agent turn");
		if (this.pendingAgentHandoffs.has(activeRun.id))
			throw new Error("this agent turn already requested a peer handoff");
		const request = input.request.normalize("NFKC").trim().slice(0, 4_000);
		if (request === "") throw new Error("peer handoff request is required");
		if (input.targetAgentId === scoped.agent.id)
			throw new Error("an agent cannot hand work to itself");
		const target = this.configuredAgents().find(
			(agent) => agent.id === input.targetAgentId,
		);
		if (target === undefined || !scoped.channel.agentIds.includes(target.id))
			throw new Error("peer handoff target is not in this Channel");
		this.pendingAgentHandoffs.set(activeRun.id, {
			targetAgentId: target.id,
			request,
		});
		return {
			targetAgentId: target.id,
			targetDisplayName: target.displayName,
		};
	}

	async bootstrap(): Promise<CommonspaceBootstrap> {
		const snapshotStartedAt = this.performancePhaseStartedAt();
		const state = this.publicSnapshot();
		this.recordPerformanceMeasurement(
			CommonspaceHostPerformancePhase.BootstrapStateSnapshot,
			snapshotStartedAt,
		);
		const assemblyStartedAt = this.performancePhaseStartedAt();
		const bootstrap = {
			agents: this.configuredAgents(),
			discoveredAgents: this.discoveredAgentCandidates,
			state,
			liveActivities: this.liveActivities(),
			queuedFollowups: this.queuedFollowups(),
			routing: this.publicRoutingConfiguration(),
		};
		this.recordPerformanceMeasurement(
			CommonspaceHostPerformancePhase.BootstrapAssembly,
			assemblyStartedAt,
		);
		return bootstrap;
	}

	async verifyDesktopNotifications(): Promise<CommonspaceNotificationVerification> {
		if (this.clientUrl === undefined) {
			return {
				status: "failed",
				message:
					"Native alert delivery is not ready. Inbox notifications remain available; restart Commonspace and try again.",
			};
		}
		try {
			await this.notifyDesktop({
				category: "reply",
				title: "Commonspace notifications are working",
				body: "Native alerts are connected. Your Inbox remains the durable fallback.",
				url: this.clientUrl,
				sound: false,
			});
			return {
				status: "delivered",
				message:
					"Test notification delivered. Click it to verify Commonspace opens.",
			};
		} catch (error) {
			this.environment.logger?.warn(
				`Commonspace desktop notification verification failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return {
				status: "failed",
				message:
					"Native alert delivery failed. Inbox notifications remain available; check System Settings > Notifications for Commonspace.",
			};
		}
	}

	async diagnostics(): Promise<CommonspaceDiagnostics> {
		const candidates = await Promise.all(
			AGENT_ADAPTER_KINDS.map((adapter) =>
				this.discoverAgentCandidates(adapter),
			),
		);
		const installed = new Set(candidates.flat().map((agent) => agent.adapter));
		const successfulAgents = new Set(
			Object.values(this.state.messages)
				.flat()
				.filter((message) => message.authorType === "agent")
				.map((message) => message.authorId),
		);
		const failedAgents = new Set(
			Object.values(this.state.messages)
				.flat()
				.flatMap((message) => {
					if (
						message.authorType !== "system" ||
						!/\brun failed:/iu.test(message.text)
					)
						return [];
					const id = /^@([^\s]+)\s/u.exec(message.text)?.[1];
					return id === undefined ? [] : [id];
				}),
		);
		const recordedRunStatus = (
			adapter: AgentAdapterKind,
		): "has-replies" | "no-recorded-runs" | "has-failures" => {
			const roster = this.state.agents.filter(
				(agent) => agent.adapter === adapter,
			);
			if (roster.some((agent) => failedAgents.has(agent.id)))
				return "has-failures";
			if (roster.some((agent) => successfulAgents.has(agent.id)))
				return "has-replies";
			return "no-recorded-runs";
		};
		const storageReady = await stat(this.root)
			.then((info) => info.isDirectory())
			.catch(() => false);
		const workspaceReady = await stat(this.defaultCwd)
			.then((info) => info.isDirectory())
			.catch(() => false);
		return {
			service: {
				status: storageReady && workspaceReady ? "ready" : "attention",
				stateVersion: COMMONSPACE_STATE_VERSION,
				storage: storageReady ? "ready" : "attention",
				projectlessWorkspace: workspaceReady ? "ready" : "attention",
			},
			inference: this.routingDiagnostics(this.routingConfiguration),
			harnesses: AGENT_ADAPTER_KINDS.map((adapter) => ({
				adapter,
				installed: installed.has(adapter),
				rostered: this.state.agents.some((agent) => agent.adapter === adapter),
				recordedRunStatus: recordedRunStatus(adapter),
				recovery: AGENT_ADAPTERS[adapter].recovery,
			})),
		};
	}

	async exportWorkspace(): Promise<CommonspaceWorkspaceArchive> {
		const exportedAt = now();
		const state = this.publicSnapshot();
		const attachments = collectArchiveAttachments(state.messages);
		const workspace: CommonspaceWorkspaceArchive["workspace"] = {
			inboxReadAt: state.inboxReadAt,
			inboxReadMessageIds: state.inboxReadMessageIds,
			inboxUnreadMessageIds: state.inboxUnreadMessageIds ?? [],
			inboxSavedItemIds: state.inboxSavedItemIds,
			followedSessionIds: state.followedSessionIds,
			mutedSessionIds: state.mutedSessionIds,
			notifications: state.notifications,
			defaults: state.defaults,
			agents: state.agents.map((agent): CommonspaceAgentDefinition => {
				const portableAgent: CommonspaceAgentDefinition = {
					id: agent.id,
					displayName: agent.displayName,
					adapter: agent.adapter,
					model: agent.model,
					createdAt: agent.createdAt,
				};
				if (agent.avatarEmoji !== undefined)
					portableAgent.avatarEmoji = agent.avatarEmoji;
				if (agent.accentColor !== undefined)
					portableAgent.accentColor = agent.accentColor;
				return portableAgent;
			}),
			projects: state.projects.map((project) => ({
				id: project.id,
				name: project.name,
				rootCount: project.paths.length,
				createdAt: project.createdAt,
			})),
			channels: state.channels,
			threads: state.threads,
			pins: state.pins,
			permissions: state.permissions.map((permission) =>
				permission.status === "pending"
					? { ...permission, status: "interrupted", resolvedAt: exportedAt }
					: permission,
			),
			messages: state.messages,
		};
		const privateValues = [
			this.root,
			this.defaultCwd,
			...this.state.projects.flatMap((project) => project.paths),
			...Object.values(this.state.dmSessions),
			...Object.values(this.state.agentSessions).flatMap((sessions) =>
				Object.values(sessions),
			),
			...Array.from(this.mcpCredentials.values(), ({ token }) => token),
		];
		const archive: CommonspaceWorkspaceArchive = {
			format: "commonspace-workspace",
			version: COMMONSPACE_EXPORT_VERSION,
			exportedAt,
			workspace: redactPortableValue(workspace, privateValues),
			attachments,
		};
		assertWorkspaceExportPlanSize(archive);
		for (const attachment of attachments) {
			const { data } =
				attachment.kind === "image"
					? await this.readImageAttachment(attachment.id)
					: await this.readFileAttachment(attachment.id);
			attachment.data = data.toString("base64");
		}
		assertWorkspaceExportSize(archive);
		return archive;
	}

	async importWorkspace(
		archiveValue: JsonValue,
		projectMappings: Record<string, string[]>,
	): Promise<CommonspaceState> {
		assertWorkspaceImportSize(archiveValue);
		assertWorkspaceProjectMappingsSize(projectMappings);
		return this.withAdmission(async () => {
			assertWorkspaceImportTargetEmpty(this.state);
			await this.removePendingAttachmentDeletions();
			const plan = await prepareWorkspaceImport(
				archiveValue,
				projectMappings,
				(path) => this.validDirectory(path),
			);
			await this.commitWorkspaceImport(plan);
			this.revokeInvalidMcpCredentials();
			this.synchronizeNotificationBaseline();
			this.broadcastRevision();
			return this.publicSnapshot();
		}, "exclusive");
	}

	private async commitWorkspaceImport({
		state,
		images,
		files,
	}: PreparedWorkspaceImport): Promise<void> {
		await this.persistImageAttachments(images);
		try {
			await this.persistFileAttachments(files);
		} catch (error) {
			await this.removeImageAttachments(
				images.map((image) => image.metadata.id),
			);
			throw error;
		}
		const previousState = this.state;
		this.state = state;
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			await this.removeImageAttachments(
				images.map((image) => image.metadata.id),
			);
			await this.removeFileAttachments(files.map((file) => file.metadata.id));
			throw error;
		}
	}
	previewRetention(
		conversation: SendMessageRequest["conversation"],
	): CommonspaceRetentionPreview {
		const target = plainRecord(conversation);
		if (
			target === null ||
			(target.kind !== "channel" && target.kind !== "dm") ||
			typeof target.id !== "string" ||
			loadedId(target.id) !== target.id
		) {
			throw new Error("invalid retention conversation");
		}
		if (conversation.kind === "channel") {
			if (
				!this.state.channels.some((channel) => channel.id === conversation.id)
			)
				throw new Error("unknown retention conversation");
		} else if (!this.state.agents.some((agent) => agent.id === conversation.id))
			throw new Error("unknown retention conversation");
		const messages = this.state.messages[conversationKey(conversation)] ?? [];
		const threadIds = new Set(
			conversation.kind === "channel"
				? this.state.threads
						.filter((thread) => thread.channelId === conversation.id)
						.map((thread) => thread.id)
				: [],
		);
		return {
			revision: this.state.revision,
			conversation,
			messages: messages.length,
			threads: threadIds.size,
			attachments: messages.reduce(
				(count, message) =>
					count +
					(message.attachments?.length ?? 0) +
					(message.files?.length ?? 0),
				0,
			),
			pins: this.state.pins.filter((pin) => {
				const messageId = pin.kind === "note" ? undefined : pin.messageId;
				return (
					(pin.scope.kind === "channel" &&
						conversation.kind === "channel" &&
						pin.scope.id === conversation.id) ||
					(pin.scope.kind === "thread" && threadIds.has(pin.scope.id)) ||
					(messageId !== undefined &&
						messages.some((message) => message.id === messageId))
				);
			}).length,
			permissions: this.state.permissions.filter(
				(permission) =>
					permission.conversation.kind === conversation.kind &&
					permission.conversation.id === conversation.id,
			).length,
		};
	}

	async applyRetention(
		request: ApplyRetentionRequest,
	): Promise<CommonspaceRetentionPreview> {
		return this.withAdmission(() =>
			this.withDeletion(async () => {
				const preview = this.previewRetention(request.conversation);
				if (
					!Number.isSafeInteger(request.expectedRevision) ||
					request.expectedRevision !== preview.revision
				)
					throw new Error("retention preview is stale");
				const removedThreads = retentionThreads(
					this.state,
					request.conversation,
				);
				if (this.retentionHasActiveWork(request.conversation, removedThreads))
					throw new Error("conversation has active work");
				await this.commitRetention(
					prepareRetention(this.state, request.conversation, removedThreads),
				);
				return preview;
			}),
		);
	}

	private retentionHasActiveWork(
		conversation: RetentionConversation,
		removedThreads: readonly CommonspaceThread[],
	): boolean {
		const runScopePrefix = `${conversation.kind}:${conversation.id}\u0000`;
		return (
			[...this.liveActivitiesById.values()].some(
				(activity) =>
					activity.conversation.kind === conversation.kind &&
					activity.conversation.id === conversation.id,
			) ||
			[...this.activeConversationRuns.keys()].some((scope) =>
				scope.startsWith(runScopePrefix),
			) ||
			[...this.pendingFollowups.keys()].some((scope) =>
				scope.startsWith(runScopePrefix),
			) ||
			(conversation.kind === "channel" &&
				this.channelMemoryTails.has(conversation.id)) ||
			removedThreads.some((thread) => this.threadMemoryTails.has(thread.id))
		);
	}

	private async commitRetention({
		state,
		removedProcessScopeNames,
	}: PreparedRetention): Promise<void> {
		const previousState = this.state;
		this.state = state;
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			throw error;
		}
		await this.closeAcpProcessesMatching((_agentId, scopeName) =>
			removedProcessScopeNames.has(scopeName),
		);
		this.revokeInvalidMcpCredentials();
		this.broadcastRevision();
		await this.removePendingAttachmentDeletions();
	}
	routing(): CommonspaceRoutingConfiguration {
		return this.publicRoutingConfiguration();
	}

	private prepareRoutingConfiguration(request: RoutingConfigurationRequest) {
		return prepareRoutingConfiguration(
			request,
			this.state.agents.map((agent) => agent.id),
		);
	}

	validateRoutingConfiguration(
		request: RoutingConfigurationRequest,
	): CommonspaceDiagnostics["inference"] {
		return this.routingDiagnostics(this.prepareRoutingConfiguration(request));
	}

	private routingDiagnostics(
		candidate: PrivateRoutingConfiguration,
	): CommonspaceDiagnostics["inference"] {
		if (candidate.provider === CommonspaceRoutingProvider.Unconfigured)
			return {
				provider: candidate.provider,
				location: "none",
				configured: false,
				sends: [],
			};
		return {
			provider: candidate.provider,
			location: "runtime-managed",
			configured: this.state.agents.some(
				(agent) => agent.id === candidate.harnessAgentId,
			),
			sends: [
				"message text",
				"Agent labels",
				"Project labels",
				"shared context",
				"routing corrections",
			],
		};
	}

	async updateRoutingConfiguration(
		request: RoutingConfigurationRequest,
	): Promise<CommonspaceRoutingConfiguration> {
		const releaseRoutingConfiguration =
			await this.acquireRoutingConfigurationLock();
		return this.withAdmission(async () => {
			const next = this.prepareRoutingConfiguration(request);
			const previousAgentId =
				this.routingConfiguration.provider ===
				CommonspaceRoutingProvider.Harness
					? this.routingConfiguration.harnessAgentId
					: undefined;
			await this.persistRoutingConfiguration(next);
			this.routingConfiguration = next;
			if (
				previousAgentId !== undefined &&
				previousAgentId !== next.harnessAgentId
			)
				await this.closeInferenceProcesses(previousAgentId);
			this.notifyRoutingListeners();
			return this.publicRoutingConfiguration();
		}).finally(releaseRoutingConfiguration);
	}

	private async acquireRoutingConfigurationLock(): Promise<() => void> {
		const previous = this.routingConfigurationTail;
		let release: (() => void) | undefined;
		const lease = new Promise<void>((resolve) => {
			release = resolve;
		});
		if (release === undefined)
			throw new Error("Routing configuration lock could not be initialized");
		this.routingConfigurationTail = previous
			.catch(() => undefined)
			.then(() => lease);
		await previous.catch(() => undefined);
		return release;
	}

	private notifyRoutingListeners(): void {
		for (const listener of this.routingListeners) {
			try {
				listener();
			} catch {
				this.routingListeners.delete(listener);
			}
		}
	}

	channelContext(channelId: string): CommonspaceChannelMemory {
		const channel = this.state.channels.find(
			(candidate) => candidate.id === channelId,
		);
		if (channel === undefined) throw new Error("unknown channel");
		return structuredClone(channel.memory);
	}

	async updateChannelContext(
		channelId: string,
		request: UpdateChannelContextRequest,
	): Promise<CommonspaceChannelMemory> {
		const mutation: Extract<
			CommonspaceMutation,
			{ action: "set-channel-memory" }
		> = {
			action: "set-channel-memory",
			channelId,
			summary: request.summary,
		};
		if (request.decisions !== undefined) mutation.decisions = request.decisions;
		if (request.openQuestions !== undefined)
			mutation.openQuestions = request.openQuestions;
		await this.mutate(mutation);
		return this.channelContext(channelId);
	}

	async compactChannelContext(
		channelId: string,
	): Promise<CommonspaceChannelMemory> {
		return this.withAdmission(async () =>
			this.withChannelMemoryLock(channelId, async () => {
				const channel = this.state.channels.find(
					(candidate) => candidate.id === channelId,
				);
				if (channel === undefined) throw new Error("unknown channel");
				const memoryBefore: CommonspaceChannelMemory = {
					...channel.memory,
					status: "compacting",
				};
				const projection = projectChannelMemory(
					this.state,
					channelId,
					this.state.defaults.memoryThreads,
				);
				this.replaceChannelMemoryState(channelId, () => memoryBefore);
				await this.persist();
				this.broadcastRevision();
				try {
					const inferred = await this.inferChannelMemory(channelId, projection);
					const memory = this.reconcileInferredChannelMemory(
						channelId,
						memoryBefore,
						projection,
						inferred,
					);
					if (memory === undefined)
						throw new Error("channel was removed during context compaction");
					this.replaceChannelMemoryState(channelId, () => memory);
					await this.persist();
					this.broadcastRevision();
					return structuredClone(memory);
				} catch (error) {
					if (
						this.replaceChannelMemoryState(channelId, (memory) => ({
							...memory,
							status: "failed",
						})) !== undefined
					) {
						await this.persist();
						this.broadcastRevision();
					}
					throw error;
				}
			}),
		);
	}

	threadContext(threadId: string): CommonspaceThreadContext {
		const thread = this.state.threads.find(
			(candidate) => candidate.id === threadId,
		);
		if (thread === undefined) throw new Error("unknown thread");
		return structuredClone(thread.context);
	}

	async updateThreadContext(
		threadId: string,
		request: UpdateThreadContextRequest,
	): Promise<CommonspaceThreadContext> {
		return this.withAdmission(async () => {
			if (typeof request.summary !== "string")
				throw new Error("thread context summary is required");
			const thread = this.state.threads.find(
				(candidate) => candidate.id === threadId,
			);
			if (thread === undefined) throw new Error("unknown thread");
			const projection = projectThreadMemory(this.state, threadId);
			const memory: CommonspaceThread["context"]["memory"] = {
				summary: request.summary.normalize("NFKC").trim().slice(0, 16_000),
				decisions: normalizedContextRequestEntries(
					request.decisions,
					"thread context decisions",
				),
				openQuestions: normalizedContextRequestEntries(
					request.openQuestions,
					"thread context open questions",
				),
				updatedAt: now(),
				origin: "user",
				status: "current",
				sourceMessageCount: projection.sourceMessageCount,
				estimatedTokens: projection.estimatedTokens,
				compactedThroughMessageId: projection.compactedThroughMessageId,
			};
			const context = { ...thread.context, memory };
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				threads: this.state.threads.map((candidate) =>
					candidate.id === threadId ? { ...candidate, context } : candidate,
				),
			};
			await this.persist();
			this.broadcastRevision();
			return structuredClone(context);
		});
	}

	async compactThreadContext(
		threadId: string,
	): Promise<CommonspaceThreadContext> {
		return this.withAdmission(async () =>
			this.withThreadMemoryLock(threadId, async () => {
				const baseline = await this.beginThreadMemoryCompaction(threadId);
				try {
					return await this.completeThreadMemoryCompaction(baseline);
				} catch (error) {
					await this.failThreadMemoryCompaction(threadId);
					throw error;
				}
			}),
		);
	}

	private invalidateChangedContextEvidence(
		previousState: CommonspaceState,
	): void {
		const channels = this.state.channels.map((channel) => {
			if (!hasChangedCompactionEvidence(previousState, this.state, channel.id))
				return channel;
			const memory =
				channel.memory.origin === "user"
					? { ...channel.memory, status: "stale" as const }
					: projectChannelMemory(
							this.state,
							channel.id,
							this.state.defaults.memoryThreads,
						);
			return { ...channel, memory };
		});
		const threads = this.state.threads.map((thread) => {
			if (
				!hasChangedCompactionEvidence(
					previousState,
					this.state,
					thread.channelId,
					thread.id,
				)
			)
				return thread;
			const memory =
				thread.context.memory.origin === "user"
					? { ...thread.context.memory, status: "stale" as const }
					: projectThreadMemory(this.state, thread.id);
			return { ...thread, context: { ...thread.context, memory } };
		});
		this.state = { ...this.state, channels, threads };
	}

	private resolvePinScope(value: AddPinRequest["scope"]): ResolvedPinScope {
		const scope = plainRecord(value);
		if (
			scope === null ||
			(scope.kind !== "channel" && scope.kind !== "thread") ||
			typeof scope.id !== "string" ||
			scope.id === ""
		) {
			throw new Error("invalid pin scope");
		}
		const pinScope: CommonspacePinScope = { kind: scope.kind, id: scope.id };
		const channelId =
			pinScope.kind === "channel"
				? this.state.channels.some((channel) => channel.id === pinScope.id)
					? pinScope.id
					: undefined
				: this.state.threads.find((thread) => thread.id === pinScope.id)
						?.channelId;
		if (channelId === undefined) throw new Error("unknown pin scope");
		return { scope: pinScope, channelId };
	}

	private pinSourceMessage(
		messageId: string,
		resolvedScope: ResolvedPinScope,
	): CommonspaceMessage {
		if (typeof messageId !== "string" || messageId === "")
			throw new Error("pin message id is required");
		const sourceMessage = this.state.messages[
			conversationKey({ kind: "channel", id: resolvedScope.channelId })
		]?.find((message) => message.id === messageId);
		const belongsToScope =
			resolvedScope.scope.kind === "channel"
				? sourceMessage?.conversation.kind === "channel" &&
					sourceMessage.conversation.id === resolvedScope.channelId
				: sourceMessage?.threadId === resolvedScope.scope.id;
		if (sourceMessage === undefined || !belongsToScope)
			throw new Error("pin source is outside its scope");
		return sourceMessage;
	}

	private preparePin(
		request: AddPinRequest,
		resolvedScope: ResolvedPinScope,
	): CommonspacePin {
		const common = {
			id: crypto.randomUUID(),
			scope: resolvedScope.scope,
			createdAt: now(),
			removedAt: null,
		};
		switch (request.kind) {
			case "note": {
				if (typeof request.note !== "string")
					throw new Error("pin note is required");
				const note = request.note.normalize("NFKC").trim().slice(0, 4_000);
				if (note === "") throw new Error("pin note is required");
				return { ...common, kind: "note", note };
			}
			case "message":
				this.pinSourceMessage(request.messageId, resolvedScope);
				return { ...common, kind: "message", messageId: request.messageId };
			case "attachment": {
				const sourceMessage = this.pinSourceMessage(
					request.messageId,
					resolvedScope,
				);
				if (
					typeof request.attachmentId !== "string" ||
					(sourceMessage.attachments?.some(
						(attachment) => attachment.id === request.attachmentId,
					) !== true &&
						sourceMessage.files?.some(
							(file) => file.id === request.attachmentId,
						) !== true)
				)
					throw new Error("pin attachment not found");
				return {
					...common,
					kind: "attachment",
					messageId: request.messageId,
					attachmentId: request.attachmentId,
				};
			}
			default:
				throw new Error("unsupported pin kind");
		}
	}

	async addPin(request: AddPinRequest): Promise<CommonspacePin> {
		return this.withAdmission(async () => {
			const pin = this.preparePin(request, this.resolvePinScope(request.scope));
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				pins: [...this.state.pins, pin],
			};
			this.invalidateChangedContextEvidence(previousState);
			await this.persist();
			this.broadcastRevision();
			return structuredClone(pin);
		});
	}

	async removePin(pinId: string): Promise<CommonspacePin> {
		return this.withAdmission(async () => {
			if (typeof pinId !== "string" || pinId === "")
				throw new Error("pin id is required");
			const pin = this.state.pins.find((candidate) => candidate.id === pinId);
			if (pin === undefined) throw new Error("unknown pin");
			if (pin.removedAt !== null) return structuredClone(pin);
			const removed = { ...pin, removedAt: now() };
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				pins: this.state.pins.map((candidate) =>
					candidate.id === pinId ? removed : candidate,
				),
			};
			this.invalidateChangedContextEvidence(previousState);
			await this.persist();
			this.broadcastRevision();
			return structuredClone(removed);
		});
	}

	async respondPermission(
		permissionId: string,
		optionId: string,
	): Promise<CommonspacePermissionRequest> {
		return this.withAdmission(async () => {
			const selection = validatePermissionSelection(
				this.state.permissions,
				permissionId,
				optionId,
			);
			const resolve = this.permissionResolvers.get(permissionId);
			if (resolve === undefined)
				throw new Error(
					"permission request is no longer attached to a native session",
				);
			const resolved: CommonspacePermissionRequest = {
				...selection.permission,
				status: "resolved",
				selectedOptionId: optionId,
				resolvedAt: now(),
			};
			if (selection.permission.conversation.kind === "dm") {
				this.updateMessageReplyStatus(
					selection.permission.conversation,
					selection.permission.sourceMessageId,
					"running",
				);
			}
			const permissions = [...this.state.permissions];
			permissions[selection.index] = resolved;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				permissions,
			};
			await this.persist();
			this.permissionResolvers.delete(permissionId);
			resolve({ optionId });
			this.broadcastRevision();
			return structuredClone(resolved);
		});
	}

	private async requestAgentPermission(
		activeRun: ActiveAgentRun,
		conversation: SendMessageRequest["conversation"],
		thread: CommonspaceThread | undefined,
		request: AgentPermissionRequest,
	): Promise<AgentPermissionOutcome> {
		const toolCallId = request.toolCallId
			.normalize("NFKC")
			.trim()
			.slice(0, 200);
		const title = request.title.normalize("NFKC").trim().slice(0, 1_000);
		const options: CommonspacePermissionOption[] = [];
		const optionIds = new Set<string>();
		for (const candidate of request.options.slice(0, 16)) {
			const optionId = candidate.optionId
				.normalize("NFKC")
				.trim()
				.slice(0, 200);
			const name = candidate.name.normalize("NFKC").trim().slice(0, 200);
			const kind = candidate.kind.normalize("NFKC").trim().slice(0, 100);
			if (
				optionId === "" ||
				optionIds.has(optionId) ||
				name === "" ||
				kind === ""
			)
				continue;
			optionIds.add(optionId);
			options.push({ optionId, name, kind });
		}
		if (toolCallId === "" || options.length === 0) return {};
		const permission: CommonspacePermissionRequest = {
			id: crypto.randomUUID(),
			sourceMessageId: activeRun.sourceMessageId,
			agentId: activeRun.agentId,
			conversation,
			toolCallId,
			title: title || "Permission requested",
			options,
			status: "pending",
			createdAt: now(),
			resolvedAt: null,
		};
		if (thread !== undefined) permission.threadId = thread.id;
		if (request.kind !== undefined && request.kind.trim() !== "")
			permission.kind = request.kind.trim().slice(0, 100);
		const previousState = this.state;
		const outcome = new Promise<AgentPermissionOutcome>((resolve) => {
			this.permissionResolvers.set(permission.id, resolve);
		});
		if (conversation.kind === "dm")
			this.updateMessageReplyStatus(
				conversation,
				activeRun.sourceMessageId,
				"needs_input",
			);
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			permissions: [...this.state.permissions, permission],
		};
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			this.permissionResolvers.delete(permission.id);
			throw error;
		}
		this.broadcastRevision();
		return outcome;
	}

	async inspectAgentCapabilities(
		agentId: string,
	): Promise<HarnessCapabilityInventory | undefined> {
		const agent = this.state.agents.find(
			(candidate) => candidate.id === agentId,
		);
		if (agent === undefined) return undefined;
		const groups =
			await this.adapters[agent.adapter].inspectCapabilities(agent);
		return {
			agentId,
			checkedAt: now(),
			groups: groups.map((group) => ({
				id: group.id,
				status: group.status,
				source: this.redactHostDetails(group.source, 200),
				notice: this.redactHostDetails(group.notice, 1_000),
				items: group.items.map((item) => {
					const metadata: HarnessCapabilityItem = {
						name: this.redactHostDetails(item.name, 200),
						status: item.status,
					};
					if (item.description !== undefined)
						metadata.description = this.redactHostDetails(
							item.description,
							1_000,
						);
					return metadata;
				}),
			})),
		};
	}

	async discoverAgents(
		adapter: AgentAdapterKind,
	): Promise<CommonspaceBootstrap> {
		if (!isAgentAdapterKind(adapter))
			throw new Error("unsupported agent adapter");
		const discovered = await this.discoverAgentCandidates(adapter);
		this.discoveredAgentCandidates = [
			...this.discoveredAgentCandidates.filter(
				(agent) => agent.adapter !== adapter,
			),
			...discovered,
		];
		return this.bootstrap();
	}

	private resolveMcpProjects(
		projectIds: readonly string[],
	): Pick<ResolvedMcpScope, "project" | "projects"> {
		if (projectIds.length === 0) return { projects: [] };
		const requestedIds = new Set(projectIds);
		const projectsById = new Map<
			string,
			CommonspaceState["projects"][number]
		>();
		for (const project of this.state.projects) {
			if (!requestedIds.has(project.id) || projectsById.has(project.id))
				continue;
			projectsById.set(project.id, project);
			if (projectsById.size === requestedIds.size) break;
		}
		const projects = projectIds.map((projectId) => {
			const project = projectsById.get(projectId);
			if (project === undefined)
				throw new Error("Commonspace MCP project scope expired");
			return project;
		});
		const resolved: Pick<ResolvedMcpScope, "project" | "projects"> = {
			projects,
		};
		const project = projects[0];
		if (project !== undefined) resolved.project = project;
		return resolved;
	}

	private resolveMcpScope(scope: CommonspaceMcpScope): ResolvedMcpScope {
		const agent = this.state.agents.find(
			(candidate) => candidate.id === scope.agentId,
		);
		if (agent === undefined)
			throw new Error("Commonspace MCP agent scope expired");
		if (scope.conversation.kind === "dm") {
			if (scope.conversation.id !== agent.id || scope.threadId !== undefined)
				throw new Error("invalid Commonspace MCP direct-message scope");
			const currentSessionName = this.state.dmSessions[agent.id] ?? "Bot Chat";
			if (scope.sessionName !== currentSessionName)
				throw new Error("Commonspace MCP direct-message generation expired");
			return {
				agent,
				...this.resolveMcpProjects(referencedProjectIds(scope)),
			};
		}

		const channel = this.state.channels.find(
			(candidate) => candidate.id === scope.conversation.id,
		);
		if (channel === undefined || scope.threadId === undefined)
			throw new Error("Commonspace MCP channel scope expired");
		const thread = this.state.threads.find(
			(candidate) =>
				candidate.id === scope.threadId && candidate.channelId === channel.id,
		);
		if (thread === undefined || !thread.agentIds.includes(agent.id))
			throw new Error("Commonspace MCP thread scope expired");
		if (scope.sessionName !== `Commonspace Thread: ${thread.id}`)
			throw new Error("invalid Commonspace MCP native-session scope");
		const scopedProjectIds =
			scope.projectIds === undefined && scope.projectId === undefined
				? referencedProjectIds(thread)
				: referencedProjectIds(scope);
		return {
			agent,
			channel,
			thread,
			...this.resolveMcpProjects(scopedProjectIds),
		};
	}

	private revokeInvalidMcpCredentials(): void {
		if (this.mcpGateway === undefined) return;
		for (const [key, credential] of this.mcpCredentials) {
			try {
				this.resolveMcpScope(credential.scope);
			} catch {
				this.mcpGateway.revoke(credential.token);
				this.mcpCredentials.delete(key);
			}
		}
	}

	private messagesForMcpScope(
		scope: CommonspaceMcpScope,
	): CommonspaceMessage[] {
		const messages =
			this.state.messages[conversationKey(scope.conversation)] ?? [];
		const boundedToNativeSession =
			scope.conversation.kind === "dm"
				? messages.slice(
						messages.findLastIndex(
							(message) => message.authorId === DM_SESSION_BOUNDARY_AUTHOR_ID,
						) + 1,
					)
				: messages;
		if (scope.threadId === undefined) return boundedToNativeSession;
		const current = boundedToNativeSession.filter(
			(message) => message.threadId === scope.threadId,
		);
		const thread = this.state.threads.find(
			(candidate) => candidate.id === scope.threadId,
		);
		if (
			thread?.branchedFromThreadId === undefined ||
			thread.branchPointMessageId === undefined
		)
			return current;
		const branchPointIndex = boundedToNativeSession.findIndex(
			(message) => message.id === thread.branchPointMessageId,
		);
		if (branchPointIndex < 0) return current;
		const prior = boundedToNativeSession
			.slice(0, branchPointIndex)
			.filter((message) => message.threadId === thread.branchedFromThreadId);
		return [...prior, ...current];
	}

	private boundedMcpMessages(
		source: readonly CommonspaceMessage[],
		limit: number,
	): McpMessageView[] {
		const selected: CommonspaceMessage[] = [];
		let chars = 0;
		for (
			let index = source.length - 1;
			index >= 0 && selected.length < limit;
			index -= 1
		) {
			const message = source[index];
			if (message === undefined) continue;
			const nextChars = chars + message.text.length;
			if (nextChars > MAX_MCP_CONTEXT_CHARS && selected.length > 0) break;
			selected.push(message);
			chars = nextChars;
		}
		return selected.reverse().map((message) => {
			const view: McpMessageView = {
				id: message.id,
				authorType: message.authorType,
				authorId: message.authorId,
				authorName: message.authorName,
				text: message.text.slice(0, MAX_MCP_CONTEXT_CHARS),
				createdAt: message.createdAt,
			};
			if (message.parentMessageId !== undefined)
				view.parentMessageId = message.parentMessageId;
			return view;
		});
	}

	private redactHostDetails(value: string, maximum: number): string {
		let message = value;
		const redactions = new Map<string, string>();
		const hostPaths = [
			this.root,
			homedir(),
			process.cwd(),
			this.defaultCwd,
			...Object.values(this.adapters).flatMap(
				(adapter) => adapter.privatePaths,
			),
			...this.state.projects.flatMap((project) => project.paths),
		];
		for (const path of hostPaths) {
			if (isAbsolute(path)) redactions.set(path, "[host path]");
		}
		for (const sessions of Object.values(this.state.agentSessions)) {
			for (const sessionId of Object.values(sessions))
				redactions.set(sessionId, "[native session]");
		}
		for (const credential of this.mcpCredentials.values()) {
			redactions.set(credential.token, "[MCP capability]");
		}
		for (const [privateValue, replacement] of [...redactions].sort(
			([left], [right]) => right.length - left.length,
		)) {
			message = message.replaceAll(privateValue, replacement);
		}
		return message.slice(0, maximum);
	}

	private publicAgentFailure(cause: unknown): string {
		let message = cause instanceof Error ? cause.message : String(cause);
		if (
			cause instanceof AcpSessionLoadError ||
			cause instanceof AcpSessionRunError
		) {
			message = message.replaceAll(cause.sessionId, "[native session]");
		}
		return this.redactHostDetails(message, 8_000);
	}

	private redactTraceEntry(
		entry: CommonspaceTraceEntry,
	): CommonspaceTraceEntry {
		switch (entry.type) {
			case "reasoning":
			case "compaction":
				return {
					...entry,
					text: this.redactHostDetails(entry.text, 64_000),
				};
			case "plan": {
				const redacted: TracePlanEntry = {
					...entry,
					steps: entry.steps.map((step) => ({
						...step,
						text: this.redactHostDetails(step.text, 2_000),
					})),
				};
				if (entry.markdown !== undefined)
					redacted.markdown = this.redactHostDetails(entry.markdown, 64_000);
				return redacted;
			}
			case "tool": {
				const redacted: TraceToolEntry = {
					...entry,
					title: this.redactHostDetails(entry.title, 1_000),
				};
				if (entry.toolName !== undefined)
					redacted.toolName = this.redactHostDetails(entry.toolName, 200);
				if (entry.toolKind !== undefined)
					redacted.toolKind = this.redactHostDetails(entry.toolKind, 100);
				if (entry.input !== undefined)
					redacted.input = this.redactHostDetails(entry.input, 16_000);
				if (entry.output !== undefined)
					redacted.output = this.redactHostDetails(entry.output, 32_000);
				return redacted;
			}
			case "usage":
				return entry;
		}
		const unhandledEntry: never = entry;
		throw new Error(`unsupported trace entry: ${String(unhandledEntry)}`);
	}

	private publicAgentTrace(
		value: CommonspaceAgentTrace,
		adapter: AgentAdapterKind,
	): CommonspaceAgentTrace | undefined {
		const serializedTrace: JsonValue = JSON.parse(JSON.stringify(value));
		const traceValue = plainRecord(serializedTrace) ?? {};
		traceValue.adapter = adapter;
		const trace = sanitizeAgentTrace(traceValue);
		if (trace === undefined) return undefined;
		return {
			...trace,
			entries: trace.entries.map((entry) => this.redactTraceEntry(entry)),
		};
	}

	private redactLoadedTraces(state: CommonspaceState): CommonspaceState {
		const messages = Object.fromEntries(
			Object.entries(state.messages).map(([key, conversationMessages]) => [
				key,
				conversationMessages.map((message) => {
					if (message.trace === undefined) return message;
					const trace = this.publicAgentTrace(
						message.trace,
						message.trace.adapter,
					);
					const sanitized: CommonspaceMessage = { ...message };
					if (trace === undefined) delete sanitized.trace;
					else sanitized.trace = trace;
					return sanitized;
				}),
			]),
		);
		return { ...state, messages };
	}

	private markInterruptedRuns(replyError: string): boolean {
		let changed = false;
		const messages = Object.fromEntries(
			Object.entries(this.state.messages).map(([key, conversationMessages]) => [
				key,
				conversationMessages.map((message) => {
					if (message.routing?.status === "pending") {
						changed = true;
						return {
							...message,
							routing: failedRoutingDecision(
								message.routing,
								message.routing.startedAt ?? message.createdAt,
								replyError,
							),
							replyStatus: "failed" as const,
							replyError,
						};
					}
					if (
						message.replyStatus !== "queued" &&
						message.replyStatus !== "running"
					)
						return message;
					changed = true;
					return { ...message, replyStatus: "error" as const, replyError };
				}),
			]),
		);
		if (changed) {
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				messages,
			};
		}
		return changed;
	}

	private interruptPendingPermissions(agentId?: string): boolean {
		const pendingIds = new Set(
			this.state.permissions
				.filter(
					(permission) =>
						permission.status === "pending" &&
						(agentId === undefined || permission.agentId === agentId),
				)
				.map((permission) => permission.id),
		);
		if (pendingIds.size === 0) return false;
		const interruptedAt = now();
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			permissions: this.state.permissions.map((permission) =>
				pendingIds.has(permission.id)
					? {
							...permission,
							status: "interrupted" as const,
							resolvedAt: interruptedAt,
						}
					: permission,
			),
		};
		for (const permissionId of pendingIds) {
			this.permissionResolvers.get(permissionId)?.({});
			this.permissionResolvers.delete(permissionId);
		}
		return true;
	}

	private processBelongsToRemovedChannel(
		processScopeKey: string,
		processScopeNames: ReadonlySet<string>,
	): boolean {
		const separator = processScopeKey.indexOf("\u0000");
		return (
			separator >= 1 &&
			processScopeNames.has(processScopeKey.slice(separator + 1))
		);
	}

	private prepareMutationProcessCleanup(
		mutation: CommonspaceMutation,
	): MutationProcessCleanup {
		switch (mutation.action) {
			case "remove-agent":
				return { kind: "remove-agent", agentId: mutation.agentId };
			case "reset-dm": {
				if (typeof mutation.agentId !== "string") return { kind: "none" };
				const scopeKey = `${mutation.agentId}\u0000${this.state.dmSessions[mutation.agentId] ?? "Bot Chat"}`;
				return {
					kind: "reset-dm",
					scopeKey,
					runs: [...this.activeAgentRuns.values()].filter(
						(run) => run.scopeKey === scopeKey,
					),
				};
			}
			case "remove-channel": {
				const processScopeNames = new Set([
					...this.state.threads
						.filter((thread) => thread.channelId === mutation.channelId)
						.flatMap((thread) => [
							`Commonspace Thread: ${thread.id}`,
							`${THREAD_CONTEXT_PROCESS_SCOPE_PREFIX}${thread.id}`,
						]),
					`${ROUTING_SESSION_SCOPE_PREFIX}${mutation.channelId}`,
					`${CHANNEL_CONTEXT_PROCESS_SCOPE_PREFIX}${mutation.channelId}`,
				]);
				const activeSessions = [...this.activeAcpSessions.entries()].flatMap(
					([sessionScopeKey, session]) =>
						this.processBelongsToRemovedChannel(
							session.processScopeKey,
							processScopeNames,
						)
							? [{ sessionScopeKey, session }]
							: [],
				);
				return {
					kind: "remove-channel",
					processScopeNames,
					activeSessions,
				};
			}
			default:
				return { kind: "none" };
		}
	}

	private prepareMutation(mutation: CommonspaceMutation): PreparedMutation {
		return {
			previousState: this.state,
			previousRoutingConfiguration: this.routingConfiguration,
			removesInferenceSelection:
				mutation.action === "remove-agent" &&
				this.routingConfiguration.provider ===
					CommonspaceRoutingProvider.Harness &&
				this.routingConfiguration.harnessAgentId === mutation.agentId,
			processCleanup: this.prepareMutationProcessCleanup(mutation),
		};
	}

	private async applyDiscoveredAgentMutation(
		mutation: CommonspaceMutationOf<"add-discovered-agent">,
	): Promise<void> {
		if (typeof mutation.agentId !== "string")
			throw new Error("discovered agent id is required");
		if (mutation.adapter !== undefined && !isAgentAdapterKind(mutation.adapter))
			throw new Error("unsupported agent adapter");
		const matches = (candidate: CommonspaceAgentProfile) =>
			candidate.id === mutation.agentId &&
			(mutation.adapter === undefined ||
				candidate.adapter === mutation.adapter);
		let candidates = this.discoveredAgentCandidates.filter(matches);
		if (candidates.length === 0) {
			const adapters =
				mutation.adapter === undefined
					? AGENT_ADAPTER_KINDS
					: [mutation.adapter];
			const discovered = (
				await Promise.all(
					adapters.map((adapter) => this.discoverAgentCandidates(adapter)),
				)
			).flat();
			this.discoveredAgentCandidates = [
				...this.discoveredAgentCandidates.filter(
					(candidate) => !adapters.includes(candidate.adapter),
				),
				...discovered,
			];
			candidates = discovered.filter(matches);
		}
		if (candidates.length > 1)
			throw new Error("ambiguous discovered agent; select a harness");
		const agent = candidates[0];
		if (agent === undefined) throw new Error("unknown discovered agent");
		this.state = addDiscoveredAgent(this.state, {
			...agent,
			fullAccess: mutation.fullAccess === true,
		});
	}

	private async applyMutationState(
		mutation: CommonspaceMutation,
	): Promise<void> {
		if (mutation.action === "add-discovered-agent") {
			await this.applyDiscoveredAgentMutation(mutation);
			return;
		}
		const normalized = await this.normalizeMutation(mutation);
		this.state = applyMutation(this.state, normalized);
	}

	private async persistMutation(prepared: PreparedMutation): Promise<void> {
		let removedRoutingFile = false;
		try {
			if (prepared.removesInferenceSelection) {
				await this.persistRoutingConfiguration(missingRouting);
				removedRoutingFile = true;
			}
			await this.persist();
		} catch (error) {
			this.state = prepared.previousState;
			if (removedRoutingFile) {
				try {
					await this.persistRoutingConfiguration(
						prepared.previousRoutingConfiguration,
					);
				} catch (restoreError) {
					throw new AggregateError(
						[error, restoreError],
						"Commonspace could not restore inference configuration after an Agent removal failed",
						{ cause: restoreError },
					);
				}
			}
			throw new Error("Commonspace could not save workspace changes.", {
				cause: error,
			});
		}
	}

	private activateMutationRoutingConfiguration(
		prepared: PreparedMutation,
	): void {
		if (!prepared.removesInferenceSelection) return;
		this.routingConfiguration = missingRouting;
		this.notifyRoutingListeners();
	}

	private async invalidateMutationRuns(
		mutation: CommonspaceMutation,
	): Promise<void> {
		if (mutation.action === "remove-agent") {
			this.invalidateAgentExecution(mutation.agentId);
			const reason = "Interrupted because the Agent was removed.";
			const invalidatedRuns = [...this.activeAgentRuns.values()].filter(
				(run) => run.agentId === mutation.agentId,
			);
			await this.interruptAgentRuns(invalidatedRuns, reason);
			await this.recordPendingRunInvalidations(
				{ kind: "agent", agentId: mutation.agentId },
				reason,
			);
			return;
		}
		if (mutation.action !== "remove-project") return;
		const reason =
			"Interrupted because a Project used by this run was removed.";
		const invalidatedRuns = [...this.activeAgentRuns.values()].filter((run) =>
			run.projectIds.includes(mutation.projectId),
		);
		await this.interruptAgentRuns(invalidatedRuns, reason);
		await this.recordPendingRunInvalidations(
			{ kind: "project", projectId: mutation.projectId },
			reason,
		);
	}

	private async applyMutationAgentAccessChange(
		mutation: CommonspaceMutation,
		previousState: CommonspaceState,
	): Promise<void> {
		if (mutation.action !== "update-agent-profile") return;
		const previous = previousState.agents.find(
			(agent) => agent.id === mutation.agentId,
		);
		const updated = this.state.agents.find(
			(agent) => agent.id === mutation.agentId,
		);
		if (previous === undefined || updated === undefined)
			throw new Error("Updated agent identity is missing");
		if (this.agentFullAccess(previous) === this.agentFullAccess(updated))
			return;

		const reason = "Interrupted because agent permissions changed.";
		this.invalidateAgentExecution(updated.id);
		const changed = this.interruptPendingPermissions(updated.id);
		const runs = [...this.activeAgentRuns.values()].filter(
			(run) => run.agentId === updated.id,
		);
		await this.interruptAgentRuns(runs, reason);
		await this.recordPendingRunInvalidations(
			{ kind: "agent", agentId: updated.id },
			reason,
		);
		const currentFullAccess = this.agentFullAccess(updated);
		await this.closeAcpProcessesMatching(
			(candidateAgentId, _scopeName, processClient) =>
				candidateAgentId === updated.id &&
				this.acpLaunchAccess.get(processClient) !== currentFullAccess,
		);
		if (changed) await this.persist();
	}

	private async cleanupRemovedAgentProcesses(agentId: string): Promise<void> {
		const processEntries = [...this.acpProcesses.entries()].filter(([key]) =>
			key.startsWith(`${agentId}\u0000`),
		);
		for (const [key] of processEntries) this.acpProcesses.delete(key);
		for (const key of this.activeAcpSessions.keys()) {
			if (key.startsWith(`${agentId}\u0000`))
				this.activeAcpSessions.delete(key);
		}
		await Promise.all(
			processEntries.map(([key, processClient]) =>
				this.closeAcpProcess(key, processClient),
			),
		);
	}

	private async cleanupResetDmProcesses(
		cleanup: Extract<MutationProcessCleanup, { kind: "reset-dm" }>,
	): Promise<void> {
		const processClient = this.acpProcesses.get(cleanup.scopeKey);
		const activeSession = this.activeAcpSessions.get(cleanup.scopeKey);
		const activeProcess =
			activeSession === undefined
				? undefined
				: this.acpProcesses.get(activeSession.processScopeKey);
		this.acpProcesses.delete(cleanup.scopeKey);
		if (activeSession !== undefined)
			await activeProcess?.cancelSession(activeSession.sessionId);
		for (const run of cleanup.runs)
			run.abortController.abort(new Error("Interrupted by /new."));
		if (processClient !== undefined)
			await this.closeAcpProcess(cleanup.scopeKey, processClient);
	}

	private async cleanupRemovedChannelProcesses(
		cleanup: Extract<MutationProcessCleanup, { kind: "remove-channel" }>,
	): Promise<void> {
		const processEntries = [...this.acpProcesses.entries()].filter(([key]) =>
			this.processBelongsToRemovedChannel(key, cleanup.processScopeNames),
		);
		for (const [key] of processEntries) this.acpProcesses.delete(key);
		await Promise.all(
			cleanup.activeSessions.map(async ({ sessionScopeKey, session }) => {
				if (this.activeAcpSessions.get(sessionScopeKey) === session)
					this.activeAcpSessions.delete(sessionScopeKey);
				await processEntries
					.find(([processKey]) => processKey === session.processScopeKey)?.[1]
					.cancelSession(session.sessionId);
			}),
		);
		await Promise.all(
			processEntries.map(([key, processClient]) =>
				this.closeAcpProcess(key, processClient),
			),
		);
	}

	private async cleanupMutationProcesses(
		cleanup: MutationProcessCleanup,
	): Promise<void> {
		switch (cleanup.kind) {
			case "none":
				return;
			case "remove-agent":
				await this.cleanupRemovedAgentProcesses(cleanup.agentId);
				return;
			case "reset-dm":
				await this.cleanupResetDmProcesses(cleanup);
				return;
			case "remove-channel":
				await this.cleanupRemovedChannelProcesses(cleanup);
				return;
		}
	}

	private async commitMutation(
		mutation: CommonspaceMutation,
	): Promise<CommonspaceState> {
		const prepared = this.prepareMutation(mutation);
		await this.applyMutationState(mutation);
		this.invalidateChangedContextEvidence(prepared.previousState);
		await this.persistMutation(prepared);
		this.activateMutationRoutingConfiguration(prepared);
		await this.invalidateMutationRuns(mutation);
		this.revokeInvalidMcpCredentials();
		await this.applyMutationAgentAccessChange(mutation, prepared.previousState);
		await this.cleanupMutationProcesses(prepared.processCleanup);
		this.broadcastRevision();
		return this.publicSnapshot();
	}

	async mutate(mutation: CommonspaceMutation): Promise<CommonspaceState> {
		const releaseRoutingConfiguration =
			mutation.action === "remove-agent"
				? await this.acquireRoutingConfigurationLock()
				: undefined;
		return this.withAdmission(() => this.commitMutation(mutation)).finally(() =>
			releaseRoutingConfiguration?.(),
		);
	}

	private withMessageSubmissionTelemetry(
		source: "send" | "edit",
		conversationKind: SendMessageRequest["conversation"]["kind"],
		deliveryMode: NonNullable<SendMessageRequest["delivery"]>,
		operation: (markAccepted: () => void) => Promise<SendMessageResponse>,
	): Promise<SendMessageResponse> {
		return serverTracer.startActiveSpan(
			"commonspace.message.submit",
			{
				attributes: {
					"commonspace.conversation.kind": conversationKind,
					"commonspace.message.source": source,
					"commonspace.message.delivery_mode": deliveryMode,
				},
			},
			async (span) => {
				let accepted = false;
				const markAccepted = () => {
					accepted = true;
					span.setAttribute("commonspace.message.accepted", true);
				};
				try {
					const response = await operation(markAccepted);
					span.setStatus({ code: SpanStatusCode.OK });
					return response;
				} catch (error) {
					const observedError = error instanceof Error ? error : undefined;
					const description = accepted
						? "Message follow-up activation failed"
						: "Message acceptance failed";
					markOperationFailed(span, observedError, description);
					recordOperationException(observedError, {
						eventName: accepted
							? "commonspace.message.followup.exception"
							: "commonspace.message.accept.exception",
						body: description,
						severity: SeverityNumber.ERROR,
					});
					throw error;
				} finally {
					span.end();
				}
			},
		);
	}

	async send(request: SendMessageRequest): Promise<SendMessageResponse> {
		return this.withMessageSubmissionTelemetry(
			"send",
			request.conversation.kind,
			request.delivery ?? "queue",
			(markAccepted) =>
				this.withAdmission(async () => {
					if (
						request.delivery !== undefined &&
						!["queue", "steer", "stop-and-send"].includes(request.delivery)
					) {
						throw new Error("invalid follow-up delivery mode");
					}
					const preparationStartedAt = this.performancePhaseStartedAt();
					const prepared = await this.prepareSend(request);
					this.recordPerformanceMeasurement(
						CommonspaceHostPerformancePhase.AcceptanceRequestPreparation,
						preparationStartedAt,
					);
					return this.acceptPreparedSend(prepared, markAccepted);
				}),
		);
	}

	private currentEditableMessage(messageId: string): CommonspaceMessage {
		const current = locateMessageById(this.state.messages, messageId)?.message;
		if (current === undefined || current.authorType !== "user")
			throw new Error("message changed before editing");
		if (current.deletedAt !== undefined)
			throw new Error("deleted messages cannot be edited");
		return current;
	}

	private attachEditedMessageBranch(
		prepared: PreparedSend,
		source: CommonspaceMessage,
	): void {
		if (source.conversation.kind !== "channel" || source.threadId === undefined)
			return;
		const sourceThread = this.state.threads.find(
			(thread) => thread.id === source.threadId,
		);
		if (sourceThread === undefined)
			throw new Error("message branch source thread is unavailable");
		prepared.branch = {
			branchedFromThreadId: sourceThread.id,
			branchPointMessageId: source.id,
			channelSnapshot: structuredClone(sourceThread.context.channelSnapshot),
		};
	}

	async editMessage(request: EditMessageRequest): Promise<SendMessageResponse> {
		if (typeof request.messageId !== "string" || request.messageId === "")
			throw new Error("message id is required");
		if (typeof request.text !== "string")
			throw new Error("edited message text is required");
		if (request.text.normalize("NFKC").trim() === "")
			throw new Error("message text or image is required");
		if (
			request.projectIds !== undefined &&
			(!Array.isArray(request.projectIds) ||
				request.projectIds.some(
					(projectId) =>
						typeof projectId !== "string" ||
						!this.state.projects.some((project) => project.id === projectId),
				))
		) {
			throw new Error("edited message references an unknown project");
		}
		const source = locateMessageById(
			this.state.messages,
			request.messageId,
		)?.message;
		if (source === undefined) throw new Error("unknown message");
		if (source.authorType !== "user")
			throw new Error("only human messages can be edited");
		if (source.deletedAt !== undefined)
			throw new Error("deleted messages cannot be edited");
		return this.withMessageSubmissionTelemetry(
			"edit",
			source.conversation.kind,
			"queue",
			async (markAccepted) => {
				if (source.conversation.kind === "dm")
					await this.mutate({
						action: "reset-dm",
						agentId: source.conversation.id,
					});
				return this.withAdmission(async () => {
					const currentSource = this.currentEditableMessage(source.id);
					const editedProjectIds =
						request.projectIds ??
						(parseTags(request.text).projects.length > 0
							? undefined
							: referencedProjectIds(currentSource));
					const editedRequest: SendMessageRequest = {
						conversation: currentSource.conversation,
						text: request.text,
					};
					if (editedProjectIds !== undefined)
						editedRequest.projectIds = editedProjectIds;
					const prepared = await this.prepareSend(editedRequest);
					if (
						request.projectIds === undefined &&
						parseTags(request.text).projects.length === 0
					)
						prepared.projectScopeExplicit = false;
					prepared.attachments = await Promise.all(
						(currentSource.attachments ?? []).map(async (attachment) => {
							const { data } = await this.readImageAttachment(attachment.id);
							return {
								metadata: { ...attachment, id: crypto.randomUUID() },
								data,
							};
						}),
					);
					prepared.files = await Promise.all(
						(currentSource.files ?? []).map(async (file) => {
							const { data } = await this.readFileAttachment(file.id);
							return { metadata: { ...file, id: crypto.randomUUID() }, data };
						}),
					);
					prepared.version = {
						versionRootMessageId:
							currentSource.versionRootMessageId ?? currentSource.id,
						supersedesMessageId: currentSource.id,
						branchId: crypto.randomUUID(),
					};
					this.attachEditedMessageBranch(prepared, currentSource);
					return this.acceptPreparedSend(prepared, markAccepted);
				});
			},
		);
	}

	private prepareMessageDeletion(messageId: string): PreparedMessageDeletion {
		if (typeof messageId !== "string" || messageId === "")
			throw new Error("message id is required");
		const location = locateMessageById(this.state.messages, messageId);
		if (location === undefined) throw new Error("unknown message");
		if (location.message.deletedAt !== undefined)
			return { kind: "existing", deleted: location.message };
		return {
			kind: "pending",
			location,
			previousState: this.state,
			deleted: deletedMessageTombstone(location.message),
			imageIds:
				location.message.attachments?.map((attachment) => attachment.id) ?? [],
			fileIds: location.message.files?.map((file) => file.id) ?? [],
		};
	}

	private refreshDeletedThreadMemory(deleted: CommonspaceMessage): void {
		if (deleted.threadId === undefined) return;
		const thread = this.state.threads.find(
			(candidate) => candidate.id === deleted.threadId,
		);
		if (thread === undefined) return;
		const projection = projectThreadMemory(this.state, thread.id);
		const memory =
			thread.context.memory.origin === "user"
				? mergeThreadMemoryProjection(thread.context.memory, projection)
				: projection;
		this.state = {
			...this.state,
			threads: this.state.threads.map((candidate) =>
				candidate.id === thread.id
					? { ...candidate, context: { ...candidate.context, memory } }
					: candidate,
			),
		};
	}

	private refreshActiveRoutingMemory(channelId: string): void {
		const channel = this.state.channels.find(
			(candidate) => candidate.id === channelId,
		);
		if (channel === undefined) return;
		const correctionCount = activeRoutingCorrectionCount(this.state, channelId);
		if (correctionCount === channel.routingMemory.correctionCount) return;
		this.state = {
			...this.state,
			channels: this.state.channels.map((candidate) =>
				candidate.id === channelId
					? {
							...candidate,
							routingMemory:
								correctionCount === 0
									? emptyRoutingMemory()
									: {
											...candidate.routingMemory,
											summary: "",
											status: "stale",
											correctionCount,
											compactedThroughCorrectionId: null,
											updatedAt: null,
										},
						}
					: candidate,
			),
		};
	}

	private refreshDeletedChannelMemory(deleted: CommonspaceMessage): void {
		if (deleted.conversation.kind !== "channel") return;
		const channel = this.state.channels.find(
			(candidate) => candidate.id === deleted.conversation.id,
		);
		if (channel === undefined) return;
		const projection = projectChannelMemory(
			this.state,
			channel.id,
			this.state.defaults.memoryThreads,
		);
		const memory =
			channel.memory.origin === "user"
				? mergeChannelMemoryProjection(channel.memory, projection)
				: projection;
		this.state = {
			...this.state,
			channels: this.state.channels.map((candidate) =>
				candidate.id === channel.id ? { ...candidate, memory } : candidate,
			),
		};
		this.refreshActiveRoutingMemory(channel.id);
	}

	private applyMessageDeletion(deletion: PendingMessageDeletion): void {
		const messages = [...(this.state.messages[deletion.location.key] ?? [])];
		messages[deletion.location.index] = deletion.deleted;
		this.state = {
			...this.state,
			pendingAttachmentDeletions: {
				imageIds: [
					...(this.state.pendingAttachmentDeletions?.imageIds ?? []),
					...deletion.imageIds,
				],
				fileIds: [
					...(this.state.pendingAttachmentDeletions?.fileIds ?? []),
					...deletion.fileIds,
				],
			},
			revision: this.state.revision + 1,
			messages: {
				...this.state.messages,
				[deletion.location.key]: messages,
			},
		};
		this.invalidateChangedContextEvidence(deletion.previousState);
		this.refreshDeletedThreadMemory(deletion.deleted);
		this.refreshDeletedChannelMemory(deletion.deleted);
	}

	private async persistMessageDeletion(
		deletion: PendingMessageDeletion,
	): Promise<void> {
		this.applyMessageDeletion(deletion);
		try {
			await this.persist();
		} catch (error) {
			this.state = deletion.previousState;
			throw error;
		}
	}

	private async commitMessageDeletion(
		messageId: string,
	): Promise<CommonspaceMessage> {
		const deletion = this.prepareMessageDeletion(messageId);
		if (deletion.kind === "existing") {
			await this.removePendingAttachmentDeletions();
			return structuredClone(deletion.deleted);
		}
		await this.persistMessageDeletion(deletion);
		this.broadcastRevision();
		await this.removePendingAttachmentDeletions();
		return structuredClone(deletion.deleted);
	}

	async deleteMessage(messageId: string): Promise<CommonspaceMessage> {
		return this.withAdmission(() =>
			this.withDeletion(() => this.commitMessageDeletion(messageId)),
		);
	}

	private withDeletion<T>(operation: () => Promise<T>): Promise<T> {
		const task = this.deletionTail.then(operation);
		this.deletionTail = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	private async acceptPreparedSend(
		prepared: PreparedSend,
		markAccepted: () => void,
	): Promise<SendMessageResponse> {
		await this.overrides.beforeAcceptSend?.(prepared);
		const response = await this.acceptSend(prepared);
		markAccepted();
		const scopeKey = this.followupScopeKey(
			prepared.request.conversation,
			response.thread?.id,
		);
		const delivery = prepared.request.delivery ?? "queue";
		if (this.activeConversationRuns.has(scopeKey)) {
			const queue = this.pendingFollowups.get(scopeKey) ?? [];
			const pending = {
				prepared,
				response,
				delivery,
				telemetryContext: context.active(),
			};
			if (delivery === "steer" || delivery === "stop-and-send")
				queue.unshift(pending);
			else queue.push(pending);
			this.pendingFollowups.set(scopeKey, queue);
			if (delivery === "steer" || delivery === "stop-and-send") {
				await this.abortConversationRuns(
					prepared.request.conversation,
					response.thread?.id,
					"Stopped for a follow-up.",
				);
			}
		} else {
			this.startConversationRun(scopeKey, {
				prepared,
				response,
				delivery,
				telemetryContext: context.active(),
			});
		}
		return response;
	}

	private locateFailedRoutingSource(
		request: RetryRoutingRequest,
	): LocatedRoutingRetry {
		if (
			typeof request.sourceMessageId !== "string" ||
			request.sourceMessageId.trim() === ""
		)
			throw new Error("source message id is required");
		if (
			request.mode === "manual" &&
			(typeof request.agentId !== "string" || request.agentId.trim() === "")
		)
			throw new Error("manual routing requires an agent id");
		const located = locateMessageById(
			this.state.messages,
			request.sourceMessageId,
		);
		if (located === undefined || !isFailedRoutingSource(located.message))
			throw new Error("failed routing source message not found");
		const source = located.message;
		const thread = this.state.threads.find(
			(candidate) => candidate.id === source.threadId,
		);
		if (thread === undefined || thread.channelId !== source.conversation.id)
			throw new Error("routing source thread not found");
		return { key: located.key, source, thread };
	}

	private async prepareRoutingRetry(
		request: RetryRoutingRequest,
	): Promise<PreparedRoutingRetry> {
		const located = this.locateFailedRoutingSource(request);
		const sendRequest: SendMessageRequest = {
			conversation: located.source.conversation,
			text: located.source.text,
			threadId: located.thread.id,
		};
		const projectIds = referencedProjectIds(located.source);
		if (projectIds.length > 0) sendRequest.projectIds = projectIds;
		if (request.mode === "manual") sendRequest.targetAgentId = request.agentId;
		const prepared = await this.prepareSend(sendRequest);
		if (request.mode === "ai") prepared.projectScopeExplicit = false;
		if (request.mode === "ai" && located.source.routing.source === "explicit") {
			prepared.agentIds = [...located.source.routing.agentIds];
			prepared.inferProjects = false;
			prepared.routing = this.explicitSendRouting(
				prepared.agentIds,
				prepared.projects,
				"Retrying explicitly addressed Agents.",
			);
		}
		if (prepared.routing === undefined)
			throw new Error("routing retry did not produce a routing decision");
		const attachments = await Promise.all(
			(located.source.attachments ?? []).map(async (attachment) => {
				const { data } = await this.readImageAttachment(attachment.id);
				return { metadata: attachment, data };
			}),
		);
		const files = await Promise.all(
			(located.source.files ?? []).map(async (file) => {
				const { data } = await this.readFileAttachment(file.id);
				return { metadata: file, data };
			}),
		);
		return {
			...located,
			prepared: {
				...prepared,
				routing: prepared.routing,
				attachments,
				files,
			},
		};
	}

	private createRoutingRetryStateChange(
		retry: PreparedRoutingRetry,
	): RoutingRetryStateChange {
		const accepted: CommonspaceMessage = {
			...retry.source,
			routing: retry.prepared.routing,
		};
		delete accepted.replyStatus;
		delete accepted.replyError;
		return {
			accepted,
			thread: retry.prepared.thread ?? retry.thread,
		};
	}

	private async persistRoutingRetry(
		retry: PreparedRoutingRetry,
		change: RoutingRetryStateChange,
	): Promise<void> {
		const previousState = this.state;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: {
				...this.state.messages,
				[retry.key]: (this.state.messages[retry.key] ?? []).map((message) =>
					message.id === change.accepted.id ? change.accepted : message,
				),
			},
			threads: this.state.threads.map((candidate) =>
				candidate.id === change.thread.id ? change.thread : candidate,
			),
		};
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			throw error;
		}
		this.broadcastRevision();
	}

	private startRoutingRetry(
		retry: PreparedRoutingRetry,
		response: RetryRoutingResponse,
	): void {
		const pending = {
			prepared: retry.prepared,
			response,
			delivery: "queue" as const,
			telemetryContext: context.active(),
		};
		const scopeKey = this.followupScopeKey(
			retry.source.conversation,
			retry.thread.id,
		);
		if (this.activeConversationRuns.has(scopeKey)) {
			const queue = this.pendingFollowups.get(scopeKey) ?? [];
			queue.push(pending);
			this.pendingFollowups.set(scopeKey, queue);
			return;
		}
		this.startConversationRun(scopeKey, pending);
	}

	private async commitRoutingRetry(
		request: RetryRoutingRequest,
	): Promise<RetryRoutingResponse> {
		const retry = await this.prepareRoutingRetry(request);
		const change = this.createRoutingRetryStateChange(retry);
		await this.persistRoutingRetry(retry, change);
		const response: RetryRoutingResponse = {
			accepted: change.accepted,
			thread: change.thread,
			state: this.publicSnapshot(),
		};
		this.startRoutingRetry(retry, response);
		return response;
	}

	async retryRouting(
		request: RetryRoutingRequest,
	): Promise<RetryRoutingResponse> {
		return this.withAdmission(() => this.commitRoutingRetry(request));
	}

	private validatedRerouteProjectIds(
		request: RerouteAssignmentRequest,
	): string[] {
		if (
			typeof request.sourceMessageId !== "string" ||
			request.sourceMessageId.trim() === ""
		)
			throw new Error("source message id is required");
		if (
			typeof request.assignmentId !== "string" ||
			request.assignmentId.trim() === ""
		)
			throw new Error("assignment id is required");
		if (typeof request.agentId !== "string" || request.agentId.trim() === "")
			throw new Error("agent id is required");
		if (!Array.isArray(request.projectIds))
			throw new Error("project ids must be an array");
		const projectIds = [
			...new Set(
				request.projectIds.map((projectId) => {
					if (typeof projectId !== "string" || projectId.trim() === "")
						throw new Error("project id must be a non-empty string");
					return projectId.trim();
				}),
			),
		];
		if (projectIds.length > 32)
			throw new Error("an assignment can reference at most 32 projects");
		return projectIds;
	}

	private prepareReroute(request: RerouteAssignmentRequest): PreparedReroute {
		const projectIds = this.validatedRerouteProjectIds(request);
		const located = locateMessageById(
			this.state.messages,
			request.sourceMessageId,
		);
		if (
			located === undefined ||
			located.message.authorType !== "user" ||
			located.message.conversation.kind !== "channel" ||
			located.message.routing === undefined
		) {
			throw new Error("routable source message not found");
		}
		const { key, message: source } = located;
		if (
			source.deletedAt !== undefined ||
			(this.state.messages[key] ?? []).some(
				(message) => message.supersedesMessageId === source.id,
			)
		)
			throw new Error("superseded or deleted messages cannot be corrected");
		const routing = source.routing;
		if (routing === undefined)
			throw new Error("routable source message not found");
		const original = routing.assignments.find(
			(assignment) => assignment.id === request.assignmentId,
		);
		if (original === undefined) throw new Error("routing assignment not found");
		if (
			routing.corrections.some(
				(correction) => correction.fromAssignmentId === original.id,
			)
		) {
			throw new Error("routing assignment was already superseded");
		}

		const agents = this.configuredAgents();
		const target = agents.find((agent) => agent.id === request.agentId);
		if (target === undefined) throw new Error("unknown reroute agent");
		if (target.id === original.agentId)
			throw new Error("reroute agent already owns this assignment");
		const agentExecutionRevisions = new Map(
			agents.map((agent) => [agent.id, this.agentExecutionRevision(agent.id)]),
		);
		const projects = projectIds.map((projectId) => {
			const project = this.state.projects.find(
				(candidate) => candidate.id === projectId,
			);
			if (project === undefined) throw new Error("unknown reroute project");
			return project;
		});
		const thread = this.state.threads.find(
			(candidate) => candidate.id === source.threadId,
		);
		if (thread === undefined || thread.channelId !== source.conversation.id)
			throw new Error("routing source thread not found");
		const channel = this.state.channels.find(
			(candidate) => candidate.id === thread.channelId,
		);
		if (channel === undefined)
			throw new Error("routing source channel not found");
		if (!channel.agentIds.includes(target.id))
			throw new Error("reroute agent must belong to the channel");
		return {
			key,
			source,
			routing,
			original,
			agents,
			target,
			agentExecutionRevisions,
			projects,
			thread,
			channel,
		};
	}

	private createRerouteStateChange(
		prepared: PreparedReroute,
	): RerouteStateChange {
		const superseded = new Set(
			prepared.routing.corrections.map(
				(correction) => correction.fromAssignmentId,
			),
		);
		const existingAssignment = prepared.routing.assignments.find(
			(candidate) =>
				candidate.agentId === prepared.target.id &&
				!superseded.has(candidate.id),
		);
		const assignment: CommonspaceRoutingAssignment = existingAssignment ?? {
			id: crypto.randomUUID(),
			agentId: prepared.target.id,
			projectIds: prepared.projects.map((project) => project.id),
		};
		const correction: CommonspaceRoutingCorrection = {
			id: crypto.randomUUID(),
			fromAssignmentId: prepared.original.id,
			toAssignmentId: assignment.id,
			createdAt: now(),
		};
		const updatedRouting: CommonspaceRoutingDecision = {
			...prepared.routing,
			status: "resolved",
			agentIds: [
				...new Set([...prepared.routing.agentIds, prepared.target.id]),
			],
			assignments:
				existingAssignment === undefined
					? [...prepared.routing.assignments, assignment]
					: prepared.routing.assignments,
			corrections: [...prepared.routing.corrections, correction],
		};
		const source: CommonspaceMessage = {
			...prepared.source,
			routing: updatedRouting,
		};
		const thread: CommonspaceThread = {
			...prepared.thread,
			agentIds: [...new Set([...prepared.thread.agentIds, prepared.target.id])],
		};
		const correctionCount =
			activeRoutingCorrectionCount(this.state, prepared.channel.id) + 1;
		const channel = {
			...prepared.channel,
			agentIds: [
				...new Set([...prepared.channel.agentIds, prepared.target.id]),
			],
			routingMemory: {
				...prepared.channel.routingMemory,
				status: "stale" as const,
				correctionCount,
			},
		};
		return {
			assignment,
			correction,
			source,
			thread,
			channel,
			deliveryNeeded: existingAssignment === undefined,
		};
	}

	private async persistRerouteStateChange(
		prepared: PreparedReroute,
		change: RerouteStateChange,
	): Promise<void> {
		const previousState = this.state;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			channels: this.state.channels.map((candidate) =>
				candidate.id === change.channel.id ? change.channel : candidate,
			),
			threads: this.state.threads.map((candidate) =>
				candidate.id === change.thread.id ? change.thread : candidate,
			),
			messages: {
				...this.state.messages,
				[prepared.key]: (this.state.messages[prepared.key] ?? []).map(
					(message) =>
						message.id === change.source.id ? change.source : message,
				),
			},
		};
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			throw error;
		}
		this.broadcastRevision();
	}

	private async prepareRerouteDelivery(
		prepared: PreparedReroute,
		change: RerouteStateChange,
	): Promise<PreparedSend> {
		const attachments = await Promise.all(
			(prepared.source.attachments ?? []).map(async (attachment) => {
				const { data } = await this.readImageAttachment(attachment.id);
				return { metadata: attachment, data };
			}),
		);
		const files = await Promise.all(
			(prepared.source.files ?? []).map(async (file) => {
				const { data } = await this.readFileAttachment(file.id);
				return { metadata: file, data };
			}),
		);
		const delivery: PreparedSend = {
			request: {
				conversation: prepared.source.conversation,
				text: prepared.source.text,
				projectIds: change.assignment.projectIds,
				threadId: change.thread.id,
			},
			text: prepared.source.text,
			attachments,
			files,
			agents: prepared.agents,
			agentIds: [prepared.target.id],
			agentExecutionRevisions: prepared.agentExecutionRevisions,
			routing: {
				source: "explicit",
				status: "resolved",
				agentIds: [prepared.target.id],
				assignments: [change.assignment],
				corrections: [],
				inferredProjectIds: [],
				reason: "User corrected one routing assignment.",
			},
			channel: change.channel,
			projects: prepared.projects,
			inferProjects: false,
			projectScopeExplicit: true,
			thread: change.thread,
		};
		if (prepared.projects[0] !== undefined)
			delivery.project = prepared.projects[0];
		return delivery;
	}

	private startRerouteOperation(
		delivery: PreparedSend | undefined,
		response: SendMessageResponse,
		channelId: string,
	): void {
		const operation = Promise.all([
			delivery === undefined
				? Promise.resolve()
				: this.processReplies(delivery, response),
			this.compactRoutingMemory(channelId),
		]).then(() => undefined);
		this.backgroundRuns.add(operation);
		void operation
			.finally(() => {
				this.backgroundRuns.delete(operation);
				this.broadcastLiveActivities();
			})
			.catch((error) => {
				this.environment.logger?.warn(error);
			});
	}

	private async commitRerouteAssignment(
		request: RerouteAssignmentRequest,
	): Promise<RerouteAssignmentResponse> {
		const prepared = this.prepareReroute(request);
		const change = this.createRerouteStateChange(prepared);
		await this.persistRerouteStateChange(prepared, change);
		const state = this.publicSnapshot();
		const delivery = change.deliveryNeeded
			? await this.prepareRerouteDelivery(prepared, change)
			: undefined;
		const response: SendMessageResponse = {
			accepted: change.source,
			thread: change.thread,
			state,
		};
		this.startRerouteOperation(delivery, response, change.channel.id);
		return {
			sourceMessageId: prepared.source.id,
			assignment: change.assignment,
			correction: change.correction,
			state,
		};
	}

	async rerouteAssignment(
		request: RerouteAssignmentRequest,
	): Promise<RerouteAssignmentResponse> {
		return this.withAdmission(() => this.commitRerouteAssignment(request));
	}

	private findPendingFollowup(
		messageId: string,
	): PendingFollowupLocation | undefined {
		for (const [scopeKey, queue] of this.pendingFollowups) {
			const index = queue.findIndex(
				(item) => item.response.accepted.id === messageId,
			);
			if (index >= 0) return { scopeKey, queue, index };
		}
		return undefined;
	}

	private requiredFollowupMessageId(value: string): string {
		if (typeof value !== "string" || value === "")
			throw new Error("message id is required");
		return value;
	}

	async reorderFollowup(
		request: ReorderFollowupRequest,
	): Promise<FollowupQueueResponse> {
		return this.withAdmission(async () => {
			const messageId = this.requiredFollowupMessageId(request.messageId);
			if (request.direction !== "up" && request.direction !== "down")
				throw new Error("invalid queue direction");
			const location = this.findPendingFollowup(messageId);
			if (location === undefined) throw new Error("queued follow-up not found");
			const target =
				request.direction === "up" ? location.index - 1 : location.index + 1;
			if (target >= 0 && target < location.queue.length) {
				const [item] = location.queue.splice(location.index, 1);
				if (item === undefined)
					throw new Error("queued follow-up changed during reorder");
				location.queue.splice(target, 0, item);
				this.broadcastLiveActivities();
			}
			return { queuedFollowups: this.queuedFollowups() };
		});
	}

	async removeFollowup(
		request: RemoveFollowupRequest,
	): Promise<FollowupQueueResponse> {
		return this.withAdmission(async () => {
			const messageId = this.requiredFollowupMessageId(request.messageId);
			const location = this.findPendingFollowup(messageId);
			if (location === undefined) throw new Error("queued follow-up not found");
			const [removed] = location.queue.splice(location.index, 1);
			if (location.queue.length === 0)
				this.pendingFollowups.delete(location.scopeKey);
			if (removed !== undefined) {
				this.updateMessageReplyStatus(
					removed.prepared.request.conversation,
					messageId,
					"cancelled",
					"Removed from queue.",
				);
				await this.persist();
				this.broadcastRevision();
				this.broadcastLiveActivities();
			}
			return { queuedFollowups: this.queuedFollowups() };
		});
	}

	async stopAgentRuns(
		request: StopAgentRunsRequest,
	): Promise<StopAgentRunsResponse> {
		return this.withAdmission(async () => {
			if (typeof request.messageId !== "string" || request.messageId === "")
				throw new Error("message id is required");
			if (
				request.agentId !== undefined &&
				(typeof request.agentId !== "string" || request.agentId === "")
			) {
				throw new Error("agent id must be a non-empty string");
			}
			const message = Object.values(this.state.messages)
				.flat()
				.find((candidate) => candidate.id === request.messageId);
			if (message === undefined || message.authorType !== "user")
				throw new Error("unknown user message");
			const runs = [...this.activeAgentRuns.values()].filter(
				(run) =>
					!run.abortController.signal.aborted &&
					run.sourceMessageId === request.messageId &&
					(request.agentId === undefined || run.agentId === request.agentId),
			);
			const stoppedAgentIds = [...new Set(runs.map((run) => run.agentId))];
			await Promise.all(
				runs.map(async (run) => {
					run.abortController.abort(new Error("Stopped by user."));
					const session = this.activeAcpSessions.get(run.scopeKey);
					if (session !== undefined)
						await this.acpProcesses
							.get(session.processScopeKey)
							?.cancelSession(session.sessionId);
				}),
			);
			const changed =
				message.conversation.kind === "dm" && stoppedAgentIds.length > 0
					? this.updateMessageReplyStatus(
							message.conversation,
							message.id,
							"error",
							"Stopped by user.",
						)
					: false;
			if (changed) {
				await this.persist();
				this.broadcastRevision();
			}
			return { stoppedAgentIds };
		});
	}

	subscribeToRevisions(listener: (revision: number) => void): () => void {
		this.revisionListeners.add(listener);
		return () => {
			this.revisionListeners.delete(listener);
		};
	}

	subscribeToRoutingChanges(listener: () => void): () => void {
		this.routingListeners.add(listener);
		return () => {
			this.routingListeners.delete(listener);
		};
	}

	liveActivities(): CommonspaceLiveAgentActivity[] {
		return structuredClone([...this.liveActivitiesById.values()]);
	}

	queuedFollowups(): CommonspaceQueuedFollowup[] {
		return [...this.pendingFollowups.values()].flatMap((queue) =>
			queue.map((item, position): CommonspaceQueuedFollowup => {
				const followup: CommonspaceQueuedFollowup = {
					messageId: item.response.accepted.id,
					conversation: item.prepared.request.conversation,
					agentIds: [...item.prepared.agentIds],
					text: item.prepared.text,
					position,
					createdAt: item.response.accepted.createdAt,
					delivery: item.delivery,
				};
				if (item.response.thread !== undefined)
					followup.threadId = item.response.thread.id;
				return followup;
			}),
		);
	}

	subscribeToLiveActivities(
		listener: (activities: readonly CommonspaceLiveAgentActivity[]) => void,
	): () => void {
		this.liveActivityListeners.add(listener);
		return () => {
			this.liveActivityListeners.delete(listener);
		};
	}

	async readImageAttachment(
		id: string,
	): Promise<{ attachment: CommonspaceImageAttachment; data: Buffer }> {
		if (!IMAGE_ATTACHMENT_ID_PATTERN.test(id))
			throw new Error("unknown image attachment");
		const attachment = Object.values(this.state.messages)
			.flat()
			.flatMap((message) => message.attachments ?? [])
			.find((candidate) => candidate.id === id);
		if (attachment === undefined) throw new Error("unknown image attachment");
		const data = await readFile(join(this.attachmentsRoot, id));
		if (data.length !== attachment.size)
			throw new Error("image attachment is unavailable");
		return { attachment: structuredClone(attachment), data };
	}

	async readFileAttachment(
		id: string,
	): Promise<{ metadata: CommonspaceFileAttachment; data: Buffer }> {
		if (!IMAGE_ATTACHMENT_ID_PATTERN.test(id))
			throw new Error("unknown file attachment");
		const metadata = Object.values(this.state.messages)
			.flat()
			.flatMap((message) => message.files ?? [])
			.find((candidate) => candidate.id === id);
		if (metadata === undefined) throw new Error("unknown file attachment");
		const data = await readFile(join(this.attachmentsRoot, id));
		if (data.length !== metadata.size)
			throw new Error("file attachment is unavailable");
		return { metadata: structuredClone(metadata), data };
	}

	private prepareSendProjectSelection(
		request: SendMessageRequest,
		text: string,
	): PreparedSendProjectSelection {
		const taggedProjects = [...new Set(parseTags(text).projects)].flatMap(
			(tag) => {
				const project = this.state.projects.find(
					(candidate) =>
						candidate.id.toLocaleLowerCase() === tag ||
						projectTagName(candidate.name) === tag,
				);
				return project === undefined ? [] : [project];
			},
		);
		if (request.projectIds !== undefined && !Array.isArray(request.projectIds))
			throw new Error("project ids must be an array");
		const explicitProjectIds = request.projectIds?.map((projectId) => {
			if (typeof projectId !== "string" || projectId.trim() === "")
				throw new Error("project id must be a non-empty string");
			return projectId.trim();
		});
		let compatibilityProjectId: string | undefined;
		if (request.projectId !== undefined) {
			if (
				typeof request.projectId !== "string" ||
				request.projectId.trim() === ""
			) {
				throw new Error("project id must be a non-empty string");
			}
			compatibilityProjectId = request.projectId.trim();
		}
		if (
			explicitProjectIds !== undefined &&
			compatibilityProjectId !== undefined &&
			explicitProjectIds[0] !== compatibilityProjectId
		) {
			throw new Error("project id must match the first project ids entry");
		}
		const selectionProvided =
			explicitProjectIds !== undefined ||
			compatibilityProjectId !== undefined ||
			taggedProjects.length > 0;
		const legacyThreadSelection =
			request.threadId !== undefined &&
			request.projectIds === undefined &&
			compatibilityProjectId !== undefined &&
			taggedProjects.length === 0;
		const requestedProjectIds = [
			...new Set([
				...taggedProjects.map((project) => project.id),
				...(explicitProjectIds ?? []),
				...(explicitProjectIds !== undefined ||
				compatibilityProjectId === undefined
					? []
					: [compatibilityProjectId]),
			]),
		];
		if (requestedProjectIds.length > 32)
			throw new Error("a message can reference at most 32 projects");
		return {
			requestedProjectIds,
			selectionProvided,
			legacyThreadSelection,
		};
	}

	private prepareSendInput(request: SendMessageRequest): PreparedSendInput {
		const text = request.text
			.normalize("NFKC")
			.trim()
			.slice(0, MAX_MESSAGE_CHARS);
		const attachments = prepareImageAttachments(request.attachments);
		const files = prepareFileAttachments(request.files);
		const projectSelection = this.prepareSendProjectSelection(request, text);
		return { text, attachments, files, projectSelection };
	}

	private knownSendProjects(
		projectIds: readonly string[],
		missingProjectError: string,
	): CommonspaceState["projects"] {
		return projectIds.map((projectId) => {
			const project = this.state.projects.find(
				(candidate) => candidate.id === projectId,
			);
			if (project === undefined) throw new Error(missingProjectError);
			return project;
		});
	}

	private prepareChannelContext(
		request: SendMessageRequest,
		selection: PreparedSendProjectSelection,
	): PreparedChannelContext {
		const channel = this.state.channels.find(
			(candidate) => candidate.id === request.conversation.id,
		);
		if (channel === undefined) throw new Error("unknown channel");
		const channelAgentIds = [...channel.agentIds];
		if (request.threadId === undefined) {
			return {
				channel,
				admission: { channelAgentIds },
				projects: this.knownSendProjects(
					selection.requestedProjectIds,
					"unknown project",
				),
			};
		}

		let thread = this.state.threads.find(
			(candidate) => candidate.id === request.threadId,
		);
		if (thread === undefined || thread.channelId !== channel.id)
			throw new Error("unknown channel thread");
		const threadProjectIds = referencedProjectIds(thread);
		const admission: PreparedChannelAdmission = {
			channelAgentIds,
			thread: {
				id: thread.id,
				agentIds: [...thread.agentIds],
				projectIds: [...threadProjectIds],
			},
		};
		const requestedProjectId = selection.requestedProjectIds[0];
		const selectedExistingThreadProject =
			selection.legacyThreadSelection &&
			selection.requestedProjectIds.length === 1 &&
			requestedProjectId !== undefined &&
			threadProjectIds.includes(requestedProjectId);
		const effectiveProjectIds =
			!selection.selectionProvided || selectedExistingThreadProject
				? threadProjectIds
				: selection.requestedProjectIds;
		const projects = this.knownSendProjects(
			effectiveProjectIds,
			"thread references an unknown project",
		);
		if (!sameIdentifierSet(effectiveProjectIds, threadProjectIds)) {
			thread = {
				...thread,
				projectIds: effectiveProjectIds,
				projectId: effectiveProjectIds[0] ?? null,
			};
		}
		return { channel, admission, projects, thread };
	}

	private async refreshUnknownChannelAgents(
		request: SendMessageRequest,
		text: string,
		memberIds: ReadonlySet<string>,
		agents: readonly CommonspaceAgentProfile[],
	): Promise<readonly CommonspaceAgentProfile[]> {
		if (
			request.targetAgentId !== undefined ||
			mentionedChannelAgents([...memberIds], text, agents).length > 0 ||
			!agents.some(
				(agent) => memberIds.has(agent.id) && agent.status === "unknown",
			)
		) {
			return agents;
		}
		const adapters = [
			...new Set(
				agents
					.filter(
						(agent) => memberIds.has(agent.id) && agent.status === "unknown",
					)
					.map((agent) => agent.adapter),
			),
		];
		const refreshed = (
			await Promise.all(
				adapters.map((adapter) => this.discoverAgentCandidates(adapter)),
			)
		).flat();
		const refreshedAdapters = new Set(adapters);
		this.discoveredAgentCandidates = [
			...this.discoveredAgentCandidates.filter(
				(agent) => !refreshedAdapters.has(agent.adapter),
			),
			...refreshed,
		];
		return this.configuredAgents();
	}

	private explicitSendRouting(
		agentIds: string[],
		projects: CommonspaceState["projects"],
		reason: string,
	): CommonspaceRoutingDecision {
		const routingAt = now();
		return {
			source: "explicit",
			...(agentIds.length > 1
				? { status: "pending" as const, startedAt: routingAt }
				: completedRoutingTiming(routingAt)),
			agentIds,
			assignments: agentIds.map((agentId) => ({
				id: crypto.randomUUID(),
				agentId,
				projectIds: projects.map((project) => project.id),
			})),
			corrections: [],
			inferredProjectIds: [],
			reason,
		};
	}

	private prepareDirectChannelSend(
		request: SendMessageRequest,
		context: PreparedChannelContext,
		agents: readonly CommonspaceAgentProfile[],
	): Extract<PreparedSendConversation, { kind: "channel" }> | undefined {
		if (request.targetAgentId === undefined) return undefined;
		if (context.thread === undefined)
			throw new Error("direct channel replies require a thread");
		if (
			!context.channel.agentIds.includes(request.targetAgentId) ||
			!agents.some((agent) => agent.id === request.targetAgentId)
		) {
			throw new Error("direct reply target is not a channel member");
		}
		const agentIds = [request.targetAgentId];
		return {
			kind: "channel",
			agents,
			agentIds,
			channel: context.channel,
			admission: context.admission,
			projects: context.projects,
			routing: this.explicitSendRouting(
				agentIds,
				context.projects,
				"Direct reply target selected.",
			),
			thread: context.thread,
		};
	}

	private async prepareChannelSend(
		request: SendMessageRequest,
		input: PreparedSendInput,
		configuredAgents: readonly CommonspaceAgentProfile[],
	): Promise<Extract<PreparedSendConversation, { kind: "channel" }>> {
		const context = this.prepareChannelContext(request, input.projectSelection);
		const memberIds = new Set(
			context.thread?.agentIds ?? context.channel.agentIds,
		);
		const agents = await this.refreshUnknownChannelAgents(
			request,
			input.text,
			memberIds,
			configuredAgents,
		);
		const direct = this.prepareDirectChannelSend(request, context, agents);
		if (direct !== undefined) return direct;

		const explicitlyMentionedAgentIds = mentionedAgents(input.text, agents);
		const channel = {
			...context.channel,
			agentIds: [
				...new Set([
					...context.channel.agentIds,
					...explicitlyMentionedAgentIds,
				]),
			],
		};
		const thread =
			context.thread === undefined
				? undefined
				: {
						...context.thread,
						agentIds: [
							...new Set([
								...context.thread.agentIds,
								...explicitlyMentionedAgentIds,
							]),
						],
					};
		const routedMemberIds = thread?.agentIds ?? channel.agentIds;
		const explicitlyAddressed = mentionedChannelAgents(
			routedMemberIds,
			input.text,
			agents,
		);
		if (explicitlyAddressed.length > 0) {
			const conversation: PreparedSendConversation = {
				kind: "channel",
				agents,
				agentIds: explicitlyAddressed,
				channel,
				admission: context.admission,
				projects: context.projects,
				routing: this.explicitSendRouting(
					explicitlyAddressed,
					context.projects,
					parseTags(input.text).agents.includes("all")
						? "@all addressed every channel agent."
						: "Agent mention selected.",
				),
			};
			if (thread !== undefined) conversation.thread = thread;
			return conversation;
		}
		const conversation: PreparedSendConversation = {
			kind: "channel",
			agents,
			agentIds: [],
			channel,
			admission: context.admission,
			projects: context.projects,
			routing: {
				source: "ai",
				status: "pending",
				startedAt: now(),
				agentIds: [],
				assignments: [],
				corrections: [],
				inferredProjectIds: [],
				reason: "Routing with inference.",
			},
		};
		if (thread !== undefined) conversation.thread = thread;
		return conversation;
	}

	private prepareDirectMessageSend(
		request: SendMessageRequest,
		selection: PreparedSendProjectSelection,
		agents: readonly CommonspaceAgentProfile[],
	): Extract<PreparedSendConversation, { kind: "dm" }> {
		if (request.threadId !== undefined)
			throw new Error("direct messages do not use channel threads");
		if (request.targetAgentId !== undefined)
			throw new Error("direct messages do not accept a reply target");
		if (!agents.some((agent) => agent.id === request.conversation.id))
			throw new Error("unknown agent");
		const projects = this.knownSendProjects(
			selection.requestedProjectIds,
			"unknown project",
		);
		return {
			kind: "dm",
			agents,
			agentIds: [request.conversation.id],
			projects,
			dmSessionName:
				this.state.dmSessions[request.conversation.id] ?? "Bot Chat",
		};
	}

	private completePreparedSend(
		request: SendMessageRequest,
		input: PreparedSendInput,
		conversation: PreparedSendConversation,
	): PreparedSend {
		const inferProjects =
			conversation.kind === "channel" &&
			!(
				conversation.routing.source === "explicit" &&
				conversation.routing.status === "pending"
			) &&
			request.threadId === undefined &&
			!input.projectSelection.selectionProvided;
		const prepared: PreparedSend = {
			request,
			text: input.text,
			attachments: input.attachments,
			files: input.files,
			agents: conversation.agents,
			agentIds: conversation.agentIds,
			agentExecutionRevisions: new Map(
				conversation.agents.map((agent) => [
					agent.id,
					this.agentExecutionRevision(agent.id),
				]),
			),
			projects: conversation.projects,
			inferProjects,
			projectScopeExplicit:
				input.projectSelection.selectionProvided &&
				!input.projectSelection.legacyThreadSelection,
		};
		if (conversation.kind === "channel") {
			prepared.routing = conversation.routing;
			prepared.channel = conversation.channel;
			prepared.channelAdmission = conversation.admission;
			if (conversation.thread !== undefined)
				prepared.thread = conversation.thread;
		} else {
			prepared.dmSessionName = conversation.dmSessionName;
		}
		const project = conversation.projects[0];
		if (project !== undefined) prepared.project = project;
		return prepared;
	}

	private async prepareSend(
		request: SendMessageRequest,
	): Promise<PreparedSend> {
		const input = this.prepareSendInput(request);
		const agents = this.configuredAgents();
		const conversation =
			request.conversation.kind === "channel"
				? await this.prepareChannelSend(request, input, agents)
				: this.prepareDirectMessageSend(
						request,
						input.projectSelection,
						agents,
					);
		if (
			input.text === "" &&
			input.attachments.length === 0 &&
			input.files.length === 0
		) {
			throw new Error("message text, image, or file is required");
		}
		return this.completePreparedSend(request, input, conversation);
	}

	private prepareChannelRoute(
		send: Pick<
			PreparedSend,
			"text" | "request" | "agents" | "inferProjects" | "routing"
		>,
		thread: CommonspaceThread | undefined,
		memberIds: readonly string[],
	): PreparedChannelRoute {
		const { text, request, agents, inferProjects } = send;
		const agentById = new Map(agents.map((agent) => [agent.id, agent]));
		const candidates = rankChannelAgents(memberIds, text, agents).flatMap(
			(signal) => {
				const agent = agentById.get(signal.id);
				if (agent === undefined) return [];
				const candidate: CommonspaceRouteInput["candidates"][number] = {
					id: agent.id,
					displayName: agent.displayName,
					adapter: agent.adapter,
					routingScore: signal.score,
					matchedTerms: signal.matchedTerms,
				};
				if (agent.description !== undefined)
					candidate.description = agent.description;
				return [candidate];
			},
		);
		if (candidates.length === 0)
			throw new Error("inference routing failed: no eligible agents");

		const explicitProjectIds = referencedProjectIds(thread ?? {});
		const selectedProjectIds = inferProjects
			? this.state.projects.map((project) => project.id)
			: explicitProjectIds;
		const projectById = new Map(
			this.state.projects.map((project) => [project.id, project]),
		);
		const projects = selectedProjectIds.flatMap((projectId) => {
			const project = projectById.get(projectId);
			return project === undefined
				? []
				: [{ id: project.id, name: project.name }];
		});
		const channelId = request.conversation.id;
		const currentChannelIds = new Set(
			this.state.channels.map((channel) => channel.id),
		);
		for (const id of this.routingIndexes.keys())
			if (!currentChannelIds.has(id)) this.routingIndexes.delete(id);
		let index = this.routingIndexes.get(channelId);
		if (index === undefined) {
			index = new RoutingMessageIndex();
			this.routingIndexes.set(channelId, index);
		}
		const context = buildRetrievedRoutingContext({
			state: this.state,
			channelId,
			query: text,
			index,
			thread,
			scopeThreadId: request.threadId,
		});
		context.unshift(
			...projects
				.filter((project) => explicitProjectIds.includes(project.id))
				.map((project) => `Referenced Project: ${project.name}`),
		);
		const routingMemory = this.state.channels.find(
			(channel) => channel.id === channelId,
		)?.routingMemory;
		const input: CommonspaceRouteInput = {
			text,
			context,
			routingMemory: routingMemory?.summary ?? "",
			candidates,
			projects,
			inferProjects,
			maxAgents: Math.min(
				this.state.defaults.maxAgentsPerTurn,
				candidates.length,
			),
		};
		const examples = currentRoutingExamples(this.state, channelId);
		if (examples !== null)
			input.routingMemory = [input.routingMemory, examples]
				.filter(Boolean)
				.join("\n\n");
		if (send.routing?.source === "explicit") {
			input.fixedAgentIds = send.routing.agentIds;
			input.maxAgents = send.routing.agentIds.length;
		}
		return { channelId, candidates, projects, input };
	}

	private currentAllowedRouteAgentIds(
		prepared: PreparedChannelRoute,
	): Set<string> {
		const currentChannel = this.state.channels.find(
			(channel) => channel.id === prepared.channelId,
		);
		if (currentChannel === undefined)
			throw new Error("Channel was removed during routing");
		const currentAgentIds = new Set(this.state.agents.map((agent) => agent.id));
		return new Set(
			prepared.candidates
				.filter(
					(candidate) =>
						currentChannel.agentIds.includes(candidate.id) &&
						currentAgentIds.has(candidate.id),
				)
				.map((candidate) => candidate.id),
		);
	}

	private currentAllowedRouteProjectIds(
		prepared: PreparedChannelRoute,
	): Set<string> {
		const currentProjectIds = new Set(
			this.state.projects.map((project) => project.id),
		);
		return new Set(
			prepared.projects
				.filter((project) => currentProjectIds.has(project.id))
				.map((project) => project.id),
		);
	}

	private validatedRouteAssignments(
		result: CommonspaceRouteResult,
		prepared: PreparedChannelRoute,
		allowedAgentIds: ReadonlySet<string>,
		allowedProjectIds: ReadonlySet<string>,
	): CommonspaceRouteResult["assignments"] {
		const rawAssignments = result.assignments;
		if (
			rawAssignments.length === 0 ||
			rawAssignments.length > prepared.input.maxAgents
		) {
			throw new Error("inference routing returned an invalid assignment count");
		}
		const assignments: CommonspaceRouteResult["assignments"] = [];
		const assignedAgents = new Set<string>();
		for (const assignment of rawAssignments) {
			if (
				!allowedAgentIds.has(assignment.agentId) ||
				assignedAgents.has(assignment.agentId)
			) {
				throw new Error("inference routing returned an invalid assignment");
			}
			const projectIds = [...new Set(assignment.projectIds)];
			if (
				prepared.input.fixedAgentIds !== undefined &&
				!sameIdentifierSet(
					projectIds,
					prepared.projects.map((project) => project.id),
				)
			) {
				throw new Error("inference routing must retain explicit Project scope");
			}
			if (projectIds.some((projectId) => !allowedProjectIds.has(projectId))) {
				throw new Error("inference routing returned an invalid assignment");
			}
			assignedAgents.add(assignment.agentId);
			assignments.push({ agentId: assignment.agentId, projectIds });
		}
		return assignments;
	}

	private validateChannelRouteResult(
		result: CommonspaceRouteResult,
		prepared: PreparedChannelRoute,
	): CommonspaceRouteResult {
		const assignments = this.validatedRouteAssignments(
			result,
			prepared,
			this.currentAllowedRouteAgentIds(prepared),
			this.currentAllowedRouteProjectIds(prepared),
		);
		const agentIds = assignments.map((assignment) => assignment.agentId);
		if (
			prepared.input.fixedAgentIds !== undefined &&
			!sameIdentifierSet(prepared.input.fixedAgentIds, agentIds)
		) {
			throw new Error(
				"inference routing must retain every explicitly addressed Agent exactly once",
			);
		}
		const reason = result.reason.normalize("NFKC").trim().slice(0, 500);
		if (reason === "")
			throw new Error("inference routing returned no valid decision");
		const confidence =
			typeof result.confidence === "number" &&
			Number.isFinite(result.confidence)
				? Math.max(0, Math.min(1, result.confidence))
				: undefined;
		const routeResult: CommonspaceRouteResult = {
			assignments,
			mode: result.mode,
			reason,
		};
		if (result.source !== undefined) routeResult.source = result.source;
		if (confidence !== undefined) routeResult.confidence = confidence;
		return routeResult;
	}

	private async routeChannelMessage(
		send: Pick<
			PreparedSend,
			| "text"
			| "request"
			| "agents"
			| "inferProjects"
			| "routing"
			| "channel"
			| "thread"
			| "projectScopeExplicit"
		>,
		thread: CommonspaceThread | undefined,
		memberIds: readonly string[],
	): Promise<CommonspaceRouteResult> {
		let prepared = this.prepareChannelRoute(send, thread, memberIds);
		const correctionCountAtPreparation = activeRoutingCorrectionCount(
			this.state,
			prepared.channelId,
		);
		try {
			const threadBrief = send.thread?.context.memory;
			const channelBrief = send.channel?.memory;
			const brief =
				threadBrief?.status === "current" && threadBrief.summary !== ""
					? threadBrief
					: channelBrief;
			if (
				this.overrides.classifyRouting !== undefined &&
				!(
					!send.projectScopeExplicit &&
					!send.inferProjects &&
					prepared.input.projects.length > 0
				)
			) {
				let local: CommonspaceRouteResult | null = null;
				try {
					local = await routeLocally(
						{
							...prepared.input,
							context:
								correctionCountAtPreparation === 0 &&
								(brief?.status === "current" || brief?.status === "empty")
									? brief.summary === ""
										? []
										: [brief.summary]
									: null,
						},
						this.overrides.classifyRouting,
						this.inferenceShutdown.signal,
					);
				} catch {
					this.inferenceShutdown.signal.throwIfAborted();
					this.environment.logger?.warn(
						"Local classification unavailable; using the configured inference router.",
					);
				}
				if (
					local !== null &&
					activeRoutingCorrectionCount(this.state, prepared.channelId) ===
						correctionCountAtPreparation
				)
					return this.validateChannelRouteResult(local, prepared);
			}
			if (
				activeRoutingCorrectionCount(this.state, prepared.channelId) !==
				correctionCountAtPreparation
			)
				prepared = this.prepareChannelRoute(send, thread, memberIds);
			const result =
				this.overrides.routeAgents === undefined
					? await this.routeAgents(prepared.channelId, prepared.input)
					: await this.overrides.routeAgents(prepared.input);
			return this.validateChannelRouteResult(result, prepared);
		} catch (error) {
			this.environment.logger?.warn(error);
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(
				this.redactHostDetails(`inference routing failed: ${detail}`, 500),
				{ cause: error },
			);
		}
	}

	private followupScopeKey(
		conversation: SendMessageRequest["conversation"],
		threadId?: string,
	): string {
		return `${conversation.kind}:${conversation.id}\u0000${threadId ?? ""}`;
	}

	private startConversationRun(
		scopeKey: string,
		initial: PendingFollowup,
	): void {
		const operation = (async () => {
			let current: PendingFollowup | undefined = initial;
			while (current !== undefined && !this.closing) {
				const followup = current;
				await context.with(followup.telemetryContext, () =>
					this.processReplies(followup.prepared, followup.response),
				);
				const queue = this.pendingFollowups.get(scopeKey);
				current = queue?.shift();
				if (queue?.length === 0) this.pendingFollowups.delete(scopeKey);
				this.broadcastLiveActivities();
			}
		})();
		this.activeConversationRuns.set(scopeKey, operation);
		this.backgroundRuns.add(operation);
		void operation
			.finally(() => {
				this.activeConversationRuns.delete(scopeKey);
				this.backgroundRuns.delete(operation);
				this.broadcastLiveActivities();
			})
			.catch((error) => {
				this.environment.logger?.warn(error);
			});
	}

	private takePendingRunInvalidations(
		invalidation: AgentRunInvalidation,
	): PendingRunInvalidations {
		const agentRuns: ActiveAgentRun[] = [];
		const routingFollowups: PendingFollowup[] = [];
		let queueChanged = false;
		for (const [scopeKey, queue] of this.pendingFollowups) {
			const retained: PendingFollowup[] = [];
			for (const item of queue) {
				const result = pendingFollowupInvalidation(
					scopeKey,
					item,
					invalidation,
				);
				agentRuns.push(...result.runs);
				if (result.interruptRouting) routingFollowups.push(item);
				if (result.removeFollowup) queueChanged = true;
				else retained.push(item);
			}
			if (retained.length === 0) this.pendingFollowups.delete(scopeKey);
			else if (retained.length !== queue.length)
				this.pendingFollowups.set(scopeKey, retained);
		}
		if (queueChanged) this.broadcastLiveActivities();
		return { agentRuns, routingFollowups };
	}

	private recordPendingRoutingInterruption(
		item: PendingFollowup,
		reason: string,
	): boolean {
		const key = conversationKey(item.prepared.request.conversation);
		let changed = false;
		const messages = (this.state.messages[key] ?? []).map((message) => {
			if (
				message.id !== item.response.accepted.id ||
				message.routing?.status !== "pending"
			) {
				return message;
			}
			changed = true;
			const routing = failedRoutingDecision(
				message.routing,
				message.routing.startedAt ?? message.createdAt,
				reason,
			);
			return {
				...message,
				routing,
				replyStatus: "failed" as const,
				replyError: reason,
			};
		});
		if (!changed) return false;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: { ...this.state.messages, [key]: messages },
		};
		return true;
	}

	private async recordPendingRunInvalidations(
		invalidation: AgentRunInvalidation,
		reason: string,
	): Promise<void> {
		const invalidated = this.takePendingRunInvalidations(invalidation);
		await Promise.all(
			invalidated.agentRuns.map((run) =>
				this.recordInterruptedAgentRun(run, reason),
			),
		);
		let routingChanged = false;
		for (const item of invalidated.routingFollowups) {
			routingChanged =
				this.recordPendingRoutingInterruption(item, reason) || routingChanged;
		}
		if (!routingChanged) return;
		await this.persist();
		this.broadcastRevision();
	}

	private async interruptAgentRuns(
		runs: readonly ActiveAgentRun[],
		reason: string,
	): Promise<void> {
		const sessions = new Map<string, ActiveAcpSession>();
		const running = runs.filter((run) => run.phase === "running");
		for (const run of running) {
			run.abortController.abort(new Error(reason));
			const session = this.activeAcpSessions.get(run.scopeKey);
			if (session !== undefined) sessions.set(run.scopeKey, session);
		}
		await Promise.all(
			running.map((run) => this.recordInterruptedAgentRun(run, reason)),
		);
		await Promise.all(
			[...sessions.values()].map((session) =>
				this.acpProcesses
					.get(session.processScopeKey)
					?.cancelSession(session.sessionId),
			),
		);
	}

	private async abortConversationRuns(
		conversation: SendMessageRequest["conversation"],
		threadId: string | undefined,
		reason: string,
	): Promise<void> {
		const activities = [...this.liveActivitiesById.values()].filter(
			(activity) =>
				activity.conversation.kind === conversation.kind &&
				activity.conversation.id === conversation.id &&
				activity.threadId === threadId,
		);
		const runIds = new Set(activities.map((activity) => activity.id));
		const runs = [...this.activeAgentRuns.values()].filter(
			(run) => runIds.has(run.id) && !run.abortController.signal.aborted,
		);
		await this.interruptAgentRuns(runs, reason);
		const sourceMessageIds = new Set(
			activities.map((activity) => activity.sourceMessageId),
		);
		let changed = false;
		for (const sourceMessageId of sourceMessageIds) {
			changed =
				this.updateMessageReplyStatus(
					conversation,
					sourceMessageId,
					"cancelled",
					reason,
				) || changed;
		}
		if (changed) {
			await this.persist();
			this.broadcastRevision();
		}
	}

	private async persistSendAttachments(prepared: PreparedSend): Promise<void> {
		await this.persistImageAttachments(prepared.attachments);
		try {
			await this.persistFileAttachments(prepared.files);
		} catch (error) {
			await this.removeImageAttachments(
				prepared.attachments.map((attachment) => attachment.metadata.id),
			);
			throw error;
		}
	}

	private createAcceptedThread(
		prepared: PreparedSend,
		acceptedId: string,
		createdAt: string,
	): CommonspaceThread | undefined {
		if (
			prepared.request.conversation.kind !== "channel" ||
			prepared.thread !== undefined
		) {
			return prepared.thread;
		}
		const thread: CommonspaceThread = {
			id: crypto.randomUUID(),
			channelId: prepared.request.conversation.id,
			projectIds: prepared.projects.map((project) => project.id),
			projectId: prepared.project?.id ?? null,
			rootMessageId: acceptedId,
			agentIds: prepared.agentIds,
			context:
				prepared.branch === undefined
					? createThreadContext(
							prepared.channel?.memory ?? emptyChannelMemory(),
							createdAt,
						)
					: {
							channelSnapshot: prepared.branch.channelSnapshot,
							memory: emptyThreadMemory(),
						},
			createdAt,
		};
		if (prepared.branch !== undefined) {
			thread.branchedFromThreadId = prepared.branch.branchedFromThreadId;
			thread.branchPointMessageId = prepared.branch.branchPointMessageId;
		}
		return thread;
	}

	private createAcceptedMessage(
		prepared: PreparedSend,
		thread: CommonspaceThread | undefined,
		acceptedId: string,
		createdAt: string,
	): CommonspaceMessage {
		const accepted: CommonspaceMessage = {
			id: acceptedId,
			conversation: prepared.request.conversation,
			authorType: "user",
			authorId: "user",
			authorName: "Ralph",
			text: prepared.text,
			createdAt,
			...projectReferenceFields(prepared.projects),
		};
		if (prepared.version !== undefined) {
			if (prepared.version.versionRootMessageId !== undefined)
				accepted.versionRootMessageId = prepared.version.versionRootMessageId;
			if (prepared.version.supersedesMessageId !== undefined)
				accepted.supersedesMessageId = prepared.version.supersedesMessageId;
			if (prepared.version.branchId !== undefined)
				accepted.branchId = prepared.version.branchId;
		}
		if (prepared.routing !== undefined) accepted.routing = prepared.routing;
		if (prepared.attachments.length > 0)
			accepted.attachments = prepared.attachments.map(
				(attachment) => attachment.metadata,
			);
		if (prepared.files.length > 0)
			accepted.files = prepared.files.map((file) => file.metadata);
		if (thread !== undefined) accepted.threadId = thread.id;
		if (prepared.thread !== undefined)
			accepted.parentMessageId = prepared.thread.rootMessageId;
		if (prepared.request.conversation.kind === "dm")
			accepted.replyStatus = "queued";
		return accepted;
	}

	private appendAcceptedSendState(
		prepared: PreparedSend,
		accepted: CommonspaceMessage,
		thread: CommonspaceThread | undefined,
	): void {
		const key = conversationKey(prepared.request.conversation);
		const currentMessages = this.state.messages[key] ?? [];
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			channels:
				prepared.channel === undefined
					? this.state.channels
					: this.state.channels.map((existing) =>
							existing.id === prepared.channel?.id
								? { ...existing, agentIds: prepared.channel.agentIds }
								: existing,
						),
			messages: {
				...this.state.messages,
				[key]: [...currentMessages, accepted],
			},
			threads:
				prepared.thread === undefined && thread !== undefined
					? [...this.state.threads, thread]
					: this.state.threads.map((existing) => {
							if (existing.id !== thread?.id) return existing;
							const updated: CommonspaceThread = {
								...existing,
								agentIds: prepared.thread?.agentIds ?? existing.agentIds,
								projectIds:
									prepared.thread?.projectIds ?? referencedProjectIds(existing),
								projectId:
									prepared.thread === undefined
										? existing.projectId
										: prepared.thread.projectId,
							};
							return updated;
						}),
		};
	}

	private refreshAcceptedChannelMemory(prepared: PreparedSend): void {
		if (prepared.channel === undefined) return;
		const projection = projectChannelMemory(
			this.state,
			prepared.channel.id,
			this.state.defaults.memoryThreads,
		);
		this.state = {
			...this.state,
			channels: this.state.channels.map((channel) =>
				channel.id === prepared.channel?.id
					? {
							...channel,
							memory: mergeChannelMemoryProjection(channel.memory, projection),
						}
					: channel,
			),
		};
		if (prepared.version?.supersedesMessageId !== undefined)
			this.refreshActiveRoutingMemory(prepared.channel.id);
	}

	private refreshAcceptedThreadMemory(
		thread: CommonspaceThread | undefined,
	): CommonspaceThread | undefined {
		if (thread === undefined) return undefined;
		const storedThread = this.state.threads.find(
			(candidate) => candidate.id === thread.id,
		);
		if (storedThread === undefined) return thread;
		const updatedThread: CommonspaceThread = {
			...storedThread,
			context: {
				...storedThread.context,
				memory: mergeThreadMemoryProjection(
					storedThread.context.memory,
					projectThreadMemory(this.state, storedThread.id),
				),
			},
		};
		this.state = {
			...this.state,
			threads: this.state.threads.map((candidate) =>
				candidate.id === updatedThread.id ? updatedThread : candidate,
			),
		};
		return updatedThread;
	}

	private applyAcceptedSendState(
		prepared: PreparedSend,
		accepted: CommonspaceMessage,
		thread: CommonspaceThread | undefined,
	): CommonspaceThread | undefined {
		this.appendAcceptedSendState(prepared, accepted, thread);
		this.refreshAcceptedChannelMemory(prepared);
		return this.refreshAcceptedThreadMemory(thread);
	}

	private async persistAcceptedSend(
		prepared: PreparedSend,
		previousState: CommonspaceState,
	): Promise<void> {
		try {
			await this.persist("acceptance");
		} catch (error) {
			this.state = previousState;
			await this.removePersistedSendAttachments(prepared);
			throw error;
		}
	}

	private async removePersistedSendAttachments(
		prepared: PreparedSend,
	): Promise<void> {
		await Promise.all([
			this.removeImageAttachments(
				prepared.attachments.map((attachment) => attachment.metadata.id),
			),
			this.removeFileAttachments(
				prepared.files.map((file) => file.metadata.id),
			),
		]);
	}

	private acceptedSendResponse(
		accepted: CommonspaceMessage,
		thread: CommonspaceThread | undefined,
	): SendMessageResponse {
		const snapshotStartedAt = this.performancePhaseStartedAt();
		const state = this.publicSnapshot();
		this.recordPerformanceMeasurement(
			CommonspaceHostPerformancePhase.AcceptanceResponseSnapshot,
			snapshotStartedAt,
		);
		const response: SendMessageResponse = { accepted, state };
		if (thread !== undefined) response.thread = thread;
		return response;
	}

	private async acceptSend(
		prepared: PreparedSend,
	): Promise<SendMessageResponse> {
		if (!this.preparedSendIsCurrent(prepared, prepared.thread)) {
			throw new Error("conversation changed before message acceptance");
		}
		await this.persistSendAttachments(prepared);
		try {
			await this.overrides.afterPersistSendAttachments?.(prepared);
			if (!this.preparedSendIsCurrent(prepared, prepared.thread)) {
				throw new Error("conversation changed before message acceptance");
			}
		} catch (error) {
			await this.removePersistedSendAttachments(prepared);
			throw error;
		}
		const previousState = this.state;
		const mutationStartedAt = this.performancePhaseStartedAt();
		const createdAt = now();
		const acceptedId = messageId();
		let thread = this.createAcceptedThread(prepared, acceptedId, createdAt);
		const accepted = this.createAcceptedMessage(
			prepared,
			thread,
			acceptedId,
			createdAt,
		);
		thread = this.applyAcceptedSendState(prepared, accepted, thread);
		this.recordPerformanceMeasurement(
			CommonspaceHostPerformancePhase.AcceptanceStateMutation,
			mutationStartedAt,
		);
		await this.persistAcceptedSend(prepared, previousState);
		this.broadcastRevision();
		return this.acceptedSendResponse(accepted, thread);
	}

	private async markDirectMessageRunStarted(
		execution: AgentRunExecutionContext,
	): Promise<void> {
		const conversation = execution.prepared.request.conversation;
		if (
			conversation.kind !== "dm" ||
			!this.updateMessageReplyStatus(
				conversation,
				execution.run.sourceMessageId,
				"running",
			)
		)
			return;
		await this.persist();
		this.broadcastRevision();
	}

	private agentRunInput(
		input: AgentSessionRunInput,
		liveActivityId: string,
		executionIsCurrent: () => boolean,
	): AgentRunInput {
		const { execution, projectRoots } = input;
		const { agent, prepared, thread } = execution;
		const runInput: AgentRunInput = {
			agent,
			cwd: input.cwd,
			additionalCwds: projectRoots.slice(1).map((root) => root.path),
			sessionName: input.sessionName,
			message: input.delivery.text,
			commonspaceScope: commonspaceScopeForAgentRun(input),
			onTraceUpdate: (entries) => {
				if (executionIsCurrent())
					this.updateLiveActivity(liveActivityId, entries);
			},
			onPermissionRequest: (request) =>
				this.requestAgentPermission(
					execution.run,
					prepared.request.conversation,
					thread,
					request,
				),
			signal: execution.run.abortController.signal,
		};
		if (prepared.request.conversation.kind === "channel")
			runInput.participationContext =
				participationContextForAgentRun(execution);
		if (input.delivery.images !== undefined)
			runInput.images = input.delivery.images;
		if (input.delivery.files !== undefined)
			runInput.files = input.delivery.files;
		if (input.sessionId !== undefined) runInput.sessionId = input.sessionId;
		return runInput;
	}

	private async runLockedAgentSession(
		input: AgentSessionRunInput,
	): Promise<AgentSessionRunResult | null> {
		const executionIsCurrent = () =>
			this.agentRunExecutionState(input.execution).status === "current";
		if (!executionIsCurrent()) return null;
		const liveActivityId = this.beginLiveActivity(input.execution);
		try {
			await this.markDirectMessageRunStarted(input.execution);
			const startedAt = now();
			const snapshots = await Promise.all(
				input.projectRoots.map(async (root) => ({
					...root,
					snapshot: await captureRunSnapshot(root.path),
				})),
			);
			const runInput = this.agentRunInput(
				input,
				liveActivityId,
				executionIsCurrent,
			);
			const activeRun = input.execution.run;
			this.executingAgentRunsByScope.set(activeRun.scopeKey, activeRun);
			try {
				const response = await this.runAgentWithSessionRecovery(
					runInput,
					executionIsCurrent,
				);
				return response === null ? null : { response, startedAt, snapshots };
			} finally {
				if (
					this.executingAgentRunsByScope.get(activeRun.scopeKey) === activeRun
				)
					this.executingAgentRunsByScope.delete(activeRun.scopeKey);
			}
		} finally {
			this.endLiveActivity(liveActivityId);
		}
	}

	private replyDeliverySession(
		prepared: PreparedSend,
		response: SendMessageResponse,
	): ReplyDeliverySession {
		const effectiveLimit =
			prepared.routing?.source === "explicit"
				? Math.max(
						this.state.defaults.maxAgentsPerTurn,
						prepared.agentIds.length,
					)
				: this.state.defaults.maxAgentsPerTurn;
		const routingAssignments = prepared.routing?.assignments ?? [];
		const relayMode = prepared.routing?.mode === "relay";
		return {
			prepared,
			response,
			thread: response.thread,
			effectiveLimit,
			memberIds:
				prepared.channel?.agentIds ??
				response.thread?.agentIds ??
				prepared.agentIds,
			delivered: new Set(),
			routingAssignments,
			relayMode,
			remainingRelayAssignments: relayMode ? routingAssignments.slice(1) : [],
			relayEdges: new Set(),
			deliveredTurns: 0,
			maxRelayTurns: effectiveLimit,
			relayStopRecorded: false,
		};
	}

	private rootAgentDelivery(session: ReplyDeliverySession): AgentDelivery {
		const { prepared, response } = session;
		const delivery: AgentDelivery = {
			authorType: "user",
			authorId: response.accepted.authorId,
			authorName: response.accepted.authorName,
			text: response.accepted.text,
			projectIds: prepared.projects.map((project) => project.id),
		};
		if (prepared.attachments.length > 0)
			delivery.images = prepared.attachments.map((attachment) => ({
				name: attachment.metadata.name,
				mimeType: attachment.metadata.mimeType,
				data: attachment.data.toString("base64"),
			}));
		if (prepared.files.length > 0)
			delivery.files = prepared.files.map((file) => ({
				name: file.metadata.name,
				mimeType: file.metadata.mimeType,
				size: file.metadata.size,
				uri: pathToFileURL(join(this.attachmentsRoot, file.metadata.id)).href,
			}));
		return delivery;
	}

	private mentionForAgentId(
		session: ReplyDeliverySession,
		agentId: string,
	): string {
		const agent = session.prepared.agents.find(
			(candidate) => candidate.id === agentId,
		);
		return `@${agent === undefined ? agentId : agentMentionName(agent)}`;
	}

	private async recordRelayStop(
		session: ReplyDeliverySession,
		text: string,
	): Promise<void> {
		if (session.relayStopRecorded) return;
		session.relayStopRecorded = true;
		const { prepared, response, thread } = session;
		const stop: CommonspaceMessage = {
			id: messageId(),
			sourceMessageId: response.accepted.id,
			conversation: prepared.request.conversation,
			authorType: "system",
			authorId: "system",
			authorName: "Commonspace",
			text,
			createdAt: now(),
			...projectReferenceFields(prepared.projects),
		};
		if (thread !== undefined) {
			stop.threadId = thread.id;
			stop.parentMessageId = thread.rootMessageId;
		}
		this.append(stop);
		await this.persist();
		this.broadcastRevision();
	}

	private async ensureAgentThreadMembership(
		execution: AgentRunExecutionContext,
	): Promise<void> {
		const { agent, thread } = execution;
		if (thread === undefined) return;
		const currentThread = this.state.threads.find(
			(candidate) => candidate.id === thread.id,
		);
		if (
			currentThread === undefined ||
			currentThread.agentIds.includes(agent.id)
		)
			return;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			threads: this.state.threads.map((candidate) =>
				candidate.id === currentThread.id
					? {
							...currentThread,
							agentIds: [...currentThread.agentIds, agent.id],
						}
					: candidate,
			),
		};
		await this.persist();
		this.broadcastRevision();
	}

	private async recordAgentRunFailure(
		message: string,
		execution: AgentRunExecutionContext,
		delivery: AgentDelivery,
		deliveryProjects: readonly CommonspaceState["projects"][number][],
	): Promise<void> {
		const { run, agent, prepared, thread } = execution;
		if (prepared.request.conversation.kind === "dm") {
			const status = /timed? out|timeout/iu.test(message)
				? "timeout"
				: "failed";
			this.updateMessageReplyStatus(
				prepared.request.conversation,
				run.sourceMessageId,
				status,
				message,
			);
		}
		const failure: CommonspaceMessage = {
			id: messageId(),
			sourceMessageId: run.sourceMessageId,
			conversation: prepared.request.conversation,
			authorType: "system",
			authorId: "system",
			authorName: "Commonspace",
			text: `@${agent.id} run failed: ${message}`,
			createdAt: now(),
			...projectReferenceFields(deliveryProjects),
		};
		if (delivery.routingAssignmentId !== undefined)
			failure.routingAssignmentId = delivery.routingAssignmentId;
		if (thread !== undefined) {
			failure.threadId = thread.id;
			failure.parentMessageId = thread.rootMessageId;
		}
		this.append(failure);
		run.phase = "terminal";
		await this.persist();
		this.broadcastRevision();
	}

	private async agentRunAttribution(
		sessionRun: AgentSessionRunResult,
		deliveryProjects: readonly CommonspaceState["projects"][number][],
		completedAt: string,
	): Promise<CommonspaceRunAttribution | undefined> {
		if (deliveryProjects.length === 0) return undefined;
		return {
			startedAt: sessionRun.startedAt,
			completedAt,
			roots: await Promise.all(
				sessionRun.snapshots.map(
					async ({
						path,
						snapshot,
						rootIndex,
						projectId,
						projectRootIndex,
					}) => ({
						...(await completeRunAttribution(path, snapshot, rootIndex)),
						projectId,
						projectRootIndex,
					}),
				),
			),
		};
	}

	private async persistAgentResponseFiles(
		response: AgentRunResult,
		projectRoots: readonly PreparedProjectRoot[],
	): Promise<PreparedFileAttachment[]> {
		try {
			const files = await prepareAgentFileAttachments(
				response.files,
				projectRoots.length === 0
					? [this.defaultCwd]
					: projectRoots.map((root) => root.path),
				() => {
					this.environment.logger?.warn(
						"Commonspace ignored invalid Agent file.",
					);
				},
			);
			await this.persistFileAttachments(files);
			return files;
		} catch (error) {
			this.environment.logger?.warn(
				`Commonspace could not persist Agent files: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	private async recordInterruptedExecution(
		execution: AgentRunExecutionContext,
	): Promise<void> {
		const state = this.agentRunExecutionState(execution);
		if (state.status !== "interrupted") return;
		await this.recordInterruptedAgentRun(execution.run, state.reason);
	}

	private async completeAgentReply({
		execution,
		delivery,
		deliveryProjects,
		projectRoots,
		sessionName,
		sessionRun,
		requestedHandoff,
	}: AgentReplyCompletionInput): Promise<CompletedAgentReply | null> {
		const { run, agent, prepared, thread } = execution;
		const requestedHandoffTarget =
			requestedHandoff === undefined
				? undefined
				: prepared.agents.find(
						(candidate) => candidate.id === requestedHandoff.targetAgentId,
					);
		const agentResponse = sessionRun.response;
		const trace =
			agentResponse.trace === undefined
				? undefined
				: this.publicAgentTrace(agentResponse.trace, agent.adapter);
		const completedAt = now();
		const runAttribution = await this.agentRunAttribution(
			sessionRun,
			deliveryProjects,
			completedAt,
		);
		const agentFiles = await this.persistAgentResponseFiles(
			agentResponse,
			projectRoots,
		);
		if (this.agentRunExecutionState(execution).status !== "current") {
			await this.removeFileAttachments(
				agentFiles.map((file) => file.metadata.id),
			);
			await this.recordInterruptedExecution(execution);
			return null;
		}
		if (agentResponse.sessionId !== undefined)
			this.rememberAgentSession(agent.id, sessionName, agentResponse.sessionId);
		if (prepared.request.conversation.kind === "dm") {
			const status = completedReplyStatus(agentResponse.text);
			this.updateMessageReplyStatus(
				prepared.request.conversation,
				run.sourceMessageId,
				status,
				status === "silent"
					? "The agent completed without returning a visible response."
					: undefined,
			);
		}
		const key = conversationKey(prepared.request.conversation);
		const text =
			requestedHandoff === undefined || requestedHandoffTarget === undefined
				? agentResponse.text
				: `${agentResponse.text}\n\n@${agentMentionName(requestedHandoffTarget)} ${requestedHandoff.request}`;
		const normalizedResponse = text.normalize("NFKC").trim();
		const duplicateProgress = this.state.messages[key]?.findLast(
			(message) =>
				run.progressMessageIds.has(message.id) &&
				message.text === normalizedResponse,
		);
		const reply: CommonspaceMessage = {
			...duplicateProgress,
			id: duplicateProgress?.id ?? messageId(),
			sourceMessageId: run.sourceMessageId,
			conversation: prepared.request.conversation,
			authorType: "agent",
			authorId: agent.id,
			authorName: agent.displayName,
			text,
			createdAt: completedAt,
			...projectReferenceFields(deliveryProjects),
		};
		if (delivery.routingAssignmentId !== undefined)
			reply.routingAssignmentId = delivery.routingAssignmentId;
		if (agentFiles.length > 0)
			reply.files = agentFiles.map((file) => file.metadata);
		if (trace !== undefined) reply.trace = trace;
		if (runAttribution !== undefined) reply.runAttribution = runAttribution;
		if (thread !== undefined) {
			reply.threadId = thread.id;
			reply.parentMessageId = thread.rootMessageId;
		}
		if (duplicateProgress !== undefined) {
			this.state = {
				...this.state,
				messages: {
					...this.state.messages,
					[key]: (this.state.messages[key] ?? []).filter(
						(message) => message.id !== duplicateProgress.id,
					),
				},
			};
		}
		this.append(reply);
		run.phase = "terminal";
		await this.persist();
		this.broadcastRevision();
		return { reply, requestedHandoffTarget };
	}

	private async deliverRequestedHandoff({
		session,
		agent,
		reply,
		delivery,
		requestedHandoff: request,
		requestedHandoffTarget: target,
	}: RequestedReplyContinuationInput): Promise<void> {
		if (target === undefined) return;
		const plannedIndex = session.remainingRelayAssignments.findIndex(
			(assignment) => assignment.agentId === target.id,
		);
		const plannedAssignment =
			plannedIndex < 0
				? undefined
				: session.remainingRelayAssignments.splice(plannedIndex, 1)[0];
		const targetAssignment =
			plannedAssignment ??
			session.routingAssignments.find(
				(assignment) => assignment.agentId === target.id,
			);
		const handoffDelivery: AgentDelivery = {
			authorType: "agent",
			authorId: agent.id,
			authorName: agent.displayName,
			text: `From ${agent.displayName}:\n\n${request.request}`,
		};
		if (plannedAssignment !== undefined)
			handoffDelivery.text = `Original user message:\n\n${session.response.accepted.text}\n\nFrom ${agent.displayName}:\n\n${boundedRelayPeerResponse(reply.text)}\n\nPeer handoff request:\n\n${request.request}`;
		if (targetAssignment !== undefined) {
			handoffDelivery.projectIds = targetAssignment.projectIds;
			handoffDelivery.routingAssignmentId = targetAssignment.id;
		} else if (delivery.projectIds !== undefined) {
			handoffDelivery.projectIds = delivery.projectIds;
		}
		inheritDeliveryAttachments(delivery, handoffDelivery);
		await this.deliverAgentReply(session, target.id, handoffDelivery, {
			allowRepeat: true,
			edge: `${agent.id}\u0000${target.id}`,
		});
	}

	private async deliverRelayContinuation(
		session: ReplyDeliverySession,
		agent: CommonspaceAgentProfile,
		reply: CommonspaceMessage,
		delivery: AgentDelivery,
	): Promise<void> {
		const mentionedPeerId = finalHandoffAgent(
			session.memberIds,
			reply.text,
			session.prepared.agents,
		);
		const nextPeerId =
			mentionedPeerId === agent.id ? undefined : mentionedPeerId;
		const mentionedAssignmentIndex =
			nextPeerId === undefined
				? -1
				: session.remainingRelayAssignments.findIndex(
						(assignment) => assignment.agentId === nextPeerId,
					);
		const mentionedAssignment =
			mentionedAssignmentIndex < 0
				? undefined
				: session.remainingRelayAssignments.splice(
						mentionedAssignmentIndex,
						1,
					)[0];
		const next =
			nextPeerId === undefined
				? session.remainingRelayAssignments.shift()
				: mentionedAssignment;
		const nextAgentId = nextPeerId ?? next?.agentId;
		if (nextAgentId === undefined) return;
		const targetAssignment =
			next ??
			session.routingAssignments.find(
				(assignment) => assignment.agentId === nextAgentId,
			);
		const nextDelivery: AgentDelivery = {
			authorType: "agent",
			authorId: agent.id,
			authorName: agent.displayName,
			text: `Original user message:\n\n${session.response.accepted.text}\n\nFrom ${agent.displayName}:\n\n${boundedRelayPeerResponse(reply.text)}`,
		};
		if (targetAssignment !== undefined) {
			nextDelivery.projectIds = targetAssignment.projectIds;
			nextDelivery.routingAssignmentId = targetAssignment.id;
		} else if (delivery.projectIds !== undefined) {
			nextDelivery.projectIds = delivery.projectIds;
		}
		inheritDeliveryAttachments(delivery, nextDelivery);
		await this.deliverAgentReply(session, nextAgentId, nextDelivery, {
			allowRepeat: nextPeerId !== undefined,
			edge: `${agent.id}\u0000${nextAgentId}`,
		});
	}

	private async deliverMentionedHandoff(
		session: ReplyDeliverySession,
		agent: CommonspaceAgentProfile,
		reply: CommonspaceMessage,
		delivery: AgentDelivery,
	): Promise<void> {
		const mentionedPeerId = finalHandoffAgent(
			session.memberIds,
			reply.text,
			session.prepared.agents,
		);
		const targetAgentId =
			mentionedPeerId === agent.id ? undefined : mentionedPeerId;
		if (targetAgentId === undefined) return;
		const targetAssignment = session.routingAssignments.find(
			(assignment) => assignment.agentId === targetAgentId,
		);
		const handoff: AgentDelivery = {
			authorType: "agent",
			authorId: agent.id,
			authorName: agent.displayName,
			text: `From ${agent.displayName}:\n\n${boundedRelayPeerResponse(reply.text)}`,
		};
		if (targetAssignment !== undefined) {
			handoff.projectIds = targetAssignment.projectIds;
			handoff.routingAssignmentId = targetAssignment.id;
		} else if (delivery.projectIds !== undefined) {
			handoff.projectIds = delivery.projectIds;
		}
		inheritDeliveryAttachments(delivery, handoff);
		await this.deliverAgentReply(session, targetAgentId, handoff, {
			allowRepeat: true,
			edge: `${agent.id}\u0000${targetAgentId}`,
		});
	}

	private async continueReplyDelivery(
		input: ReplyContinuationInput,
	): Promise<void> {
		const { session, agent, reply, delivery, requestedHandoff } = input;
		if (session.prepared.request.conversation.kind !== "channel") return;
		if (requestedHandoff !== undefined) {
			await this.deliverRequestedHandoff({ ...input, requestedHandoff });
			return;
		}
		if (session.relayMode) {
			await this.deliverRelayContinuation(session, agent, reply, delivery);
			return;
		}
		await this.deliverMentionedHandoff(session, agent, reply, delivery);
	}

	private async reserveAgentDelivery(
		session: ReplyDeliverySession,
		agentId: string,
		options: AgentDeliveryOptions,
	): Promise<boolean> {
		if (!options.allowRepeat && session.delivered.has(agentId)) return false;
		if (
			!session.relayMode &&
			!options.allowRepeat &&
			session.delivered.size >= session.effectiveLimit
		)
			return false;
		if (
			(session.relayMode || options.allowRepeat) &&
			session.deliveredTurns >= session.maxRelayTurns
		) {
			await this.recordRelayStop(
				session,
				`Commonspace stopped the agent relay after ${String(session.maxRelayTurns)} turns to prevent a loop.`,
			);
			return false;
		}
		if (options.edge !== undefined) {
			if (session.relayEdges.has(options.edge)) {
				const [fromAgentId = "agent", toAgentId = agentId] =
					options.edge.split("\u0000");
				await this.recordRelayStop(
					session,
					`Commonspace stopped the ${this.mentionForAgentId(session, fromAgentId)} to ${this.mentionForAgentId(session, toAgentId)} handoff because that relay edge already ran.`,
				);
				return false;
			}
			session.relayEdges.add(options.edge);
		}
		session.delivered.add(agentId);
		session.deliveredTurns += 1;
		return true;
	}

	private startAgentReplyRun(
		session: ReplyDeliverySession,
		agentId: string,
		delivery: AgentDelivery,
	): PreparedAgentReplyRun | undefined {
		const { prepared, response, thread } = session;
		const agent = prepared.agents.find((candidate) => candidate.id === agentId);
		if (agent === undefined) return undefined;
		const projectById = new Map(
			prepared.projects.map((project) => [project.id, project]),
		);
		const deliveryProjects = (
			delivery.projectIds ?? prepared.projects.map((project) => project.id)
		).flatMap((projectId) => projectById.get(projectId) ?? []);
		const projectRoots = preparedProjectRoots(deliveryProjects);
		const cwd = projectRoots[0]?.path ?? this.defaultCwd;
		const authority = this.agentAuthority(agent);
		const sessionName =
			prepared.request.conversation.kind === "dm"
				? (prepared.dmSessionName ?? "Bot Chat")
				: `Commonspace Thread: ${thread?.id ?? crypto.randomUUID()}`;
		const activeRun: ActiveAgentRun = {
			id: crypto.randomUUID(),
			sourceMessageId: response.accepted.id,
			agentId: agent.id,
			agentExecutionRevision:
				prepared.agentExecutionRevisions.get(agent.id) ?? -1,
			phase: "running",
			projectIds: deliveryProjects.map((project) => project.id),
			conversation: prepared.request.conversation,
			scopeKey: `${agent.id}\u0000${sessionName}`,
			progressMessageIds: new Set(),
			abortController: new AbortController(),
		};
		if (delivery.routingAssignmentId !== undefined)
			activeRun.routingAssignmentId = delivery.routingAssignmentId;
		this.activeAgentRuns.set(activeRun.id, activeRun);
		return {
			agent,
			deliveryProjects,
			projectRoots,
			cwd,
			sessionName,
			activeRun,
			execution: {
				run: activeRun,
				agent,
				authority,
				prepared,
				thread,
			},
		};
	}

	private async deliverAgentReply(
		session: ReplyDeliverySession,
		agentId: string,
		delivery: AgentDelivery,
		options: AgentDeliveryOptions = {},
	): Promise<void> {
		if (!(await this.reserveAgentDelivery(session, agentId, options))) return;
		const preparedRun = this.startAgentReplyRun(session, agentId, delivery);
		if (preparedRun === undefined) return;
		const {
			agent,
			deliveryProjects,
			projectRoots,
			cwd,
			sessionName,
			activeRun,
			execution,
		} = preparedRun;
		const executionIsCurrent = () =>
			this.agentRunExecutionState(execution).status === "current";
		let requestedHandoff: CommonspaceMcpHandoffRequest | undefined;
		let completed: CompletedAgentReply | null;
		try {
			if (!executionIsCurrent()) {
				await this.recordInterruptedExecution(execution);
				return;
			}
			await this.ensureAgentThreadMembership(execution);
			const sessionId = this.state.agentSessions[agent.id]?.[sessionName];
			let sessionRun: AgentSessionRunResult | null;
			try {
				sessionRun = await this.withAgentSessionLock(
					agent.id,
					sessionName,
					() =>
						this.runLockedAgentSession({
							execution,
							delivery,
							deliveryProjects,
							projectRoots,
							memberIds: session.memberIds,
							cwd,
							sessionName,
							sessionId,
						}),
				);
			} catch (error) {
				this.pendingAgentHandoffs.delete(activeRun.id);
				if (!executionIsCurrent()) {
					await this.recordInterruptedExecution(execution);
					return;
				}
				await this.recordAgentRunFailure(
					this.publicAgentFailure(error),
					execution,
					delivery,
					deliveryProjects,
				);
				return;
			}
			requestedHandoff = this.pendingAgentHandoffs.get(activeRun.id);
			this.pendingAgentHandoffs.delete(activeRun.id);
			if (sessionRun === null || !executionIsCurrent()) {
				await this.recordInterruptedExecution(execution);
				return;
			}
			completed = await this.completeAgentReply({
				execution,
				delivery,
				deliveryProjects,
				projectRoots,
				sessionName,
				sessionRun,
				requestedHandoff,
			});
		} finally {
			this.activeAgentRuns.delete(activeRun.id);
		}
		if (completed === null) return;
		await this.continueReplyDelivery({
			session,
			agent,
			reply: completed.reply,
			delivery,
			requestedHandoff,
			requestedHandoffTarget: completed.requestedHandoffTarget,
		});
	}

	private async processReplies(
		initialPrepared: PreparedSend,
		initialResponse: SendMessageResponse,
	): Promise<void> {
		const routed = await this.resolvePendingRouting(
			initialPrepared,
			initialResponse,
		);
		if (routed === null) return;
		const session = this.replyDeliverySession(routed.prepared, routed.response);
		const rootDelivery = this.rootAgentDelivery(session);
		const rootDeliveries = preparedAgentAssignments(session.prepared).map(
			(assignment) => ({
				agentId: assignment.agentId,
				delivery:
					assignment.routingAssignmentId === undefined
						? rootDelivery
						: {
								...rootDelivery,
								projectIds: assignment.projectIds,
								routingAssignmentId: assignment.routingAssignmentId,
							},
			}),
		);
		await Promise.all(
			(session.relayMode ? rootDeliveries.slice(0, 1) : rootDeliveries)
				.slice(0, session.effectiveLimit)
				.map(({ agentId, delivery }) =>
					this.deliverAgentReply(session, agentId, delivery),
				),
		);
		if (
			!this.closing &&
			session.thread !== undefined &&
			this.conversationIsCurrent(session.prepared, session.thread)
		) {
			this.scheduleContextRefresh(session.thread.id, session.thread.channelId);
		}
	}
	private currentPendingRoutingMessage(
		prepared: PreparedSend,
		response: SendMessageResponse,
	): CommonspaceMessage | undefined {
		const accepted = (
			this.state.messages[conversationKey(prepared.request.conversation)] ?? []
		).find((message) => message.id === response.accepted.id);
		if (
			accepted === undefined ||
			accepted.deletedAt !== undefined ||
			accepted.routing?.status !== "pending"
		) {
			return undefined;
		}
		return accepted;
	}

	private resolvedRoutingProjects(
		prepared: PreparedSend,
		assignments: readonly CommonspaceRoutingAssignment[],
	): ResolvedRoutingProjects {
		const inferredProjectIds = prepared.inferProjects
			? [...new Set(assignments.flatMap((assignment) => assignment.projectIds))]
			: [];
		const inferredProjects = inferredProjectIds.map((projectId) => {
			const project = this.state.projects.find(
				(candidate) => candidate.id === projectId,
			);
			if (project === undefined)
				throw new Error("inference routing returned an unknown Project");
			return project;
		});
		return {
			inferredProjectIds,
			projects: prepared.inferProjects ? inferredProjects : prepared.projects,
		};
	}

	private completedPendingRoutingDecision({
		prepared,
		response,
		decision,
		assignments,
		projects,
	}: PendingRoutingDecisionInput): CommonspaceRoutingDecision {
		const routing: CommonspaceRoutingDecision = {
			source:
				prepared.routing?.source === "explicit"
					? "explicit"
					: (decision.source ?? "ai"),
			status: "resolved",
			...completedRoutingTiming(
				prepared.routing?.startedAt ?? response.accepted.createdAt,
			),
			agentIds: assignments.map((assignment) => assignment.agentId),
			mode: decision.mode,
			assignments,
			corrections: [],
			inferredProjectIds: projects.inferredProjectIds,
			reason: decision.reason,
		};
		if (decision.confidence !== undefined)
			routing.confidence = decision.confidence;
		return routing;
	}

	private resolvedPendingRoutingThread(
		response: SendMessageResponse,
		routing: CommonspaceRoutingDecision,
		projects: CommonspaceState["projects"],
	): CommonspaceThread | undefined {
		const currentThread = this.state.threads.find(
			(thread) => thread.id === response.thread?.id,
		);
		if (response.thread !== undefined && currentThread === undefined)
			throw new Error("Thread was removed during routing");
		if (currentThread === undefined) return undefined;
		return {
			...currentThread,
			agentIds:
				routing.source === "explicit"
					? currentThread.agentIds
					: routing.agentIds,
			projectIds: projects.map((project) => project.id),
			projectId: projects[0]?.id ?? null,
		};
	}

	private prepareResolvedPendingRouting(
		prepared: PreparedSend,
		response: SendMessageResponse,
		decision: CommonspaceRouteResult,
	): ResolvedPendingRouting {
		const assignments: CommonspaceRoutingAssignment[] =
			decision.assignments.map((assignment) => ({
				id: crypto.randomUUID(),
				...assignment,
			}));
		const projects = this.resolvedRoutingProjects(prepared, assignments);
		const routing = this.completedPendingRoutingDecision({
			prepared,
			response,
			decision,
			assignments,
			projects,
		});
		if (
			routing.agentIds.some(
				(agentId) => !this.preparedAgentExecutionIsCurrent(prepared, agentId),
			)
		) {
			throw new Error(
				"Routing selected an Agent whose execution authority changed.",
			);
		}
		const thread = this.resolvedPendingRoutingThread(
			response,
			routing,
			projects.projects,
		);
		const accepted: CommonspaceMessage = {
			...response.accepted,
			...projectReferenceFields(projects.projects),
			routing,
		};
		const resolved: ResolvedPendingRouting = {
			routing,
			projects: projects.projects,
			accepted,
		};
		if (thread !== undefined) resolved.thread = thread;
		return resolved;
	}

	private async commitResolvedPendingRouting(
		prepared: PreparedSend,
		response: SendMessageResponse,
		resolved: ResolvedPendingRouting,
	): Promise<{ prepared: PreparedSend; response: SendMessageResponse }> {
		const key = conversationKey(prepared.request.conversation);
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: {
				...this.state.messages,
				[key]: (this.state.messages[key] ?? []).map((message) =>
					message.id === resolved.accepted.id ? resolved.accepted : message,
				),
			},
			threads:
				resolved.thread === undefined
					? this.state.threads
					: this.state.threads.map((existing) =>
							existing.id === resolved.thread?.id ? resolved.thread : existing,
						),
		};
		await this.persist();
		this.broadcastRevision();

		const nextPrepared: PreparedSend = {
			...prepared,
			agentIds: resolved.routing.agentIds,
			projects: resolved.projects,
			routing: resolved.routing,
		};
		const project = resolved.projects[0];
		if (project !== undefined) nextPrepared.project = project;
		if (resolved.thread !== undefined) nextPrepared.thread = resolved.thread;
		const nextResponse: SendMessageResponse = {
			...response,
			accepted: resolved.accepted,
			state: this.publicSnapshot(),
		};
		if (resolved.thread !== undefined) nextResponse.thread = resolved.thread;
		return { prepared: nextPrepared, response: nextResponse };
	}

	private async commitFailedPendingRouting(
		prepared: PreparedSend,
		response: SendMessageResponse,
		reason: string,
	): Promise<null> {
		const pending = this.currentPendingRoutingMessage(
			prepared,
			response,
		)?.routing;
		if (pending === undefined) return null;
		const routing = failedRoutingDecision(
			pending,
			pending.startedAt ?? response.accepted.createdAt,
			reason,
		);
		const key = conversationKey(prepared.request.conversation);
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: {
				...this.state.messages,
				[key]: (this.state.messages[key] ?? []).map((message) =>
					message.id === response.accepted.id
						? {
								...message,
								routing,
								replyStatus: "failed",
								replyError: routing.reason,
							}
						: message,
				),
			},
		};
		await this.persist();
		this.broadcastRevision();
		return null;
	}

	private async resolvePendingRouting(
		prepared: PreparedSend,
		response: SendMessageResponse,
	): Promise<{ prepared: PreparedSend; response: SendMessageResponse } | null> {
		if (
			prepared.routing?.status !== "pending" ||
			prepared.request.conversation.kind !== "channel"
		) {
			return { prepared, response };
		}
		try {
			const routingThread = this.state.threads.find(
				(thread) => thread.id === (prepared.thread ?? response.thread)?.id,
			);
			const memberIds =
				prepared.routing.source === "explicit"
					? prepared.routing.agentIds
					: prepared.thread !== undefined && prepared.thread.agentIds.length > 0
						? prepared.thread.agentIds
						: (prepared.channel?.agentIds ?? []);
			const decision = await this.routeChannelMessage(
				prepared,
				routingThread,
				memberIds,
			);
			if (this.currentPendingRoutingMessage(prepared, response) === undefined)
				return null;
			const resolved = this.prepareResolvedPendingRouting(
				prepared,
				response,
				decision,
			);
			return await this.commitResolvedPendingRouting(
				prepared,
				response,
				resolved,
			);
		} catch (error) {
			const reason =
				error instanceof Error ? error.message : "Inference routing failed.";
			return this.commitFailedPendingRouting(prepared, response, reason);
		}
	}

	private agentAuthority(
		agent: CommonspaceAgentProfile,
	): CommonspaceAgentDefinition | undefined {
		return this.state.agents.find(
			(candidate) =>
				candidate.id === agent.id && candidate.adapter === agent.adapter,
		);
	}

	private preparedAgentExecutionIsCurrent(
		prepared: PreparedSend,
		agentId: string,
	): boolean {
		const agent = prepared.agents.find((candidate) => candidate.id === agentId);
		return (
			agent !== undefined &&
			prepared.agentExecutionRevisions.get(agentId) ===
				this.agentExecutionRevision(agentId) &&
			this.agentAuthorityIsCurrent(agent, this.agentAuthority(agent))
		);
	}

	private agentExecutionRevision(agentId: string): number {
		return this.agentExecutionRevisions.get(agentId) ?? 0;
	}

	private invalidateAgentExecution(agentId: string): void {
		this.agentExecutionRevisions.set(
			agentId,
			this.agentExecutionRevision(agentId) + 1,
		);
	}

	private agentRunExecutionState({
		run,
		agent,
		authority,
		prepared,
		thread,
	}: AgentRunExecutionContext): RunExecutionState {
		if (this.closing) return { status: "closing" };
		if (run.abortController.signal.aborted) {
			const cause = run.abortController.signal.reason;
			return {
				status: "interrupted",
				reason:
					cause instanceof Error
						? this.publicAgentFailure(cause)
						: "The Agent run was interrupted.",
			};
		}
		if (
			run.agentExecutionRevision !== this.agentExecutionRevision(agent.id) ||
			!this.agentAuthorityIsCurrent(agent, authority)
		) {
			return {
				status: "interrupted",
				reason:
					"Interrupted because the Agent was removed or its execution permissions changed.",
			};
		}
		if (
			!run.projectIds.every((projectId) =>
				this.state.projects.some((project) => project.id === projectId),
			)
		) {
			return {
				status: "interrupted",
				reason: "Interrupted because a Project used by this run was removed.",
			};
		}
		if (!this.conversationIsCurrent(prepared, thread)) {
			return {
				status: "interrupted",
				reason: "Interrupted because the conversation changed.",
			};
		}
		return { status: "current" };
	}

	private async recordInterruptedAgentRun(
		run: ActiveAgentRun,
		reason: string,
	): Promise<void> {
		if (run.phase === "terminal") return;
		const key = conversationKey(run.conversation);
		const source = this.state.messages[key]?.find(
			(message) => message.id === run.sourceMessageId,
		);
		if (source === undefined) {
			run.phase = "terminal";
			return;
		}
		if (run.conversation.kind === "dm") {
			if (
				source.replyStatus !== "queued" &&
				source.replyStatus !== "running" &&
				source.replyStatus !== "needs_input"
			)
				return;
			this.updateMessageReplyStatus(
				run.conversation,
				run.sourceMessageId,
				"cancelled",
				reason,
			);
			run.phase = "terminal";
		} else {
			const existingFailure = this.state.messages[key]?.some(
				(message) =>
					message.authorType === "system" &&
					message.sourceMessageId === run.sourceMessageId &&
					(run.routingAssignmentId !== undefined
						? message.routingAssignmentId === run.routingAssignmentId
						: message.text.startsWith(`@${run.agentId} run failed:`)),
			);
			if (existingFailure === true) {
				run.phase = "terminal";
				return;
			}
			const failure: CommonspaceMessage = {
				id: messageId(),
				sourceMessageId: run.sourceMessageId,
				conversation: run.conversation,
				authorType: "system",
				authorId: "system",
				authorName: "Commonspace",
				text: `@${run.agentId} run failed: ${reason}`,
				createdAt: now(),
			};
			const sourceProjectIds = referencedProjectIds(source);
			const primaryProjectId = sourceProjectIds[0];
			if (primaryProjectId !== undefined) {
				failure.projectIds = sourceProjectIds;
				failure.projectId = primaryProjectId;
			}
			if (run.routingAssignmentId !== undefined)
				failure.routingAssignmentId = run.routingAssignmentId;
			const currentThread = this.state.threads.find(
				(candidate) => candidate.id === source.threadId,
			);
			if (currentThread !== undefined) {
				failure.threadId = currentThread.id;
				failure.parentMessageId = currentThread.rootMessageId;
			}
			this.append(failure);
			run.phase = "terminal";
		}
		await this.persist();
		this.broadcastRevision();
	}

	private conversationIsCurrent(
		prepared: PreparedSend,
		thread: CommonspaceThread | undefined,
	): boolean {
		if (prepared.request.conversation.kind === "dm") {
			return (
				(this.state.dmSessions[prepared.request.conversation.id] ??
					"Bot Chat") === (prepared.dmSessionName ?? "Bot Chat")
			);
		}
		if (
			!this.state.channels.some(
				(channel) => channel.id === prepared.request.conversation.id,
			)
		)
			return false;
		return (
			thread === undefined ||
			this.state.threads.some((candidate) => candidate.id === thread.id)
		);
	}

	private preparedProjectsAreCurrent(prepared: PreparedSend): boolean {
		return prepared.projects.every((project) => {
			const current = this.state.projects.find(
				(candidate) => candidate.id === project.id,
			);
			return (
				current !== undefined &&
				sameStringSequence(current.paths, project.paths)
			);
		});
	}

	private preparedAgentsAreCurrent(prepared: PreparedSend): boolean {
		const agentIds =
			prepared.request.conversation.kind === "dm"
				? prepared.agentIds
				: (prepared.thread?.agentIds ??
					prepared.channel?.agentIds ??
					prepared.agentIds);
		return agentIds.every((agentId) =>
			this.preparedAgentExecutionIsCurrent(prepared, agentId),
		);
	}

	private preparedChannelAdmissionIsCurrent(prepared: PreparedSend): boolean {
		if (prepared.request.conversation.kind !== "channel") return true;
		const admission = prepared.channelAdmission;
		if (admission === undefined) return false;
		const channel = this.state.channels.find(
			(candidate) => candidate.id === prepared.request.conversation.id,
		);
		if (
			channel === undefined ||
			!sameIdentifierSet(channel.agentIds, admission.channelAgentIds)
		) {
			return false;
		}
		if (admission.thread === undefined)
			return prepared.request.threadId === undefined;
		const thread = this.state.threads.find(
			(candidate) => candidate.id === admission.thread?.id,
		);
		return (
			thread !== undefined &&
			thread.channelId === channel.id &&
			sameIdentifierSet(thread.agentIds, admission.thread.agentIds) &&
			sameIdentifierSet(
				referencedProjectIds(thread),
				admission.thread.projectIds,
			)
		);
	}

	private preparedSendIsCurrent(
		prepared: PreparedSend,
		thread: CommonspaceThread | undefined,
	): boolean {
		return (
			this.conversationIsCurrent(prepared, thread) &&
			this.preparedChannelAdmissionIsCurrent(prepared) &&
			this.preparedProjectsAreCurrent(prepared) &&
			this.preparedAgentsAreCurrent(prepared)
		);
	}

	private agentAuthorityIsCurrent(
		agent: CommonspaceAgentProfile,
		authority: CommonspaceAgentDefinition | undefined,
	): boolean {
		if (authority === undefined) return false;
		const current = this.state.agents.find(
			(candidate) => candidate.id === agent.id,
		);
		return (
			current !== undefined &&
			current.adapter === authority.adapter &&
			current.model === authority.model &&
			this.agentFullAccess(current) === this.agentFullAccess(authority)
		);
	}

	private async withAgentSessionLock<T>(
		agentId: string,
		sessionName: string,
		task: () => Promise<T>,
	): Promise<T> {
		const key = `${agentId}\u0000${sessionName}`;
		const previous = this.agentSessionTails.get(key) ?? Promise.resolve();
		const operation = previous.catch(() => undefined).then(task);
		this.agentSessionTails.set(key, operation);
		void operation
			.finally(() => {
				if (this.agentSessionTails.get(key) === operation)
					this.agentSessionTails.delete(key);
			})
			.catch(() => undefined);
		return operation;
	}

	private async withChannelMemoryLock<T>(
		channelId: string,
		task: () => Promise<T>,
	): Promise<T> {
		const previous =
			this.channelMemoryTails.get(channelId) ?? Promise.resolve();
		const operation = previous.catch(() => undefined).then(task);
		this.channelMemoryTails.set(channelId, operation);
		void operation
			.finally(() => {
				if (this.channelMemoryTails.get(channelId) === operation)
					this.channelMemoryTails.delete(channelId);
			})
			.catch(() => undefined);
		return operation;
	}

	private async withThreadMemoryLock<T>(
		threadId: string,
		task: () => Promise<T>,
	): Promise<T> {
		const previous = this.threadMemoryTails.get(threadId) ?? Promise.resolve();
		const operation = previous.catch(() => undefined).then(task);
		this.threadMemoryTails.set(threadId, operation);
		void operation
			.finally(() => {
				if (this.threadMemoryTails.get(threadId) === operation)
					this.threadMemoryTails.delete(threadId);
			})
			.catch(() => undefined);
		return operation;
	}

	private rememberAgentSession(
		agentId: string,
		sessionName: string,
		sessionId: string,
	): void {
		if (!isNativeSessionId(sessionId))
			throw new Error("agent returned an invalid session id");
		const current = this.state.agentSessions[agentId] ?? {};
		if (current[sessionName] === sessionId) return;
		const bounded = Object.fromEntries(
			[...Object.entries(current), [sessionName, sessionId]].slice(-500),
		);
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			agentSessions: { ...this.state.agentSessions, [agentId]: bounded },
		};
	}

	private forgetAgentSession(
		agentId: string,
		sessionName: string,
		expectedSessionId: string,
	): void {
		const current = this.state.agentSessions[agentId];
		if (current?.[sessionName] !== expectedSessionId) return;
		const remaining = { ...current };
		delete remaining[sessionName];
		const agentSessions = { ...this.state.agentSessions };
		if (Object.keys(remaining).length === 0) delete agentSessions[agentId];
		else agentSessions[agentId] = remaining;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			agentSessions,
		};
	}

	private async inferChannelMemory(
		channelId: string,
		projection: CommonspaceChannelMemory,
	): Promise<CommonspaceChannelMemory> {
		const sourceState = this.state;
		if ((projection.sourceMessageCount ?? 0) === 0)
			return { ...projection, origin: "inference" };
		const compacted = parseChannelContextCompaction(
			await this.completeInference(
				"You compact bounded shared workspace context. Return only the requested JSON object.",
				buildChannelContextCompactionPrompt(this.state, channelId, projection),
				2_000,
				{ kind: "channel-context", channelId },
			),
		);
		if (hasInvalidatedContextSources(sourceState, this.state, channelId))
			return projectChannelMemory(
				this.state,
				channelId,
				this.state.defaults.memoryThreads,
			);
		return inferredChannelMemory(projection, compacted, now());
	}

	private updateRoutingMemoryIfCurrent(
		channelId: string,
		sourceState: CommonspaceState,
		latestCorrectionId: string,
		update: (
			channel: Readonly<CommonspaceState["channels"][number]>,
		) => CommonspaceState["channels"][number]["routingMemory"],
	): boolean {
		const channelIndex = this.state.channels.findIndex(
			(channel) => channel.id === channelId,
		);
		const channel = this.state.channels[channelIndex];
		const sourceChannel = sourceState.channels.find(
			(candidate) => candidate.id === channelId,
		);
		if (
			channel === undefined ||
			sourceChannel === undefined ||
			channel.routingMemory.correctionCount !==
				sourceChannel.routingMemory.correctionCount ||
			buildRoutingMemoryCompactionPrompt(this.state, channelId)
				?.compactedThroughCorrectionId !== latestCorrectionId ||
			hasInvalidatedContextSources(sourceState, this.state, channelId)
		)
			return false;
		const channels = [...this.state.channels];
		channels[channelIndex] = { ...channel, routingMemory: update(channel) };
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			channels,
		};
		return true;
	}

	private async compactRoutingMemory(channelId: string): Promise<void> {
		await this.withChannelMemoryLock(channelId, async () => {
			const sourceState = this.state;
			const source = buildRoutingMemoryCompactionPrompt(sourceState, channelId);
			if (source === null) return;
			try {
				const summary = parseRoutingMemoryCompaction(
					await this.completeInference(
						"You compact bounded routing feedback. Return only the requested JSON object.",
						source.prompt,
						1_000,
						{ kind: "channel-context", channelId },
					),
				);
				if (
					!this.updateRoutingMemoryIfCurrent(
						channelId,
						sourceState,
						source.compactedThroughCorrectionId,
						() => ({
							summary,
							status: "current",
							correctionCount: source.correctionCount,
							compactedThroughCorrectionId: source.compactedThroughCorrectionId,
							updatedAt: now(),
						}),
					)
				)
					return;
			} catch (error) {
				this.environment.logger?.warn(
					`Commonspace routing memory compaction failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				if (
					!this.updateRoutingMemoryIfCurrent(
						channelId,
						sourceState,
						source.compactedThroughCorrectionId,
						(channel) => ({
							...channel.routingMemory,
							status: "failed",
							correctionCount: source.correctionCount,
						}),
					)
				)
					return;
			}
			await this.persist();
			this.broadcastRevision();
		});
	}

	private reconcileInferredChannelMemory(
		channelId: string,
		memoryBeforeInference: CommonspaceChannelMemory,
		projectionBeforeInference: CommonspaceChannelMemory,
		inferred: CommonspaceChannelMemory,
	): CommonspaceChannelMemory | undefined {
		const currentChannel = this.state.channels.find(
			(channel) => channel.id === channelId,
		);
		if (currentChannel === undefined) return undefined;
		const latestProjection = projectChannelMemory(
			this.state,
			channelId,
			this.state.defaults.memoryThreads,
		);

		// A human edit made while inference was running remains authoritative.
		if (
			currentChannel.memory !== memoryBeforeInference &&
			currentChannel.memory.origin === "user"
		) {
			return mergeChannelMemoryProjection(
				currentChannel.memory,
				latestProjection,
			);
		}

		const sourceChanged =
			projectionBeforeInference.compactedThroughMessageId !==
				latestProjection.compactedThroughMessageId ||
			projectionBeforeInference.sourceMessageCount !==
				latestProjection.sourceMessageCount;
		return sourceChanged
			? mergeChannelMemoryProjection(inferred, latestProjection)
			: inferred;
	}

	private scheduleContextRefresh(threadId: string, channelId: string): void {
		const current = this.contextRefreshes.get(threadId);
		if (current !== undefined) {
			current.dirty = true;
			return;
		}
		const refresh = { dirty: true };
		this.contextRefreshes.set(threadId, refresh);
		const operation = (async () => {
			while (refresh.dirty && !this.closing) {
				refresh.dirty = false;
				await this.updateThreadMemory(threadId);
				if (!this.closing) await this.updateChannelMemory(channelId);
			}
		})()
			.catch((error) => this.environment.logger?.warn(error))
			.finally(() => {
				this.contextRefreshes.delete(threadId);
				this.backgroundRuns.delete(operation);
			});
		this.backgroundRuns.add(operation);
	}

	private replaceThreadMemoryState(
		threadId: string,
		update: (memory: Readonly<ThreadMemory>) => ThreadMemory,
	): CommonspaceThreadContext | undefined {
		const threadIndex = this.state.threads.findIndex(
			(thread) => thread.id === threadId,
		);
		const thread = this.state.threads[threadIndex];
		if (thread === undefined) return undefined;
		const context = {
			...thread.context,
			memory: update(thread.context.memory),
		};
		const threads = [...this.state.threads];
		threads[threadIndex] = { ...thread, context };
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			threads,
		};
		return context;
	}

	private async inferThreadMemory(
		threadId: string,
		projection: ThreadMemory,
	): Promise<ThreadMemory> {
		const compacted = parseChannelContextCompaction(
			await this.completeInference(
				"You compact bounded shared workspace context. Return only the requested JSON object.",
				buildThreadContextCompactionPrompt(this.state, threadId),
				2_000,
				{ kind: "thread-context", threadId },
			),
		);
		return inferredThreadMemory(projection, compacted, now());
	}

	private reconcileInferredThreadMemory(
		snapshot: ThreadMemoryInferenceSnapshot,
		inferred: ThreadMemory,
		conflictPolicy: ThreadMemoryConflictPolicy,
	): ThreadMemory | undefined {
		const current = this.state.threads.find(
			(thread) => thread.id === snapshot.threadId,
		);
		if (current === undefined) return undefined;
		const latestProjection = projectThreadMemory(this.state, snapshot.threadId);
		if (threadMemoryInferenceHasConflict(snapshot, current, this.state)) {
			switch (conflictPolicy) {
				case "preserve-current":
					return mergeThreadMemoryProjection(
						current.context.memory,
						latestProjection,
					);
				case "discard-inference":
					return undefined;
			}
		}
		return sameThreadMemoryProjection(
			snapshot.projectionBeforeInference,
			latestProjection,
		)
			? inferred
			: mergeThreadMemoryProjection(inferred, latestProjection);
	}

	private async beginThreadMemoryCompaction(
		threadId: string,
	): Promise<ThreadMemoryInferenceBaseline> {
		const thread = this.state.threads.find(
			(candidate) => candidate.id === threadId,
		);
		if (thread === undefined) throw new Error("unknown thread");
		const projectionBeforeInference = projectThreadMemory(this.state, threadId);
		const memoryBeforeInference: ThreadMemory = {
			...thread.context.memory,
			status: "compacting",
		};
		if (
			this.replaceThreadMemoryState(threadId, () => memoryBeforeInference) ===
			undefined
		)
			throw new Error("unknown thread");
		await this.persist();
		this.broadcastRevision();
		return {
			threadId,
			channelId: thread.channelId,
			memoryBeforeInference,
			projectionBeforeInference,
		};
	}

	private async completeThreadMemoryCompaction(
		baseline: ThreadMemoryInferenceBaseline,
	): Promise<CommonspaceThreadContext> {
		const snapshot: ThreadMemoryInferenceSnapshot = {
			...baseline,
			sourceState: this.state,
		};
		const inferred = await this.inferThreadMemory(
			snapshot.threadId,
			snapshot.projectionBeforeInference,
		);
		const memory = this.reconcileInferredThreadMemory(
			snapshot,
			inferred,
			"preserve-current",
		);
		if (memory === undefined)
			throw new Error("thread was removed during context compaction");
		const context = this.replaceThreadMemoryState(
			snapshot.threadId,
			() => memory,
		);
		if (context === undefined)
			throw new Error("thread was removed during context compaction");
		await this.persist();
		this.broadcastRevision();
		return structuredClone(context);
	}

	private async failThreadMemoryCompaction(threadId: string): Promise<void> {
		const context = this.replaceThreadMemoryState(threadId, (memory) => ({
			...memory,
			status: "failed",
		}));
		if (context === undefined) return;
		await this.persist();
		this.broadcastRevision();
	}

	private replaceChannelMemoryState(
		channelId: string,
		update: (
			memory: Readonly<CommonspaceChannelMemory>,
		) => CommonspaceChannelMemory,
	): CommonspaceChannelMemory | undefined {
		const channelIndex = this.state.channels.findIndex(
			(channel) => channel.id === channelId,
		);
		const channel = this.state.channels[channelIndex];
		if (channel === undefined) return undefined;
		const memory = update(channel.memory);
		const channels = [...this.state.channels];
		channels[channelIndex] = { ...channel, memory };
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			channels,
		};
		return memory;
	}

	private channelMemoryNeedsInference(
		projection: Readonly<CommonspaceChannelMemory>,
		memory: Readonly<CommonspaceChannelMemory>,
	): boolean {
		return (
			(projection.sourceMessageCount ?? 0) > 0 &&
			this.routingConfiguration.provider !==
				CommonspaceRoutingProvider.Unconfigured &&
			memory.origin !== "user" &&
			(memory.origin === "automatic" ||
				memory.status === "stale" ||
				memory.status === "failed")
		);
	}

	private async inferAutomaticChannelMemory(
		channel: Readonly<CommonspaceState["channels"][number]>,
		projection: CommonspaceChannelMemory,
		memory: CommonspaceChannelMemory,
	): Promise<CommonspaceChannelMemory | undefined> {
		if (!this.channelMemoryNeedsInference(projection, memory)) return memory;
		try {
			const compacting: CommonspaceChannelMemory = {
				...memory,
				status: "compacting",
			};
			if (
				this.replaceChannelMemoryState(channel.id, () => compacting) ===
				undefined
			)
				return undefined;
			await this.persist();
			this.broadcastRevision();
			const inferred = await this.inferChannelMemory(channel.id, projection);
			return this.reconcileInferredChannelMemory(
				channel.id,
				channel.memory,
				projection,
				inferred,
			);
		} catch (error) {
			this.environment.logger?.warn(
				`Commonspace context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			const currentChannel = this.state.channels.find(
				(candidate) => candidate.id === channel.id,
			);
			if (currentChannel === undefined) return undefined;
			const current = mergeChannelMemoryProjection(
				currentChannel.memory,
				projectChannelMemory(
					this.state,
					channel.id,
					this.state.defaults.memoryThreads,
				),
			);
			return current.origin === "user"
				? current
				: { ...current, status: "failed" };
		}
	}

	private async updateChannelMemory(channelId: string): Promise<void> {
		await this.withChannelMemoryLock(channelId, async () => {
			const channel = this.state.channels.find(
				(candidate) => candidate.id === channelId,
			);
			if (channel === undefined) return;
			const projection = projectChannelMemory(
				this.state,
				channelId,
				this.state.defaults.memoryThreads,
			);
			const projected = mergeChannelMemoryProjection(
				channel.memory,
				projection,
			);
			const memory = await this.inferAutomaticChannelMemory(
				channel,
				projection,
				projected,
			);
			if (
				memory === undefined ||
				this.replaceChannelMemoryState(channelId, () => memory) === undefined
			)
				return;
			await this.persist();
			this.broadcastRevision();
		});
	}

	private threadMemoryNeedsInference(
		projection: Readonly<ThreadMemory>,
		memory: Readonly<ThreadMemory>,
	): boolean {
		return (
			projection.estimatedTokens >= SHARED_CONTEXT_PRESSURE_TOKENS &&
			memory.origin !== "user" &&
			(memory.origin === "automatic" || memory.status === "stale")
		);
	}

	private async inferAndCommitAutomaticThreadMemory(
		thread: Readonly<CommonspaceThread>,
		projection: ThreadMemory,
	): Promise<void> {
		const snapshot: ThreadMemoryInferenceSnapshot = {
			threadId: thread.id,
			channelId: thread.channelId,
			memoryBeforeInference: thread.context.memory,
			projectionBeforeInference: projection,
			sourceState: this.state,
		};
		let memory: ThreadMemory | undefined;
		try {
			const inferred = await this.inferThreadMemory(thread.id, projection);
			memory = this.reconcileInferredThreadMemory(
				snapshot,
				inferred,
				"discard-inference",
			);
		} catch (error) {
			this.environment.logger?.warn(
				`Commonspace Thread context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			const current = this.state.threads.find(
				(candidate) => candidate.id === thread.id,
			);
			if (current === undefined) return;
			memory = mergeThreadMemoryProjection(
				current.context.memory,
				projectThreadMemory(this.state, thread.id),
			);
		}
		if (
			memory === undefined ||
			this.replaceThreadMemoryState(thread.id, () => memory) === undefined
		)
			return;
		await this.persist();
		this.broadcastRevision();
	}

	private async updateThreadMemory(threadId: string): Promise<void> {
		await this.withThreadMemoryLock(threadId, async () => {
			const thread = this.state.threads.find(
				(candidate) => candidate.id === threadId,
			);
			if (thread === undefined) return;
			const projection = projectThreadMemory(this.state, threadId);
			const projected = mergeThreadMemoryProjection(
				thread.context.memory,
				projection,
			);
			if (this.threadMemoryNeedsInference(projection, projected)) {
				await this.inferAndCommitAutomaticThreadMemory(thread, projection);
				return;
			}
			if (
				this.replaceThreadMemoryState(threadId, () => projected) === undefined
			)
				return;
			await this.persist();
			this.broadcastRevision();
		});
	}

	private broadcastRevision(): void {
		for (const listener of this.revisionListeners) {
			try {
				listener(this.state.revision);
			} catch {
				this.revisionListeners.delete(listener);
			}
		}
		this.queueDesktopNotifications();
	}

	private queueDesktopNotifications(): void {
		const items = deriveCommonspaceInboxItems(this.state);
		const fresh = items.filter((item) => !this.knownInboxItemIds.has(item.id));
		for (const item of items) this.knownInboxItemIds.add(item.id);
		if (this.closing || this.clientUrl === undefined || fresh.length === 0)
			return;
		for (const item of fresh) {
			const notification = desktopNotificationForItem(
				item,
				this.state.notifications,
				this.clientUrl,
			);
			if (notification === null) continue;
			const operation = this.notifyDesktop(notification).catch((error) => {
				this.environment.logger?.warn(
					`Commonspace desktop notification failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
			this.backgroundRuns.add(operation);
			void operation
				.finally(() => {
					this.backgroundRuns.delete(operation);
				})
				.catch(() => undefined);
		}
	}

	private synchronizeNotificationBaseline(): void {
		for (const item of deriveCommonspaceInboxItems(this.state))
			this.knownInboxItemIds.add(item.id);
	}

	private broadcastLiveActivities(): void {
		const activities = this.liveActivities();
		for (const listener of this.liveActivityListeners) {
			try {
				listener(activities);
			} catch {
				this.liveActivityListeners.delete(listener);
			}
		}
	}

	private append(message: CommonspaceMessage): void {
		const key = conversationKey(message.conversation);
		const current = this.state.messages[key] ?? [];
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: { ...this.state.messages, [key]: [...current, message] },
		};
		if (message.threadId !== undefined) {
			this.state = {
				...this.state,
				threads: this.state.threads.map((thread) =>
					thread.id === message.threadId
						? {
								...thread,
								context: {
									...thread.context,
									memory: mergeThreadMemoryProjection(
										thread.context.memory,
										projectThreadMemory(this.state, thread.id),
									),
								},
							}
						: thread,
				),
			};
		}
	}

	private updateMessageReplyStatus(
		conversation: SendMessageRequest["conversation"],
		messageId: string,
		replyStatus: NonNullable<CommonspaceMessage["replyStatus"]>,
		replyError?: string,
	): boolean {
		const key = conversationKey(conversation);
		const current = this.state.messages[key];
		if (
			current === undefined ||
			!current.some((message) => message.id === messageId)
		)
			return false;
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			messages: {
				...this.state.messages,
				[key]: current.map((message) => {
					if (message.id !== messageId) return message;
					const updated: CommonspaceMessage = {
						...message,
						replyStatus,
					};
					if (replyError === undefined) delete updated.replyError;
					else updated.replyError = replyError;
					return updated;
				}),
			},
		};
		return true;
	}

	private async normalizeMutation(
		mutation: CommonspaceMutation,
	): Promise<CommonspaceMutation> {
		if (mutation.action === "create-project") {
			const paths = await Promise.all(
				mutation.paths.map((path) => this.validDirectory(path)),
			);
			return { ...mutation, paths };
		}
		if (mutation.action === "add-project-path") {
			return { ...mutation, path: await this.validDirectory(mutation.path) };
		}
		if (mutation.action === "reset-dm") {
			if (
				typeof mutation.agentId !== "string" ||
				!this.configuredAgents().some((agent) => agent.id === mutation.agentId)
			) {
				throw new Error("unknown agent");
			}
		}
		return mutation;
	}

	private async validDirectory(path: string): Promise<string> {
		if (!isAbsolute(path)) throw new Error("project path must be absolute");
		const resolved = await realpath(path);
		if (!(await stat(resolved)).isDirectory())
			throw new Error("project path must be a directory");
		return resolved;
	}

	private async discoverAgentCandidates(
		adapter: AgentAdapterKind,
	): Promise<CommonspaceAgentProfile[]> {
		if (this.overrides.discoverAgents !== undefined) {
			const discovered = await this.overrides.discoverAgents(adapter);
			return [
				...new Map(
					discovered
						.filter((agent) => agent.adapter === adapter)
						.map((agent) => [agent.id, agent]),
				).values(),
			];
		}
		try {
			return await this.adapters[adapter].discover();
		} catch (error) {
			this.environment.logger?.warn(
				`Commonspace could not discover ${AGENT_ADAPTERS[adapter].label}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		}
	}

	private configuredAgentPermissionPolicy(
		agent: CommonspaceAgentDefinition,
	): NonNullable<CommonspaceAgentProfile["permissionPolicy"]> {
		return {
			source: this.unsafeModeForAdapter(agent.adapter) ? "server" : "agent",
			fullAccess: this.agentFullAccess(agent),
		};
	}

	private configuredAgentProfile(
		agent: CommonspaceAgentDefinition,
		discovered: CommonspaceAgentProfile | undefined,
	): CommonspaceAgentProfile {
		const profile: CommonspaceAgentProfile = {
			id: agent.id,
			displayName: agent.displayName,
			adapter: agent.adapter,
			model: discovered === undefined ? agent.model : discovered.model,
			status: discovered === undefined ? "unknown" : discovered.status,
			permissionPolicy: this.configuredAgentPermissionPolicy(agent),
		};
		if (agent.fullAccess === true) profile.fullAccess = true;
		if (agent.avatarEmoji !== undefined)
			profile.avatarEmoji = agent.avatarEmoji;
		if (agent.accentColor !== undefined)
			profile.accentColor = agent.accentColor;
		if (agent.nativeProfile !== undefined)
			profile.nativeProfile = agent.nativeProfile;
		if (discovered?.description !== undefined)
			profile.description = discovered.description;
		return profile;
	}

	private configuredAgents(
		discoveredAgents: CommonspaceAgentProfile[] = this
			.discoveredAgentCandidates,
	): CommonspaceAgentProfile[] {
		const discoveredById = new Map(
			discoveredAgents.map((agent) => [agent.id, agent]),
		);
		return this.state.agents.map((agent) => {
			const discovered = discoveredById.get(agent.id);
			return this.configuredAgentProfile(
				agent,
				discovered?.adapter === agent.adapter ? discovered : undefined,
			);
		});
	}

	private async completeInference(
		system: string,
		prompt: string,
		maxTokens: number,
		scope: InferenceScope,
	): Promise<string> {
		if (
			this.routingConfiguration.provider === CommonspaceRoutingProvider.Harness
		) {
			const routingAuthority = this.routingConfiguration;
			const harnessAgentId = this.routingConfiguration.harnessAgentId;
			const agent = this.configuredAgents().find(
				(candidate) => candidate.id === harnessAgentId,
			);
			if (agent === undefined)
				throw new Error("routing harness is unavailable");
			const agentAuthority = this.agentAuthority(agent);
			if (agentAuthority === undefined)
				throw new Error("routing harness is unavailable");
			const processScopeName = inferenceProcessScopeName(scope);
			const sessionName =
				scope.kind === "channel-routing"
					? `${processScopeName}: ${crypto.randomUUID()}`
					: `Commonspace Inference: ${crypto.randomUUID()}`;
			const signal = AbortSignal.any([
				AbortSignal.timeout(30_000),
				this.inferenceShutdown.signal,
			]);
			const scopeIsActive = (): boolean =>
				!signal.aborted &&
				this.routingConfiguration === routingAuthority &&
				this.agentAuthorityIsCurrent(agent, agentAuthority) &&
				inferenceScopeExists(this.state, scope);
			const scopeExpiredError = (): Error =>
				signal.aborted && signal.reason instanceof Error
					? signal.reason
					: new Error("routing session scope expired");
			const run = async (): Promise<string> => {
				if (!scopeIsActive()) throw scopeExpiredError();
				const runInput: AgentRunInput = {
					agent,
					cwd: this.defaultCwd,
					additionalCwds: [],
					sessionName,
					processScopeName,
					processScopeIsCurrent: scopeIsActive,
					ephemeralSession: true,
					message: `${system}\n\nOutput token budget: at most ${String(maxTokens)} tokens.\n\n${prompt}`,
					maxResponseChars: Math.min(MAX_AGENT_RESPONSE_CHARS, maxTokens * 8),
					signal,
				};
				const result = await this.runAgentWithSessionRecovery(
					runInput,
					scopeIsActive,
				);
				if (result === null || !scopeIsActive()) throw scopeExpiredError();
				return result.text;
			};
			return this.withAgentSessionLock(agent.id, processScopeName, run);
		}
		throw new Error(this.routingConfiguration.message);
	}

	private async routeAgents(
		channelId: string,
		input: CommonspaceRouteInput,
	): Promise<CommonspaceRouteResult> {
		let retryableFailure: unknown;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				return parseRoutingResponse(
					await this.completeInference(
						"You are a bounded routing classifier. Return only the requested JSON object.",
						buildRoutingPrompt(input),
						routingOutputTokenBudget(input.maxAgents, attempt),
						{ kind: "channel-routing", channelId },
					),
				);
			} catch (error) {
				if (!(error instanceof RoutingResponseValidationError)) throw error;
				retryableFailure = error;
			}
		}
		throw retryableFailure;
	}

	private async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
		return serverTracer.startActiveSpan(
			"commonspace.agent.run_attempt",
			async (span) => {
				try {
					const result =
						this.overrides.runAgent === undefined
							? await this.runAcpAgent(input)
							: await this.overrides.runAgent(input);
					const response =
						typeof result === "string" ? { text: result } : result;
					const timeout = agentTimeoutReason(input.signal);
					if (timeout !== undefined) {
						span.setAttribute("commonspace.agent.outcome", "timeout");
						markOperationFailed(span, timeout, "Agent attempt timed out");
					} else if (input.signal.aborted) {
						span.setAttribute("commonspace.agent.outcome", "cancelled");
					} else {
						span.setAttribute(
							"commonspace.agent.response_chars",
							Math.min(response.text.length, MAX_AGENT_RESPONSE_CHARS),
						);
						span.setStatus({ code: SpanStatusCode.OK });
					}
					return response;
				} catch (error) {
					const timeout = agentTimeoutReason(input.signal);
					if (timeout !== undefined) {
						span.setAttribute("commonspace.agent.outcome", "timeout");
						markOperationFailed(span, timeout, "Agent attempt timed out");
					} else if (input.signal.aborted)
						span.setAttribute("commonspace.agent.outcome", "cancelled");
					else {
						span.setAttribute("commonspace.agent.outcome", "failed");
						markOperationFailed(
							span,
							error instanceof Error ? error : undefined,
							"Agent attempt failed",
						);
					}
					throw error;
				} finally {
					span.end();
				}
			},
		);
	}

	private beginLiveActivity({
		run,
		agent,
		thread,
	}: Pick<AgentRunExecutionContext, "run" | "agent" | "thread">): string {
		const activity: CommonspaceLiveAgentActivity = {
			id: run.id,
			sourceMessageId: run.sourceMessageId,
			agentId: agent.id,
			agentName: agent.displayName,
			adapter: agent.adapter,
			conversation: structuredClone(run.conversation),
			startedAt: now(),
			entries: [],
		};
		if (thread !== undefined) activity.threadId = thread.id;
		this.liveActivitiesById.set(run.id, activity);
		this.broadcastLiveActivities();
		return run.id;
	}

	private updateLiveActivity(
		id: string,
		entries: readonly CommonspaceTraceEntry[],
	): void {
		const current = this.liveActivitiesById.get(id);
		if (current === undefined) return;
		const completedAt = now();
		const trace = this.publicAgentTrace(
			{
				adapter: current.adapter,
				startedAt: current.startedAt,
				completedAt,
				entries: [...entries],
			},
			current.adapter,
		);
		this.liveActivitiesById.set(id, {
			...current,
			entries: trace?.entries ?? [],
		});
		this.broadcastLiveActivities();
	}

	private endLiveActivity(id: string): void {
		if (!this.liveActivitiesById.delete(id)) return;
		this.broadcastLiveActivities();
	}

	private unsafeModeForAdapter(adapter: AgentAdapterKind): boolean {
		return this.agentYolo === true || this.agentYolo === adapter;
	}

	private agentFullAccess(
		agent: Pick<CommonspaceAgentProfile, "adapter" | "fullAccess">,
	): boolean {
		return (
			agent.fullAccess === true || this.unsafeModeForAdapter(agent.adapter)
		);
	}

	private closeAcpProcess(
		scopeKey: string,
		client: AcpAgentProcess,
	): Promise<void> {
		if (this.acpProcesses.get(scopeKey) === client)
			this.acpProcesses.delete(scopeKey);
		const closing = Promise.all([
			this.acpProcessClosures.get(scopeKey),
			client.close(),
		]).then(() => undefined);
		this.acpProcessClosures.set(scopeKey, closing);
		const clear = () => {
			if (this.acpProcessClosures.get(scopeKey) === closing)
				this.acpProcessClosures.delete(scopeKey);
		};
		void closing.then(clear, clear);
		return closing;
	}

	private closeInferenceProcesses(agentId: string): Promise<void> {
		return this.closeAcpProcessesMatching(
			(candidateAgentId, scopeName) =>
				candidateAgentId === agentId && isInferenceProcessScopeName(scopeName),
		);
	}

	private async closeAcpProcessesMatching(
		matches: (
			agentId: string,
			scopeName: string,
			processClient: AcpAgentProcess,
		) => boolean,
	): Promise<void> {
		const processEntries = [...this.acpProcesses.entries()].filter(
			([key, client]) => {
				const separator = key.indexOf("\u0000");
				return (
					separator >= 1 &&
					matches(key.slice(0, separator), key.slice(separator + 1), client)
				);
			},
		);
		const processScopeKeys = new Set(processEntries.map(([key]) => key));
		for (const key of processScopeKeys) this.acpProcesses.delete(key);
		for (const [sessionScopeKey, session] of this.activeAcpSessions) {
			if (processScopeKeys.has(session.processScopeKey))
				this.activeAcpSessions.delete(sessionScopeKey);
		}
		await Promise.all(
			processEntries.map(([key, processClient]) =>
				this.closeAcpProcess(key, processClient).catch((error) => {
					this.environment.logger?.warn(error);
				}),
			),
		);
	}

	private assertAcpProcessScopeCurrent(input: AgentRunInput): void {
		input.signal.throwIfAborted();
		if (input.processScopeIsCurrent?.() === false)
			throw new Error("Agent process scope expired before execution.");
	}

	private async launchAcpProcess({
		input,
		processScopeKey,
		adapter,
		currentAgent,
		fullAccess,
		settings,
		processClient,
	}: AcpProcessLaunchPlan): Promise<AcquiredAcpProcess> {
		if (processClient !== undefined) {
			this.acpProcesses.delete(processScopeKey);
			await this.closeAcpProcess(processScopeKey, processClient);
			this.assertAcpProcessScopeCurrent(input);
		}
		const launch = await adapter.launch(input.agent, fullAccess, input.signal);
		this.assertAcpProcessScopeCurrent(input);
		const latestAgent = this.state.agents.find(
			(agent) =>
				agent.id === input.agent.id && agent.adapter === input.agent.adapter,
		);
		if (latestAgent !== currentAgent)
			throw new Error("Agent settings changed before execution.");
		const launchedProcess = new AcpAgentProcess({
			...launch,
			cwd: input.cwd,
			requestTimeoutMs: ((this.runBudgetSeconds ?? 3_600) + 30) * 1000,
			maxResponseChars: MAX_AGENT_RESPONSE_CHARS,
			clientName: `commonspace-${input.agent.id}`,
		});
		this.acpProcesses.set(processScopeKey, launchedProcess);
		this.acpLaunchAccess.set(launchedProcess, fullAccess);
		return { processClient: launchedProcess, settings };
	}

	private acquireAcpProcess(
		input: AgentRunInput,
		processScopeKey: string,
	): AcquiredAcpProcess | Promise<AcquiredAcpProcess> {
		const adapter = this.adapters[input.agent.adapter];
		const currentAgent = this.state.agents.find(
			(agent) =>
				agent.id === input.agent.id && agent.adapter === input.agent.adapter,
		);
		if (currentAgent === undefined)
			throw new Error("Agent identity changed before execution.");
		const fullAccess = this.agentFullAccess(currentAgent);
		const settings = adapter.sessionSettings({
			fullAccess,
		});
		const processClient = this.acpProcesses.get(processScopeKey);
		const launchPlan: AcpProcessLaunchPlan = {
			input,
			processScopeKey,
			adapter,
			currentAgent,
			fullAccess,
			settings,
			processClient,
		};
		if (
			processClient !== undefined &&
			this.acpLaunchAccess.get(processClient) !== fullAccess
		) {
			return this.launchAcpProcess(launchPlan);
		}
		if (
			processClient !== undefined &&
			input.ephemeralSession === true &&
			(this.acpEphemeralSessionCounts.get(processClient) ?? 0) >=
				MAX_EPHEMERAL_SESSIONS_PER_PROCESS
		) {
			return this.launchAcpProcess(launchPlan);
		}
		if (processClient === undefined) return this.launchAcpProcess(launchPlan);
		return { processClient, settings };
	}

	private prepareAcpRunInput(
		execution: PreparedAcpExecution,
		onSessionReady: (sessionId: string) => void,
	): AcpRunInput {
		const { input, mcpServers, settings } = execution;
		const acpInput: AcpRunInput = {
			cwd: input.cwd,
			additionalCwds: input.additionalCwds,
			message: input.message,
			mcpServers,
			signal: input.signal,
			...settings,
			onSessionReady,
		};
		if (input.ephemeralSession === true) acpInput.retainSession = false;
		if (input.participationContext !== undefined)
			acpInput.participationContext = input.participationContext;
		if (input.maxResponseChars !== undefined)
			acpInput.maxResponseChars = input.maxResponseChars;
		if (input.images !== undefined) acpInput.images = input.images;
		if (input.files !== undefined) acpInput.files = input.files;
		if (input.onTraceUpdate !== undefined)
			acpInput.onTraceUpdate = input.onTraceUpdate;
		if (input.onPermissionRequest !== undefined)
			acpInput.onPermissionRequest = input.onPermissionRequest;
		if (input.sessionId !== undefined) acpInput.sessionId = input.sessionId;
		return acpInput;
	}

	private async runPreparedAcpExecution(
		execution: PreparedAcpExecution,
	): Promise<AgentRunResult> {
		const { input, processClient, processScopeKey, sessionScopeKey } =
			execution;
		let activeSessionId: string | undefined;
		const abortSetup = () => {
			if (activeSessionId !== undefined) return;
			if (this.acpProcesses.get(processScopeKey) === processClient)
				this.acpProcesses.delete(processScopeKey);
			void this.closeAcpProcess(processScopeKey, processClient).catch((error) =>
				this.environment.logger?.warn(error),
			);
		};
		input.signal.addEventListener("abort", abortSetup, { once: true });
		try {
			if (input.signal.aborted) {
				abortSetup();
				throw input.signal.reason;
			}
			const acpInput = this.prepareAcpRunInput(execution, (sessionId) => {
				input.signal.throwIfAborted();
				activeSessionId = sessionId;
				this.activeAcpSessions.set(sessionScopeKey, {
					sessionId,
					processScopeKey,
				});
				input.signal.removeEventListener("abort", abortSetup);
			});
			const result = await processClient.run(acpInput);
			if (result.text.trim() === "")
				throw new AcpEmptyResponseError(
					`${input.agent.displayName} returned no response`,
				);
			const runResult: AgentRunResult = {
				sessionId: result.sessionId,
				text: result.text,
			};
			if (result.resources !== undefined) runResult.files = result.resources;
			if (result.trace !== undefined)
				runResult.trace = { adapter: input.agent.adapter, ...result.trace };
			return runResult;
		} finally {
			input.signal.removeEventListener("abort", abortSetup);
			if (
				activeSessionId !== undefined &&
				this.activeAcpSessions.get(sessionScopeKey)?.sessionId ===
					activeSessionId
			) {
				this.activeAcpSessions.delete(sessionScopeKey);
			}
		}
	}

	private async runAcpAgent(input: AgentRunInput): Promise<AgentRunResult> {
		this.assertAcpProcessScopeCurrent(input);
		const sessionScopeKey = `${input.agent.id}\u0000${input.sessionName}`;
		const processScopeKey = `${input.agent.id}\u0000${input.processScopeName ?? input.sessionName}`;
		await this.acpProcessClosures.get(processScopeKey);
		this.assertAcpProcessScopeCurrent(input);
		const mcpServers = this.mcpServersFor(input);
		const acquisition = this.acquireAcpProcess(input, processScopeKey);
		const acquired =
			acquisition instanceof Promise ? await acquisition : acquisition;
		this.assertAcpProcessScopeCurrent(input);
		if (input.ephemeralSession === true) {
			this.acpEphemeralSessionCounts.set(
				acquired.processClient,
				(this.acpEphemeralSessionCounts.get(acquired.processClient) ?? 0) + 1,
			);
		}
		return this.runPreparedAcpExecution({
			input,
			mcpServers,
			sessionScopeKey,
			processScopeKey,
			...acquired,
		});
	}

	private mcpServersFor(input: AgentRunInput): AcpMcpServer[] {
		if (
			this.mcpGateway === undefined ||
			this.mcpEndpoint === undefined ||
			input.commonspaceScope === undefined
		)
			return [];
		const scope: CommonspaceMcpScope = {
			...input.commonspaceScope,
			agentId: input.agent.id,
			sessionName: input.sessionName,
		};
		const key = `${input.agent.id}\u0000${input.sessionName}`;
		const fingerprint = JSON.stringify(scope);
		let credential = this.mcpCredentials.get(key);
		if (
			credential?.fingerprint !== fingerprint ||
			(credential !== undefined && !this.mcpGateway.has(credential.token))
		) {
			if (credential !== undefined) {
				this.mcpGateway.revoke(credential.token);
				this.mcpCredentials.delete(key);
			}
			while (this.mcpCredentials.size >= MAX_MCP_CREDENTIALS) {
				const oldest = this.mcpCredentials.entries().next();
				if (oldest.done) break;
				const [oldestKey, oldestCredential] = oldest.value;
				this.mcpCredentials.delete(oldestKey);
				this.mcpGateway.revoke(oldestCredential.token);
			}
			const issued = this.mcpGateway.issue(scope);
			credential = {
				fingerprint,
				scope: structuredClone(scope),
				token: issued.token,
			};
			this.mcpCredentials.set(key, credential);
		}
		return [
			{
				type: "http",
				name: "commonspace",
				url: this.mcpEndpoint,
				headers: [
					{ name: "Authorization", value: `Bearer ${credential.token}` },
				],
			},
		];
	}

	private async runAgentWithSessionRecovery(
		input: AgentRunInput,
		shouldContinue: () => boolean,
	): Promise<AgentRunResult | null> {
		return serverTracer.startActiveSpan(
			"commonspace.agent.run",
			{
				attributes: {
					"commonspace.agent.adapter": input.agent.adapter,
					"commonspace.agent.session_reused": input.sessionId !== undefined,
					"commonspace.agent.ephemeral": input.ephemeralSession === true,
				},
			},
			async (span) => {
				const recordTimeout = (reason: Error) => {
					span.setAttribute("commonspace.agent.outcome", "timeout");
					markOperationFailed(span, reason, "Agent run timed out");
					recordOperationException(reason, {
						eventName: "commonspace.agent.run.exception",
						body: "Agent run timed out",
						severity: SeverityNumber.ERROR,
					});
				};
				try {
					const result = await this.runAgentWithRecovery(input, shouldContinue);
					const timeout = agentTimeoutReason(input.signal);
					if (timeout !== undefined) recordTimeout(timeout);
					else {
						const completed = result !== null && shouldContinue();
						span.setAttribute(
							"commonspace.agent.outcome",
							completed ? "completed" : "cancelled",
						);
						if (completed) span.setStatus({ code: SpanStatusCode.OK });
					}
					return result;
				} catch (error) {
					const timeout = agentTimeoutReason(input.signal);
					if (timeout !== undefined) recordTimeout(timeout);
					else if (!shouldContinue()) {
						span.setAttribute("commonspace.agent.outcome", "cancelled");
					} else {
						const observedError = error instanceof Error ? error : undefined;
						span.setAttribute("commonspace.agent.outcome", "failed");
						markOperationFailed(span, observedError, "Agent run failed");
						recordOperationException(observedError, {
							eventName: "commonspace.agent.run.exception",
							body: "Agent run failed",
							severity: SeverityNumber.ERROR,
						});
					}
					throw error;
				} finally {
					span.end();
				}
			},
		);
	}

	private async runAgentWithRecovery(
		input: AgentRunInput,
		shouldContinue: () => boolean,
	): Promise<AgentRunResult | null> {
		try {
			return await this.runAgent(input);
		} catch (error) {
			const silentPersistedHermesSession =
				input.agent.adapter === "hermes" &&
				error instanceof AcpEmptyResponseError;
			if (
				input.sessionId === undefined ||
				(!silentPersistedHermesSession && !isMissingNativeSession(error))
			)
				throw error;
			let recover = shouldContinue();
			if (recover) {
				this.forgetAgentSession(
					input.agent.id,
					input.sessionName,
					input.sessionId,
				);
				recover = shouldContinue();
			}
			recordOperationException(error instanceof Error ? error : undefined, {
				eventName: "commonspace.agent.run_attempt.exception",
				body: "Agent session was unavailable",
				severity: SeverityNumber.WARN,
				recoveryAction: recover ? "replace_session" : "cancel_run",
			});
			if (!recover) return null;
			const processScopeKey = `${input.agent.id}\u0000${input.processScopeName ?? input.sessionName}`;
			const processClient = this.acpProcesses.get(processScopeKey);
			if (processClient !== undefined) {
				this.acpProcesses.delete(processScopeKey);
				await processClient.close().catch((closeError) => {
					this.environment.logger?.warn(closeError);
				});
			}
			const replacement = { ...input };
			delete replacement.sessionId;
			return this.runAgent(replacement);
		}
	}

	private async persistImageAttachments(
		attachments: readonly PreparedImageAttachment[],
	): Promise<void> {
		const storedIds: string[] = [];
		try {
			for (const attachment of attachments) {
				const temporary = join(
					this.attachmentsRoot,
					`attachment-${process.pid}-${crypto.randomUUID()}.tmp`,
				);
				try {
					await writeFile(temporary, attachment.data, {
						mode: 0o600,
						flag: "wx",
					});
					await rename(
						temporary,
						join(this.attachmentsRoot, attachment.metadata.id),
					);
					storedIds.push(attachment.metadata.id);
				} finally {
					await rm(temporary, { force: true });
				}
			}
		} catch (error) {
			await this.removeImageAttachments(storedIds);
			throw error;
		}
	}

	private async persistFileAttachments(
		files: readonly PreparedFileAttachment[],
	): Promise<void> {
		const storedIds: string[] = [];
		try {
			for (const file of files) {
				const temporary = join(
					this.attachmentsRoot,
					`file-${process.pid}-${crypto.randomUUID()}.tmp`,
				);
				try {
					await writeFile(temporary, file.data, { mode: 0o600, flag: "wx" });
					await rename(temporary, join(this.attachmentsRoot, file.metadata.id));
					storedIds.push(file.metadata.id);
				} finally {
					await rm(temporary, { force: true });
				}
			}
		} catch (error) {
			await this.removeFileAttachments(storedIds);
			throw error;
		}
	}

	private async removePendingAttachmentDeletions() {
		const pending = this.state.pendingAttachmentDeletions;
		if (pending === undefined) return;
		try {
			await this.removeImageAttachments(pending.imageIds);
			await this.removeFileAttachments(pending.fileIds);
			this.state = { ...this.state };
			delete this.state.pendingAttachmentDeletions;
			await this.persist();
		} catch (cause) {
			this.state = {
				...this.state,
				pendingAttachmentDeletions: pending,
			};
			throw new Error(
				"Conversation changes were saved, but attachment cleanup is pending. Retry deletion or restart Commonspace.",
				{ cause },
			);
		}
	}

	private async removeImageAttachments(ids: readonly string[]): Promise<void> {
		await Promise.all(
			ids.map((id) => rm(join(this.attachmentsRoot, id), { force: true })),
		);
	}

	private async removeFileAttachments(ids: readonly string[]): Promise<void> {
		await Promise.all(
			ids.map((id) => rm(join(this.attachmentsRoot, id), { force: true })),
		);
	}

	private publicRoutingConfiguration(): CommonspaceRoutingConfiguration {
		return publicRoutingConfiguration(this.routingConfiguration);
	}

	private async persistRoutingConfiguration(
		configuration: PrivateRoutingConfiguration,
	): Promise<void> {
		await this.overrides.beforePersistRoutingConfiguration?.(
			publicRoutingConfiguration(configuration),
		);
		if (configuration.provider === CommonspaceRoutingProvider.Unconfigured) {
			await rm(this.routingPath, { force: true });
			return;
		}
		const temporary = join(
			this.root,
			`routing-${process.pid}-${crypto.randomUUID()}.tmp`,
		);
		try {
			await writeFile(temporary, JSON.stringify(configuration, null, 2), {
				encoding: "utf8",
				mode: 0o600,
			});
			await rename(temporary, this.routingPath);
		} finally {
			await rm(temporary, { force: true });
		}
	}

	private persist(measurementScope?: "acceptance"): Promise<void> {
		const serializationStartedAt =
			measurementScope === undefined
				? undefined
				: this.performancePhaseStartedAt();
		const snapshot = JSON.stringify(this.state, null, 2);
		if (measurementScope !== undefined)
			this.recordPerformanceMeasurement(
				CommonspaceHostPerformancePhase.AcceptancePersistenceSerialization,
				serializationStartedAt,
			);
		const queuedAt =
			measurementScope === undefined
				? undefined
				: this.performancePhaseStartedAt();
		const task = this.writeTail
			.catch(() => undefined)
			.then(async () => {
				if (measurementScope !== undefined)
					this.recordPerformanceMeasurement(
						CommonspaceHostPerformancePhase.AcceptancePersistenceQueue,
						queuedAt,
					);
				const writeStartedAt =
					measurementScope === undefined
						? undefined
						: this.performancePhaseStartedAt();
				const temporary = join(
					this.root,
					`state-${process.pid}-${crypto.randomUUID()}.tmp`,
				);
				const backupTemporary = join(
					this.root,
					`state-backup-${process.pid}-${crypto.randomUUID()}.tmp`,
				);
				try {
					try {
						const previous = await readFile(this.statePath, "utf8");
						await writeFile(backupTemporary, previous, {
							encoding: "utf8",
							mode: 0o600,
						});
						await rename(backupTemporary, this.stateBackupPath);
					} catch (error) {
						if (errorCode(error) !== "ENOENT") throw error;
					}
					await writeFile(temporary, snapshot, {
						encoding: "utf8",
						mode: 0o600,
					});
					await rename(temporary, this.statePath);
				} finally {
					await Promise.all([
						rm(temporary, { force: true }),
						rm(backupTemporary, { force: true }),
					]);
					if (measurementScope !== undefined)
						this.recordPerformanceMeasurement(
							CommonspaceHostPerformancePhase.AcceptancePersistenceWrite,
							writeStartedAt,
						);
				}
			});
		this.writeTail = task.catch(() => undefined);
		return task;
	}
}

export async function createCommonspaceHost(
	environment: CommonspaceHostEnvironment,
	config: CommonspaceHostConfig = {},
): Promise<CommonspaceHostService> {
	const service = new CommonspaceHostService(environment, config);
	await service.initialize();
	return service;
}
