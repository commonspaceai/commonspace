import { z } from "zod";
import { AGENT_ADAPTER_KINDS } from "./agent-adapters.js";
import {
	COMMONSPACE_STATE_VERSION,
	type CommonspaceBootstrap,
	CommonspaceRoutingProvider,
	type CommonspaceState,
	type RerouteAssignmentResponse,
	type RetryRoutingResponse,
	RoutingConfigurationIssue,
	type SendMessageResponse,
} from "./contracts.js";

// Zod's optional output includes undefined; JSON optional properties are absent.
type JsonWire<T> = T extends readonly (infer Item)[]
	? JsonWire<Item>[]
	: T extends object
		? {
				[Key in keyof T]: undefined extends T[Key]
					? JsonWire<Exclude<T[Key], undefined>> | undefined
					: JsonWire<T[Key]>;
			}
		: T;

const stringArray = z.array(z.string());
const adapter = z.enum(AGENT_ADAPTER_KINDS);
const nullableString = z.string().nullable();
const conversation = z.object({
	kind: z.enum(["channel", "dm"]),
	id: z.string(),
});
const agent = z.object({
	id: z.string(),
	displayName: z.string(),
	avatarEmoji: z.string().optional(),
	accentColor: z.string().optional(),
	adapter,
	nativeProfile: z.string().optional(),
	model: nullableString,
	fullAccess: z.boolean().optional(),
	status: z.enum(["running", "stopped", "unknown"]),
	description: z.string().optional(),
	permissionPolicy: z
		.object({ source: z.enum(["server", "agent"]), fullAccess: z.boolean() })
		.optional(),
});
const channelMemory = z.object({
	summary: z.string(),
	decisions: stringArray,
	openQuestions: stringArray,
	threadIds: stringArray,
	updatedAt: nullableString,
	origin: z.enum(["automatic", "inference", "user"]).optional(),
	status: z
		.enum(["empty", "current", "stale", "compacting", "failed"])
		.optional(),
	sourceMessageCount: z.number().optional(),
	estimatedTokens: z.number().optional(),
	compactedThroughMessageId: nullableString.optional(),
});
const routingMemory = z.object({
	summary: z.string(),
	status: z.enum(["empty", "current", "stale", "failed"]),
	correctionCount: z.number(),
	compactedThroughCorrectionId: nullableString,
	updatedAt: nullableString,
});
const threadMemory = z.object({
	summary: z.string(),
	decisions: stringArray,
	openQuestions: stringArray,
	updatedAt: nullableString,
	origin: z.enum(["automatic", "inference", "user"]),
	status: z.enum(["empty", "current", "stale", "compacting", "failed"]),
	sourceMessageCount: z.number(),
	estimatedTokens: z.number(),
	compactedThroughMessageId: nullableString,
});
const thread = z.object({
	id: z.string(),
	channelId: z.string(),
	projectIds: stringArray.optional(),
	projectId: nullableString,
	rootMessageId: z.string(),
	agentIds: stringArray,
	branchedFromThreadId: z.string().optional(),
	branchPointMessageId: z.string().optional(),
	context: z.object({
		channelSnapshot: threadMemory.extend({ capturedAt: z.string() }),
		memory: threadMemory,
	}),
	createdAt: z.string(),
});
const traceMetadata = {
	id: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
};
const traceEntry = z.discriminatedUnion("type", [
	z.object({
		...traceMetadata,
		type: z.literal("compaction"),
		status: z.enum(["in_progress", "completed", "failed", "cancelled"]),
		text: z.string(),
	}),
	z.object({
		...traceMetadata,
		type: z.literal("reasoning"),
		text: z.string(),
	}),
	z.object({
		...traceMetadata,
		type: z.literal("plan"),
		steps: z.array(
			z.object({
				text: z.string(),
				priority: z.enum(["high", "medium", "low"]),
				status: z.enum(["pending", "in_progress", "completed"]),
			}),
		),
		markdown: z.string().optional(),
	}),
	z.object({
		...traceMetadata,
		type: z.literal("tool"),
		title: z.string(),
		toolName: z.string().optional(),
		toolKind: z.string().optional(),
		status: z.enum(["pending", "in_progress", "completed", "failed"]),
		input: z.string().optional(),
		output: z.string().optional(),
	}),
	z.object({
		...traceMetadata,
		type: z.literal("usage"),
		id: z.literal("usage"),
		usedTokens: z.number(),
		contextWindow: z.number(),
		costAmount: z.number().optional(),
		costCurrency: z.string().optional(),
	}),
]);
const imageAttachment = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
	size: z.number(),
});
const fileAttachment = z.object({
	id: z.string(),
	name: z.string(),
	mimeType: z.string(),
	size: z.number(),
});
const routingAssignment = z.object({
	id: z.string(),
	agentId: z.string(),
	legacySubRequest: z.string().optional(),
	projectIds: stringArray,
});
const routingCorrection = z.object({
	id: z.string(),
	fromAssignmentId: z.string(),
	toAssignmentId: z.string(),
	projectIds: stringArray,
	createdAt: z.string(),
});
const runFileChange = z.object({
	path: z.string(),
	status: z.enum([
		"modified",
		"added",
		"deleted",
		"renamed",
		"untracked",
		"conflicted",
	]),
	preExisting: z.boolean(),
	additions: z.number().nullable(),
	deletions: z.number().nullable(),
	patch: z.string().optional(),
	patchTruncated: z.boolean().optional(),
});
const runRoot = z.discriminatedUnion("available", [
	z.object({
		available: z.literal(true),
		rootIndex: z.number(),
		projectId: z.string().optional(),
		projectRootIndex: z.number().optional(),
		branch: nullableString,
		headBefore: nullableString,
		headAfter: nullableString,
		preExisting: z.array(
			z.object({
				path: z.string(),
				status: runFileChange.shape.status,
			}),
		),
		observed: z.array(runFileChange),
	}),
	z.object({
		available: z.literal(false),
		rootIndex: z.number(),
		projectId: z.string().optional(),
		projectRootIndex: z.number().optional(),
		reason: z.string(),
	}),
]);
const message = z.object({
	id: z.string(),
	conversation,
	authorType: z.enum(["user", "agent", "system"]),
	authorId: z.string(),
	authorName: z.string(),
	text: z.string(),
	attachments: z.array(imageAttachment).optional(),
	files: z.array(fileAttachment).optional(),
	createdAt: z.string(),
	projectIds: stringArray.optional(),
	projectId: z.string().optional(),
	threadId: z.string().optional(),
	parentMessageId: z.string().optional(),
	sourceMessageId: z.string().optional(),
	versionRootMessageId: z.string().optional(),
	supersedesMessageId: z.string().optional(),
	branchId: z.string().optional(),
	deletedAt: z.string().optional(),
	routingAssignmentId: z.string().optional(),
	replyStatus: z
		.enum([
			"queued",
			"running",
			"complete",
			"needs_input",
			"failed",
			"cancelled",
			"silent",
			"timeout",
			"error",
		])
		.optional(),
	replyError: z.string().optional(),
	trace: z
		.object({
			adapter,
			startedAt: z.string(),
			completedAt: z.string(),
			entries: z.array(traceEntry),
		})
		.optional(),
	runAttribution: z
		.object({
			startedAt: z.string(),
			completedAt: z.string(),
			roots: z.array(runRoot),
		})
		.optional(),
	routing: z
		.object({
			source: z.enum(["explicit", "ai", "local"]),
			mode: z.enum(["parallel", "relay"]).optional(),
			status: z.enum(["pending", "resolved", "failed"]).optional(),
			startedAt: z.string().optional(),
			resolvedAt: z.string().optional(),
			durationMs: z.number().optional(),
			agentIds: stringArray,
			assignments: z.array(routingAssignment),
			corrections: z.array(routingCorrection),
			inferredProjectIds: stringArray,
			confidence: z.number().optional(),
			reason: z.string(),
		})
		.optional(),
});
const pinScope = z.object({
	kind: z.enum(["channel", "thread"]),
	id: z.string(),
});
const pinBase = {
	id: z.string(),
	scope: pinScope,
	createdAt: z.string(),
	removedAt: nullableString,
};
const pin = z.discriminatedUnion("kind", [
	z.object({ ...pinBase, kind: z.literal("message"), messageId: z.string() }),
	z.object({
		...pinBase,
		kind: z.literal("attachment"),
		messageId: z.string(),
		attachmentId: z.string(),
	}),
	z.object({ ...pinBase, kind: z.literal("note"), note: z.string() }),
]);

/** Parses the full durable state shape before a browser snapshot becomes trusted. */
const stateSchema: z.ZodType<JsonWire<CommonspaceState>> = z.object({
	version: z.literal(COMMONSPACE_STATE_VERSION),
	revision: z.number().int().nonnegative(),
	inboxReadAt: nullableString,
	inboxReadMessageIds: stringArray,
	inboxUnreadMessageIds: stringArray.optional(),
	inboxSavedItemIds: stringArray,
	followedSessionIds: stringArray,
	mutedSessionIds: stringArray,
	notifications: z.object({
		enabled: z.boolean(),
		replies: z.boolean(),
		mentions: z.boolean(),
		permissions: z.boolean(),
		failures: z.boolean(),
		sound: z.boolean(),
	}),
	defaults: z.object({
		maxAgentsPerTurn: z.number(),
		memoryThreads: z.number(),
	}),
	agents: z.array(
		agent
			.omit({ status: true, description: true, permissionPolicy: true })
			.extend({
				createdAt: z.string(),
			}),
	),
	dmSessions: z.record(z.string(), z.string()),
	agentSessions: z.record(z.string(), z.record(z.string(), z.string())),
	pendingAttachmentDeletions: z
		.object({ imageIds: stringArray, fileIds: stringArray })
		.optional(),
	projects: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			emoji: z.string().optional(),
			paths: stringArray,
			createdAt: z.string(),
		}),
	),
	channels: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			emoji: z.string().optional(),
			agentIds: stringArray,
			instructions: z.string(),
			memory: channelMemory,
			routingMemory,
			createdAt: z.string(),
		}),
	),
	threads: z.array(thread),
	schedules: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			channelId: z.string(),
			text: z.string(),
			timing: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("once"), runAt: z.string() }),
				z.object({
					kind: z.literal("cron"),
					expression: z.string(),
					timeZone: z.string(),
				}),
			]),
			paused: z.boolean(),
			nextRunAt: nullableString,
			lastRunAt: nullableString,
			createdAt: z.string(),
		}),
	),
	pins: z.array(pin),
	permissions: z.array(
		z.object({
			id: z.string(),
			sourceMessageId: z.string(),
			agentId: z.string(),
			conversation,
			threadId: z.string().optional(),
			toolCallId: z.string(),
			title: z.string(),
			kind: z.string().optional(),
			options: z.array(
				z.object({
					optionId: z.string(),
					name: z.string(),
					kind: z.string(),
				}),
			),
			status: z.enum(["pending", "resolved", "cancelled", "interrupted"]),
			selectedOptionId: z.string().optional(),
			createdAt: z.string(),
			resolvedAt: nullableString,
		}),
	),
	messages: z.record(z.string(), z.array(message)),
});

const routingConfiguration = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal(CommonspaceRoutingProvider.Unconfigured),
		reason: z.enum([
			RoutingConfigurationIssue.Missing,
			RoutingConfigurationIssue.Invalid,
		]),
		message: z.string(),
	}),
	z.object({
		provider: z.literal(CommonspaceRoutingProvider.Harness),
		harnessAgentId: z.string(),
	}),
]);

/** Parses bootstrap responses from the local HTTP boundary. */
const bootstrapSchema: z.ZodType<JsonWire<CommonspaceBootstrap>> = z.object({
	agents: z.array(agent),
	discoveredAgents: z.array(agent),
	state: stateSchema,
	liveActivities: z
		.array(
			z.object({
				id: z.string(),
				sourceMessageId: z.string(),
				agentId: z.string(),
				agentName: z.string(),
				adapter,
				conversation,
				threadId: z.string().optional(),
				startedAt: z.string(),
				entries: z.array(traceEntry),
			}),
		)
		.optional(),
	queuedFollowups: z
		.array(
			z.object({
				messageId: z.string(),
				conversation,
				threadId: z.string().optional(),
				agentIds: stringArray,
				text: z.string(),
				position: z.number(),
				createdAt: z.string(),
				delivery: z.enum(["queue", "steer", "stop-and-send"]),
			}),
		)
		.optional(),
	routing: routingConfiguration.optional(),
});

const sendResponseSchema: z.ZodType<JsonWire<SendMessageResponse>> = z.object({
	accepted: message,
	thread: thread.optional(),
	state: stateSchema,
});

const retryResponseSchema: z.ZodType<JsonWire<RetryRoutingResponse>> = z.object(
	{
		accepted: message,
		thread,
		state: stateSchema,
	},
);

const rerouteResponseSchema: z.ZodType<JsonWire<RerouteAssignmentResponse>> =
	z.object({
		sourceMessageId: z.string(),
		assignments: z.array(routingAssignment),
		corrections: z.array(routingCorrection),
		state: stateSchema,
	});

function parseResponse<T>(
	schema: z.ZodType<JsonWire<T>>,
	// biome-ignore lint/plugin: HTTP JSON must enter this schema as unknown.
	value: unknown,
): T {
	// Zod's optional output permits undefined; JSON parsing leaves those keys absent.
	// biome-ignore lint/nursery/noUnsafeTypeAssertion: Schema conformance is checked above; this bridges Zod's optional type to JSON's absent key.
	return schema.parse(value) as T;
}

// biome-ignore lint/plugin: Callers pass untrusted HTTP JSON to this parser.
export function parseCommonspaceState(value: unknown): CommonspaceState {
	return parseResponse<CommonspaceState>(stateSchema, value);
}

export function parseCommonspaceBootstrap(
	// biome-ignore lint/plugin: Callers pass untrusted HTTP JSON to this parser.
	value: unknown,
): CommonspaceBootstrap {
	return parseResponse<CommonspaceBootstrap>(bootstrapSchema, value);
}

// biome-ignore lint/plugin: Callers pass untrusted HTTP JSON to this parser.
export function parseSendMessageResponse(value: unknown): SendMessageResponse {
	return parseResponse<SendMessageResponse>(sendResponseSchema, value);
}

export function parseRetryRoutingResponse(
	// biome-ignore lint/plugin: Callers pass untrusted HTTP JSON to this parser.
	value: unknown,
): RetryRoutingResponse {
	return parseResponse<RetryRoutingResponse>(retryResponseSchema, value);
}

export function parseRerouteAssignmentResponse(
	// biome-ignore lint/plugin: Callers pass untrusted HTTP JSON to this parser.
	value: unknown,
): RerouteAssignmentResponse {
	return parseResponse<RerouteAssignmentResponse>(rerouteResponseSchema, value);
}
