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
	CommonspaceQueuedFollowup,
	CommonspaceRetentionPreview,
	CommonspaceRoutingAssignment,
	CommonspaceRoutingConfiguration,
	CommonspaceRoutingCorrection,
	CommonspaceRoutingDecision,
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
	SendMessageRequest,
	SendMessageResponse,
	StopAgentRunsRequest,
	StopAgentRunsResponse,
	UpdateChannelContextRequest,
	UpdateRoutingConfigurationRequest,
	UpdateThreadContextRequest,
	UpdateWorkspaceSettingsRequest,
} from "@commonspace/shared";
import {
	AGENT_ADAPTER_KINDS,
	AGENT_ADAPTERS,
	agentMentionName,
	COMMONSPACE_EXPORT_VERSION,
	COMMONSPACE_STATE_VERSION,
	conversationKey,
	deriveCommonspaceInboxItems,
	isAgentAdapterKind,
	projectTagName,
	referencedProjectIds,
	uniqueAgentDisplayName,
} from "@commonspace/shared";
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
	buildRoutingPrompt,
	completeWithOpenAICompatible,
	InferenceResponseTruncatedError,
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
	inferredChannelMemory,
	parseChannelContextCompaction,
} from "./context.js";
import {
	createDesktopNotifier,
	desktopNotificationForItem,
} from "./desktop-notifications.js";
import {
	type AgentGeneratedFile,
	credentialBearingFileName,
	MAX_FILE_ATTACHMENT_BYTES,
	MAX_FILE_ATTACHMENTS,
	MAX_FILE_ATTACHMENTS_BYTES,
	type PreparedFileAttachment,
	prepareAgentFileAttachments,
} from "./file-attachments.js";
import { type JsonObject, type JsonValue, jsonObject } from "./json.js";
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
	buildRoutingMemoryCompactionPrompt,
	parseRoutingMemoryCompaction,
} from "./routing-memory.js";
import {
	captureRunSnapshot,
	completeRunAttribution,
	type RunSnapshot,
} from "./run-attribution.js";
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
	isCommonspaceReasoning,
} from "./state.js";
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
const MAX_MCP_CONTEXT_CHARS = 64_000;

const MAX_MCP_CONTEXT_MESSAGES = 30;
const MAX_MCP_CREDENTIALS = 10_000;
const MAX_MCP_SEARCH_SNIPPET_CHARS = 500;
const MAX_RELAY_PEER_RESPONSE_CHARS = 4_000;
const MAX_TRACE_ENTRIES = 128;
const MAX_TRACE_CHARS = 256_000;
const DEFAULT_ROUTING_BASE_URL = "https://api.openai.com/v1";
const SHARED_CONTEXT_PRESSURE_TOKENS = 24_000;
const MANAGED_AGENT_ID_PATTERN = /^codex-[\p{L}\p{N}][\p{L}\p{N}-]{0,79}$/u;

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
	hermesYolo?: boolean;
	externalAgentYolo?: boolean;
	runBudgetSeconds?: number;
}

export interface CommonspaceHostEnvironment {
	logger?: {
		warn(cause: unknown): void;
	};
}

export function unsafeModeForAdapter(
	config: CommonspaceHostConfig,
	adapter: AgentAdapterKind,
): boolean {
	return adapter === "hermes"
		? config.hermesYolo === true
		: config.externalAgentYolo === true;
}

export interface AgentRunInput {
	agent: CommonspaceAgentProfile;
	cwd: string;
	additionalCwds: string[];
	sessionName: string;
	/** The one newly delivered Commonspace message, without replayed context. */
	message: string;
	maxResponseChars?: number;
	images?: readonly AgentImageInput[];
	files?: readonly AgentFileInput[];
	commonspaceScope?: CommonspaceMcpScope;
	sessionId?: string;
	model?: string;
	reasoning?: CommonspaceState["defaults"]["reasoning"];
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

export interface CommonspaceHostDependencies {
	discoverAgents(adapter: AgentAdapterKind): Promise<CommonspaceAgentProfile[]>;
	runAgent(input: AgentRunInput): Promise<string | AgentRunResult>;
	routeAgents(input: CommonspaceRouteInput): Promise<CommonspaceRouteResult>;
	notify(notification: CommonspaceDesktopNotification): Promise<void>;
	beforeAcceptSend?(prepared: PreparedSend): Promise<void>;
}

export interface CommonspaceRouteInput {
	text: string;
	context: string[];
	routingMemory: string;
	candidates: Array<
		Pick<CommonspaceAgentProfile, "id" | "displayName" | "description"> & {
			routingScore: number;
			matchedTerms: string[];
		}
	>;
	projects: Array<{ id: string; name: string }>;
	inferProjects: boolean;
	maxAgents: number;
}

export interface CommonspaceRouteResult {
	assignments?: Array<Omit<CommonspaceRoutingAssignment, "id">>;
	/** @deprecated Test-override compatibility while callers migrate to assignments. */
	agentIds?: string[];
	mode?: CommonspaceRoutingDecision["mode"];
	confidence?: number;
	reason: string;
}

interface PreparedSend {
	request: SendMessageRequest;
	text: string;
	attachments: PreparedImageAttachment[];
	files: PreparedFileAttachment[];

	agents: CommonspaceAgentProfile[];
	agentIds: string[];
	routing?: CommonspaceRoutingDecision;
	channel?: CommonspaceState["channels"][number];
	projects: CommonspaceState["projects"];
	inferProjects: boolean;
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

interface PrivateRoutingConfiguration
	extends Omit<CommonspaceRoutingConfiguration, "apiKeyConfigured"> {
	apiKey?: string;
}

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
	scopeKey: string;
	abortController: AbortController;
}

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
}

function messageId(): string {
	return crypto.randomUUID();
}

function now(): string {
	return new Date().toISOString();
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

function sameProjectSet(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((projectId) => right.includes(projectId))
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

interface McpPinView extends CommonspacePin {
	source?: {
		authorName: string;
		text?: string;
		attachment?: CommonspaceImageAttachment | CommonspaceFileAttachment;
	};
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

function defaultRoutingConfiguration(): PrivateRoutingConfiguration {
	return {
		provider: "openai-compatible",
		model: "gpt-4.1-mini",
		harnessAgentId: null,
		baseUrl: DEFAULT_ROUTING_BASE_URL,
	};
}

function normalizedRoutingBaseUrl(value: JsonValue | undefined): string {
	const raw =
		typeof value === "string" && value.trim() !== ""
			? value.trim()
			: DEFAULT_ROUTING_BASE_URL;
	if (raw.length > 2_000) throw new Error("routing base URL is too long");
	const parsed = new URL(raw);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new Error("routing base URL must use HTTP or HTTPS");
	return parsed.toString().replace(/\/$/u, "");
}

function routingUsesOpenAiOrigin(baseUrl: string): boolean {
	return new URL(baseUrl).origin === new URL(DEFAULT_ROUTING_BASE_URL).origin;
}

function sanitizeRoutingConfiguration(
	value: JsonValue | undefined,
): PrivateRoutingConfiguration {
	const record = plainRecord(value);
	if (record === null) return defaultRoutingConfiguration();
	if (record.provider !== "harness" && record.provider !== "openai-compatible")
		return defaultRoutingConfiguration();
	const provider = record.provider;
	const model =
		typeof record.model === "string" ? record.model.trim().slice(0, 200) : "";
	const harnessAgentId =
		typeof record.harnessAgentId === "string" &&
		record.harnessAgentId.trim() !== ""
			? record.harnessAgentId.trim().slice(0, 200)
			: null;
	let baseUrl = DEFAULT_ROUTING_BASE_URL;
	try {
		baseUrl = normalizedRoutingBaseUrl(record.baseUrl);
	} catch {
		// Invalid persisted URLs fall back without exposing or blocking the workspace.
	}
	const apiKey =
		typeof record.apiKey === "string" && record.apiKey !== ""
			? record.apiKey.slice(0, 10_000)
			: undefined;
	const configuration: PrivateRoutingConfiguration = {
		provider,
		model,
		harnessAgentId,
		baseUrl,
	};
	if (apiKey !== undefined) configuration.apiKey = apiKey;
	return configuration;
}

function isImageMimeType(
	value: JsonValue | undefined,
): value is CommonspaceImageMimeType {
	return typeof value === "string" && IMAGE_MIME_TYPES.has(value);
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
		if (
			typeof attachment.data !== "string" ||
			attachment.data.length === 0 ||
			attachment.data.length > Math.ceil(MAX_IMAGE_ATTACHMENT_BYTES / 3) * 4 + 4
		) {
			throw new Error("invalid image data");
		}
		if (
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
				attachment.data,
			)
		) {
			throw new Error("invalid image data");
		}
		const data = Buffer.from(attachment.data, "base64");
		if (
			data.length === 0 ||
			data.length > MAX_IMAGE_ATTACHMENT_BYTES ||
			data.toString("base64") !== attachment.data
		) {
			throw new Error("invalid image data");
		}
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
		const name = loadedString(file.name, 200).normalize("NFKC").trim();
		if (name === "" || name.includes("/") || name.includes("\\"))
			throw new Error("file name is invalid");
		if (credentialBearingFileName(name))
			throw new Error("credential-bearing files cannot be attached");
		const mimeType = loadedString(file.mimeType, 200)
			.trim()
			.toLocaleLowerCase();
		if (
			!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(
				mimeType,
			)
		)
			throw new Error("file MIME type is invalid");
		if (
			typeof file.data !== "string" ||
			file.data.length === 0 ||
			file.data.length > Math.ceil(MAX_FILE_ATTACHMENT_BYTES / 3) * 4 + 4 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
				file.data,
			)
		) {
			throw new Error("invalid file data");
		}
		const data = Buffer.from(file.data, "base64");
		if (
			data.length === 0 ||
			data.length > MAX_FILE_ATTACHMENT_BYTES ||
			data.toString("base64") !== file.data
		)
			throw new Error("invalid file data");
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

function sanitizeAgents(
	value: JsonValue | undefined,
): CommonspaceState["agents"] {
	if (!Array.isArray(value)) return [];
	const agents: CommonspaceState["agents"] = [];
	for (const candidate of value) {
		const agent = plainRecord(candidate);
		if (agent === null) continue;
		const adapter = agent.adapter;
		if (!isAgentAdapterKind(adapter)) continue;
		if (typeof agent.id !== "string") continue;
		if (adapter === "hermes") {
			if (
				agent.id.trim() !== agent.id ||
				agent.id === "" ||
				agent.id.length > 200 ||
				/\s/u.test(agent.id)
			)
				continue;
		} else if (
			adapter === "claude-code" ||
			adapter === "gemini" ||
			adapter === "opencode"
		) {
			if (agent.id !== adapter || agent.nativeProfile !== undefined) continue;
		} else if (agent.id !== "codex" && !MANAGED_AGENT_ID_PATTERN.test(agent.id))
			continue;
		const nativeProfile = agent.nativeProfile;
		if (
			nativeProfile !== undefined &&
			(typeof nativeProfile !== "string" ||
				nativeProfile.trim() !== nativeProfile ||
				nativeProfile === "" ||
				nativeProfile.length > 200 ||
				/\s/u.test(nativeProfile))
		)
			continue;
		if (
			typeof agent.displayName !== "string" ||
			agent.displayName.trim() === ""
		)
			continue;
		if (agent.model !== null && typeof agent.model !== "string") continue;
		if (typeof agent.createdAt !== "string") continue;
		const nativeDisplayName = agent.displayName
			.normalize("NFKC")
			.trim()
			.slice(0, 80);
		try {
			if (
				adapter === "codex" &&
				agent.id === "codex" &&
				nativeProfile !== undefined
			)
				continue;
			if (
				adapter === "codex" &&
				agent.id !== "codex" &&
				codexAgentId(
					typeof nativeProfile === "string" ? nativeProfile : nativeDisplayName,
				) !== agent.id
			)
				continue;
		} catch {
			continue;
		}
		const displayName = uniqueAgentDisplayName(
			nativeDisplayName,
			adapter,
			agents,
		);
		const model =
			typeof agent.model === "string" ? agent.model.trim().slice(0, 200) : null;
		const avatarEmoji =
			typeof agent.avatarEmoji === "string"
				? agent.avatarEmoji.normalize("NFKC").trim().slice(0, 16)
				: "";
		const accentColor =
			typeof agent.accentColor === "string" &&
			/^#[0-9a-fA-F]{6}$/u.test(agent.accentColor.trim())
				? agent.accentColor.trim().toLocaleLowerCase()
				: undefined;
		const sanitizedAgent: CommonspaceAgentDefinition = {
			id: agent.id,
			displayName,
			adapter,
			model: model === "" ? null : model,
			createdAt: agent.createdAt.slice(0, 100),
		};
		if (agent.fullAccess === true) sanitizedAgent.fullAccess = true;
		if (avatarEmoji !== "") sanitizedAgent.avatarEmoji = avatarEmoji;
		if (accentColor !== undefined) sanitizedAgent.accentColor = accentColor;
		if (typeof nativeProfile === "string")
			sanitizedAgent.nativeProfile = nativeProfile;
		agents.push(sanitizedAgent);
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

function loadedModel(value: JsonValue | undefined): string | null {
	if (value === null) return null;
	if (typeof value !== "string") return null;
	const model = value.trim().slice(0, 200);
	return model === "" ? null : model;
}

function sanitizeAgentTrace(
	value: JsonValue | undefined,
): CommonspaceAgentTrace | undefined {
	const trace = plainRecord(value);
	if (trace === null || !isAgentAdapterKind(trace.adapter)) return undefined;
	const startedAt = loadedString(trace.startedAt, 100);
	const completedAt = loadedString(trace.completedAt, 100);
	if (startedAt === "" || completedAt === "" || !Array.isArray(trace.entries))
		return undefined;
	let remainingChars = MAX_TRACE_CHARS;
	const take = (candidate: JsonValue | undefined, maximum: number): string => {
		if (remainingChars <= 0 || typeof candidate !== "string") return "";
		const text = candidate.slice(0, Math.min(maximum, remainingChars));
		remainingChars -= text.length;
		return text;
	};
	const entries: CommonspaceTraceEntry[] = [];
	const seen = new Set<string>();
	for (const candidate of trace.entries.slice(0, MAX_TRACE_ENTRIES)) {
		const entry = plainRecord(candidate);
		const type = entry?.type;
		const id = loadedId(entry?.id);
		if (
			entry === null ||
			id === null ||
			(type !== "reasoning" &&
				type !== "compaction" &&
				type !== "plan" &&
				type !== "tool" &&
				type !== "usage")
		)
			continue;
		const normalizedId = type === "usage" ? "usage" : id;
		const key = `${type}:${normalizedId}`;
		if (seen.has(key)) continue;
		const createdAt = loadedString(entry.createdAt, 100, startedAt);
		const updatedAt = loadedString(entry.updatedAt, 100, createdAt);
		if (type === "reasoning" || type === "compaction") {
			const text = take(entry.text, 64_000);
			if (text === "") continue;
			if (type === "reasoning") {
				entries.push({ type, id: normalizedId, text, createdAt, updatedAt });
			} else {
				const status =
					entry.status === "in_progress" ||
					entry.status === "completed" ||
					entry.status === "failed" ||
					entry.status === "cancelled"
						? entry.status
						: "in_progress";
				entries.push({
					type,
					id: normalizedId,
					status,
					text,
					createdAt,
					updatedAt,
				});
			}
		} else if (type === "plan") {
			const steps = Array.isArray(entry.steps)
				? entry.steps.slice(0, 64).flatMap((rawStep) => {
						const step = plainRecord(rawStep);
						if (step === null || typeof step.text !== "string") return [];
						const text = take(step.text, 2_000);
						if (text === "") return [];
						const priority: CommonspaceTracePlanStep["priority"] =
							step.priority === "high" || step.priority === "low"
								? step.priority
								: "medium";
						const status: CommonspaceTracePlanStep["status"] =
							step.status === "in_progress" || step.status === "completed"
								? step.status
								: "pending";
						return [{ text, priority, status }];
					})
				: [];
			const markdown = take(entry.markdown, 64_000);
			const planEntry: Extract<CommonspaceTraceEntry, { type: "plan" }> = {
				type,
				id: normalizedId,
				steps,
				createdAt,
				updatedAt,
			};
			if (markdown !== "") planEntry.markdown = markdown;
			entries.push(planEntry);
		} else if (type === "tool") {
			const title = take(entry.title, 1_000).trim();
			const toolName = take(entry.toolName, 200).trim();
			const toolKind = take(entry.toolKind, 100).trim();
			const input = take(entry.input, 16_000);
			const output = take(entry.output, 32_000);
			const status =
				entry.status === "in_progress" ||
				entry.status === "completed" ||
				entry.status === "failed"
					? entry.status
					: "pending";
			const toolEntry: Extract<CommonspaceTraceEntry, { type: "tool" }> = {
				type,
				id: normalizedId,
				title: title === "" ? "Tool call" : title,
				status,
				createdAt,
				updatedAt,
			};
			if (toolName !== "") toolEntry.toolName = toolName;
			if (toolKind !== "") toolEntry.toolKind = toolKind;
			if (input !== "") toolEntry.input = input;
			if (output !== "") toolEntry.output = output;
			entries.push(toolEntry);
		} else {
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
				typeof entry.costAmount === "number" &&
				Number.isFinite(entry.costAmount)
					? entry.costAmount
					: undefined;
			const costCurrency = take(entry.costCurrency, 20).trim();
			const usageEntry: Extract<CommonspaceTraceEntry, { type: "usage" }> = {
				type: "usage",
				id: "usage",
				usedTokens,
				contextWindow,
				createdAt,
				updatedAt,
			};
			if (costAmount !== undefined) usageEntry.costAmount = costAmount;
			if (costCurrency !== "") usageEntry.costCurrency = costCurrency;
			entries.push(usageEntry);
		}
		seen.add(key);
		if (remainingChars <= 0) break;
	}
	return { adapter: trace.adapter, startedAt, completedAt, entries };
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
		if (
			!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(
				mimeType,
			)
		)
			continue;
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

function sanitizeRoutingDecision(
	value: JsonValue | undefined,
	agentIds: ReadonlySet<string>,
	projectIds: ReadonlySet<string>,
	messageId: string,
	messageText: string,
	fallbackProjectIds: readonly string[],
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
	const routedAgentIds = [
		...new Set(
			routing.agentIds.filter(
				(id): id is string => typeof id === "string" && agentIds.has(id),
			),
		),
	];
	const status =
		routing.status === "pending" ||
		routing.status === "resolved" ||
		routing.status === "failed"
			? routing.status
			: undefined;
	const reason = routing.reason.normalize("NFKC").trim().slice(0, 500);
	if (
		(routedAgentIds.length === 0 &&
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
	).filter((projectId) => projectIds.has(projectId));
	const assignments: CommonspaceRoutingAssignment[] = [];
	const assignedAgents = new Set<string>();
	const assignmentIds = new Set<string>();
	if (Array.isArray(routing.assignments)) {
		for (const candidate of routing.assignments) {
			const assignment = plainRecord(candidate);
			const id = loadedId(assignment?.id);
			const agentId = loadedId(assignment?.agentId);
			const subRequest = loadedString(assignment?.subRequest, MAX_MESSAGE_CHARS)
				.normalize("NFKC")
				.trim();
			const assignmentProjectIds = loadedStringArray(
				assignment?.projectIds,
				32,
				200,
			).filter((projectId) => projectIds.has(projectId));
			if (
				assignment === null ||
				id === null ||
				assignmentIds.has(id) ||
				agentId === null ||
				!routedAgentIds.includes(agentId) ||
				subRequest === ""
			)
				continue;
			assignmentIds.add(id);
			assignedAgents.add(agentId);
			assignments.push({
				id,
				agentId,
				subRequest,
				projectIds: assignmentProjectIds,
			});
		}
	}
	for (const agentId of routedAgentIds) {
		if (assignedAgents.has(agentId)) continue;
		const id = `legacy:${messageId}:${agentId}`;
		assignmentIds.add(id);
		assignments.push({
			id,
			agentId,
			subRequest: messageText.slice(0, MAX_MESSAGE_CHARS),
			projectIds: [...fallbackProjectIds],
		});
	}
	const corrections: CommonspaceRoutingCorrection[] = [];
	const correctionIds = new Set<string>();
	const correctedAssignments = new Set<string>();
	if (Array.isArray(routing.corrections)) {
		for (const candidate of routing.corrections) {
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
	}
	const decision: CommonspaceRoutingDecision = {
		source: routing.source === "fallback" ? "local" : routing.source,
		agentIds: routedAgentIds,
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
		const root = plainRecord(candidate);
		if (
			root === null ||
			!Number.isInteger(root.rootIndex) ||
			Number(root.rootIndex) < 0
		)
			continue;
		const rootIndex = Number(root.rootIndex);
		const projectId = loadedId(root.projectId);
		const projectRootIndex =
			Number.isInteger(root.projectRootIndex) &&
			Number(root.projectRootIndex) >= 0
				? Number(root.projectRootIndex)
				: undefined;
		if (root.available === false) {
			const unavailableRoot: Extract<
				CommonspaceRunRootAttribution,
				{ available: false }
			> = {
				available: false,
				rootIndex,
				reason: loadedString(root.reason, 500),
			};
			if (projectId !== null) unavailableRoot.projectId = projectId;
			if (projectRootIndex !== undefined)
				unavailableRoot.projectRootIndex = projectRootIndex;
			roots.push(unavailableRoot);
			continue;
		}
		if (
			root.available !== true ||
			!Array.isArray(root.preExisting) ||
			!Array.isArray(root.observed)
		)
			continue;
		const preExisting = root.preExisting
			.slice(0, 1_000)
			.map(sanitizePreExistingRunChange)
			.filter((change) => change !== null);
		const observed: CommonspaceRunFileChange[] = root.observed
			.slice(0, 1_000)
			.map(sanitizeObservedRunChange)
			.filter((change) => change !== null);
		const availableRoot: AvailableRunRoot = {
			available: true,
			rootIndex,
			branch:
				typeof root.branch === "string" ? root.branch.slice(0, 500) : null,
			headBefore:
				typeof root.headBefore === "string"
					? root.headBefore.slice(0, 100)
					: null,
			headAfter:
				typeof root.headAfter === "string"
					? root.headAfter.slice(0, 100)
					: null,
			preExisting,
			observed,
		};
		if (projectId !== null) availableRoot.projectId = projectId;
		if (projectRootIndex !== undefined)
			availableRoot.projectRootIndex = projectRootIndex;
		roots.push(availableRoot);
	}
	return { startedAt, completedAt, roots };
}

function sanitizeMessages(
	value: JsonValue | undefined,
	channelIds: ReadonlySet<string>,
	agentIds: ReadonlySet<string>,
	projectIds: ReadonlySet<string>,
	threads: readonly CommonspaceThread[],
): CommonspaceState["messages"] {
	const record = plainRecord(value);
	if (record === null) return {};
	const threadIds = new Set(threads.map((thread) => thread.id));
	const messages: CommonspaceState["messages"] = {};
	for (const [key, rawMessages] of Object.entries(record)) {
		if (!Array.isArray(rawMessages)) continue;
		const separator = key.indexOf(":");
		const kind = key.slice(0, separator);
		const conversationId = separator < 1 ? "" : key.slice(separator + 1);
		if ((kind !== "channel" && kind !== "dm") || conversationId === "")
			continue;
		if (kind === "channel" && !channelIds.has(conversationId)) continue;
		if (kind === "dm" && !agentIds.has(conversationId)) continue;
		const seen = new Set<string>();
		const sanitized: CommonspaceMessage[] = [];
		for (const candidate of rawMessages) {
			const message = plainRecord(candidate);
			const conversation = plainRecord(message?.conversation);
			const id = loadedId(message?.id);
			const authorId = loadedId(message?.authorId);
			const authorName = loadedString(message?.authorName, 200).trim();
			if (
				message === null ||
				conversation === null ||
				id === null ||
				seen.has(id) ||
				authorId === null ||
				authorName === ""
			)
				continue;
			if (conversation.kind !== kind || conversation.id !== conversationId)
				continue;
			if (
				message.authorType !== "user" &&
				message.authorType !== "agent" &&
				message.authorType !== "system"
			)
				continue;
			if (typeof message.text !== "string") continue;
			const threadId = loadedId(message.threadId);
			if (
				message.threadId !== undefined &&
				(threadId === null || !threadIds.has(threadId))
			)
				continue;
			const parentMessageId = loadedId(message.parentMessageId);
			if (message.parentMessageId !== undefined && parentMessageId === null)
				continue;
			const sourceMessageId = loadedId(message.sourceMessageId);
			if (message.sourceMessageId !== undefined && sourceMessageId === null)
				continue;
			const versionRootMessageId = loadedId(message.versionRootMessageId);
			if (
				message.versionRootMessageId !== undefined &&
				versionRootMessageId === null
			)
				continue;
			const supersedesMessageId = loadedId(message.supersedesMessageId);
			if (
				message.supersedesMessageId !== undefined &&
				supersedesMessageId === null
			)
				continue;
			const branchId = loadedId(message.branchId);
			if (message.branchId !== undefined && branchId === null) continue;
			const deletedAt = loadedIsoTimestamp(message.deletedAt);
			const routingAssignmentId = loadedId(message.routingAssignmentId);
			if (
				message.routingAssignmentId !== undefined &&
				routingAssignmentId === null
			)
				continue;
			const trace =
				deletedAt === null && message.authorType === "agent"
					? sanitizeAgentTrace(message.trace)
					: undefined;
			const runAttribution =
				deletedAt === null && message.authorType === "agent"
					? sanitizeRunAttribution(message.runAttribution)
					: undefined;
			const attachments =
				deletedAt === null
					? sanitizeImageAttachments(message.attachments)
					: undefined;
			const files =
				deletedAt === null ? sanitizeFileAttachments(message.files) : undefined;

			const referencedProjects = loadedProjectIds(message, projectIds);
			const loadedRouting = sanitizeRoutingDecision(
				message.routing,
				agentIds,
				projectIds,
				id,
				deletedAt === null ? message.text : "[deleted]",
				referencedProjects,
			);
			const routing =
				deletedAt === null || loadedRouting === undefined
					? loadedRouting
					: {
							...loadedRouting,
							assignments: loadedRouting.assignments.map((assignment) => ({
								...assignment,
								subRequest: "[deleted]",
							})),
							reason: "Routing record retained for deleted message.",
						};
			seen.add(id);
			const sanitizedMessage: CommonspaceMessage = {
				id,
				conversation: { kind, id: conversationId },
				authorType: message.authorType,
				authorId,
				authorName,
				text: deletedAt === null ? message.text.slice(0, 64_000) : "",
				createdAt: loadedString(message.createdAt, 100),
			};
			if (attachments !== undefined) sanitizedMessage.attachments = attachments;
			if (files !== undefined) sanitizedMessage.files = files;
			const primaryProjectId = referencedProjects[0];
			if (primaryProjectId !== undefined) {
				sanitizedMessage.projectIds = referencedProjects;
				sanitizedMessage.projectId = primaryProjectId;
			}
			if (threadId !== null) sanitizedMessage.threadId = threadId;
			if (parentMessageId !== null)
				sanitizedMessage.parentMessageId = parentMessageId;
			if (sourceMessageId !== null)
				sanitizedMessage.sourceMessageId = sourceMessageId;
			if (versionRootMessageId !== null)
				sanitizedMessage.versionRootMessageId = versionRootMessageId;
			if (supersedesMessageId !== null)
				sanitizedMessage.supersedesMessageId = supersedesMessageId;
			if (branchId !== null) sanitizedMessage.branchId = branchId;
			if (deletedAt !== null) sanitizedMessage.deletedAt = deletedAt;
			if (routingAssignmentId !== null)
				sanitizedMessage.routingAssignmentId = routingAssignmentId;
			if (trace !== undefined) sanitizedMessage.trace = trace;
			if (runAttribution !== undefined)
				sanitizedMessage.runAttribution = runAttribution;
			if (routing !== undefined) sanitizedMessage.routing = routing;
			if (
				kind === "dm" &&
				message.authorType === "user" &&
				(message.replyStatus === "queued" ||
					message.replyStatus === "running" ||
					message.replyStatus === "complete" ||
					message.replyStatus === "needs_input" ||
					message.replyStatus === "failed" ||
					message.replyStatus === "cancelled" ||
					message.replyStatus === "silent" ||
					message.replyStatus === "timeout" ||
					message.replyStatus === "error")
			) {
				sanitizedMessage.replyStatus = message.replyStatus;
				if (typeof message.replyError === "string")
					sanitizedMessage.replyError = message.replyError.slice(0, 4_000);
			}
			sanitized.push(sanitizedMessage);
		}
		messages[key] = sanitized;
	}
	return messages;
}

function sanitizePins(
	value: JsonValue | undefined,
	channels: readonly CommonspaceState["channels"][number][],
	threads: readonly CommonspaceThread[],
	messages: CommonspaceState["messages"],
): CommonspacePin[] {
	if (!Array.isArray(value)) return [];
	const channelIds = new Set(channels.map((channel) => channel.id));
	const threadIds = new Set(threads.map((thread) => thread.id));
	const messageById = new Map(
		Object.values(messages)
			.flat()
			.map((message) => [message.id, message]),
	);
	const pins: CommonspacePin[] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const pin = plainRecord(candidate);
		const scope = plainRecord(pin?.scope);
		const id = loadedId(pin?.id);
		const scopeId = loadedId(scope?.id);
		const removedAt = loadedIsoTimestamp(pin?.removedAt);
		if (
			pin === null ||
			scope === null ||
			id === null ||
			ids.has(id) ||
			scopeId === null ||
			(scope.kind !== "channel" && scope.kind !== "thread") ||
			(removedAt === null &&
				!(scope.kind === "channel"
					? channelIds.has(scopeId)
					: threadIds.has(scopeId)))
		)
			continue;
		const common = {
			id,
			scope: { kind: scope.kind, id: scopeId },
			createdAt: loadedString(pin.createdAt, 100),
			removedAt,
		} as const;
		if (pin.kind === "note") {
			const note = loadedString(pin.note, 4_000).normalize("NFKC").trim();
			if (note === "") continue;
			pins.push({ ...common, kind: "note", note });
		} else if (pin.kind === "message" || pin.kind === "attachment") {
			const messageId = loadedId(pin.messageId);
			const message =
				messageId === null ? undefined : messageById.get(messageId);
			if (messageId === null || (removedAt === null && message === undefined))
				continue;
			if (pin.kind === "message")
				pins.push({ ...common, kind: "message", messageId });
			else {
				const attachmentId = loadedId(pin.attachmentId);
				if (
					attachmentId === null ||
					(removedAt === null &&
						message?.attachments?.some(
							(attachment) => attachment.id === attachmentId,
						) !== true &&
						message?.files?.some((file) => file.id === attachmentId) !== true)
				)
					continue;
				pins.push({ ...common, kind: "attachment", messageId, attachmentId });
			}
		} else continue;
		ids.add(id);
	}
	return pins;
}

function sanitizePermissions(
	value: JsonValue | undefined,
	agentIds: ReadonlySet<string>,
	messages: CommonspaceState["messages"],
): CommonspacePermissionRequest[] {
	if (!Array.isArray(value)) return [];
	const messageIds = new Set(
		Object.values(messages)
			.flat()
			.map((message) => message.id),
	);
	const permissions: CommonspacePermissionRequest[] = [];
	const ids = new Set<string>();
	for (const candidate of value) {
		const permission = plainRecord(candidate);
		const conversation = plainRecord(permission?.conversation);
		const id = loadedId(permission?.id);
		const sourceMessageId = loadedId(permission?.sourceMessageId);
		const agentId = loadedId(permission?.agentId);
		const toolCallId = loadedId(permission?.toolCallId);
		if (
			permission === null ||
			conversation === null ||
			id === null ||
			ids.has(id) ||
			sourceMessageId === null ||
			agentId === null ||
			toolCallId === null ||
			!agentIds.has(agentId) ||
			!messageIds.has(sourceMessageId) ||
			(conversation.kind !== "channel" && conversation.kind !== "dm") ||
			typeof conversation.id !== "string"
		)
			continue;
		const options: CommonspacePermissionOption[] = [];
		const optionIds = new Set<string>();
		if (Array.isArray(permission.options)) {
			for (const rawOption of permission.options.slice(0, 16)) {
				const option = plainRecord(rawOption);
				const optionId = loadedId(option?.optionId);
				const name = loadedString(option?.name, 200).normalize("NFKC").trim();
				const kind = loadedString(option?.kind, 100).trim();
				if (
					option === null ||
					optionId === null ||
					optionIds.has(optionId) ||
					name === "" ||
					kind === ""
				)
					continue;
				optionIds.add(optionId);
				options.push({ optionId, name, kind });
			}
		}
		if (options.length === 0) continue;
		const storedStatus =
			permission.status === "resolved" ||
			permission.status === "cancelled" ||
			permission.status === "interrupted"
				? permission.status
				: "interrupted";
		const selectedOptionId = loadedId(permission.selectedOptionId);
		const threadId = loadedId(permission.threadId);
		ids.add(id);
		const sanitizedPermission: CommonspacePermissionRequest = {
			id,
			sourceMessageId,
			agentId,
			conversation: { kind: conversation.kind, id: conversation.id },
			toolCallId,
			title:
				loadedString(permission.title, 1_000).normalize("NFKC").trim() ||
				"Permission requested",
			options,
			status: storedStatus,
			createdAt: loadedString(permission.createdAt, 100),
			resolvedAt: loadedIsoTimestamp(permission.resolvedAt),
		};
		if (threadId !== null) sanitizedPermission.threadId = threadId;
		if (typeof permission.kind === "string" && permission.kind.trim() !== "")
			sanitizedPermission.kind = permission.kind.trim().slice(0, 100);
		if (
			storedStatus === "resolved" &&
			selectedOptionId !== null &&
			optionIds.has(selectedOptionId)
		)
			sanitizedPermission.selectedOptionId = selectedOptionId;
		permissions.push(sanitizedPermission);
	}
	return permissions;
}

function sanitizeLoadedState(value: JsonValue): CommonspaceState {
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
	const stateDefaults = defaultCommonspaceDefaults();
	const rawDefaults = plainRecord(record.defaults) ?? {};
	const defaults: CommonspaceState["defaults"] = {
		model: loadedModel(rawDefaults.model),
		reasoning: isCommonspaceReasoning(rawDefaults.reasoning)
			? rawDefaults.reasoning
			: stateDefaults.reasoning,
		maxAgentsPerTurn: loadedBoundedInteger(
			rawDefaults.maxAgentsPerTurn,
			stateDefaults.maxAgentsPerTurn,
			1,
			8,
		),
		memoryThreads: loadedBoundedInteger(
			rawDefaults.memoryThreads,
			stateDefaults.memoryThreads,
			1,
			50,
		),
	};
	const projects = sanitizeProjects(record.projects);
	const agents = sanitizeAgents(record.agents);
	const agentIds = new Set(agents.map((agent) => agent.id));
	const projectIds = new Set(projects.map((project) => project.id));
	let channels = sanitizeChannels(record.channels).map((channel) => ({
		...channel,
		agentIds: channel.agentIds.filter((agentId) => agentIds.has(agentId)),
	}));
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
	const messages = sanitizeMessages(
		record.messages,
		new Set(channels.map((channel) => channel.id)),
		agentIds,
		projectIds,
		threads,
	);
	if (record.version < 19) {
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
	const pins = sanitizePins(record.pins, channels, threads, messages);
	const permissions = sanitizePermissions(
		record.permissions,
		agentIds,
		messages,
	);
	const messageIds = new Set(
		Object.values(messages)
			.flat()
			.map((message) => message.id),
	);
	const inboxMessageIds = new Set(
		Object.values(messages).flatMap((entries) =>
			entries
				.filter(
					(message) =>
						message.authorType === "agent" ||
						message.authorType === "system" ||
						message.replyStatus === "error" ||
						message.replyStatus === "failed" ||
						message.replyStatus === "timeout",
				)
				.map((message) => message.id),
		),
	);
	return {
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
		).filter((messageId) => inboxMessageIds.has(messageId)),
		inboxUnreadMessageIds: loadedStringArray(
			record.inboxUnreadMessageIds,
			10_000,
			200,
		).filter((messageId) => messageIds.has(messageId)),
		inboxSavedItemIds: loadedStringArray(
			record.inboxSavedItemIds,
			10_000,
			200,
		).filter((messageId) => inboxMessageIds.has(messageId)),
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
			new Set(channels.map((channel) => channel.id)),
		),
		projects,
		channels,
		threads,
		pins,
		permissions,
		messages,
	};
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
	private routingConfiguration: PrivateRoutingConfiguration =
		defaultRoutingConfiguration();
	private writeTail = Promise.resolve();
	private readonly agentSessionTails = new Map<string, Promise<unknown>>();
	private readonly channelMemoryTails = new Map<string, Promise<unknown>>();
	private readonly threadMemoryTails = new Map<string, Promise<unknown>>();
	private readonly revisionListeners = new Set<(revision: number) => void>();
	private readonly liveActivityListeners = new Set<
		(activities: readonly CommonspaceLiveAgentActivity[]) => void
	>();
	private readonly liveActivitiesById = new Map<
		string,
		CommonspaceLiveAgentActivity
	>();
	private readonly knownInboxItemIds = new Set<string>();
	private readonly activeAgentRuns = new Map<string, ActiveAgentRun>();
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
	private readonly activeConversationRuns = new Map<string, Promise<void>>();
	private readonly pendingFollowups = new Map<string, PendingFollowup[]>();
	private activeAdmissions = 0;
	private exclusiveAdmission = false;
	private readonly admissionIdleWaiters = new Set<() => void>();
	private readonly acpProcesses = new Map<string, AcpAgentProcess>();
	private readonly acpLaunchAccess = new WeakMap<AcpAgentProcess, boolean>();
	private readonly acpProcessClosures = new Map<string, Promise<void>>();
	private readonly activeAcpSessions = new Map<string, string>();
	private readonly mcpCredentials = new Map<
		string,
		{ fingerprint: string; scope: CommonspaceMcpScope; token: string }
	>();
	private readonly adapters: Record<AgentAdapterKind, NativeAgentAdapter>;
	private readonly hermesYolo: boolean;
	private readonly externalAgentYolo: boolean;
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
		this.hermesYolo = unsafeModeForAdapter(config, "hermes");
		this.externalAgentYolo = unsafeModeForAdapter(config, "codex");
		this.runBudgetSeconds =
			config.runBudgetSeconds === undefined
				? undefined
				: Math.min(3_600, Math.max(30, config.runBudgetSeconds));
		this.notifyDesktop = overrides.notify ?? createDesktopNotifier();
	}

	async initialize(): Promise<void> {
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		await chmod(this.root, 0o700);
		await mkdir(this.attachmentsRoot, { recursive: true, mode: 0o700 });
		await chmod(this.attachmentsRoot, 0o700);
		if (this.managedDefaultCwd) {
			await mkdir(this.defaultCwd, { recursive: true, mode: 0o700 });
			await chmod(this.defaultCwd, 0o700);
		}
		this.defaultCwd = await realpath(this.defaultCwd);
		try {
			this.routingConfiguration = sanitizeRoutingConfiguration(
				JSON.parse(await readFile(this.routingPath, "utf8")),
			);
		} catch (error) {
			if (errorCode(error) !== "ENOENT")
				this.environment.logger?.warn(
					"Commonspace ignored invalid routing configuration",
				);
			this.routingConfiguration = defaultRoutingConfiguration();
		}
		try {
			this.state = sanitizeLoadedState(
				JSON.parse(await readFile(this.statePath, "utf8")),
			);
		} catch (error) {
			const primaryMissing = errorCode(error) === "ENOENT";
			try {
				this.state = sanitizeLoadedState(
					JSON.parse(await readFile(this.stateBackupPath, "utf8")),
				);
				if (!primaryMissing) {
					await rm(this.stateCorruptPath, { force: true });
					await rename(this.statePath, this.stateCorruptPath);
				}
				this.environment.logger?.warn(
					"Commonspace recovered unavailable state.json from state.backup.json",
				);
			} catch (recoveryError) {
				if (!primaryMissing || errorCode(recoveryError) !== "ENOENT") {
					this.environment.logger?.warn(error);
					this.environment.logger?.warn(recoveryError);
					throw new AggregateError(
						[error, recoveryError],
						"Commonspace state and rollback backup are both invalid",
					);
				}
				let corruptStateExists = true;
				try {
					await readFile(this.stateCorruptPath, "utf8");
				} catch (corruptError) {
					if (errorCode(corruptError) !== "ENOENT") throw corruptError;
					corruptStateExists = false;
				}
				if (corruptStateExists)
					throw new Error(
						"Commonspace saved state is corrupt and no rollback backup is available",
					);
				this.state = createInitialState();
			}
		}
		this.state = await this.canonicalizeLoadedProjectPaths(this.state);
		this.state = this.redactLoadedTraces(this.state);
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
			const changed = JSON.stringify(memory) !== JSON.stringify(channel.memory);
			if (changed) memoryChanged = true;
			return changed ? { ...channel, memory } : channel;
		});
		if (memoryChanged) {
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				channels,
			};
		}
		this.markInterruptedRuns(
			"The previous Commonspace process ended before the agent completed.",
		);
		await this.persist();
		this.synchronizeNotificationBaseline();
	}

	private async canonicalizeLoadedProjectPaths(
		state: CommonspaceState,
	): Promise<CommonspaceState> {
		const projects: CommonspaceState["projects"] = [];
		for (const project of state.projects) {
			const paths: string[] = [];
			for (const path of project.paths) {
				try {
					const canonical = await this.validDirectory(path);
					if (!paths.includes(canonical)) paths.push(canonical);
				} catch {
					// Invalid persisted paths are dropped before they can reach an agent process.
				}
			}
			if (paths.length > 0) projects.push({ ...project, paths });
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
				entries.map((message) => {
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
						if (primaryProjectId !== undefined)
							sanitized.projectId = primaryProjectId;
					}
					if (sanitized.runAttribution !== undefined) {
						const referenced = new Set(references);
						const roots =
							references.length === 0
								? []
								: sanitized.runAttribution.roots.filter(
										(root) =>
											root.projectId === undefined ||
											referenced.has(root.projectId),
									);
						if (roots.length === 0) delete sanitized.runAttribution;
						else
							sanitized.runAttribution = { ...sanitized.runAttribution, roots };
					}
					return sanitized;
				}),
			]),
		);
		return { ...state, projects, threads, messages };
	}

	snapshot(): CommonspaceState {
		return structuredClone(this.state);
	}

	private publicSnapshot(): CommonspaceState {
		const snapshot = this.snapshot();
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
		this.closeOperation ??= (async () => {
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
		const scopedPins: McpPinView[] =
			scoped.channel === undefined
				? []
				: this.state.pins
						.filter(
							(pin) =>
								pin.removedAt === null &&
								((pin.scope.kind === "channel" &&
									pin.scope.id === scoped.channel?.id) ||
									(pin.scope.kind === "thread" &&
										pin.scope.id === scoped.thread?.id)),
						)
						.map((pin): McpPinView => {
							if (pin.kind === "note") return pin;
							const source = Object.values(this.state.messages)
								.flat()
								.find((message) => message.id === pin.messageId);
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
								source.files?.find(
									(candidate) => candidate.id === pin.attachmentId,
								);
							const view: McpPinView = {
								...pin,
								source: { authorName: source.authorName },
							};
							if (attachment !== undefined && view.source !== undefined)
								view.source.attachment = attachment;
							return view;
						});
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
			participants:
				scoped.channel === undefined
					? [{ id: scoped.agent.id, displayName: scoped.agent.displayName }]
					: scoped.channel.agentIds.flatMap((id) => {
							const agent = this.state.agents.find(
								(candidate) => candidate.id === id,
							);
							if (agent === undefined) return [];
							const profile = this.configuredAgents().find(
								(candidate) => candidate.id === agent.id,
							);
							const participant: McpParticipant = {
								id: agent.id,
								displayName: agent.displayName,
								adapter: agent.adapter,
							};
							if (profile?.description !== undefined)
								participant.description = profile.description;
							return [participant];
						}),
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
		return {
			agents: this.configuredAgents(),
			discoveredAgents: this.discoveredAgentCandidates,
			state: this.publicSnapshot(),
			liveActivities: this.liveActivities(),
			queuedFollowups: this.queuedFollowups(),
			routing: this.publicRoutingConfiguration(),
		};
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
		const readiness = (
			adapter: AgentAdapterKind,
		): "ready" | "unknown" | "attention" => {
			const roster = this.state.agents.filter(
				(agent) => agent.adapter === adapter,
			);
			if (roster.some((agent) => failedAgents.has(agent.id)))
				return "attention";
			if (roster.some((agent) => successfulAgents.has(agent.id)))
				return "ready";
			return "unknown";
		};
		const storageReady = await stat(this.root)
			.then((info) => info.isDirectory())
			.catch(() => false);
		const workspaceReady = await stat(this.defaultCwd)
			.then((info) => info.isDirectory())
			.catch(() => false);
		const routingUrl = new URL(this.routingConfiguration.baseUrl);
		const localRoutingHost =
			routingUrl.hostname === "localhost" ||
			routingUrl.hostname === "127.0.0.1" ||
			routingUrl.hostname === "::1";
		return {
			service: {
				status: storageReady && workspaceReady ? "ready" : "attention",
				stateVersion: COMMONSPACE_STATE_VERSION,
				storage: storageReady ? "ready" : "attention",
				projectlessWorkspace: workspaceReady ? "ready" : "attention",
			},
			inference: {
				provider: this.routingConfiguration.provider,
				location:
					this.routingConfiguration.provider === "harness" || localRoutingHost
						? "local"
						: "remote",
				configured:
					this.routingConfiguration.provider === "harness"
						? this.state.agents.some(
								(agent) =>
									agent.id === this.routingConfiguration.harnessAgentId,
							)
						: this.routingConfiguration.model !== "",
				sends: [
					"message text",
					"Agent labels",
					"Project labels",
					"shared context",
					"routing corrections",
				],
			},
			harnesses: AGENT_ADAPTER_KINDS.map((adapter) => ({
				adapter,
				installed: installed.has(adapter),
				rostered: this.state.agents.some((agent) => agent.adapter === adapter),
				runReadiness: readiness(adapter),
				recovery: AGENT_ADAPTERS[adapter].recovery,
			})),
		};
	}

	async exportWorkspace(): Promise<CommonspaceWorkspaceArchive> {
		const exportedAt = now();
		const state = this.publicSnapshot();
		const attachments: CommonspaceArchiveAttachment[] = [];
		const seen = new Set<string>();
		for (const message of Object.values(state.messages).flat()) {
			for (const attachment of message.attachments ?? []) {
				if (seen.has(attachment.id)) continue;
				seen.add(attachment.id);
				attachments.push({
					kind: "image",
					...attachment,
					data: "",
				});
			}
			for (const file of message.files ?? []) {
				if (seen.has(file.id)) continue;
				seen.add(file.id);
				attachments.push({
					kind: "file",
					...file,
					data: "",
				});
			}
		}
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
			this.routingConfiguration.apiKey ?? "",
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
			if (
				this.state.revision !== 0 ||
				this.state.agents.length > 0 ||
				this.state.projects.length > 0 ||
				this.state.channels.length > 0 ||
				this.state.threads.length > 0 ||
				Object.values(this.state.messages).some(
					(messages) => messages.length > 0,
				)
			) {
				throw new Error("workspace import requires an empty workspace");
			}
			const archive = plainRecord(archiveValue);
			const workspace = plainRecord(archive?.workspace);
			if (
				archive === null ||
				workspace === null ||
				archive.format !== "commonspace-workspace" ||
				archive.version !== COMMONSPACE_EXPORT_VERSION
			) {
				throw new Error("unsupported Commonspace workspace archive");
			}
			if (
				!Array.isArray(workspace.projects) ||
				!Array.isArray(archive.attachments) ||
				plainRecord(projectMappings) === null
			) {
				throw new Error("workspace archive is invalid");
			}
			const importedWorkspace = { ...workspace };
			if (Array.isArray(workspace.channels)) {
				importedWorkspace.channels = workspace.channels.map((candidate) => {
					const channel = plainRecord(candidate);
					if (channel === null || channel.settings === undefined)
						return candidate;
					const settings = plainRecord(channel.settings);
					if (
						settings === null ||
						Object.keys(settings).length !== 2 ||
						settings.model !== loadedModel(settings.model) ||
						(settings.reasoning !== null &&
							!isCommonspaceReasoning(settings.reasoning))
					) {
						throw new Error("workspace archive failed structural validation");
					}
					const currentChannel = { ...channel };
					delete currentChannel.settings;
					return currentChannel;
				});
			}
			const projects: CommonspaceState["projects"] = [];
			const mappedIds = new Set(Object.keys(projectMappings));
			for (const candidate of workspace.projects) {
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
				) {
					throw new Error("workspace archive contains an invalid Project");
				}
				const mapping = projectMappings[id];
				if (!Array.isArray(mapping) || mapping.length !== rootCount)
					throw new Error(
						`Project ${name} requires ${String(rootCount)} mapped local roots`,
					);
				const paths = await Promise.all(
					mapping.map((path) => this.validDirectory(path)),
				);
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
			const importedValue: JsonValue = JSON.parse(
				JSON.stringify({
					...importedWorkspace,
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
			if (workspace.inboxUnreadMessageIds !== undefined)
				canonicalWorkspace.inboxUnreadMessageIds =
					imported.inboxUnreadMessageIds ?? [];
			if (!isDeepStrictEqual(canonicalWorkspace, importedWorkspace))
				throw new Error("workspace archive failed structural validation");
			const expected = new Map<
				string,
				| { kind: "image"; metadata: CommonspaceImageAttachment }
				| { kind: "file"; metadata: CommonspaceFileAttachment }
			>();
			for (const message of Object.values(imported.messages).flat()) {
				for (const attachment of message.attachments ?? [])
					expected.set(attachment.id, { kind: "image", metadata: attachment });
				for (const file of message.files ?? [])
					expected.set(file.id, { kind: "file", metadata: file });
			}
			const images: PreparedImageAttachment[] = [];
			const files: PreparedFileAttachment[] = [];
			const importedIds = new Set<string>();
			for (const candidate of archive.attachments) {
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
				) {
					throw new Error("workspace archive attachment validation failed");
				}
				const data = Buffer.from(attachment.data, "base64");
				if (
					data.length !== expectation.metadata.size ||
					data.toString("base64") !== attachment.data
				)
					throw new Error("workspace archive attachment data is invalid");
				importedIds.add(id);
				if (expectation.kind === "image")
					images.push({ metadata: expectation.metadata, data });
				else files.push({ metadata: expectation.metadata, data });
			}
			if (importedIds.size !== expected.size)
				throw new Error("workspace archive is missing attachment data");
			const previousState = this.state;
			await this.persistImageAttachments(images);
			try {
				await this.persistFileAttachments(files);
			} catch (error) {
				await this.removeImageAttachments(
					images.map((image) => image.metadata.id),
				);
				throw error;
			}
			this.state = imported;
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
			this.revokeInvalidMcpCredentials();
			this.synchronizeNotificationBaseline();
			this.broadcastRevision();
			return this.publicSnapshot();
		}, "exclusive");
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
			pins: this.state.pins.filter(
				(pin) =>
					(pin.scope.kind === "channel" &&
						conversation.kind === "channel" &&
						pin.scope.id === conversation.id) ||
					(pin.scope.kind === "thread" && threadIds.has(pin.scope.id)) ||
					(pin.messageId !== undefined &&
						messages.some((message) => message.id === pin.messageId)),
			).length,
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
		return this.withAdmission(async () => {
			const preview = this.previewRetention(request.conversation);
			if (
				!Number.isSafeInteger(request.expectedRevision) ||
				request.expectedRevision !== preview.revision
			)
				throw new Error("retention preview is stale");
			const removedThreads =
				request.conversation.kind === "channel"
					? this.state.threads.filter(
							(thread) => thread.channelId === request.conversation.id,
						)
					: [];
			const runScopePrefix = `${request.conversation.kind}:${request.conversation.id}\u0000`;
			const hasActiveWork =
				[...this.liveActivitiesById.values()].some(
					(activity) =>
						activity.conversation.kind === request.conversation.kind &&
						activity.conversation.id === request.conversation.id,
				) ||
				[...this.activeConversationRuns.keys()].some((scope) =>
					scope.startsWith(runScopePrefix),
				) ||
				[...this.pendingFollowups.keys()].some((scope) =>
					scope.startsWith(runScopePrefix),
				) ||
				(request.conversation.kind === "channel" &&
					this.channelMemoryTails.has(request.conversation.id)) ||
				removedThreads.some((thread) => this.threadMemoryTails.has(thread.id));
			if (hasActiveWork) {
				throw new Error("conversation has active work");
			}
			const key = conversationKey(request.conversation);
			const removedMessages = this.state.messages[key] ?? [];
			const removedMessageIds = new Set(
				removedMessages.map((message) => message.id),
			);
			const imageIds = removedMessages.flatMap(
				(message) =>
					message.attachments?.map((attachment) => attachment.id) ?? [],
			);
			const fileIds = removedMessages.flatMap(
				(message) => message.files?.map((file) => file.id) ?? [],
			);
			const removedThreadIds = new Set(
				removedThreads.map((thread) => thread.id),
			);
			const removedSessionNames = new Set(
				removedThreads.map((thread) => `Commonspace Thread: ${thread.id}`),
			);
			if (request.conversation.kind === "dm") {
				removedSessionNames.add("Bot Chat");
				for (const name of Object.keys(
					this.state.agentSessions[request.conversation.id] ?? {},
				)) {
					if (name.startsWith("Commonspace DM: "))
						removedSessionNames.add(name);
				}
			}
			const agentSessions: CommonspaceState["agentSessions"] = {};
			for (const [agentId, sessions] of Object.entries(
				this.state.agentSessions,
			)) {
				if (
					request.conversation.kind === "dm" &&
					agentId !== request.conversation.id
				) {
					agentSessions[agentId] = sessions;
					continue;
				}
				const remaining = Object.fromEntries(
					Object.entries(sessions).filter(
						([name]) => !removedSessionNames.has(name),
					),
				);
				if (Object.keys(remaining).length > 0)
					agentSessions[agentId] = remaining;
			}
			const messages = { ...this.state.messages };
			delete messages[key];
			const dmSessions = { ...this.state.dmSessions };
			if (request.conversation.kind === "dm")
				delete dmSessions[request.conversation.id];
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				inboxReadMessageIds: this.state.inboxReadMessageIds.filter(
					(id) => !removedMessageIds.has(id),
				),
				inboxUnreadMessageIds: (this.state.inboxUnreadMessageIds ?? []).filter(
					(id) => !removedMessageIds.has(id),
				),
				inboxSavedItemIds: this.state.inboxSavedItemIds.filter(
					(id) => !removedMessageIds.has(id),
				),
				dmSessions,
				agentSessions,
				channels:
					request.conversation.kind === "channel"
						? this.state.channels.map((channel) =>
								channel.id === request.conversation.id
									? {
											...channel,
											memory: emptyChannelMemory(),
											routingMemory: emptyRoutingMemory(),
										}
									: channel,
							)
						: this.state.channels,
				threads: this.state.threads.filter(
					(thread) => !removedThreadIds.has(thread.id),
				),
				pins: this.state.pins.filter(
					(pin) =>
						!(
							(pin.scope.kind === "channel" &&
								request.conversation.kind === "channel" &&
								pin.scope.id === request.conversation.id) ||
							(pin.scope.kind === "thread" &&
								removedThreadIds.has(pin.scope.id)) ||
							(pin.messageId !== undefined &&
								removedMessageIds.has(pin.messageId))
						),
				),
				permissions: this.state.permissions.filter(
					(permission) =>
						!(
							permission.conversation.kind === request.conversation.kind &&
							permission.conversation.id === request.conversation.id
						),
				),
				messages,
			};
			try {
				await this.persist();
			} catch (error) {
				this.state = previousState;
				throw error;
			}
			await this.removeImageAttachments(imageIds);
			await this.removeFileAttachments(fileIds);
			this.revokeInvalidMcpCredentials();
			this.broadcastRevision();
			return preview;
		});
	}

	routing(): CommonspaceRoutingConfiguration {
		return this.publicRoutingConfiguration();
	}

	private prepareRoutingConfiguration(
		request: UpdateRoutingConfigurationRequest,
	): PrivateRoutingConfiguration {
		if (
			request.provider !== "harness" &&
			request.provider !== "openai-compatible"
		) {
			throw new Error("unsupported routing provider");
		}
		const model =
			request.provider === "openai-compatible"
				? request.model.normalize("NFKC").trim()
				: this.routingConfiguration.model;
		if (model.length > 200) throw new Error("routing model is too long");
		const harnessAgentId =
			request.provider === "harness"
				? request.harnessAgentId.trim() || null
				: null;
		if (
			request.provider === "harness" &&
			(harnessAgentId === null ||
				!this.state.agents.some((agent) => agent.id === harnessAgentId))
		) {
			throw new Error("routing harness must be a configured agent");
		}
		if (request.provider === "openai-compatible" && model === "")
			throw new Error("routing model is required");
		const baseUrl =
			request.provider === "openai-compatible"
				? normalizedRoutingBaseUrl(request.baseUrl)
				: this.routingConfiguration.baseUrl;
		const requestedApiKey =
			request.provider === "openai-compatible" ? request.apiKey : undefined;
		const apiKey =
			requestedApiKey === undefined
				? baseUrl === this.routingConfiguration.baseUrl
					? this.routingConfiguration.apiKey
					: undefined
				: requestedApiKey === null || requestedApiKey.trim() === ""
					? undefined
					: requestedApiKey.trim().slice(0, 10_000);
		const next: PrivateRoutingConfiguration = {
			provider: request.provider,
			model,
			harnessAgentId,
			baseUrl,
		};
		if (apiKey !== undefined) next.apiKey = apiKey;
		return next;
	}

	validateRoutingConfiguration(
		request: UpdateRoutingConfigurationRequest,
	): CommonspaceDiagnostics["inference"] {
		const candidate = this.prepareRoutingConfiguration(request);
		const routingUrl = new URL(candidate.baseUrl);
		const localRoutingHost =
			routingUrl.hostname === "localhost" ||
			routingUrl.hostname === "127.0.0.1" ||
			routingUrl.hostname === "::1";
		return {
			provider: candidate.provider,
			location:
				candidate.provider === "harness" || localRoutingHost
					? "local"
					: "remote",
			configured:
				candidate.provider === "harness"
					? this.state.agents.some(
							(agent) => agent.id === candidate.harnessAgentId,
						)
					: candidate.model !== "",
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
		request: UpdateRoutingConfigurationRequest,
	): Promise<CommonspaceRoutingConfiguration> {
		const next = this.prepareRoutingConfiguration(request);
		await this.persistRoutingConfiguration(next);
		this.routingConfiguration = next;
		return this.publicRoutingConfiguration();
	}

	async updateWorkspaceSettings(
		request: UpdateWorkspaceSettingsRequest,
	): Promise<CommonspaceBootstrap> {
		return this.withAdmission(async () => {
			const previousState = this.state;
			const previousRouting = this.routingConfiguration;
			const nextRouting = this.prepareRoutingConfiguration(request.routing);
			const defaultsMutation: Extract<
				CommonspaceMutation,
				{ action: "set-defaults" }
			> = { action: "set-defaults", ...request.defaults };
			const normalizedDefaults = await this.normalizeMutation(defaultsMutation);
			const nextState = applyMutation(this.state, normalizedDefaults);

			await this.persistRoutingConfiguration(nextRouting);
			this.state = nextState;
			try {
				await this.persist();
			} catch (error) {
				this.state = previousState;
				try {
					await this.persistRoutingConfiguration(previousRouting);
				} catch (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						"workspace settings failed and routing rollback also failed",
					);
				}
				throw error;
			}
			this.routingConfiguration = nextRouting;
			this.broadcastRevision();
			return this.bootstrap();
		});
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
				const memoryBefore = channel.memory;
				const projection = projectChannelMemory(
					this.state,
					channelId,
					this.state.defaults.memoryThreads,
				);
				this.state = {
					...this.state,
					revision: this.state.revision + 1,
					channels: this.state.channels.map((candidate) =>
						candidate.id === channelId
							? {
									...candidate,
									memory: { ...candidate.memory, status: "compacting" },
								}
							: candidate,
					),
				};
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
					this.state = {
						...this.state,
						revision: this.state.revision + 1,
						channels: this.state.channels.map((candidate) =>
							candidate.id === channelId ? { ...candidate, memory } : candidate,
						),
					};
					await this.persist();
					this.broadcastRevision();
					return structuredClone(memory);
				} catch (error) {
					if (
						this.state.channels.some((candidate) => candidate.id === channelId)
					) {
						this.state = {
							...this.state,
							revision: this.state.revision + 1,
							channels: this.state.channels.map((candidate) =>
								candidate.id === channelId
									? {
											...candidate,
											memory: { ...candidate.memory, status: "failed" },
										}
									: candidate,
							),
						};
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
				const thread = this.state.threads.find(
					(candidate) => candidate.id === threadId,
				);
				if (thread === undefined) throw new Error("unknown thread");
				const projection = projectThreadMemory(this.state, threadId);
				this.state = {
					...this.state,
					revision: this.state.revision + 1,
					threads: this.state.threads.map((candidate) =>
						candidate.id === threadId
							? {
									...candidate,
									context: {
										...candidate.context,
										memory: {
											...candidate.context.memory,
											status: "compacting",
										},
									},
								}
							: candidate,
					),
				};
				await this.persist();
				this.broadcastRevision();
				try {
					const compacted = parseChannelContextCompaction(
						await this.completeInference(
							"You compact bounded shared workspace context. Return only the requested JSON object.",
							buildThreadContextCompactionPrompt(this.state, threadId),
							2_000,
							{ kind: "isolated" },
						),
					);
					const inferred = inferredThreadMemory(projection, compacted, now());
					const current = this.state.threads.find(
						(candidate) => candidate.id === threadId,
					);
					if (current === undefined)
						throw new Error("thread was removed during context compaction");
					const latestProjection = projectThreadMemory(this.state, threadId);
					const memory =
						projection.compactedThroughMessageId ===
							latestProjection.compactedThroughMessageId &&
						projection.sourceMessageCount ===
							latestProjection.sourceMessageCount
							? inferred
							: mergeThreadMemoryProjection(inferred, latestProjection);
					const context = { ...current.context, memory };
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
				} catch (error) {
					if (
						this.state.threads.some((candidate) => candidate.id === threadId)
					) {
						this.state = {
							...this.state,
							revision: this.state.revision + 1,
							threads: this.state.threads.map((candidate) =>
								candidate.id === threadId
									? {
											...candidate,
											context: {
												...candidate.context,
												memory: {
													...candidate.context.memory,
													status: "failed",
												},
											},
										}
									: candidate,
							),
						};
						await this.persist();
						this.broadcastRevision();
					}
					throw error;
				}
			}),
		);
	}

	async addPin(request: AddPinRequest): Promise<CommonspacePin> {
		return this.withAdmission(async () => {
			const scope = plainRecord(request.scope);
			if (
				scope === null ||
				(scope.kind !== "channel" && scope.kind !== "thread") ||
				typeof scope.id !== "string" ||
				scope.id === ""
			) {
				throw new Error("invalid pin scope");
			}
			const pinScope = { kind: scope.kind, id: scope.id } as const;
			const channelId =
				pinScope.kind === "channel"
					? this.state.channels.some((channel) => channel.id === pinScope.id)
						? pinScope.id
						: undefined
					: this.state.threads.find((thread) => thread.id === pinScope.id)
							?.channelId;
			if (channelId === undefined) throw new Error("unknown pin scope");
			let sourceMessage: CommonspaceMessage | undefined;
			if (request.kind === "message" || request.kind === "attachment") {
				if (typeof request.messageId !== "string" || request.messageId === "")
					throw new Error("pin message id is required");
				sourceMessage = Object.values(this.state.messages)
					.flat()
					.find((message) => message.id === request.messageId);
				const belongsToScope =
					pinScope.kind === "channel"
						? sourceMessage?.conversation.kind === "channel" &&
							sourceMessage.conversation.id === channelId
						: sourceMessage?.threadId === pinScope.id;
				if (sourceMessage === undefined || !belongsToScope)
					throw new Error("pin source is outside its scope");
			}
			const common = {
				id: crypto.randomUUID(),
				scope: pinScope,
				createdAt: now(),
				removedAt: null,
			};
			let pin: CommonspacePin;
			if (request.kind === "note") {
				if (typeof request.note !== "string")
					throw new Error("pin note is required");
				const note = request.note.normalize("NFKC").trim().slice(0, 4_000);
				if (note === "") throw new Error("pin note is required");
				pin = { ...common, kind: "note", note };
			} else if (request.kind === "message") {
				pin = { ...common, kind: "message", messageId: request.messageId };
			} else if (request.kind === "attachment") {
				if (
					typeof request.attachmentId !== "string" ||
					(sourceMessage?.attachments?.some(
						(attachment) => attachment.id === request.attachmentId,
					) !== true &&
						sourceMessage?.files?.some(
							(file) => file.id === request.attachmentId,
						) !== true)
				) {
					throw new Error("pin attachment not found");
				}
				pin = {
					...common,
					kind: "attachment",
					messageId: request.messageId,
					attachmentId: request.attachmentId,
				};
			} else {
				throw new Error("unsupported pin kind");
			}
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				pins: [...this.state.pins, pin],
			};
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
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				pins: this.state.pins.map((candidate) =>
					candidate.id === pinId ? removed : candidate,
				),
			};
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
			if (typeof permissionId !== "string" || permissionId === "")
				throw new Error("permission id is required");
			if (typeof optionId !== "string" || optionId === "")
				throw new Error("permission option is required");
			const permission = this.state.permissions.find(
				(candidate) => candidate.id === permissionId,
			);
			if (permission === undefined)
				throw new Error("unknown permission request");
			if (permission.status !== "pending")
				throw new Error("permission request is no longer pending");
			if (!permission.options.some((option) => option.optionId === optionId))
				throw new Error("permission option was not advertised");
			const resolve = this.permissionResolvers.get(permissionId);
			if (resolve === undefined)
				throw new Error(
					"permission request is no longer attached to a native session",
				);
			const resolved: CommonspacePermissionRequest = {
				...permission,
				status: "resolved",
				selectedOptionId: optionId,
				resolvedAt: now(),
			};
			if (permission.conversation.kind === "dm") {
				this.updateMessageReplyStatus(
					permission.conversation,
					permission.sourceMessageId,
					"running",
				);
			}
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				permissions: this.state.permissions.map((candidate) =>
					candidate.id === permissionId ? resolved : candidate,
				),
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
			const projects = referencedProjectIds(scope).map((projectId) => {
				const project = this.state.projects.find(
					(candidate) => candidate.id === projectId,
				);
				if (project === undefined)
					throw new Error("Commonspace MCP project scope expired");
				return project;
			});
			const resolved: ResolvedMcpScope = {
				agent,
				projects,
			};
			if (projects[0] !== undefined) resolved.project = projects[0];
			return resolved;
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
		const projects = scopedProjectIds.map((projectId) => {
			const project = this.state.projects.find(
				(candidate) => candidate.id === projectId,
			);
			if (project === undefined)
				throw new Error("Commonspace MCP project scope expired");
			return project;
		});
		const resolved: ResolvedMcpScope = {
			agent,
			channel,
			thread,
			projects,
		};
		if (projects[0] !== undefined) resolved.project = projects[0];
		return resolved;
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

	private publicAgentTrace(
		value: CommonspaceAgentTrace,
		adapter: AgentAdapterKind,
	): CommonspaceAgentTrace | undefined {
		const serializedTrace: JsonValue = JSON.parse(JSON.stringify(value));
		const traceValue = plainRecord(serializedTrace) ?? {};
		traceValue.adapter = adapter;
		const trace = sanitizeAgentTrace(traceValue);
		if (trace === undefined) return undefined;
		const entries = trace.entries.map((entry): CommonspaceTraceEntry => {
			if (entry.type === "reasoning" || entry.type === "compaction") {
				return { ...entry, text: this.redactHostDetails(entry.text, 64_000) };
			}
			if (entry.type === "plan") {
				const redacted: Extract<CommonspaceTraceEntry, { type: "plan" }> = {
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
			if (entry.type === "tool") {
				const redacted: Extract<CommonspaceTraceEntry, { type: "tool" }> = {
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
			return entry;
		});
		return { ...trace, entries };
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

	async mutate(mutation: CommonspaceMutation): Promise<CommonspaceState> {
		return this.withAdmission(async () => {
			const previousState = this.state;
			const resetScope =
				mutation.action === "reset-dm" && typeof mutation.agentId === "string"
					? `${mutation.agentId}\u0000${this.state.dmSessions[mutation.agentId] ?? "Bot Chat"}`
					: undefined;
			const resetRuns =
				resetScope === undefined
					? []
					: [...this.activeAgentRuns.values()].filter(
							(run) => run.scopeKey === resetScope,
						);
			const removedChannelSessionNames =
				mutation.action === "remove-channel"
					? new Set([
							...this.state.threads
								.filter((thread) => thread.channelId === mutation.channelId)
								.map((thread) => `Commonspace Thread: ${thread.id}`),
							`${ROUTING_SESSION_SCOPE_PREFIX}${mutation.channelId}`,
						])
					: undefined;
			const removedChannelRoutingSessionPrefix =
				mutation.action === "remove-channel"
					? `${ROUTING_SESSION_SCOPE_PREFIX}${mutation.channelId}: `
					: undefined;
			const belongsToRemovedChannel = (sessionName: string): boolean =>
				removedChannelSessionNames?.has(sessionName) === true ||
				(removedChannelRoutingSessionPrefix !== undefined &&
					sessionName.startsWith(removedChannelRoutingSessionPrefix));
			const activeRemovedChannelSessions =
				removedChannelSessionNames === undefined
					? []
					: [...this.activeAcpSessions.entries()].flatMap(
							([key, sessionId]) => {
								const separator = key.indexOf("\u0000");
								if (
									separator < 1 ||
									!belongsToRemovedChannel(key.slice(separator + 1))
								)
									return [];
								return [{ key, agentId: key.slice(0, separator), sessionId }];
							},
						);
			if (mutation.action === "add-discovered-agent") {
				if (typeof mutation.agentId !== "string")
					throw new Error("discovered agent id is required");
				if (
					mutation.adapter !== undefined &&
					!isAgentAdapterKind(mutation.adapter)
				)
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
			} else {
				const normalized = await this.normalizeMutation(mutation);
				this.state = applyMutation(this.state, normalized);
			}
			try {
				await this.persist();
			} catch (error) {
				this.state = previousState;
				throw error;
			}
			this.revokeInvalidMcpCredentials();
			if (mutation.action === "update-agent-profile") {
				const previous = previousState.agents.find(
					(agent) => agent.id === mutation.agentId,
				);
				const updated = this.state.agents.find(
					(agent) => agent.id === mutation.agentId,
				);
				if (previous === undefined || updated === undefined)
					throw new Error("Updated agent identity is missing");
				if (this.agentFullAccess(previous) !== this.agentFullAccess(updated)) {
					const reason = "Interrupted because agent permissions changed.";
					let changed = this.interruptPendingPermissions(updated.id);
					const runs = [...this.activeAgentRuns.values()].filter(
						(run) => run.agentId === updated.id,
					);
					for (const run of runs) {
						run.abortController.abort(new Error(reason));
						const source = Object.values(this.state.messages)
							.flat()
							.find((message) => message.id === run.sourceMessageId);
						if (source?.conversation.kind === "dm")
							changed =
								this.updateMessageReplyStatus(
									source.conversation,
									source.id,
									"cancelled",
									reason,
								) || changed;
					}
					const processes = [...this.acpProcesses.entries()].filter(([key]) =>
						key.startsWith(`${updated.id}\u0000`),
					);
					for (const [key] of processes) {
						this.acpProcesses.delete(key);
						this.activeAcpSessions.delete(key);
					}
					await Promise.all(
						processes.map(([key, client]) => this.closeAcpProcess(key, client)),
					);
					if (changed) await this.persist();
				}
			}
			if (mutation.action === "remove-agent") {
				const processEntries = [...this.acpProcesses.entries()].filter(
					([key]) => key.startsWith(`${mutation.agentId}\u0000`),
				);
				for (const [key] of processEntries) this.acpProcesses.delete(key);
				for (const key of this.activeAcpSessions.keys()) {
					if (key.startsWith(`${mutation.agentId}\u0000`))
						this.activeAcpSessions.delete(key);
				}
				await Promise.all(
					processEntries.map(([key, processClient]) =>
						this.closeAcpProcess(key, processClient),
					),
				);
			} else if (mutation.action === "reset-dm" && resetScope !== undefined) {
				const processClient = this.acpProcesses.get(resetScope);
				const activeResetSession = this.activeAcpSessions.get(resetScope);
				this.acpProcesses.delete(resetScope);
				if (activeResetSession !== undefined)
					await processClient?.cancelSession(activeResetSession);
				for (const run of resetRuns)
					run.abortController.abort(new Error("Interrupted by /new."));
				if (processClient !== undefined)
					await this.closeAcpProcess(resetScope, processClient);
			} else if (mutation.action === "remove-channel") {
				const processEntries = [...this.acpProcesses.entries()].filter(
					([key]) => {
						const separator = key.indexOf("\u0000");
						return (
							separator >= 1 &&
							belongsToRemovedChannel(key.slice(separator + 1))
						);
					},
				);
				for (const [key] of processEntries) this.acpProcesses.delete(key);
				await Promise.all(
					activeRemovedChannelSessions.map(async ({ key, sessionId }) => {
						if (this.activeAcpSessions.get(key) === sessionId)
							this.activeAcpSessions.delete(key);
						await processEntries
							.find(([processKey]) => processKey === key)?.[1]
							.cancelSession(sessionId);
					}),
				);
				await Promise.all(
					processEntries.map(([key, processClient]) =>
						this.closeAcpProcess(key, processClient),
					),
				);
			}
			this.broadcastRevision();
			return this.publicSnapshot();
		});
	}

	async send(request: SendMessageRequest): Promise<SendMessageResponse> {
		return this.withAdmission(async () => {
			if (
				request.delivery !== undefined &&
				!["queue", "steer", "stop-and-send"].includes(request.delivery)
			) {
				throw new Error("invalid follow-up delivery mode");
			}
			const prepared = await this.prepareSend(request);
			return this.acceptPreparedSend(prepared);
		});
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
		const source = Object.values(this.state.messages)
			.flat()
			.find((message) => message.id === request.messageId);
		if (source === undefined) throw new Error("unknown message");
		if (source.authorType !== "user")
			throw new Error("only human messages can be edited");
		if (source.deletedAt !== undefined)
			throw new Error("deleted messages cannot be edited");
		if (source.conversation.kind === "dm")
			await this.mutate({
				action: "reset-dm",
				agentId: source.conversation.id,
			});
		return this.withAdmission(async () => {
			const currentSource = Object.values(this.state.messages)
				.flat()
				.find((message) => message.id === source.id);
			if (currentSource === undefined || currentSource.authorType !== "user")
				throw new Error("message changed before editing");
			if (currentSource.deletedAt !== undefined)
				throw new Error("deleted messages cannot be edited");
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
			if (
				currentSource.conversation.kind === "channel" &&
				currentSource.threadId !== undefined
			) {
				const sourceThread = this.state.threads.find(
					(thread) => thread.id === currentSource.threadId,
				);
				if (sourceThread === undefined)
					throw new Error("message branch source thread is unavailable");
				prepared.branch = {
					branchedFromThreadId: sourceThread.id,
					branchPointMessageId: currentSource.id,
					channelSnapshot: structuredClone(
						sourceThread.context.channelSnapshot,
					),
				};
			}
			return this.acceptPreparedSend(prepared);
		});
	}

	async deleteMessage(messageId: string): Promise<CommonspaceMessage> {
		return this.withAdmission(async () => {
			if (typeof messageId !== "string" || messageId === "")
				throw new Error("message id is required");
			const located = Object.entries(this.state.messages).flatMap(
				([key, messages]) => {
					const message = messages.find(
						(candidate) => candidate.id === messageId,
					);
					return message === undefined ? [] : [{ key, message }];
				},
			)[0];
			if (located === undefined) throw new Error("unknown message");
			if (located.message.deletedAt !== undefined)
				return structuredClone(located.message);
			const attachmentIds =
				located.message.attachments?.map((attachment) => attachment.id) ?? [];
			const fileIds = located.message.files?.map((file) => file.id) ?? [];
			const deleted: CommonspaceMessage = {
				...located.message,
				text: "",
				deletedAt: now(),
			};
			if (located.message.routing !== undefined)
				deleted.routing = {
					...located.message.routing,
					assignments: located.message.routing.assignments.map(
						(assignment) => ({ ...assignment, subRequest: "[deleted]" }),
					),
					reason: "Routing record retained for deleted message.",
				};
			delete deleted.attachments;
			delete deleted.files;
			delete deleted.trace;
			delete deleted.runAttribution;
			delete deleted.replyError;
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				messages: {
					...this.state.messages,
					[located.key]: (this.state.messages[located.key] ?? []).map(
						(message) => (message.id === messageId ? deleted : message),
					),
				},
			};
			if (deleted.threadId !== undefined) {
				const thread = this.state.threads.find(
					(candidate) => candidate.id === deleted.threadId,
				);
				if (thread !== undefined) {
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
			}
			if (deleted.conversation.kind === "channel") {
				const channel = this.state.channels.find(
					(candidate) => candidate.id === deleted.conversation.id,
				);
				if (channel !== undefined) {
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
						channels: this.state.channels.map((candidate) => {
							if (candidate.id !== channel.id) return candidate;
							const updated = { ...candidate, memory };
							if (deleted.routing !== undefined)
								updated.routingMemory = {
									...candidate.routingMemory,
									summary: "",
									status: "stale",
									compactedThroughCorrectionId: null,
									updatedAt: null,
								};
							return updated;
						}),
					};
				}
			}
			try {
				await this.persist();
			} catch (error) {
				this.state = previousState;
				throw error;
			}
			await this.removeImageAttachments(attachmentIds);
			await this.removeFileAttachments(fileIds);
			this.broadcastRevision();
			return structuredClone(deleted);
		});
	}

	private async acceptPreparedSend(
		prepared: PreparedSend,
	): Promise<SendMessageResponse> {
		await this.overrides.beforeAcceptSend?.(prepared);
		const response = await this.acceptSend(prepared);
		const scopeKey = this.followupScopeKey(
			prepared.request.conversation,
			response.thread?.id,
		);
		const delivery = prepared.request.delivery ?? "queue";
		if (this.activeConversationRuns.has(scopeKey)) {
			const queue = this.pendingFollowups.get(scopeKey) ?? [];
			const pending = { prepared, response, delivery };
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
			this.startConversationRun(scopeKey, { prepared, response, delivery });
		}
		return response;
	}

	async retryRouting(
		request: RetryRoutingRequest,
	): Promise<RetryRoutingResponse> {
		return this.withAdmission(async () => {
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

			const keyAndSource = Object.entries(this.state.messages).flatMap(
				([key, messages]) => {
					const source = messages.find(
						(message) => message.id === request.sourceMessageId,
					);
					return source === undefined ? [] : [{ key, source }];
				},
			)[0];
			if (
				keyAndSource === undefined ||
				keyAndSource.source.authorType !== "user" ||
				keyAndSource.source.conversation.kind !== "channel" ||
				keyAndSource.source.routing?.status !== "failed" ||
				keyAndSource.source.threadId === undefined
			)
				throw new Error("failed routing source message not found");
			const { key, source } = keyAndSource;
			const thread = this.state.threads.find(
				(candidate) => candidate.id === source.threadId,
			);
			if (thread === undefined || thread.channelId !== source.conversation.id)
				throw new Error("routing source thread not found");

			const sendRequest: SendMessageRequest = {
				conversation: source.conversation,
				text: source.text,
				threadId: thread.id,
			};
			const projectIds = referencedProjectIds(source);
			if (projectIds.length > 0) sendRequest.projectIds = projectIds;
			if (request.mode === "manual")
				sendRequest.targetAgentId = request.agentId;
			const prepared = await this.prepareSend(sendRequest);
			if (prepared.routing === undefined)
				throw new Error("routing retry did not produce a routing decision");
			prepared.attachments = await Promise.all(
				(source.attachments ?? []).map(async (attachment) => {
					const { data } = await this.readImageAttachment(attachment.id);
					return { metadata: attachment, data };
				}),
			);
			prepared.files = await Promise.all(
				(source.files ?? []).map(async (file) => {
					const { data } = await this.readFileAttachment(file.id);
					return { metadata: file, data };
				}),
			);
			const accepted: CommonspaceMessage = {
				...source,
				routing: prepared.routing,
			};
			delete accepted.replyStatus;
			delete accepted.replyError;
			const updatedThread = prepared.thread ?? thread;
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				messages: {
					...this.state.messages,
					[key]: (this.state.messages[key] ?? []).map((message) =>
						message.id === accepted.id ? accepted : message,
					),
				},
				threads: this.state.threads.map((candidate) =>
					candidate.id === updatedThread.id ? updatedThread : candidate,
				),
			};
			try {
				await this.persist();
			} catch (error) {
				this.state = previousState;
				throw error;
			}
			this.broadcastRevision();
			const response: RetryRoutingResponse = {
				accepted,
				thread: updatedThread,
				state: this.publicSnapshot(),
			};
			const pending = { prepared, response, delivery: "queue" as const };
			const scopeKey = this.followupScopeKey(source.conversation, thread.id);
			if (this.activeConversationRuns.has(scopeKey)) {
				const queue = this.pendingFollowups.get(scopeKey) ?? [];
				queue.push(pending);
				this.pendingFollowups.set(scopeKey, queue);
			} else {
				this.startConversationRun(scopeKey, pending);
			}
			return response;
		});
	}

	async rerouteAssignment(
		request: RerouteAssignmentRequest,
	): Promise<RerouteAssignmentResponse> {
		return this.withAdmission(async () => {
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
			if (typeof request.subRequest !== "string")
				throw new Error("corrected sub-request is required");
			if (!Array.isArray(request.projectIds))
				throw new Error("project ids must be an array");
			const subRequest = request.subRequest
				.normalize("NFKC")
				.trim()
				.slice(0, MAX_MESSAGE_CHARS);
			if (subRequest === "")
				throw new Error("corrected sub-request is required");
			const requestedProjectIds = [
				...new Set(
					request.projectIds.map((projectId) => {
						if (typeof projectId !== "string" || projectId.trim() === "")
							throw new Error("project id must be a non-empty string");
						return projectId.trim();
					}),
				),
			];
			if (requestedProjectIds.length > 32)
				throw new Error("an assignment can reference at most 32 projects");

			const keyAndSource = Object.entries(this.state.messages).flatMap(
				([key, messages]) => {
					const source = messages.find(
						(message) => message.id === request.sourceMessageId,
					);
					return source === undefined ? [] : [{ key, source }];
				},
			)[0];
			if (
				keyAndSource === undefined ||
				keyAndSource.source.authorType !== "user" ||
				keyAndSource.source.conversation.kind !== "channel" ||
				keyAndSource.source.routing === undefined
			) {
				throw new Error("routable source message not found");
			}
			const { key, source } = keyAndSource;
			const routing = source.routing;
			if (routing === undefined)
				throw new Error("routable source message not found");
			const original = routing.assignments.find(
				(assignment) => assignment.id === request.assignmentId,
			);
			if (original === undefined)
				throw new Error("routing assignment not found");
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
			const projects = requestedProjectIds.map((projectId) => {
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

			const assignment: CommonspaceRoutingAssignment = {
				id: crypto.randomUUID(),
				agentId: target.id,
				subRequest,
				projectIds: projects.map((project) => project.id),
			};
			const correction: CommonspaceRoutingCorrection = {
				id: crypto.randomUUID(),
				fromAssignmentId: original.id,
				toAssignmentId: assignment.id,
				createdAt: now(),
			};
			const updatedRouting: CommonspaceRoutingDecision = {
				...routing,
				status: "resolved",
				agentIds: [...new Set([...routing.agentIds, target.id])],
				assignments: [...routing.assignments, assignment],
				corrections: [...routing.corrections, correction],
			};
			const updatedSource: CommonspaceMessage = {
				...source,
				routing: updatedRouting,
			};
			const updatedThread: CommonspaceThread = {
				...thread,
				agentIds: [...new Set([...thread.agentIds, target.id])],
			};
			const correctionCount =
				Object.entries(this.state.messages)
					.filter(([messageKey]) => messageKey === key)
					.flatMap(([, messages]) => messages)
					.reduce(
						(count, message) =>
							count + (message.routing?.corrections.length ?? 0),
						0,
					) + 1;
			const updatedChannel = {
				...channel,
				agentIds: [...new Set([...channel.agentIds, target.id])],
				routingMemory: {
					...channel.routingMemory,
					status: "stale" as const,
					correctionCount,
				},
			};
			const previousState = this.state;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				channels: this.state.channels.map((candidate) =>
					candidate.id === updatedChannel.id ? updatedChannel : candidate,
				),
				threads: this.state.threads.map((candidate) =>
					candidate.id === updatedThread.id ? updatedThread : candidate,
				),
				messages: {
					...this.state.messages,
					[key]: (this.state.messages[key] ?? []).map((message) =>
						message.id === updatedSource.id ? updatedSource : message,
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

			const state = this.publicSnapshot();
			const prepared: PreparedSend = {
				request: {
					conversation: source.conversation,
					text: source.text,
					projectIds: assignment.projectIds,
					threadId: updatedThread.id,
				},
				text: source.text,
				attachments: await Promise.all(
					(source.attachments ?? []).map(async (attachment) => {
						const { data } = await this.readImageAttachment(attachment.id);
						return { metadata: attachment, data };
					}),
				),
				files: await Promise.all(
					(source.files ?? []).map(async (file) => {
						const { data } = await this.readFileAttachment(file.id);
						return { metadata: file, data };
					}),
				),
				agents,
				agentIds: [target.id],
				routing: {
					source: "explicit",
					status: "resolved",
					agentIds: [target.id],
					assignments: [assignment],
					corrections: [],
					inferredProjectIds: [],
					reason: "User corrected one routing assignment.",
				},
				channel: updatedChannel,
				projects,
				inferProjects: false,
				thread: updatedThread,
			};
			if (projects[0] !== undefined) prepared.project = projects[0];
			const response: SendMessageResponse = {
				accepted: updatedSource,
				thread: updatedThread,
				state,
			};
			const operation = Promise.all([
				this.processReplies(prepared, response),
				this.compactRoutingMemory(updatedChannel.id),
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
			return { sourceMessageId: source.id, assignment, correction, state };
		});
	}

	async reorderFollowup(
		request: ReorderFollowupRequest,
	): Promise<FollowupQueueResponse> {
		return this.withAdmission(async () => {
			if (typeof request.messageId !== "string" || request.messageId === "")
				throw new Error("message id is required");
			if (request.direction !== "up" && request.direction !== "down")
				throw new Error("invalid queue direction");
			for (const queue of this.pendingFollowups.values()) {
				const index = queue.findIndex(
					(item) => item.response.accepted.id === request.messageId,
				);
				if (index < 0) continue;
				const target = request.direction === "up" ? index - 1 : index + 1;
				if (target >= 0 && target < queue.length) {
					const [item] = queue.splice(index, 1);
					if (item === undefined)
						throw new Error("queued follow-up changed during reorder");
					queue.splice(target, 0, item);
					this.broadcastLiveActivities();
				}
				return { queuedFollowups: this.queuedFollowups() };
			}
			throw new Error("queued follow-up not found");
		});
	}

	async removeFollowup(
		request: RemoveFollowupRequest,
	): Promise<FollowupQueueResponse> {
		return this.withAdmission(async () => {
			if (typeof request.messageId !== "string" || request.messageId === "")
				throw new Error("message id is required");
			for (const [scopeKey, queue] of this.pendingFollowups) {
				const index = queue.findIndex(
					(item) => item.response.accepted.id === request.messageId,
				);
				if (index < 0) continue;
				const [removed] = queue.splice(index, 1);
				if (queue.length === 0) this.pendingFollowups.delete(scopeKey);
				if (removed !== undefined) {
					this.updateMessageReplyStatus(
						removed.prepared.request.conversation,
						request.messageId,
						"cancelled",
						"Removed from queue.",
					);
					await this.persist();
					this.broadcastRevision();
					this.broadcastLiveActivities();
				}
				return { queuedFollowups: this.queuedFollowups() };
			}
			throw new Error("queued follow-up not found");
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
					const sessionId = this.activeAcpSessions.get(run.scopeKey);
					if (sessionId !== undefined)
						await this.acpProcesses.get(run.scopeKey)?.cancelSession(sessionId);
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
			.flatMap((messages) => messages)
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
			.flatMap((messages) => messages)
			.flatMap((message) => message.files ?? [])
			.find((candidate) => candidate.id === id);
		if (metadata === undefined) throw new Error("unknown file attachment");
		const data = await readFile(join(this.attachmentsRoot, id));
		if (data.length !== metadata.size)
			throw new Error("file attachment is unavailable");
		return { metadata: structuredClone(metadata), data };
	}

	private async prepareSend(
		request: SendMessageRequest,
	): Promise<PreparedSend> {
		const text = request.text
			.normalize("NFKC")
			.trim()
			.slice(0, MAX_MESSAGE_CHARS);
		const attachments = prepareImageAttachments(request.attachments);
		const files = prepareFileAttachments(request.files);
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
		const compatibilityProjectId =
			request.projectId === undefined
				? undefined
				: (() => {
						if (
							typeof request.projectId !== "string" ||
							request.projectId.trim() === ""
						) {
							throw new Error("project id must be a non-empty string");
						}
						return request.projectId.trim();
					})();
		if (
			explicitProjectIds !== undefined &&
			compatibilityProjectId !== undefined &&
			explicitProjectIds[0] !== compatibilityProjectId
		) {
			throw new Error("project id must match the first project ids entry");
		}
		const projectSelectionProvided =
			explicitProjectIds !== undefined ||
			compatibilityProjectId !== undefined ||
			taggedProjects.length > 0;
		const legacyThreadProjectSelection =
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
		let agents = this.configuredAgents();
		let channel: PreparedSend["channel"];
		let projects: PreparedSend["projects"] = [];
		let project: PreparedSend["project"];
		let thread: PreparedSend["thread"];
		let dmSessionName: PreparedSend["dmSessionName"];
		let agentIds: string[];
		let routing: PreparedSend["routing"];

		if (request.conversation.kind === "channel") {
			channel = this.state.channels.find(
				(candidate) => candidate.id === request.conversation.id,
			);
			if (channel === undefined) throw new Error("unknown channel");
			if (request.threadId !== undefined) {
				thread = this.state.threads.find(
					(candidate) => candidate.id === request.threadId,
				);
				if (thread === undefined || thread.channelId !== channel.id)
					throw new Error("unknown channel thread");
				const threadProjectIds = referencedProjectIds(thread);
				const requestedProjectId = requestedProjectIds[0];
				const selectedExistingThreadProject =
					legacyThreadProjectSelection &&
					requestedProjectIds.length === 1 &&
					requestedProjectId !== undefined &&
					threadProjectIds.includes(requestedProjectId);
				const effectiveProjectIds =
					!projectSelectionProvided || selectedExistingThreadProject
						? threadProjectIds
						: requestedProjectIds;
				projects = effectiveProjectIds.map((projectId) => {
					const referenced = this.state.projects.find(
						(candidate) => candidate.id === projectId,
					);
					if (referenced === undefined)
						throw new Error("thread references an unknown project");
					return referenced;
				});
				if (!sameProjectSet(effectiveProjectIds, threadProjectIds)) {
					thread = {
						...thread,
						projectIds: effectiveProjectIds,
						projectId: effectiveProjectIds[0] ?? null,
					};
				}
			} else {
				projects = requestedProjectIds.map((projectId) => {
					const referenced = this.state.projects.find(
						(candidate) => candidate.id === projectId,
					);
					if (referenced === undefined) throw new Error("unknown project");
					return referenced;
				});
			}
			project = projects[0];
			const memberIds = new Set(thread?.agentIds ?? channel.agentIds);
			if (
				request.targetAgentId === undefined &&
				mentionedChannelAgents([...memberIds], text, agents).length === 0 &&
				agents.some(
					(agent) => memberIds.has(agent.id) && agent.status === "unknown",
				)
			) {
				const adapters = [
					...new Set(
						agents
							.filter(
								(agent) =>
									memberIds.has(agent.id) && agent.status === "unknown",
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
				agents = this.configuredAgents();
			}
			if (request.targetAgentId !== undefined) {
				if (thread === undefined)
					throw new Error("direct channel replies require a thread");
				if (
					!channel.agentIds.includes(request.targetAgentId) ||
					!agents.some((agent) => agent.id === request.targetAgentId)
				) {
					throw new Error("direct reply target is not a channel member");
				}
				agentIds = [request.targetAgentId];
				const routingAt = now();
				routing = {
					source: "explicit",
					...completedRoutingTiming(routingAt),
					agentIds,
					assignments: agentIds.map((agentId) => ({
						id: crypto.randomUUID(),
						agentId,
						subRequest: text,
						projectIds: projects.map((project) => project.id),
					})),
					corrections: [],
					inferredProjectIds: [],
					reason: "Direct reply target selected.",
				};
			} else {
				const explicitlyMentionedAgentIds = mentionedAgents(text, agents);
				channel = {
					...channel,
					agentIds: [
						...new Set([...channel.agentIds, ...explicitlyMentionedAgentIds]),
					],
				};
				if (thread !== undefined) {
					thread = {
						...thread,
						agentIds: [
							...new Set([...thread.agentIds, ...explicitlyMentionedAgentIds]),
						],
					};
				}
				const routedMemberIds = thread?.agentIds ?? channel.agentIds;
				const explicitlyAddressed = mentionedChannelAgents(
					routedMemberIds,
					text,
					agents,
				);
				if (explicitlyAddressed.length > 0) {
					agentIds = explicitlyAddressed;
					const routingAt = now();
					routing = {
						source: "explicit",
						...completedRoutingTiming(routingAt),
						agentIds,
						assignments: agentIds.map((agentId) => ({
							id: crypto.randomUUID(),
							agentId,
							subRequest: text,
							projectIds: projects.map((project) => project.id),
						})),
						corrections: [],
						inferredProjectIds: [],
						reason: parseTags(text).agents.includes("all")
							? "@all addressed every channel agent."
							: "Agent mention selected.",
					};
				} else {
					agentIds = [];
					routing = {
						source: "ai",
						status: "pending",
						startedAt: now(),
						agentIds,
						assignments: [],
						corrections: [],
						inferredProjectIds: [],
						reason: "Routing with inference.",
					};
				}
			}
		} else {
			if (request.threadId !== undefined)
				throw new Error("direct messages do not use channel threads");
			if (request.targetAgentId !== undefined)
				throw new Error("direct messages do not accept a reply target");
			if (!agents.some((agent) => agent.id === request.conversation.id))
				throw new Error("unknown agent");
			projects = requestedProjectIds.map((projectId) => {
				const referenced = this.state.projects.find(
					(candidate) => candidate.id === projectId,
				);
				if (referenced === undefined) throw new Error("unknown project");
				return referenced;
			});
			project = projects[0];
			agentIds = [request.conversation.id];
			dmSessionName =
				this.state.dmSessions[request.conversation.id] ?? "Bot Chat";
		}
		if (text === "" && attachments.length === 0 && files.length === 0)
			throw new Error("message text, image, or file is required");
		const inferProjects =
			request.conversation.kind === "channel" &&
			request.threadId === undefined &&
			!projectSelectionProvided;
		const prepared: PreparedSend = {
			request,
			text,
			attachments,
			files,
			agents,
			agentIds,
			projects,
			inferProjects,
		};
		if (routing !== undefined) prepared.routing = routing;
		if (channel !== undefined) prepared.channel = channel;
		if (project !== undefined) prepared.project = project;
		if (thread !== undefined) prepared.thread = thread;
		if (dmSessionName !== undefined) prepared.dmSessionName = dmSessionName;
		return prepared;
	}

	private async routeChannelMessage(
		text: string,
		request: SendMessageRequest,
		thread: CommonspaceThread | undefined,
		memberIds: readonly string[],
		agents: readonly CommonspaceAgentProfile[],
		inferProjects: boolean,
	): Promise<CommonspaceRouteResult> {
		const agentById = new Map(agents.map((agent) => [agent.id, agent]));
		const candidates = rankChannelAgents(memberIds, text, agents).flatMap(
			(signal) => {
				const agent = agentById.get(signal.id);
				if (agent === undefined) return [];
				const candidate: CommonspaceRouteInput["candidates"][number] = {
					id: agent.id,
					displayName: agent.displayName,
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
		const projects = (
			inferProjects
				? this.state.projects.map((project) => project.id)
				: explicitProjectIds
		).flatMap((projectId) => {
			const project = this.state.projects.find(
				(candidate) => candidate.id === projectId,
			);
			return project === undefined
				? []
				: [{ id: project.id, name: project.name }];
		});
		const context =
			thread === undefined
				? []
				: [
						...referencedProjectIds(thread).flatMap((projectId) => {
							const project = this.state.projects.find(
								(candidate) => candidate.id === projectId,
							);
							return project === undefined
								? []
								: [`Referenced Project: ${project.name}`];
						}),
						...(
							this.state.messages[conversationKey(request.conversation)] ?? []
						)
							.filter((message) => message.threadId === thread.id)
							.slice(-8)
							.map(
								(message) =>
									`${message.authorName}: ${message.text.slice(0, 1_000)}`,
							),
					];
		const input: CommonspaceRouteInput = {
			text,
			context,
			routingMemory:
				this.state.channels.find(
					(channel) => channel.id === request.conversation.id,
				)?.routingMemory.summary ?? "",
			candidates,
			projects,
			inferProjects,
			maxAgents: Math.min(
				this.state.defaults.maxAgentsPerTurn,
				candidates.length,
			),
		};
		try {
			const result =
				this.overrides.routeAgents === undefined
					? await this.routeAgents(request.conversation.id, input)
					: await this.overrides.routeAgents(input);
			const allowed = new Set(candidates.map((candidate) => candidate.id));
			const allowedProjects = new Set(projects.map((project) => project.id));
			const rawAssignments =
				result.assignments ??
				(result.agentIds ?? []).map((agentId) => ({
					agentId,
					subRequest: text,
					projectIds: projects.map((project) => project.id),
				}));
			if (
				rawAssignments.length === 0 ||
				rawAssignments.length > input.maxAgents
			)
				throw new Error(
					"inference routing returned an invalid assignment count",
				);
			const assignments: Array<Omit<CommonspaceRoutingAssignment, "id">> = [];
			const assignedAgents = new Set<string>();
			for (const assignment of rawAssignments) {
				if (
					!allowed.has(assignment.agentId) ||
					assignedAgents.has(assignment.agentId)
				)
					throw new Error("inference routing returned an invalid assignment");
				const subRequest = assignment.subRequest.normalize("NFKC").trim();
				const projectIds = [...new Set(assignment.projectIds)];
				if (
					subRequest === "" ||
					subRequest.length > MAX_MESSAGE_CHARS ||
					projectIds.some((projectId) => !allowedProjects.has(projectId))
				) {
					throw new Error("inference routing returned an invalid assignment");
				}
				assignedAgents.add(assignment.agentId);
				assignments.push({
					agentId: assignment.agentId,
					subRequest,
					projectIds,
				});
			}
			const agentIds = assignments.map((assignment) => assignment.agentId);
			const reason = result.reason.normalize("NFKC").trim().slice(0, 500);
			if (agentIds.length === 0 || reason === "")
				throw new Error("inference routing returned no valid decision");
			const confidence =
				typeof result.confidence === "number" &&
				Number.isFinite(result.confidence)
					? Math.max(0, Math.min(1, result.confidence))
					: undefined;
			const routeResult: CommonspaceRouteResult = {
				assignments,
				agentIds,
				reason,
			};
			if (result.mode !== undefined) routeResult.mode = result.mode;
			if (confidence !== undefined) routeResult.confidence = confidence;
			return routeResult;
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
				await this.processReplies(current.prepared, current.response);
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
		await Promise.all(
			runs.map(async (run) => {
				run.abortController.abort(new Error(reason));
				const sessionId = this.activeAcpSessions.get(run.scopeKey);
				if (sessionId !== undefined)
					await this.acpProcesses.get(run.scopeKey)?.cancelSession(sessionId);
			}),
		);
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

	private async acceptSend(
		prepared: PreparedSend,
	): Promise<SendMessageResponse> {
		if (!this.conversationIsCurrent(prepared, prepared.thread)) {
			throw new Error("conversation changed before message acceptance");
		}
		const previousState = this.state;
		await this.persistImageAttachments(prepared.attachments);
		try {
			await this.persistFileAttachments(prepared.files);
		} catch (error) {
			await this.removeImageAttachments(
				prepared.attachments.map((attachment) => attachment.metadata.id),
			);
			throw error;
		}
		const createdAt = now();
		const acceptedId = messageId();
		let thread = prepared.thread;
		if (
			prepared.request.conversation.kind === "channel" &&
			thread === undefined
		) {
			const id = crypto.randomUUID();
			const createdThread: CommonspaceThread = {
				id,
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
				createdThread.branchedFromThreadId =
					prepared.branch.branchedFromThreadId;
				createdThread.branchPointMessageId =
					prepared.branch.branchPointMessageId;
			}
			thread = createdThread;
		}
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
		if (prepared.channel !== undefined) {
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
								memory: mergeChannelMemoryProjection(
									channel.memory,
									projection,
								),
							}
						: channel,
				),
			};
		}
		if (thread !== undefined) {
			const storedThread = this.state.threads.find(
				(candidate) => candidate.id === thread?.id,
			);
			if (storedThread !== undefined) {
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
				thread = updatedThread;
				this.state = {
					...this.state,
					threads: this.state.threads.map((candidate) =>
						candidate.id === updatedThread.id ? updatedThread : candidate,
					),
				};
			}
		}
		try {
			await this.persist();
		} catch (error) {
			this.state = previousState;
			await this.removeImageAttachments(
				prepared.attachments.map((attachment) => attachment.metadata.id),
			);
			await this.removeFileAttachments(
				prepared.files.map((file) => file.metadata.id),
			);
			throw error;
		}
		this.broadcastRevision();
		const sendResponse: SendMessageResponse = {
			accepted,
			state: this.publicSnapshot(),
		};
		if (thread !== undefined) sendResponse.thread = thread;
		return sendResponse;
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
		const prepared = routed.prepared;
		const response = routed.response;
		const thread = response.thread;
		const explicitlyTargetsAll =
			prepared.request.conversation.kind === "channel" &&
			parseTags(prepared.text).agents.includes("all");
		const effectiveLimit = explicitlyTargetsAll
			? prepared.agentIds.length
			: this.state.defaults.maxAgentsPerTurn;
		const effectiveModel = this.state.defaults.model ?? undefined;
		const effectiveReasoning = this.state.defaults.reasoning;
		const memberIds =
			prepared.channel?.agentIds ?? thread?.agentIds ?? prepared.agentIds;
		const delivered = new Set<string>();
		const routingAssignments = prepared.routing?.assignments ?? [];
		const relayMode = prepared.routing?.mode === "relay";
		const remainingRelayAssignments = relayMode
			? routingAssignments.slice(1)
			: [];
		const relayEdges = new Set<string>();
		let deliveredTurns = 0;
		const maxRelayTurns = effectiveLimit;
		const mentionForAgentId = (agentId: string): string => {
			const agent = prepared.agents.find(
				(candidate) => candidate.id === agentId,
			);
			return `@${agent === undefined ? agentId : agentMentionName(agent)}`;
		};
		let relayStopRecorded = false;
		const recordRelayStop = async (text: string): Promise<void> => {
			if (relayStopRecorded) return;
			relayStopRecorded = true;
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
		};

		const rootDelivery: AgentDelivery = {
			authorType: "user",
			authorId: response.accepted.authorId,
			authorName: response.accepted.authorName,
			text: response.accepted.text,
			projectIds: prepared.projects.map((project) => project.id),
		};
		if (prepared.attachments.length > 0)
			rootDelivery.images = prepared.attachments.map((attachment) => ({
				name: attachment.metadata.name,
				mimeType: attachment.metadata.mimeType,
				data: attachment.data.toString("base64"),
			}));
		if (prepared.files.length > 0)
			rootDelivery.files = prepared.files.map((file) => ({
				name: file.metadata.name,
				mimeType: file.metadata.mimeType,
				size: file.metadata.size,
				uri: pathToFileURL(join(this.attachmentsRoot, file.metadata.id)).href,
			}));

		const deliver = async (
			agentId: string,
			delivery: AgentDelivery,
			options: AgentDeliveryOptions = {},
		): Promise<void> => {
			if (!options.allowRepeat && delivered.has(agentId)) return;
			if (
				!relayMode &&
				!options.allowRepeat &&
				delivered.size >= effectiveLimit
			)
				return;
			if (
				(relayMode || options.allowRepeat) &&
				deliveredTurns >= maxRelayTurns
			) {
				await recordRelayStop(
					`Commonspace stopped the agent relay after ${String(maxRelayTurns)} turns to prevent a loop.`,
				);
				return;
			}
			if (options.edge !== undefined) {
				if (relayEdges.has(options.edge)) {
					const [fromAgentId = "agent", toAgentId = agentId] =
						options.edge.split("\u0000");
					await recordRelayStop(
						`Commonspace stopped the ${mentionForAgentId(fromAgentId)} to ${mentionForAgentId(toAgentId)} handoff because that relay edge already ran.`,
					);
					return;
				}
				relayEdges.add(options.edge);
			}
			delivered.add(agentId);
			deliveredTurns += 1;
			const agent = prepared.agents.find(
				(candidate) => candidate.id === agentId,
			);
			if (agent === undefined) return;
			if (thread !== undefined) {
				const currentThread = this.state.threads.find(
					(candidate) => candidate.id === thread.id,
				);
				if (
					currentThread !== undefined &&
					!currentThread.agentIds.includes(agent.id)
				) {
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
			}
			const projectById = new Map(
				prepared.projects.map((project) => [project.id, project]),
			);
			const deliveryProjects = (
				delivery.projectIds ?? prepared.projects.map((project) => project.id)
			).flatMap((projectId) => projectById.get(projectId) ?? []);
			const projectRoots = preparedProjectRoots(deliveryProjects);
			const cwd = projectRoots[0]?.path ?? this.defaultCwd;
			const authority = this.agentAuthority(agent);
			if (authority === undefined) return;
			const sessionName =
				prepared.request.conversation.kind === "dm"
					? (prepared.dmSessionName ?? "Bot Chat")
					: `Commonspace Thread: ${thread?.id ?? crypto.randomUUID()}`;
			const activeRun: ActiveAgentRun = {
				id: crypto.randomUUID(),
				sourceMessageId: response.accepted.id,
				agentId: agent.id,
				scopeKey: `${agent.id}\u0000${sessionName}`,
				abortController: new AbortController(),
			};
			this.activeAgentRuns.set(activeRun.id, activeRun);
			const projectsAreCurrent = () =>
				deliveryProjects.every(
					(project) =>
						this.state.projects.find(
							(candidate) => candidate.id === project.id,
						) === project,
				);
			const executionIsCurrent = () =>
				!activeRun.abortController.signal.aborted &&
				!this.closing &&
				this.agentAuthorityIsCurrent(agent, authority) &&
				projectsAreCurrent() &&
				this.conversationIsCurrent(prepared, thread);
			const sessionId = this.state.agentSessions[agent.id]?.[sessionName];
			const agentModel =
				effectiveModel ??
				(agent.adapter === "hermes" || agent.nativeProfile !== undefined
					? undefined
					: (agent.model ?? undefined));
			let agentResponse: AgentRunResult | null;
			let runStartedAt = now();
			let runSnapshots: Array<PreparedProjectRoot & { snapshot: RunSnapshot }> =
				[];
			try {
				agentResponse = await this.withAgentSessionLock(
					agent.id,
					sessionName,
					async () => {
						if (!executionIsCurrent()) return null;
						const liveActivityId = this.beginLiveActivity(
							activeRun.id,
							response.accepted.id,
							agent,
							prepared.request.conversation,
							thread?.id,
						);
						try {
							if (
								prepared.request.conversation.kind === "dm" &&
								this.updateMessageReplyStatus(
									prepared.request.conversation,
									response.accepted.id,
									"running",
								)
							) {
								await this.persist();
								this.broadcastRevision();
							}
							runStartedAt = now();
							runSnapshots = await Promise.all(
								projectRoots.map(async (root) => ({
									...root,
									snapshot: await captureRunSnapshot(root.path),
								})),
							);
							const commonspaceScope: CommonspaceMcpScope = {
								agentId: agent.id,
								conversation: prepared.request.conversation,
								sessionName,
								projectIds: deliveryProjects.map((project) => project.id),
							};
							if (prepared.request.conversation.kind === "channel")
								commonspaceScope.peers = memberIds.flatMap((memberId) => {
									if (memberId === agent.id) return [];
									const peer = prepared.agents.find(
										(candidate) => candidate.id === memberId,
									);
									if (peer === undefined) return [];
									const scopedPeer: NonNullable<
										CommonspaceMcpScope["peers"]
									>[number] = {
										id: peer.id,
										displayName: peer.displayName,
									};
									return [scopedPeer];
								});
							if (thread !== undefined) commonspaceScope.threadId = thread.id;
							if (deliveryProjects[0] !== undefined)
								commonspaceScope.projectId = deliveryProjects[0].id;
							const runInput: AgentRunInput = {
								agent,
								cwd,
								additionalCwds: projectRoots.slice(1).map((root) => root.path),
								sessionName,
								message: delivery.text,
								commonspaceScope,
								onTraceUpdate: (entries) => {
									if (executionIsCurrent())
										this.updateLiveActivity(liveActivityId, entries);
								},
								onPermissionRequest: (request) =>
									this.requestAgentPermission(
										activeRun,
										prepared.request.conversation,
										thread,
										request,
									),
								signal: activeRun.abortController.signal,
							};
							if (delivery.images !== undefined)
								runInput.images = delivery.images;
							if (delivery.files !== undefined) runInput.files = delivery.files;
							if (sessionId !== undefined) runInput.sessionId = sessionId;
							if (agentModel !== undefined) runInput.model = agentModel;
							if (agent.nativeProfile === undefined)
								runInput.reasoning = effectiveReasoning;
							this.executingAgentRunsByScope.set(activeRun.scopeKey, activeRun);
							try {
								return await this.runAgentWithSessionRecovery(
									runInput,
									executionIsCurrent,
								);
							} finally {
								if (
									this.executingAgentRunsByScope.get(activeRun.scopeKey) ===
									activeRun
								)
									this.executingAgentRunsByScope.delete(activeRun.scopeKey);
							}
						} finally {
							this.endLiveActivity(liveActivityId);
						}
					},
				);
			} catch (error) {
				this.pendingAgentHandoffs.delete(activeRun.id);
				if (!executionIsCurrent()) return;
				const message = this.publicAgentFailure(error);
				if (prepared.request.conversation.kind === "dm") {
					const status = /timed? out|timeout/iu.test(message)
						? "timeout"
						: "failed";
					this.updateMessageReplyStatus(
						prepared.request.conversation,
						response.accepted.id,
						status,
						message,
					);
				}
				const failure: CommonspaceMessage = {
					id: messageId(),
					sourceMessageId: response.accepted.id,
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
				await this.persist();
				this.broadcastRevision();
				return;
			} finally {
				this.activeAgentRuns.delete(activeRun.id);
			}
			const requestedHandoff = this.pendingAgentHandoffs.get(activeRun.id);
			this.pendingAgentHandoffs.delete(activeRun.id);
			if (agentResponse === null || !executionIsCurrent()) return;
			const requestedHandoffTarget =
				requestedHandoff === undefined
					? undefined
					: prepared.agents.find(
							(candidate) => candidate.id === requestedHandoff.targetAgentId,
						);
			if (agentResponse.sessionId !== undefined)
				this.rememberAgentSession(
					agent.id,
					sessionName,
					agentResponse.sessionId,
				);
			if (prepared.request.conversation.kind === "dm") {
				const status = completedReplyStatus(agentResponse.text);
				this.updateMessageReplyStatus(
					prepared.request.conversation,
					response.accepted.id,
					status,
					status === "silent"
						? "The agent completed without returning a visible response."
						: undefined,
				);
			}
			const trace =
				agentResponse.trace === undefined
					? undefined
					: this.publicAgentTrace(agentResponse.trace, agent.adapter);
			const completedAt = now();
			const runAttribution: CommonspaceRunAttribution | undefined =
				deliveryProjects.length === 0
					? undefined
					: {
							startedAt: runStartedAt,
							completedAt,
							roots: await Promise.all(
								runSnapshots.map(
									async ({
										path,
										snapshot,
										rootIndex,
										projectId,
										projectRootIndex,
									}) => ({
										...(await completeRunAttribution(
											path,
											snapshot,
											rootIndex,
										)),
										projectId,
										projectRootIndex,
									}),
								),
							),
						};
			let agentFiles: PreparedFileAttachment[] = [];
			try {
				agentFiles = await prepareAgentFileAttachments(
					agentResponse.files,
					projectRoots.length === 0
						? [this.defaultCwd]
						: projectRoots.map((root) => root.path),
					() => {
						this.environment.logger?.warn(
							"Commonspace ignored invalid Agent file.",
						);
					},
				);
				await this.persistFileAttachments(agentFiles);
			} catch (error) {
				agentFiles = [];
				this.environment.logger?.warn(
					`Commonspace could not persist Agent files: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			const reply: CommonspaceMessage = {
				id: messageId(),
				sourceMessageId: response.accepted.id,
				conversation: prepared.request.conversation,
				authorType: "agent",
				authorId: agent.id,
				authorName: agent.displayName,
				text:
					requestedHandoff === undefined || requestedHandoffTarget === undefined
						? agentResponse.text
						: `${agentResponse.text}\n\n@${agentMentionName(requestedHandoffTarget)} ${requestedHandoff.request}`,
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
			this.append(reply);
			await this.persist();
			this.broadcastRevision();
			if (prepared.request.conversation.kind === "channel") {
				if (requestedHandoff !== undefined) {
					const target = requestedHandoffTarget;
					if (target !== undefined) {
						const plannedIndex = remainingRelayAssignments.findIndex(
							(assignment) => assignment.agentId === target.id,
						);
						const plannedAssignment =
							plannedIndex < 0
								? undefined
								: remainingRelayAssignments.splice(plannedIndex, 1)[0];
						const targetAssignment =
							plannedAssignment ??
							routingAssignments.find(
								(assignment) => assignment.agentId === target.id,
							);
						const handoffDelivery: AgentDelivery = {
							authorType: "agent",
							authorId: agent.id,
							authorName: agent.displayName,
							text: `From ${agent.displayName}:\n\n${requestedHandoff.request}`,
						};
						if (targetAssignment !== undefined) {
							handoffDelivery.projectIds = targetAssignment.projectIds;
							handoffDelivery.routingAssignmentId = targetAssignment.id;
						} else if (delivery.projectIds !== undefined) {
							handoffDelivery.projectIds = delivery.projectIds;
						}
						inheritDeliveryAttachments(delivery, handoffDelivery);
						await deliver(target.id, handoffDelivery, {
							allowRepeat: true,
							edge: `${agent.id}\u0000${target.id}`,
						});
					}
					return;
				}
				if (relayMode) {
					const mentionedPeerId = finalHandoffAgent(
						memberIds,
						reply.text,
						prepared.agents,
					);
					const nextPeerId =
						mentionedPeerId === agent.id ? undefined : mentionedPeerId;
					const mentionedAssignmentIndex =
						nextPeerId === undefined
							? -1
							: remainingRelayAssignments.findIndex(
									(assignment) => assignment.agentId === nextPeerId,
								);
					const mentionedAssignment =
						mentionedAssignmentIndex < 0
							? undefined
							: remainingRelayAssignments.splice(
									mentionedAssignmentIndex,
									1,
								)[0];
					const next =
						nextPeerId === undefined
							? remainingRelayAssignments.shift()
							: mentionedAssignment;
					const nextAgentId = nextPeerId ?? next?.agentId;
					if (nextAgentId !== undefined) {
						const peerResponse = boundedRelayPeerResponse(reply.text);
						const targetAssignment =
							next ??
							routingAssignments.find(
								(assignment) => assignment.agentId === nextAgentId,
							);
						const nextDelivery: AgentDelivery = {
							authorType: "agent",
							authorId: agent.id,
							authorName: agent.displayName,
							text:
								next === undefined
									? `From ${agent.displayName}:\n\n${peerResponse}`
									: `From ${agent.displayName}:\n\n${peerResponse}\n\nYour relay assignment:\n\n${next.subRequest}`,
						};
						if (targetAssignment !== undefined) {
							nextDelivery.projectIds = targetAssignment.projectIds;
							nextDelivery.routingAssignmentId = targetAssignment.id;
						} else if (delivery.projectIds !== undefined) {
							nextDelivery.projectIds = delivery.projectIds;
						}
						inheritDeliveryAttachments(delivery, nextDelivery);
						await deliver(nextAgentId, nextDelivery, {
							allowRepeat: nextPeerId !== undefined,
							edge: `${agent.id}\u0000${nextAgentId}`,
						});
					}
					return;
				}
				const mentionedPeerId = finalHandoffAgent(
					memberIds,
					reply.text,
					prepared.agents,
				);
				const targetAgentId =
					mentionedPeerId === agent.id ? undefined : mentionedPeerId;
				if (targetAgentId !== undefined) {
					const targetAssignment = routingAssignments.find(
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
					await deliver(targetAgentId, handoff, {
						allowRepeat: true,
						edge: `${agent.id}\u0000${targetAgentId}`,
					});
				}
			}
		};

		const rootDeliveries =
			routingAssignments.length === 0
				? prepared.agentIds.map((agentId) => ({
						agentId,
						delivery: rootDelivery,
					}))
				: routingAssignments.map((assignment) => ({
						agentId: assignment.agentId,
						delivery: {
							...rootDelivery,
							text: assignment.subRequest,
							projectIds: assignment.projectIds,
							routingAssignmentId: assignment.id,
						},
					}));
		await Promise.all(
			(relayMode ? rootDeliveries.slice(0, 1) : rootDeliveries)
				.slice(0, effectiveLimit)
				.map(({ agentId, delivery }) => deliver(agentId, delivery)),
		);
		if (
			!this.closing &&
			thread !== undefined &&
			this.conversationIsCurrent(prepared, thread)
		) {
			await this.updateThreadMemory(thread.id);
			await this.updateChannelMemory(thread.channelId);
		}
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
			const routingThread = prepared.thread ?? response.thread;
			const memberIds =
				prepared.thread !== undefined && prepared.thread.agentIds.length > 0
					? prepared.thread.agentIds
					: (prepared.channel?.agentIds ?? []);
			const decision = await this.routeChannelMessage(
				prepared.text,
				prepared.request,
				routingThread,
				memberIds,
				prepared.agents,
				prepared.inferProjects,
			);
			const assignments: CommonspaceRoutingAssignment[] = (
				decision.assignments ?? []
			).map((assignment) => ({
				id: crypto.randomUUID(),
				...assignment,
			}));
			const inferredProjectIds = prepared.inferProjects
				? [
						...new Set(
							assignments.flatMap((assignment) => assignment.projectIds),
						),
					]
				: [];
			const inferredProjects = inferredProjectIds.map((projectId) => {
				const project = this.state.projects.find(
					(candidate) => candidate.id === projectId,
				);
				if (project === undefined)
					throw new Error("inference routing returned an unknown Project");
				return project;
			});
			const resolvedProjects = prepared.inferProjects
				? inferredProjects
				: prepared.projects;
			const timing = completedRoutingTiming(
				prepared.routing.startedAt ?? response.accepted.createdAt,
			);
			const routing: CommonspaceRoutingDecision = {
				source: "ai",
				status: "resolved",
				...timing,
				agentIds:
					decision.agentIds ??
					assignments.map((assignment) => assignment.agentId),
				assignments,
				corrections: [],
				inferredProjectIds,
				reason: decision.reason,
			};
			if (decision.mode !== undefined) routing.mode = decision.mode;
			if (decision.confidence !== undefined)
				routing.confidence = decision.confidence;
			const thread =
				response.thread === undefined
					? undefined
					: {
							...response.thread,
							agentIds: routing.agentIds,
							projectIds: resolvedProjects.map((project) => project.id),
							projectId: resolvedProjects[0]?.id ?? null,
						};
			const accepted: CommonspaceMessage = {
				...response.accepted,
				...projectReferenceFields(resolvedProjects),
				routing,
			};
			const key = conversationKey(prepared.request.conversation);
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				messages: {
					...this.state.messages,
					[key]: (this.state.messages[key] ?? []).map((message) =>
						message.id === accepted.id ? accepted : message,
					),
				},
				threads:
					thread === undefined
						? this.state.threads
						: this.state.threads.map((existing) =>
								existing.id === thread.id ? thread : existing,
							),
			};
			await this.persist();
			this.broadcastRevision();
			const nextPrepared: PreparedSend = {
				...prepared,
				agentIds: routing.agentIds,
				projects: resolvedProjects,
				routing,
			};
			if (resolvedProjects[0] !== undefined)
				nextPrepared.project = resolvedProjects[0];
			if (thread !== undefined) nextPrepared.thread = thread;
			const nextResponse: SendMessageResponse = {
				...response,
				accepted,
				state: this.publicSnapshot(),
			};
			if (thread !== undefined) nextResponse.thread = thread;
			return { prepared: nextPrepared, response: nextResponse };
		} catch (error) {
			const timing = completedRoutingTiming(
				prepared.routing.startedAt ?? response.accepted.createdAt,
			);
			const routing: CommonspaceRoutingDecision = {
				source: "ai",
				status: "failed",
				...timing,
				agentIds: [],
				assignments: [],
				corrections: [],
				inferredProjectIds: [],
				reason:
					error instanceof Error ? error.message : "Inference routing failed.",
			};
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
	}

	private agentAuthority(
		agent: CommonspaceAgentProfile,
	): CommonspaceAgentDefinition | undefined {
		return this.state.agents.find(
			(candidate) =>
				candidate.id === agent.id && candidate.adapter === agent.adapter,
		);
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

	private agentAuthorityIsCurrent(
		agent: CommonspaceAgentProfile,
		authority: CommonspaceAgentDefinition | undefined,
	): boolean {
		return (
			authority !== undefined &&
			this.state.agents.find((candidate) => candidate.id === agent.id) ===
				authority
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
		if ((projection.sourceMessageCount ?? 0) === 0)
			return { ...projection, origin: "inference" };
		const compacted = parseChannelContextCompaction(
			await this.completeInference(
				"You compact bounded shared workspace context. Return only the requested JSON object.",
				buildChannelContextCompactionPrompt(this.state, channelId, projection),
				2_000,
				{ kind: "isolated" },
			),
		);
		return inferredChannelMemory(projection, compacted, now());
	}

	private async compactRoutingMemory(channelId: string): Promise<void> {
		await this.withChannelMemoryLock(channelId, async () => {
			const source = buildRoutingMemoryCompactionPrompt(this.state, channelId);
			if (source === null) return;
			try {
				const summary = parseRoutingMemoryCompaction(
					await this.completeInference(
						"You compact bounded routing feedback. Return only the requested JSON object.",
						source.prompt,
						1_000,
						{ kind: "isolated" },
					),
				);
				if (!this.state.channels.some((channel) => channel.id === channelId))
					return;
				this.state = {
					...this.state,
					revision: this.state.revision + 1,
					channels: this.state.channels.map((channel) =>
						channel.id === channelId
							? {
									...channel,
									routingMemory: {
										summary,
										status: "current",
										correctionCount: source.correctionCount,
										compactedThroughCorrectionId:
											source.compactedThroughCorrectionId,
										updatedAt: now(),
									},
								}
							: channel,
					),
				};
			} catch (error) {
				this.environment.logger?.warn(
					`Commonspace routing memory compaction failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				if (!this.state.channels.some((channel) => channel.id === channelId))
					return;
				this.state = {
					...this.state,
					revision: this.state.revision + 1,
					channels: this.state.channels.map((channel) =>
						channel.id === channelId
							? {
									...channel,
									routingMemory: {
										...channel.routingMemory,
										status: "failed",
										correctionCount: source.correctionCount,
									},
								}
							: channel,
					),
				};
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
			let memory = mergeChannelMemoryProjection(channel.memory, projection);
			if (
				(projection.estimatedTokens ?? 0) >= SHARED_CONTEXT_PRESSURE_TOKENS &&
				memory.origin !== "user" &&
				(memory.origin === "automatic" || memory.status === "stale")
			) {
				try {
					const inferred = await this.inferChannelMemory(channelId, projection);
					const reconciled = this.reconcileInferredChannelMemory(
						channelId,
						channel.memory,
						projection,
						inferred,
					);
					if (reconciled === undefined) return;
					memory = reconciled;
				} catch (error) {
					this.environment.logger?.warn(
						`Commonspace context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					const currentChannel = this.state.channels.find(
						(candidate) => candidate.id === channelId,
					);
					if (currentChannel === undefined) return;
					memory = mergeChannelMemoryProjection(
						currentChannel.memory,
						projectChannelMemory(
							this.state,
							channelId,
							this.state.defaults.memoryThreads,
						),
					);
				}
			}
			if (!this.state.channels.some((candidate) => candidate.id === channelId))
				return;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				channels: this.state.channels.map((channel) =>
					channel.id === channelId ? { ...channel, memory } : channel,
				),
			};
			await this.persist();
			this.broadcastRevision();
		});
	}

	private async updateThreadMemory(threadId: string): Promise<void> {
		await this.withThreadMemoryLock(threadId, async () => {
			const thread = this.state.threads.find(
				(candidate) => candidate.id === threadId,
			);
			if (thread === undefined) return;
			const projection = projectThreadMemory(this.state, threadId);
			let memory = mergeThreadMemoryProjection(
				thread.context.memory,
				projection,
			);
			if (
				projection.estimatedTokens >= SHARED_CONTEXT_PRESSURE_TOKENS &&
				memory.origin !== "user" &&
				(memory.origin === "automatic" || memory.status === "stale")
			) {
				try {
					const compacted = parseChannelContextCompaction(
						await this.completeInference(
							"You compact bounded shared workspace context. Return only the requested JSON object.",
							buildThreadContextCompactionPrompt(this.state, threadId),
							2_000,
							{ kind: "isolated" },
						),
					);
					const inferred = inferredThreadMemory(projection, compacted, now());
					const latestProjection = projectThreadMemory(this.state, threadId);
					memory =
						projection.compactedThroughMessageId ===
							latestProjection.compactedThroughMessageId &&
						projection.sourceMessageCount ===
							latestProjection.sourceMessageCount
							? inferred
							: mergeThreadMemoryProjection(inferred, latestProjection);
				} catch (error) {
					this.environment.logger?.warn(
						`Commonspace Thread context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
					);
					const current = this.state.threads.find(
						(candidate) => candidate.id === threadId,
					);
					if (current === undefined) return;
					memory = mergeThreadMemoryProjection(
						current.context.memory,
						projectThreadMemory(this.state, threadId),
					);
				}
			}
			if (!this.state.threads.some((candidate) => candidate.id === threadId))
				return;
			this.state = {
				...this.state,
				revision: this.state.revision + 1,
				threads: this.state.threads.map((candidate) =>
					candidate.id === threadId
						? { ...candidate, context: { ...candidate.context, memory } }
						: candidate,
				),
			};
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

	private configuredAgents(
		discoveredAgents: CommonspaceAgentProfile[] = this
			.discoveredAgentCandidates,
	): CommonspaceAgentProfile[] {
		const discoveredById = new Map(
			discoveredAgents.map((agent) => [agent.id, agent]),
		);
		return this.state.agents.map<CommonspaceAgentProfile>((agent) => {
			const discovered = discoveredById.get(agent.id);
			if (discovered?.adapter === agent.adapter) {
				const profile: CommonspaceAgentProfile = {
					id: agent.id,
					displayName: agent.displayName,
					adapter: agent.adapter,
					model: discovered.model,
					status: discovered.status,
				};
				if (agent.fullAccess === true) profile.fullAccess = true;
				if (agent.avatarEmoji !== undefined)
					profile.avatarEmoji = agent.avatarEmoji;
				if (agent.accentColor !== undefined)
					profile.accentColor = agent.accentColor;
				if (agent.nativeProfile !== undefined)
					profile.nativeProfile = agent.nativeProfile;
				if (discovered.description !== undefined)
					profile.description = discovered.description;
				return profile;
			}
			const profile: CommonspaceAgentProfile = {
				id: agent.id,
				displayName: agent.displayName,
				adapter: agent.adapter,
				model: agent.model,
				status: "unknown",
			};
			if (agent.fullAccess === true) profile.fullAccess = true;
			if (agent.avatarEmoji !== undefined)
				profile.avatarEmoji = agent.avatarEmoji;
			if (agent.accentColor !== undefined)
				profile.accentColor = agent.accentColor;
			if (agent.nativeProfile !== undefined)
				profile.nativeProfile = agent.nativeProfile;
			return profile;
		});
	}

	private async completeInference(
		system: string,
		prompt: string,
		maxTokens: number,
		scope:
			| { kind: "channel-routing"; channelId: string }
			| { kind: "isolated" },
	): Promise<string> {
		if (this.routingConfiguration.provider === "openai-compatible") {
			const apiKey =
				this.routingConfiguration.apiKey ??
				(routingUsesOpenAiOrigin(this.routingConfiguration.baseUrl)
					? process.env.OPENAI_API_KEY
					: undefined);
			const inferenceOptions: Parameters<
				typeof completeWithOpenAICompatible
			>[0] = {
				baseUrl: this.routingConfiguration.baseUrl,
				model: this.routingConfiguration.model,
				signal: AbortSignal.timeout(30_000),
			};
			if (apiKey !== undefined) inferenceOptions.apiKey = apiKey;
			return completeWithOpenAICompatible(inferenceOptions, {
				system,
				prompt,
				maxTokens,
			});
		}
		if (this.routingConfiguration.provider === "harness") {
			const agent = this.configuredAgents().find(
				(candidate) =>
					candidate.id === this.routingConfiguration.harnessAgentId,
			);
			if (agent === undefined)
				throw new Error("routing harness is unavailable");
			const sessionName =
				scope.kind === "channel-routing"
					? `${ROUTING_SESSION_SCOPE_PREFIX}${scope.channelId}: ${crypto.randomUUID()}`
					: `Commonspace Inference: ${crypto.randomUUID()}`;
			const signal = AbortSignal.timeout(30_000);
			const scopeIsActive = (): boolean =>
				!signal.aborted &&
				(scope.kind === "isolated" ||
					this.state.channels.some(
						(channel) => channel.id === scope.channelId,
					));
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
					message: `${system}\n\nOutput token budget: at most ${String(maxTokens)} tokens.\n\n${prompt}`,
					maxResponseChars: Math.min(MAX_AGENT_RESPONSE_CHARS, maxTokens * 8),
					reasoning: "minimal",
					signal,
				};
				const result = await this.runAgentWithSessionRecovery(
					runInput,
					scopeIsActive,
				);
				if (result === null || !scopeIsActive()) throw scopeExpiredError();
				return result.text;
			};
			const invoke =
				scope.kind === "channel-routing"
					? () =>
							this.withAgentSessionLock(
								agent.id,
								`${ROUTING_SESSION_SCOPE_PREFIX}${scope.channelId}`,
								run,
							)
					: run;
			try {
				return await invoke();
			} finally {
				const scopeKey = `${agent.id}\u0000${sessionName}`;
				const processClient = this.acpProcesses.get(scopeKey);
				if (processClient !== undefined) {
					this.acpProcesses.delete(scopeKey);
					await processClient.close().catch((closeError) => {
						this.environment.logger?.warn(closeError);
					});
				}
			}
		}
		throw new Error("unsupported routing provider");
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
				if (
					!(error instanceof InferenceResponseTruncatedError) &&
					!(error instanceof RoutingResponseValidationError)
				)
					throw error;
				retryableFailure = error;
			}
		}
		throw retryableFailure;
	}

	private async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
		if (this.overrides.runAgent !== undefined) {
			const result = await this.overrides.runAgent(input);
			return typeof result === "string" ? { text: result } : result;
		}
		return this.runAcpAgent(input);
	}

	private beginLiveActivity(
		id: string,
		sourceMessageId: string,
		agent: CommonspaceAgentProfile,
		conversation: SendMessageRequest["conversation"],
		threadId: string | undefined,
	): string {
		const activity: CommonspaceLiveAgentActivity = {
			id,
			sourceMessageId,
			agentId: agent.id,
			agentName: agent.displayName,
			adapter: agent.adapter,
			conversation: structuredClone(conversation),
			startedAt: now(),
			entries: [],
		};
		if (threadId !== undefined) activity.threadId = threadId;
		this.liveActivitiesById.set(id, activity);
		this.broadcastLiveActivities();
		return id;
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

	private agentFullAccess(
		agent: Pick<CommonspaceAgentProfile, "adapter" | "fullAccess">,
	): boolean {
		return (
			agent.fullAccess === true ||
			(agent.adapter === "hermes" ? this.hermesYolo : this.externalAgentYolo)
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

	private async runAcpAgent(input: AgentRunInput): Promise<AgentRunResult> {
		if (input.signal.aborted) throw input.signal.reason;
		const activeScopeKey = `${input.agent.id}\u0000${input.sessionName}`;
		await this.acpProcessClosures.get(activeScopeKey);
		input.signal.throwIfAborted();
		const mcpServers = this.mcpServersFor(input);
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
			model: input.model,
			reasoning: input.reasoning,
		});
		let processClient = this.acpProcesses.get(activeScopeKey);
		if (
			processClient !== undefined &&
			this.acpLaunchAccess.get(processClient) !== fullAccess
		) {
			this.acpProcesses.delete(activeScopeKey);
			await this.closeAcpProcess(activeScopeKey, processClient);
			processClient = undefined;
		}
		if (processClient === undefined) {
			const launch = await adapter.launch(
				input.agent,
				fullAccess,
				input.signal,
			);
			if (input.signal.aborted) throw input.signal.reason;
			const latestAgent = this.state.agents.find(
				(agent) =>
					agent.id === input.agent.id && agent.adapter === input.agent.adapter,
			);
			if (latestAgent !== currentAgent)
				throw new Error("Agent settings changed before execution.");
			processClient = new AcpAgentProcess({
				...launch,
				cwd: input.cwd,
				requestTimeoutMs: ((this.runBudgetSeconds ?? 3_600) + 30) * 1000,
				maxResponseChars: MAX_AGENT_RESPONSE_CHARS,
				clientName: `commonspace-${input.agent.id}`,
			});
			this.acpProcesses.set(activeScopeKey, processClient);
			this.acpLaunchAccess.set(processClient, fullAccess);
		}
		let activeSessionId: string | undefined;
		const abortSetup = () => {
			if (activeSessionId !== undefined) return;
			if (this.acpProcesses.get(activeScopeKey) === processClient)
				this.acpProcesses.delete(activeScopeKey);
			void this.closeAcpProcess(activeScopeKey, processClient).catch((error) =>
				this.environment.logger?.warn(error),
			);
		};
		input.signal.addEventListener("abort", abortSetup, { once: true });
		try {
			if (input.signal.aborted) {
				abortSetup();
				throw input.signal.reason;
			}
			const acpInput: AcpRunInput = {
				cwd: input.cwd,
				additionalCwds: input.additionalCwds,
				message: input.message,
				mcpServers,
				signal: input.signal,
				...settings,
				onSessionReady: (sessionId) => {
					input.signal.throwIfAborted();
					activeSessionId = sessionId;
					this.activeAcpSessions.set(activeScopeKey, sessionId);
					input.signal.removeEventListener("abort", abortSetup);
				},
			};
			if (input.maxResponseChars !== undefined)
				acpInput.maxResponseChars = input.maxResponseChars;
			if (input.images !== undefined) acpInput.images = input.images;
			if (input.files !== undefined) acpInput.files = input.files;
			if (input.onTraceUpdate !== undefined)
				acpInput.onTraceUpdate = input.onTraceUpdate;
			if (input.onPermissionRequest !== undefined)
				acpInput.onPermissionRequest = input.onPermissionRequest;
			if (input.sessionId !== undefined) acpInput.sessionId = input.sessionId;
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
				this.activeAcpSessions.get(activeScopeKey) === activeSessionId
			) {
				this.activeAcpSessions.delete(activeScopeKey);
			}
		}
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
			if (!shouldContinue()) return null;
			this.forgetAgentSession(
				input.agent.id,
				input.sessionName,
				input.sessionId,
			);
			if (!shouldContinue()) return null;
			const scopeKey = `${input.agent.id}\u0000${input.sessionName}`;
			const processClient = this.acpProcesses.get(scopeKey);
			if (processClient !== undefined) {
				this.acpProcesses.delete(scopeKey);
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
		return {
			provider: this.routingConfiguration.provider,
			model: this.routingConfiguration.model,
			harnessAgentId: this.routingConfiguration.harnessAgentId,
			baseUrl: this.routingConfiguration.baseUrl,
			apiKeyConfigured:
				this.routingConfiguration.apiKey !== undefined ||
				(routingUsesOpenAiOrigin(this.routingConfiguration.baseUrl) &&
					process.env.OPENAI_API_KEY !== undefined),
		};
	}

	private async persistRoutingConfiguration(
		configuration: PrivateRoutingConfiguration,
	): Promise<void> {
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

	private persist(): Promise<void> {
		const snapshot = JSON.stringify(this.state, null, 2);
		const task = this.writeTail
			.catch(() => undefined)
			.then(async () => {
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
