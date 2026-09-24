import type {
	AddPinRequest,
	AgentAdapterKind,
	CommonspaceBootstrap,
	CommonspaceDiagnostics,
	CommonspaceLiveAgentActivity,
	CommonspaceMessage,
	CommonspaceMutation,
	CommonspaceNotificationVerification,
	CommonspacePermissionRequest,
	CommonspacePin,
	CommonspaceQueuedFollowup,
	CommonspaceRetentionPreview,
	CommonspaceRoutingConfiguration,
	CommonspaceState,
	CommonspaceTraceEntry,
	CommonspaceTracePlanStep,
	CommonspaceWorkspaceArchive,
	ConversationRef,
	EditMessageRequest,
	FollowupQueueResponse,
	HarnessCapabilityInventory,
	RerouteAssignmentRequest,
	RerouteAssignmentResponse,
	RetryRoutingRequest,
	RetryRoutingResponse,
	SelectDirectoryResponse,
	SendFileAttachment,
	SendImageAttachment,
	SendMessageRequest,
	SendMessageResponse,
	StopAgentRunsResponse,
	UpdateRoutingConfigurationRequest,
	UpdateThreadContextRequest,
} from "@commonspace/shared";
import { conversationKey, isAgentAdapterKind } from "@commonspace/shared";
import type { WorkspaceArchiveSource } from "./workspace-import.ts";

export const enum AgentDiscoveryStatus {
	Pending = "pending",
	Success = "success",
	Failed = "failed",
}

type AgentDiscoveryState =
	| {
			status: AgentDiscoveryStatus.Pending;
			adapter: AgentAdapterKind;
	  }
	| {
			status: AgentDiscoveryStatus.Success;
			adapter: AgentAdapterKind;
			agents: CommonspaceBootstrap["discoveredAgents"];
	  }
	| {
			status: AgentDiscoveryStatus.Failed;
			adapter: AgentAdapterKind;
			error: string;
	  };

export interface CommonspaceClientSnapshot {
	bootstrap: CommonspaceBootstrap | null;
	loading: boolean;
	discovery: AgentDiscoveryState | null;
	pendingSubmissions: CommonspacePendingSubmission[];
	sending: boolean;
	error: string | null;
	activeConversation: ConversationRef | null;
	activeProjectId: string | null;
	activeThreadId: string | null;
}

export interface CommonspacePendingSubmission {
	id: string;
	conversation: ConversationRef;
	threadId?: string;
	targetAgentId?: string;
	text: string;
	attachments: SendImageAttachment[];
	files: SendFileAttachment[];
	delivery?: SendMessageRequest["delivery"];
	projectIds?: string[];
	createdAt: string;
	status: "admitting" | "failed";
	error?: string;
}

export interface CommonspaceSendOptions {
	text: string;
	threadId?: string | undefined;
	attachments?: readonly SendImageAttachment[] | undefined;
	delivery?: SendMessageRequest["delivery"] | undefined;
	projectIds?: readonly string[] | undefined;
	files?: readonly SendFileAttachment[] | undefined;
}

export interface CommonspaceDirectReplyOptions
	extends Omit<CommonspaceSendOptions, "delivery" | "threadId"> {
	threadId: string;
	targetAgentId: string;
}

interface CommonspaceMessageOptions extends CommonspaceSendOptions {
	targetAgentId?: string | undefined;
}

export class CommonspaceSubmissionError extends Error {
	readonly submissionId: string;

	constructor(message: string, submissionId: string, cause: unknown) {
		super(message, { cause });
		this.name = "CommonspaceSubmissionError";
		this.submissionId = submissionId;
	}
}

type Listener = () => void;
const LIVE_UPDATES_DISCONNECTED =
	"Commonspace live updates disconnected; retrying…";

interface TraceEntryMetadata {
	id: string;
	createdAt: string;
	updatedAt: string;
}

interface TraceEntryCandidate extends TraceEntryMetadata {
	type: unknown;
}

export interface CommonspaceActivityEventData {
	activities: CommonspaceLiveAgentActivity[];
	queuedFollowups?: CommonspaceQueuedFollowup[];
}

function isObject<T>(value: T): value is T & object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray<T>(value: T): value is T & string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isConversationRef<T>(value: T): value is T & ConversationRef {
	return (
		isObject(value) &&
		"kind" in value &&
		(value.kind === "channel" || value.kind === "dm") &&
		"id" in value &&
		typeof value.id === "string"
	);
}

function hasTraceEntryMetadata<T>(value: T): value is T & TraceEntryMetadata {
	return (
		isObject(value) &&
		"id" in value &&
		typeof value.id === "string" &&
		"createdAt" in value &&
		typeof value.createdAt === "string" &&
		"updatedAt" in value &&
		typeof value.updatedAt === "string"
	);
}

function isTracePlanStep<T>(value: T): value is T & CommonspaceTracePlanStep {
	return (
		isObject(value) &&
		"text" in value &&
		typeof value.text === "string" &&
		"priority" in value &&
		(value.priority === "high" ||
			value.priority === "medium" ||
			value.priority === "low") &&
		"status" in value &&
		(value.status === "pending" ||
			value.status === "in_progress" ||
			value.status === "completed")
	);
}

function isReasoningTraceEntry(
	value: TraceEntryCandidate,
): value is Extract<CommonspaceTraceEntry, { type: "reasoning" }> {
	return (
		value.type === "reasoning" &&
		"text" in value &&
		typeof value.text === "string"
	);
}

function isPlanTraceEntry(
	value: TraceEntryCandidate,
): value is Extract<CommonspaceTraceEntry, { type: "plan" }> {
	return (
		value.type === "plan" &&
		"steps" in value &&
		Array.isArray(value.steps) &&
		value.steps.every(isTracePlanStep) &&
		(!("markdown" in value) || typeof value.markdown === "string")
	);
}

function isToolTraceEntry(
	value: TraceEntryCandidate,
): value is Extract<CommonspaceTraceEntry, { type: "tool" }> {
	return (
		value.type === "tool" &&
		"title" in value &&
		typeof value.title === "string" &&
		"status" in value &&
		(value.status === "pending" ||
			value.status === "in_progress" ||
			value.status === "completed" ||
			value.status === "failed") &&
		(!("toolName" in value) || typeof value.toolName === "string") &&
		(!("toolKind" in value) || typeof value.toolKind === "string") &&
		(!("input" in value) || typeof value.input === "string") &&
		(!("output" in value) || typeof value.output === "string")
	);
}

function isCompactionTraceEntry(
	value: TraceEntryCandidate,
): value is Extract<CommonspaceTraceEntry, { type: "compaction" }> {
	return (
		value.type === "compaction" &&
		"status" in value &&
		(value.status === "in_progress" ||
			value.status === "completed" ||
			value.status === "failed" ||
			value.status === "cancelled") &&
		"text" in value &&
		typeof value.text === "string"
	);
}

function isUsageTraceEntry(
	value: TraceEntryCandidate,
): value is Extract<CommonspaceTraceEntry, { type: "usage" }> {
	return (
		value.type === "usage" &&
		value.id === "usage" &&
		"usedTokens" in value &&
		typeof value.usedTokens === "number" &&
		Number.isFinite(value.usedTokens) &&
		"contextWindow" in value &&
		typeof value.contextWindow === "number" &&
		Number.isFinite(value.contextWindow) &&
		(!("costAmount" in value) ||
			(typeof value.costAmount === "number" &&
				Number.isFinite(value.costAmount))) &&
		(!("costCurrency" in value) || typeof value.costCurrency === "string")
	);
}

function isTraceEntry<T>(value: T): value is T & CommonspaceTraceEntry {
	if (!hasTraceEntryMetadata(value) || !("type" in value)) return false;
	return (
		isReasoningTraceEntry(value) ||
		isPlanTraceEntry(value) ||
		isToolTraceEntry(value) ||
		isCompactionTraceEntry(value) ||
		isUsageTraceEntry(value)
	);
}

function isLiveAgentActivity<T>(
	value: T,
): value is T & CommonspaceLiveAgentActivity {
	return (
		isObject(value) &&
		"id" in value &&
		typeof value.id === "string" &&
		"sourceMessageId" in value &&
		typeof value.sourceMessageId === "string" &&
		"agentId" in value &&
		typeof value.agentId === "string" &&
		"agentName" in value &&
		typeof value.agentName === "string" &&
		"adapter" in value &&
		isAgentAdapterKind(value.adapter) &&
		"conversation" in value &&
		isConversationRef(value.conversation) &&
		(!("threadId" in value) || typeof value.threadId === "string") &&
		"startedAt" in value &&
		typeof value.startedAt === "string" &&
		"entries" in value &&
		Array.isArray(value.entries) &&
		value.entries.every(isTraceEntry)
	);
}

function isQueuedFollowup<T>(value: T): value is T & CommonspaceQueuedFollowup {
	return (
		isObject(value) &&
		"messageId" in value &&
		typeof value.messageId === "string" &&
		"conversation" in value &&
		isConversationRef(value.conversation) &&
		(!("threadId" in value) || typeof value.threadId === "string") &&
		"agentIds" in value &&
		isStringArray(value.agentIds) &&
		"text" in value &&
		typeof value.text === "string" &&
		"position" in value &&
		typeof value.position === "number" &&
		Number.isSafeInteger(value.position) &&
		value.position >= 0 &&
		"createdAt" in value &&
		typeof value.createdAt === "string" &&
		"delivery" in value &&
		(value.delivery === "queue" ||
			value.delivery === "steer" ||
			value.delivery === "stop-and-send")
	);
}

export function parseRevisionEventData(data: string): number | null {
	try {
		const value: unknown = JSON.parse(data);
		if (
			!isObject(value) ||
			!("revision" in value) ||
			typeof value.revision !== "number" ||
			!Number.isSafeInteger(value.revision) ||
			value.revision < 0
		)
			return null;
		return value.revision;
	} catch {
		return null;
	}
}

export function parseActivityEventData(
	data: string,
): CommonspaceActivityEventData | null {
	try {
		const value: unknown = JSON.parse(data);
		if (
			!isObject(value) ||
			!("activities" in value) ||
			!Array.isArray(value.activities) ||
			!value.activities.every(isLiveAgentActivity)
		)
			return null;
		const parsed: CommonspaceActivityEventData = {
			activities: value.activities,
		};
		if ("queuedFollowups" in value) {
			if (
				!Array.isArray(value.queuedFollowups) ||
				!value.queuedFollowups.every(isQueuedFollowup)
			)
				return null;
			parsed.queuedFollowups = value.queuedFollowups;
		}
		return parsed;
	} catch {
		return null;
	}
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		headers: {
			"content-type": "application/json",
			...init?.headers,
		},
	});
	const value: T = await response.json();
	if (!response.ok) {
		const error: unknown = value;
		throw new Error(
			typeof error === "object" &&
				error !== null &&
				"error" in error &&
				typeof error.error === "string" &&
				error.error !== ""
				? error.error
				: `Commonspace request failed (${String(response.status)})`,
		);
	}
	return value;
}

function prepareMessageAdmission(
	conversation: ConversationRef,
	submissionId: string,
	options: CommonspaceMessageOptions,
): {
	request: SendMessageRequest;
	submission: CommonspacePendingSubmission;
} {
	const attachments = [...(options.attachments ?? [])];
	const files = [...(options.files ?? [])];
	const request: SendMessageRequest = {
		conversation,
		text: options.text,
	};
	if (options.projectIds !== undefined)
		request.projectIds = [...options.projectIds];
	if (options.threadId !== undefined) request.threadId = options.threadId;
	if (options.targetAgentId !== undefined)
		request.targetAgentId = options.targetAgentId;
	if (attachments.length > 0) request.attachments = attachments;
	if (files.length > 0) request.files = files;
	if (options.delivery !== undefined) request.delivery = options.delivery;

	const submission: CommonspacePendingSubmission = {
		id: submissionId,
		conversation,
		text: options.text,
		attachments,
		files,
		createdAt: new Date().toISOString(),
		status: "admitting",
	};
	if (options.threadId !== undefined) submission.threadId = options.threadId;
	if (options.targetAgentId !== undefined)
		submission.targetAgentId = options.targetAgentId;
	if (options.delivery !== undefined) submission.delivery = options.delivery;
	if (options.projectIds !== undefined)
		submission.projectIds = [...options.projectIds];
	return { request, submission };
}

export type CommonspaceStore = Pick<
	CommonspaceClientStore,
	keyof CommonspaceClientStore
>;

export class CommonspaceClientStore {
	private snapshot: CommonspaceClientSnapshot = {
		bootstrap: null,
		loading: false,
		discovery: null,
		pendingSubmissions: [],
		sending: false,
		error: null,
		activeConversation: null,
		activeProjectId: null,
		activeThreadId: null,
	};
	private readonly listeners = new Set<Listener>();
	private submissionRequest = 0;
	private navigationRevision = 0;
	private refreshPromise: Promise<void> | null = null;
	private discoveryRequest = 0;
	private pendingRevision = -1;
	private pendingConfigurationRefresh = false;
	private routingGeneration = 0;
	private pendingLiveActivities: CommonspaceLiveAgentActivity[] | null = null;
	private events: EventSource | null = null;

	getSnapshot = (): CommonspaceClientSnapshot => this.snapshot;

	dismissError(): void {
		this.set({ ...this.snapshot, error: null });
	}

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	async refresh(): Promise<void> {
		if (this.refreshPromise !== null) return this.refreshPromise;
		const routingGeneration = this.routingGeneration;
		this.pendingConfigurationRefresh = false;
		this.set({ ...this.snapshot, loading: true, error: null });
		let refreshSucceeded = false;
		const task = requestJson<CommonspaceBootstrap>("/api/bootstrap")
			.then((bootstrap) => {
				refreshSucceeded = true;
				const liveActivities = this.pendingLiveActivities;
				this.pendingLiveActivities = null;
				const merged = this.mergeBootstrap(
					liveActivities === null
						? bootstrap
						: { ...bootstrap, liveActivities },
					routingGeneration,
				);
				this.set({
					...this.snapshot,
					bootstrap: merged,
					loading: false,
					activeProjectId: this.resolveActiveProject(merged),
				});
			})
			.catch((cause: unknown) => {
				this.set({
					...this.snapshot,
					loading: false,
					error: cause instanceof Error ? cause.message : String(cause),
				});
			})
			.finally(() => {
				this.refreshPromise = null;
				const currentRevision = this.snapshot.bootstrap?.state.revision ?? -1;
				if (this.pendingRevision <= currentRevision) this.pendingRevision = -1;
				if (
					refreshSucceeded &&
					(this.pendingRevision !== -1 || this.pendingConfigurationRefresh)
				)
					void this.refresh();
			});
		this.refreshPromise = task;
		return task;
	}

	connectEvents(): void {
		if (this.events !== null || typeof EventSource === "undefined") return;
		const events = new EventSource("/api/events");
		const refreshConfiguration = () => {
			this.routingGeneration += 1;
			this.pendingConfigurationRefresh = true;
			void this.refresh();
		};
		events.addEventListener("routing-changed", refreshConfiguration);
		events.addEventListener("open", refreshConfiguration);
		events.addEventListener("revision", (event) => {
			if (!(event instanceof MessageEvent) || typeof event.data !== "string")
				return;
			const revision = parseRevisionEventData(event.data);
			if (
				revision === null ||
				revision <= (this.snapshot.bootstrap?.state.revision ?? -1)
			)
				return;
			this.pendingRevision = Math.max(this.pendingRevision, revision);
			void this.refresh();
		});
		events.addEventListener("activity", (event) => {
			if (!(event instanceof MessageEvent) || typeof event.data !== "string")
				return;
			const value = parseActivityEventData(event.data);
			if (value === null) return;
			const activities = value.activities;
			this.pendingLiveActivities = activities;
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap === null) return;
			const queuedFollowups =
				value.queuedFollowups ?? bootstrap.queuedFollowups;
			const nextBootstrap = { ...bootstrap, liveActivities: activities };
			if (queuedFollowups !== undefined)
				nextBootstrap.queuedFollowups = queuedFollowups;
			this.set({
				...this.snapshot,
				bootstrap: nextBootstrap,
			});
		});
		events.onerror = () => {
			this.set({ ...this.snapshot, error: LIVE_UPDATES_DISCONNECTED });
		};
		events.onopen = () => {
			if (this.snapshot.error === LIVE_UPDATES_DISCONNECTED)
				this.set({ ...this.snapshot, error: null });
		};
		this.events = events;
	}

	disconnectEvents(): void {
		this.events?.close();
		this.events = null;
	}

	async mutate(mutation: CommonspaceMutation): Promise<void> {
		const routingGeneration = this.routingGeneration;
		try {
			const result = await requestJson<CommonspaceBootstrap>("/api/mutate", {
				method: "POST",
				body: JSON.stringify(mutation),
			});
			let merged: CommonspaceBootstrap;
			if (
				mutation.action === "remove-agent" &&
				routingGeneration === this.routingGeneration &&
				result.state.revision >= (this.snapshot.bootstrap?.state.revision ?? -1)
			) {
				// Removing an Agent can also remove the independently persisted
				// inference selection. Make this response authoritative and expire
				// older bootstrap requests that could restore that selection.
				this.routingGeneration += 1;
				merged = this.mergeBootstrap(result, this.routingGeneration);
			} else {
				merged = this.mergeBootstrap(result);
			}
			this.set({
				...this.snapshot,
				bootstrap: merged,
				activeProjectId: this.resolveActiveProject(merged),
				error: null,
			});
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async updateRoutingConfiguration(
		request: UpdateRoutingConfigurationRequest,
	): Promise<void> {
		const requestGeneration = this.routingGeneration;
		try {
			const routing = await requestJson<CommonspaceRoutingConfiguration>(
				"/api/routing",
				{
					method: "PUT",
					body: JSON.stringify(request),
				},
			);
			const bootstrap = this.snapshot.bootstrap;
			const next = { ...this.snapshot, error: null };
			if (bootstrap !== null && requestGeneration === this.routingGeneration)
				next.bootstrap = { ...bootstrap, routing };
			this.routingGeneration += 1;
			this.set({
				...next,
			});
			this.pendingConfigurationRefresh = true;
			await this.refresh();
			if (this.refreshPromise !== null) await this.refreshPromise;
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async validateRoutingConfiguration(
		request: UpdateRoutingConfigurationRequest,
	): Promise<CommonspaceDiagnostics["inference"]> {
		return requestJson<CommonspaceDiagnostics["inference"]>(
			"/api/routing/validate",
			{ method: "POST", body: JSON.stringify(request) },
		);
	}

	async inspectAgentCapabilities(
		agentId: string,
	): Promise<HarnessCapabilityInventory> {
		return requestJson<HarnessCapabilityInventory>(
			`/api/agents/${encodeURIComponent(agentId)}/capabilities`,
		);
	}

	async authenticateAgentMcp(
		agentId: string,
		serverName: string,
	): Promise<void> {
		await requestJson<{ status: "complete" }>(
			`/api/agents/${encodeURIComponent(agentId)}/mcp-authentication`,
			{ method: "POST", body: JSON.stringify({ serverName }) },
		);
	}

	async discoverAgents(adapter: AgentAdapterKind): Promise<void> {
		const request = ++this.discoveryRequest;
		this.set({
			...this.snapshot,
			discovery: { status: AgentDiscoveryStatus.Pending, adapter },
		});
		try {
			const result = await requestJson<CommonspaceBootstrap>(
				"/api/discover-agents",
				{
					method: "POST",
					body: JSON.stringify({ adapter }),
				},
			);
			if (request !== this.discoveryRequest) return;
			const merged = this.mergeBootstrap(result);
			this.set({
				...this.snapshot,
				bootstrap: merged,
				discovery: {
					status: AgentDiscoveryStatus.Success,
					adapter,
					agents: result.discoveredAgents,
				},
			});
		} catch (error) {
			if (request !== this.discoveryRequest) return;
			this.set({
				...this.snapshot,
				discovery: {
					status: AgentDiscoveryStatus.Failed,
					adapter,
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	async selectDirectory(): Promise<string | null> {
		try {
			const result = await requestJson<SelectDirectoryResponse>(
				"/api/select-directory",
				{ method: "POST" },
			);
			if (result.path !== null && typeof result.path !== "string")
				throw new Error("folder picker returned an invalid path");
			this.set({ ...this.snapshot, error: null });
			return result.path;
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	selectConversation(conversation: ConversationRef): void {
		this.navigationRevision += 1;
		this.set({
			...this.snapshot,
			activeConversation: conversation,
			activeThreadId: null,
			error: null,
		});
	}

	selectThread(threadId: string | null): void {
		this.navigationRevision += 1;
		this.set({ ...this.snapshot, activeThreadId: threadId, error: null });
	}

	selectProject(projectId: string): void {
		this.navigationRevision += 1;
		this.set({ ...this.snapshot, activeProjectId: projectId, error: null });
	}

	messages(
		conversation: ConversationRef | null = this.snapshot.activeConversation,
	): CommonspaceMessage[] {
		if (conversation === null) return [];
		return (
			this.snapshot.bootstrap?.state.messages[conversationKey(conversation)] ??
			[]
		);
	}

	async send(options: CommonspaceSendOptions): Promise<void> {
		return this.sendMessage(options);
	}

	async sendDirectReply(options: CommonspaceDirectReplyOptions): Promise<void> {
		return this.sendMessage(options);
	}

	dismissPendingSubmission(submissionId: string): void {
		const pendingSubmissions = this.snapshot.pendingSubmissions.filter(
			(submission) => submission.id !== submissionId,
		);
		if (pendingSubmissions.length === this.snapshot.pendingSubmissions.length)
			return;
		this.set({
			...this.snapshot,
			pendingSubmissions,
			sending: pendingSubmissions.some(
				(submission) => submission.status === "admitting",
			),
		});
	}

	async rerouteAssignment(request: RerouteAssignmentRequest): Promise<void> {
		try {
			const result = await requestJson<RerouteAssignmentResponse>(
				"/api/reroute",
				{
					method: "POST",
					body: JSON.stringify(request),
				},
			);
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap === null) {
				await this.refresh();
				return;
			}
			const merged = this.mergeBootstrap({ ...bootstrap, state: result.state });
			this.set({
				...this.snapshot,
				bootstrap: merged,
				activeProjectId: this.resolveActiveProject(merged),
				error: null,
			});
		} catch (error) {
			this.recordRequestFailure(error);
			throw error;
		}
	}

	async retryRouting(request: RetryRoutingRequest): Promise<void> {
		try {
			const result = await requestJson<RetryRoutingResponse>(
				"/api/routing/retry",
				{
					method: "POST",
					body: JSON.stringify(request),
				},
			);
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap === null) {
				await this.refresh();
				return;
			}
			const merged = this.mergeBootstrap({ ...bootstrap, state: result.state });
			this.set({
				...this.snapshot,
				bootstrap: merged,
				activeProjectId: this.resolveActiveProject(merged),
				error: null,
			});
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async updateThreadContext(
		threadId: string,
		request: UpdateThreadContextRequest,
	): Promise<void> {
		try {
			await requestJson(
				`/api/threads/${encodeURIComponent(threadId)}/context`,
				{
					method: "PUT",
					body: JSON.stringify(request),
				},
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async compactThreadContext(threadId: string): Promise<void> {
		try {
			await requestJson(
				`/api/threads/${encodeURIComponent(threadId)}/context/compact`,
				{ method: "POST" },
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async compactChannelContext(channelId: string): Promise<void> {
		try {
			await requestJson(
				`/api/channels/${encodeURIComponent(channelId)}/context/compact`,
				{ method: "POST" },
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async addPin(request: AddPinRequest): Promise<void> {
		try {
			await requestJson<CommonspacePin>("/api/pins", {
				method: "POST",
				body: JSON.stringify(request),
			});
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async removePin(pinId: string): Promise<void> {
		try {
			await requestJson<CommonspacePin>(
				`/api/pins/${encodeURIComponent(pinId)}/remove`,
				{ method: "POST" },
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async editMessage(
		messageId: string,
		request: Omit<EditMessageRequest, "messageId">,
	): Promise<void> {
		const navigationRevision = ++this.navigationRevision;
		try {
			const result = await requestJson<SendMessageResponse>(
				`/api/messages/${encodeURIComponent(messageId)}/edit`,
				{
					method: "POST",
					body: JSON.stringify(request),
				},
			);
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap === null) {
				await this.refresh();
				return;
			}
			const merged = this.mergeBootstrap({ ...bootstrap, state: result.state });
			this.set({
				...this.snapshot,
				bootstrap: merged,
				activeProjectId: this.resolveActiveProject(merged),
				activeThreadId:
					this.navigationRevision === navigationRevision
						? (result.thread?.id ?? this.snapshot.activeThreadId)
						: this.snapshot.activeThreadId,
				error: null,
			});
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async deleteMessage(messageId: string): Promise<void> {
		try {
			await requestJson<CommonspaceMessage>(
				`/api/messages/${encodeURIComponent(messageId)}/delete`,
				{ method: "POST" },
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async respondPermission(
		permissionId: string,
		optionId: string,
	): Promise<void> {
		try {
			await requestJson<CommonspacePermissionRequest>(
				`/api/permissions/${encodeURIComponent(permissionId)}/respond`,
				{
					method: "POST",
					body: JSON.stringify({ optionId }),
				},
			);
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async diagnostics(): Promise<CommonspaceDiagnostics> {
		try {
			const diagnostics =
				await requestJson<CommonspaceDiagnostics>("/api/diagnostics");
			this.set({ ...this.snapshot, error: null });
			return diagnostics;
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async verifyDesktopNotifications(): Promise<CommonspaceNotificationVerification> {
		return requestJson<CommonspaceNotificationVerification>(
			"/api/notifications/verify",
			{ method: "POST" },
		);
	}

	async exportWorkspace(): Promise<CommonspaceWorkspaceArchive> {
		return requestJson<CommonspaceWorkspaceArchive>("/api/export");
	}

	async importWorkspace(
		archiveSource: WorkspaceArchiveSource,
		projectMappings: Record<string, string[]>,
	): Promise<void> {
		try {
			const state = await requestJson<CommonspaceState>("/api/import", {
				method: "POST",
				body: JSON.stringify({
					archive: archiveSource.value,
					projectMappings,
				}),
			});
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap === null) {
				await this.refresh();
				return;
			}
			const merged = this.mergeBootstrap({ ...bootstrap, state });
			this.set({
				...this.snapshot,
				bootstrap: merged,
				activeProjectId: this.resolveActiveProject(merged),
				activeConversation: null,
				activeThreadId: null,
				error: null,
			});
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async previewRetention(
		conversation: ConversationRef,
	): Promise<CommonspaceRetentionPreview> {
		return requestJson<CommonspaceRetentionPreview>("/api/retention/preview", {
			method: "POST",
			body: JSON.stringify({ conversation }),
		});
	}

	async applyRetention(preview: CommonspaceRetentionPreview): Promise<void> {
		try {
			await requestJson<CommonspaceRetentionPreview>("/api/retention/apply", {
				method: "POST",
				body: JSON.stringify({
					conversation: preview.conversation,
					expectedRevision: preview.revision,
				}),
			});
			await this.refresh();
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async stopAgentRuns(messageId: string, agentId?: string): Promise<string[]> {
		try {
			const request: { messageId: string; agentId?: string } = { messageId };
			if (agentId !== undefined) request.agentId = agentId;
			const result = await requestJson<StopAgentRunsResponse>("/api/stop", {
				method: "POST",
				body: JSON.stringify(request),
			});
			this.set({ ...this.snapshot, error: null });
			return result.stoppedAgentIds;
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	async reorderFollowup(
		messageId: string,
		direction: "up" | "down",
	): Promise<void> {
		await this.updateFollowupQueue("/api/followups/reorder", {
			messageId,
			direction,
		});
	}

	async removeFollowup(messageId: string): Promise<void> {
		await this.updateFollowupQueue("/api/followups/remove", { messageId });
	}

	private async updateFollowupQueue(
		path: string,
		body:
			| { messageId: string }
			| { messageId: string; direction: "up" | "down" },
	): Promise<void> {
		try {
			const result = await requestJson<FollowupQueueResponse>(path, {
				method: "POST",
				body: JSON.stringify(body),
			});
			const bootstrap = this.snapshot.bootstrap;
			const next = { ...this.snapshot, error: null };
			if (bootstrap !== null)
				next.bootstrap = {
					...bootstrap,
					queuedFollowups: result.queuedFollowups,
				};
			this.set(next);
		} catch (error) {
			this.recordRequestFailure(error);
		}
	}

	private async sendMessage(options: CommonspaceMessageOptions): Promise<void> {
		const conversation = this.snapshot.activeConversation;
		if (conversation === null) return;
		const navigationRevision = ++this.navigationRevision;
		const { request, submission } = prepareMessageAdmission(
			conversation,
			`submission-${String(++this.submissionRequest)}`,
			options,
		);
		this.set({
			...this.snapshot,
			pendingSubmissions: [...this.snapshot.pendingSubmissions, submission],
			sending: true,
			error: null,
		});
		try {
			const result = await requestJson<SendMessageResponse>("/api/send", {
				method: "POST",
				body: JSON.stringify(request),
			});
			const pendingSubmissions = this.snapshot.pendingSubmissions.filter(
				(candidate) => candidate.id !== submission.id,
			);
			const bootstrap = this.snapshot.bootstrap;
			if (bootstrap !== null) {
				const merged = this.mergeBootstrap({
					...bootstrap,
					state: result.state,
				});
				this.set({
					...this.snapshot,
					pendingSubmissions,
					sending: pendingSubmissions.some(
						(candidate) => candidate.status === "admitting",
					),
					bootstrap: merged,
					activeProjectId: this.resolveActiveProject(merged),
					activeThreadId:
						this.navigationRevision === navigationRevision &&
						this.snapshot.activeConversation?.kind === conversation.kind &&
						this.snapshot.activeConversation.id === conversation.id
							? (result.thread?.id ?? this.snapshot.activeThreadId)
							: this.snapshot.activeThreadId,
				});
			} else {
				await this.refresh();
				this.set({
					...this.snapshot,
					pendingSubmissions,
					sending: pendingSubmissions.some(
						(candidate) => candidate.status === "admitting",
					),
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const pendingSubmissions = this.snapshot.pendingSubmissions.map(
				(candidate): CommonspacePendingSubmission =>
					candidate.id === submission.id
						? { ...candidate, status: "failed", error: message }
						: candidate,
			);
			this.set({
				...this.snapshot,
				pendingSubmissions,
				sending: pendingSubmissions.some(
					(candidate) => candidate.status === "admitting",
				),
				error: message,
			});
			throw new CommonspaceSubmissionError(message, submission.id, error);
		}
	}

	// biome-ignore lint/plugin: JavaScript permits any thrown value; this boundary narrows it before recording.
	private recordRequestFailure(error: unknown): never {
		this.set({
			...this.snapshot,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}

	private set(snapshot: CommonspaceClientSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}

	private mergeBootstrap(
		candidate: CommonspaceBootstrap,
		routingGeneration?: number,
	): CommonspaceBootstrap {
		const current = this.snapshot.bootstrap;
		if (current === null) return candidate;
		const merged =
			candidate.state.revision < current.state.revision
				? { ...current }
				: { ...candidate };
		if (
			candidate.liveActivities === undefined &&
			current.liveActivities !== undefined
		)
			merged.liveActivities = current.liveActivities;
		// Workspace mutations do not own routing. Only a refresh started after
		// the latest invalidation may replace the independently saved configuration.
		const routing =
			routingGeneration === this.routingGeneration
				? candidate.routing
				: current.routing;
		if (routing === undefined) delete merged.routing;
		else merged.routing = routing;
		return merged;
	}

	private resolveActiveProject(bootstrap: CommonspaceBootstrap): string | null {
		const current = this.snapshot.activeProjectId;
		if (
			current !== null &&
			bootstrap.state.projects.some((project) => project.id === current)
		)
			return current;
		return bootstrap.state.projects[0]?.id ?? null;
	}
}
