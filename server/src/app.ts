import type { IncomingMessage } from "node:http";
import {
	type AddPinRequest,
	AGENT_ADAPTER_KINDS,
	type ApplyRetentionRequest,
	COMMONSPACE_REASONING_VALUES,
	COMMONSPACE_SEARCH_KINDS,
	type CommonspaceLiveAgentActivity,
	type CommonspaceMutation,
	type CommonspaceSearchKind,
	type ConversationRef,
	type DiscoverAgentsRequest,
	type EditMessageRequest,
	type RemoveFollowupRequest,
	type ReorderFollowupRequest,
	type RerouteAssignmentRequest,
	type RetryRoutingRequest,
	type SelectDirectoryResponse,
	type SendMessageRequest,
	type StopAgentRunsRequest,
	type UpdateChannelContextRequest,
	type UpdateThreadContextRequest,
} from "@commonspace/shared";
import express, {
	type ErrorRequestHandler,
	type Express,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { z } from "zod";
import type { CommonspaceMcpGateway } from "./commonspace-mcp.js";
import { selectLocalDirectory } from "./directory-picker.js";
import type { JsonValue } from "./json.js";
import {
	listProjectFiles,
	openProjectFile,
	openProjectFileInEditor,
	ProjectEditorTarget,
	ProjectFileError,
	projectGitDiff,
	projectGitStatus,
	streamProjectFile,
} from "./project-files.js";
import { RoutingConfigurationRequest } from "./routing-configuration.js";
import { searchCommonspace } from "./search.js";
import type { CommonspaceHostService } from "./service.js";
import {
	MAX_WORKSPACE_IMPORT_BODY_BYTES,
	WorkspacePortabilitySizeError,
} from "./workspace-portability.js";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_SEND_BODY_BYTES = 24 * 1024 * 1024;

const conversationSchema = z.strictObject({
	kind: z.enum(["channel", "dm"]),
	id: z.string(),
});
const reasoningSchema = z.enum(COMMONSPACE_REASONING_VALUES);
const notificationSettingsSchema = z.strictObject({
	enabled: z.boolean(),
	replies: z.boolean(),
	mentions: z.boolean(),
	permissions: z.boolean(),
	failures: z.boolean(),
	sound: z.boolean(),
});
const contextRequestShape = z.strictObject({
	summary: z.string(),
	decisions: z.array(z.string()).optional(),
	openQuestions: z.array(z.string()).optional(),
});
const pinScopeSchema = z.strictObject({
	kind: z.enum(["channel", "thread"]),
	id: z.string(),
});
const imageAttachmentSchema = z.strictObject({
	name: z.string(),
	mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"], {
		error: "unsupported image type",
	}),
	data: z.string(),
});
const fileAttachmentSchema = z.strictObject({
	name: z.string(),
	mimeType: z.string(),
	data: z.string(),
});

const importWorkspaceBodySchema = z.strictObject({
	archive: z.json(),
	projectMappings: z.record(z.string(), z.array(z.string())),
}) satisfies z.ZodType<{
	archive: JsonValue;
	projectMappings: Record<string, string[]>;
}>;
const retentionPreviewBodySchema = z.strictObject({
	conversation: conversationSchema,
}) satisfies z.ZodType<{
	conversation: ConversationRef;
}>;
const applyRetentionRequestSchema = z.strictObject({
	conversation: conversationSchema,
	expectedRevision: z.number(),
}) satisfies z.ZodType<ApplyRetentionRequest>;
const contextRequestSchema =
	contextRequestShape satisfies z.ZodType<UpdateChannelContextRequest>;
const threadContextRequestSchema =
	contextRequestShape satisfies z.ZodType<UpdateThreadContextRequest>;
const discoverAgentsRequestSchema = z.strictObject({
	adapter: z.enum(AGENT_ADAPTER_KINDS),
}) satisfies z.ZodType<DiscoverAgentsRequest>;
const mutationSchema = z.discriminatedUnion(
	"action",
	[
		z.strictObject({ action: z.literal("mark-inbox-read") }),
		z.strictObject({
			action: z.literal("mark-inbox-item-read"),
			messageId: z.string(),
		}),
		z.strictObject({
			action: z.literal("set-inbox-item-unread"),
			messageId: z.string(),
			unread: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-inbox-item-saved"),
			messageId: z.string(),
			saved: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-session-followed"),
			sessionId: z.string(),
			followed: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-session-muted"),
			sessionId: z.string(),
			muted: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-notifications"),
			notifications: notificationSettingsSchema,
		}),
		z.strictObject({
			action: z.literal("create-project"),
			name: z.string(),
			paths: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("add-project-path"),
			projectId: z.string(),
			path: z.string(),
		}),
		z.strictObject({
			action: z.literal("remove-project"),
			projectId: z.string(),
		}),
		z.strictObject({
			action: z.literal("create-channel"),
			name: z.string(),
			agentIds: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("set-channel-agents"),
			channelId: z.string(),
			agentIds: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("set-channel-context"),
			channelId: z.string(),
			instructions: z.string(),
		}),
		z.strictObject({
			action: z.literal("set-channel-memory"),
			channelId: z.string(),
			summary: z.string(),
			decisions: z.array(z.string()).optional(),
			openQuestions: z.array(z.string()).optional(),
		}),
		z.strictObject({
			action: z.literal("set-channel-configuration"),
			channelId: z.string(),
			agentIds: z.array(z.string()),
			instructions: z.string(),
			summary: z.string(),
			decisions: z.array(z.string()).optional(),
			openQuestions: z.array(z.string()).optional(),
		}),
		z.strictObject({
			action: z.literal("set-defaults"),
			model: z.string().nullable().optional(),
			reasoning: reasoningSchema.optional(),
			maxAgentsPerTurn: z.number().optional(),
			memoryThreads: z.number().optional(),
		}),
		z.strictObject({
			action: z.literal("add-discovered-agent"),
			agentId: z.string(),
			adapter: z.enum(AGENT_ADAPTER_KINDS).optional(),
			fullAccess: z.boolean().optional(),
		}),
		z.strictObject({
			action: z.literal("update-agent-profile"),
			agentId: z.string(),
			displayName: z.string(),
			avatarEmoji: z.string().optional(),
			accentColor: z.string().optional(),
			fullAccess: z.boolean().optional(),
		}),
		z.strictObject({ action: z.literal("remove-agent"), agentId: z.string() }),
		z.strictObject({ action: z.literal("reset-dm"), agentId: z.string() }),
		z.strictObject({
			action: z.literal("remove-channel"),
			channelId: z.string(),
		}),
	],
	{ error: "unknown mutation" },
) satisfies z.ZodType<CommonspaceMutation>;
const sendMessageRequestSchema = z.strictObject({
	conversation: conversationSchema,
	text: z.string(),
	projectIds: z.array(z.string()).optional(),
	projectId: z.string().optional(),
	threadId: z.string().optional(),
	targetAgentId: z.string().optional(),
	attachments: z.array(imageAttachmentSchema).optional(),
	files: z.array(fileAttachmentSchema).optional(),
	delivery: z.enum(["queue", "steer", "stop-and-send"]).optional(),
}) satisfies z.ZodType<SendMessageRequest>;
const rerouteAssignmentSchema = z.strictObject({
	sourceMessageId: z.string(),
	assignmentId: z.string(),
	agentId: z.string(),
	projectIds: z.array(z.string()),
}) satisfies z.ZodType<RerouteAssignmentRequest>;
const retryRoutingSchema = z.discriminatedUnion("mode", [
	z.strictObject({ sourceMessageId: z.string(), mode: z.literal("ai") }),
	z.strictObject({
		sourceMessageId: z.string(),
		mode: z.literal("manual"),
		agentId: z.string(),
	}),
]) satisfies z.ZodType<RetryRoutingRequest>;
const editMessageBodySchema = z.strictObject({
	text: z.string(),
	projectIds: z.array(z.string()).optional(),
}) satisfies z.ZodType<Omit<EditMessageRequest, "messageId">>;
const addPinRequestSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		scope: pinScopeSchema,
		kind: z.literal("message"),
		messageId: z.string(),
	}),
	z.strictObject({
		scope: pinScopeSchema,
		kind: z.literal("attachment"),
		messageId: z.string(),
		attachmentId: z.string(),
	}),
	z.strictObject({
		scope: pinScopeSchema,
		kind: z.literal("note"),
		note: z.string(),
	}),
]) satisfies z.ZodType<AddPinRequest>;
const stopAgentRunsSchema = z.strictObject({
	messageId: z.string(),
	agentId: z.string().optional(),
}) satisfies z.ZodType<StopAgentRunsRequest>;
const reorderFollowupSchema = z.strictObject({
	messageId: z.string(),
	direction: z.enum(["up", "down"]),
}) satisfies z.ZodType<ReorderFollowupRequest>;
const removeFollowupSchema = z.strictObject({
	messageId: z.string(),
}) satisfies z.ZodType<RemoveFollowupRequest>;
const permissionResponseSchema = z.strictObject({ optionId: z.string() });
const searchKindSet: ReadonlySet<string> = new Set(COMMONSPACE_SEARCH_KINDS);

function requestErrorMessage(cause: unknown): string {
	if (cause instanceof z.ZodError) return z.prettifyError(cause);
	return cause instanceof Error ? cause.message : String(cause);
}

function firstHeaderValue(
	value: string | string[] | undefined,
): string | undefined {
	const first = Array.isArray(value) ? value[0] : value;
	const trimmed = first?.split(",")[0]?.trim();
	return trimmed === "" ? undefined : trimmed;
}

function requestBrowserHost(
	req: Pick<IncomingMessage, "headers">,
): string | undefined {
	const host = firstHeaderValue(req.headers.host);
	if (host === undefined || !requestHostIsLoopback(host)) return undefined;
	const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
	return forwardedHost !== undefined && requestHostIsLoopback(forwardedHost)
		? forwardedHost
		: host;
}

function requestHostIsLoopback(host: string): boolean {
	try {
		const hostname = new URL(`http://${host}`).hostname.toLocaleLowerCase();
		return (
			hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
		);
	} catch {
		return false;
	}
}

function urlMatchesRequestHost(
	value: string,
	host: string | undefined,
): boolean {
	if (host === undefined) return false;
	try {
		const url = new URL(value);
		return url.protocol === "http:" && url.host === host;
	} catch {
		return false;
	}
}

export interface CreateCommonspaceAppOptions {
	service: CommonspaceHostService;
	mcpGateway?: CommonspaceMcpGateway;
	directoryPicker?: () => Promise<string | null>;
	uiRoot?: string;
	/** Deterministic transport-boundary test override. */
	workspaceImportBodyLimitBytes?: number;
}

export function requestIsSameOrigin(
	req: Pick<IncomingMessage, "headers">,
): boolean {
	const host = requestBrowserHost(req);
	if (host === undefined) return false;
	const origin = req.headers.origin;
	if (origin !== undefined) {
		return urlMatchesRequestHost(origin, host);
	}
	const referer = req.headers.referer;
	if (referer !== undefined) {
		return urlMatchesRequestHost(referer, host);
	}
	return req.headers["sec-fetch-site"] === "same-origin";
}

export function requestIsLoopback(req: {
	socket: Pick<IncomingMessage["socket"], "remoteAddress">;
}): boolean {
	const address = req.socket.remoteAddress;
	return (
		address === "127.0.0.1" ||
		address === "::1" ||
		address?.startsWith("::ffff:127.") === true
	);
}

function requireSameOrigin(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	if (!requestIsSameOrigin(req)) {
		res
			.status(403)
			.json({ code: "origin_denied", error: "same-origin request required" });
		return;
	}
	next();
}

type QueryValue = Request["query"][string];

function queryString(value: QueryValue, fallback = ""): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string")
		throw new ProjectFileError(
			400,
			"invalid_query",
			"Query parameter must be a string",
		);
	return value;
}

function queryRootIndex(value: QueryValue): number {
	if (value === undefined) return 0;
	if (typeof value !== "string" || !/^\d+$/u.test(value)) {
		throw new ProjectFileError(
			400,
			"invalid_project_root",
			"Project folder index must be a non-negative integer",
		);
	}
	const rootIndex = Number(value);
	if (!Number.isSafeInteger(rootIndex))
		throw new ProjectFileError(
			400,
			"invalid_project_root",
			"Project folder index is too large",
		);
	return rootIndex;
}

function projectIdParam(value: string | string[] | undefined): string {
	if (typeof value !== "string" || value === "")
		throw new ProjectFileError(
			400,
			"invalid_project_id",
			"Project id is required",
		);
	return value;
}

function sendProjectError(res: Response, cause: unknown): void {
	if (cause instanceof ProjectFileError) {
		res.status(cause.status).json({ code: cause.code, error: cause.message });
		return;
	}
	res.status(500).json({
		code: "project_read_failed",
		error: "Unable to read project files",
	});
}

function configureApiTransport(
	app: Express,
	workspaceImportBodyLimitBytes: number,
): void {
	app.disable("x-powered-by");

	app.use("/api", (req, res, next) => {
		if (!requestIsLoopback(req)) {
			res.status(403).json({
				code: "loopback_required",
				error: "Commonspace is local-only",
			});
			return;
		}
		res.setHeader("cache-control", "no-store");
		next();
	});
	app.use("/api/send", express.json({ limit: MAX_SEND_BODY_BYTES }));
	app.use(
		"/api/import",
		express.json({ limit: workspaceImportBodyLimitBytes }),
	);
	app.use("/api", express.json({ limit: MAX_BODY_BYTES }));
}

function registerWorkspaceRoutes(
	app: Express,
	service: CommonspaceHostService,
	mcpGateway: CommonspaceMcpGateway | undefined,
): void {
	app.get("/api/health", (_req, res) => {
		res.json({ status: "ok" });
	});

	if (mcpGateway !== undefined) {
		app.all("/api/mcp", (req, res) => {
			void mcpGateway.handle(req, res);
		});
	}

	app.get("/api/bootstrap", requireSameOrigin, async (_req, res) => {
		res.json(await service.bootstrap());
	});

	app.get("/api/diagnostics", requireSameOrigin, async (_req, res) => {
		try {
			res.json(await service.diagnostics());
		} catch (error) {
			res.status(500).json({
				code: "diagnostics_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post(
		"/api/notifications/verify",
		requireSameOrigin,
		async (_req, res) => {
			res.json(await service.verifyDesktopNotifications());
		},
	);

	app.get("/api/export", requireSameOrigin, async (_req, res) => {
		try {
			res.setHeader(
				"content-disposition",
				'attachment; filename="commonspace-export.json"',
			);
			res.json(await service.exportWorkspace());
		} catch (error) {
			const tooLarge = error instanceof WorkspacePortabilitySizeError;
			res.status(tooLarge ? 413 : 500).json({
				code: tooLarge
					? "workspace_export_too_large"
					: "workspace_export_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/import", requireSameOrigin, async (req, res) => {
		try {
			const body = importWorkspaceBodySchema.parse(req.body);
			res.json(
				await service.importWorkspace(body.archive, body.projectMappings),
			);
		} catch (error) {
			const tooLarge = error instanceof WorkspacePortabilitySizeError;
			res.status(tooLarge ? 413 : 400).json({
				code: tooLarge
					? "workspace_import_too_large"
					: "workspace_import_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerRetentionAndSearchRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.post("/api/retention/preview", requireSameOrigin, (req, res) => {
		try {
			const body = retentionPreviewBodySchema.parse(req.body);
			res.json(service.previewRetention(body.conversation));
		} catch (error) {
			res.status(400).json({
				code: "retention_preview_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/retention/apply", requireSameOrigin, async (req, res) => {
		try {
			res.json(
				await service.applyRetention(
					applyRetentionRequestSchema.parse(req.body),
				),
			);
		} catch (error) {
			res.status(400).json({
				code: "retention_apply_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.get("/api/search", requireSameOrigin, async (req, res) => {
		try {
			const query = queryString(req.query.q);
			const rawKinds = queryString(req.query.types);
			const kinds =
				rawKinds === ""
					? []
					: rawKinds
							.split(",")
							.filter((kind): kind is CommonspaceSearchKind =>
								searchKindSet.has(kind),
							);
			if (rawKinds !== "" && kinds.length !== rawKinds.split(",").length)
				throw new Error("search contains an invalid result type");
			const rawLimit = queryString(req.query.limit, "24");
			if (!/^\d+$/u.test(rawLimit))
				throw new Error("search limit must be a positive integer");
			const projectId = queryString(req.query.project);
			const bootstrap = await service.bootstrap();
			const searchRequest: Parameters<typeof searchCommonspace>[1] = {
				query,
				limit: Number(rawLimit),
			};
			if (kinds.length > 0) searchRequest.kinds = kinds;
			if (projectId !== "") searchRequest.projectId = projectId;
			res.json(
				await searchCommonspace(
					{ ...bootstrap, state: service.snapshot() },
					searchRequest,
				),
			);
		} catch (error) {
			res.status(400).json({
				code: "search_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerRoutingRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.get("/api/routing", requireSameOrigin, (_req, res) => {
		res.json(service.routing());
	});

	app.put("/api/routing", requireSameOrigin, async (req, res) => {
		try {
			res.json(
				await service.updateRoutingConfiguration(
					RoutingConfigurationRequest.parse(req.body),
				),
			);
		} catch (error) {
			res.status(400).json({
				code: "routing_configuration_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/routing/validate", requireSameOrigin, (req, res) => {
		try {
			res.json(
				service.validateRoutingConfiguration(
					RoutingConfigurationRequest.parse(req.body),
				),
			);
		} catch (error) {
			res.status(400).json({
				code: "routing_validation_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerChannelContextRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.get("/api/channels/:channelId/context", requireSameOrigin, (req, res) => {
		try {
			const channelId = req.params.channelId;
			if (typeof channelId !== "string" || channelId === "")
				throw new Error("channel id is required");
			res.json(service.channelContext(channelId));
		} catch (error) {
			res.status(404).json({
				code: "channel_context_not_found",
				error: requestErrorMessage(error),
			});
		}
	});

	app.put(
		"/api/channels/:channelId/context",
		requireSameOrigin,
		async (req, res) => {
			try {
				const channelId = req.params.channelId;
				if (typeof channelId !== "string" || channelId === "")
					throw new Error("channel id is required");
				res.json(
					await service.updateChannelContext(
						channelId,
						contextRequestSchema.parse(req.body),
					),
				);
			} catch (error) {
				res.status(400).json({
					code: "channel_context_update_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.post(
		"/api/channels/:channelId/context/compact",
		requireSameOrigin,
		async (req, res) => {
			try {
				const channelId = req.params.channelId;
				if (typeof channelId !== "string" || channelId === "")
					throw new Error("channel id is required");
				res.json(await service.compactChannelContext(channelId));
			} catch (error) {
				res.status(400).json({
					code: "channel_context_compaction_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);
}

function registerThreadContextRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.get("/api/threads/:threadId/context", requireSameOrigin, (req, res) => {
		try {
			const threadId = req.params.threadId;
			if (typeof threadId !== "string" || threadId === "")
				throw new Error("thread id is required");
			res.json(service.threadContext(threadId));
		} catch (error) {
			res.status(404).json({
				code: "thread_context_not_found",
				error: requestErrorMessage(error),
			});
		}
	});

	app.put(
		"/api/threads/:threadId/context",
		requireSameOrigin,
		async (req, res) => {
			try {
				const threadId = req.params.threadId;
				if (typeof threadId !== "string" || threadId === "")
					throw new Error("thread id is required");
				res.json(
					await service.updateThreadContext(
						threadId,
						threadContextRequestSchema.parse(req.body),
					),
				);
			} catch (error) {
				res.status(400).json({
					code: "thread_context_update_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.post(
		"/api/threads/:threadId/context/compact",
		requireSameOrigin,
		async (req, res) => {
			try {
				const threadId = req.params.threadId;
				if (typeof threadId !== "string" || threadId === "")
					throw new Error("thread id is required");
				res.json(await service.compactThreadContext(threadId));
			} catch (error) {
				res.status(400).json({
					code: "thread_context_compaction_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);
}

function registerProjectRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.get(
		"/api/projects/:projectId/files",
		requireSameOrigin,
		async (req, res) => {
			try {
				res.json(
					await listProjectFiles(
						service.snapshot(),
						projectIdParam(req.params.projectId),
						queryRootIndex(req.query.root),
						queryString(req.query.path),
					),
				);
			} catch (error) {
				sendProjectError(res, error);
			}
		},
	);

	app.get(
		"/api/projects/:projectId/file",
		requireSameOrigin,
		async (req, res) => {
			try {
				const file = await openProjectFile(
					service.snapshot(),
					projectIdParam(req.params.projectId),
					queryRootIndex(req.query.root),
					queryString(req.query.path),
				);
				try {
					await streamProjectFile(req, res, file);
				} finally {
					await file.handle.close();
				}
			} catch (error) {
				if (res.headersSent) {
					res.destroy();
					return;
				}
				sendProjectError(res, error);
			}
		},
	);

	app.post(
		"/api/projects/:projectId/open",
		requireSameOrigin,
		async (req, res) => {
			try {
				const body = ProjectEditorTarget.parse(req.body);
				res.json(
					await openProjectFileInEditor(
						service.snapshot(),
						projectIdParam(req.params.projectId),
						body,
					),
				);
			} catch (error) {
				sendProjectError(res, error);
			}
		},
	);

	app.get(
		"/api/projects/:projectId/changes",
		requireSameOrigin,
		async (req, res) => {
			try {
				res.json(
					await projectGitStatus(
						service.snapshot(),
						projectIdParam(req.params.projectId),
						queryRootIndex(req.query.root),
					),
				);
			} catch (error) {
				sendProjectError(res, error);
			}
		},
	);

	app.get(
		"/api/projects/:projectId/diff",
		requireSameOrigin,
		async (req, res) => {
			try {
				res.json(
					await projectGitDiff(
						service.snapshot(),
						projectIdParam(req.params.projectId),
						queryRootIndex(req.query.root),
						queryString(req.query.path),
					),
				);
			} catch (error) {
				sendProjectError(res, error);
			}
		},
	);
}

function registerAgentRoutes(
	app: Express,
	service: CommonspaceHostService,
	pickDirectory: () => Promise<string | null>,
): void {
	app.get(
		"/api/agents/:agentId/capabilities",
		requireSameOrigin,
		async (req, res) => {
			res.setHeader("cache-control", "no-store");
			try {
				const agentId = req.params.agentId;
				if (typeof agentId !== "string") {
					res
						.status(400)
						.json({ code: "invalid_agent_id", error: "Agent ID is required." });
					return;
				}
				const inventory = await service.inspectAgentCapabilities(agentId);
				if (inventory === undefined) {
					res.status(404).json({
						code: "agent_not_found",
						error: "Agent is not in this workspace.",
					});
					return;
				}
				res.json(inventory);
			} catch {
				res.status(500).json({
					code: "capability_inspection_failed",
					error:
						"Native capability inspection failed. Retry from the agent settings.",
				});
			}
		},
	);

	app.post("/api/discover-agents", requireSameOrigin, async (req, res) => {
		try {
			const body = discoverAgentsRequestSchema.parse(req.body);
			res.json(await service.discoverAgents(body.adapter));
		} catch (error) {
			res.status(400).json({
				code: "agent_discovery_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.get("/api/events", requireSameOrigin, (req, res) => {
		res.status(200);
		res.setHeader("content-type", "text/event-stream; charset=utf-8");
		res.setHeader("cache-control", "no-store");
		res.setHeader("connection", "keep-alive");
		res.flushHeaders();
		const writeRevision = (revision: number) => {
			res.write(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`);
		};
		const writeActivity = (
			activities: readonly CommonspaceLiveAgentActivity[],
		) => {
			res.write(
				`event: activity\ndata: ${JSON.stringify({ activities, queuedFollowups: service.queuedFollowups() })}\n\n`,
			);
		};
		writeRevision(service.snapshot().revision);
		writeActivity(service.liveActivities());
		const unsubscribeRevision = service.subscribeToRevisions(writeRevision);
		const unsubscribeRouting = service.subscribeToRoutingChanges(() => {
			res.write("event: routing-changed\ndata: {}\n\n");
		});
		const unsubscribeActivity =
			service.subscribeToLiveActivities(writeActivity);
		req.on("close", () => {
			unsubscribeRevision();
			unsubscribeRouting();
			unsubscribeActivity();
		});
	});

	app.post("/api/select-directory", requireSameOrigin, async (_req, res) => {
		try {
			const path = await pickDirectory();
			res.json({ path } satisfies SelectDirectoryResponse);
		} catch (error) {
			res.status(500).json({
				code: "directory_picker_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerDeliveryRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.post("/api/mutate", requireSameOrigin, async (req, res) => {
		try {
			await service.mutate(mutationSchema.parse(req.body));
			res.json(await service.bootstrap());
		} catch (error) {
			res.status(400).json({
				code: "invalid_mutation",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/send", requireSameOrigin, async (req, res) => {
		try {
			res
				.status(202)
				.json(await service.send(sendMessageRequestSchema.parse(req.body)));
		} catch (error) {
			res.status(400).json({
				code: "send_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/reroute", requireSameOrigin, async (req, res) => {
		try {
			res
				.status(202)
				.json(
					await service.rerouteAssignment(
						rerouteAssignmentSchema.parse(req.body),
					),
				);
		} catch (error) {
			res.status(400).json({
				code: "reroute_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/routing/retry", requireSameOrigin, async (req, res) => {
		try {
			res
				.status(202)
				.json(await service.retryRouting(retryRoutingSchema.parse(req.body)));
		} catch (error) {
			res.status(400).json({
				code: "routing_retry_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerMessageAndPinRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.post(
		"/api/messages/:messageId/edit",
		requireSameOrigin,
		async (req, res) => {
			try {
				const messageId = req.params.messageId;
				if (typeof messageId !== "string" || messageId === "")
					throw new Error("message id is required");
				const body = editMessageBodySchema.parse(req.body);
				res.status(202).json(
					await service.editMessage({
						...body,
						messageId,
					}),
				);
			} catch (error) {
				res.status(400).json({
					code: "message_edit_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.post(
		"/api/messages/:messageId/delete",
		requireSameOrigin,
		async (req, res) => {
			try {
				const messageId = req.params.messageId;
				if (typeof messageId !== "string" || messageId === "")
					throw new Error("message id is required");
				res.json(await service.deleteMessage(messageId));
			} catch (error) {
				res.status(400).json({
					code: "message_delete_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.post("/api/pins", requireSameOrigin, async (req, res) => {
		try {
			res
				.status(201)
				.json(await service.addPin(addPinRequestSchema.parse(req.body)));
		} catch (error) {
			res.status(400).json({
				code: "pin_add_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/pins/:pinId/remove", requireSameOrigin, async (req, res) => {
		try {
			const pinId = req.params.pinId;
			if (typeof pinId !== "string" || pinId === "")
				throw new Error("pin id is required");
			res.json(await service.removePin(pinId));
		} catch (error) {
			res.status(400).json({
				code: "pin_remove_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerRunControlRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.post(
		"/api/permissions/:permissionId/respond",
		requireSameOrigin,
		async (req, res) => {
			try {
				const permissionId = req.params.permissionId;
				const body = permissionResponseSchema.parse(req.body);
				if (typeof permissionId !== "string" || permissionId === "")
					throw new Error("permission id is required");
				if (body.optionId === "")
					throw new Error("permission option is required");
				res.json(await service.respondPermission(permissionId, body.optionId));
			} catch (error) {
				res.status(400).json({
					code: "permission_response_failed",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.post("/api/stop", requireSameOrigin, async (req, res) => {
		try {
			res.json(
				await service.stopAgentRuns(stopAgentRunsSchema.parse(req.body)),
			);
		} catch (error) {
			res.status(400).json({
				code: "stop_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/followups/reorder", requireSameOrigin, async (req, res) => {
		try {
			res.json(
				await service.reorderFollowup(reorderFollowupSchema.parse(req.body)),
			);
		} catch (error) {
			res.status(400).json({
				code: "followup_reorder_failed",
				error: requestErrorMessage(error),
			});
		}
	});

	app.post("/api/followups/remove", requireSameOrigin, async (req, res) => {
		try {
			res.json(
				await service.removeFollowup(removeFollowupSchema.parse(req.body)),
			);
		} catch (error) {
			res.status(400).json({
				code: "followup_remove_failed",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerAttachmentRoutes(
	app: Express,
	service: CommonspaceHostService,
): void {
	app.get(
		"/api/attachments/:attachmentId",
		requireSameOrigin,
		async (req, res) => {
			try {
				const attachmentId = req.params.attachmentId;
				if (typeof attachmentId !== "string")
					throw new Error("unknown image attachment");
				const { attachment, data } =
					await service.readImageAttachment(attachmentId);
				res.setHeader("content-type", attachment.mimeType);
				res.setHeader("content-length", String(data.length));
				res.setHeader("x-content-type-options", "nosniff");
				res.send(data);
			} catch (error) {
				res.status(404).json({
					code: "attachment_not_found",
					error: requestErrorMessage(error),
				});
			}
		},
	);

	app.get("/api/files/:fileId", requireSameOrigin, async (req, res) => {
		try {
			const fileId = req.params.fileId;
			if (typeof fileId !== "string")
				throw new Error("unknown file attachment");
			const { metadata, data } = await service.readFileAttachment(fileId);
			res.setHeader("content-type", metadata.mimeType);
			res.setHeader("content-length", String(data.length));
			res.setHeader(
				"content-disposition",
				`attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
			);
			res.setHeader("x-content-type-options", "nosniff");
			res.send(data);
		} catch (error) {
			res.status(404).json({
				code: "file_attachment_not_found",
				error: requestErrorMessage(error),
			});
		}
	});
}

function registerFallbackRoutes(
	app: Express,
	uiRoot: string | undefined,
): void {
	app.use("/api", (_req, res) => {
		res.status(404).json({ code: "not_found", error: "API route not found" });
	});

	if (uiRoot !== undefined) {
		app.use((_req, res, next) => {
			res.setHeader("content-security-policy", "frame-ancestors 'none'");
			res.setHeader("x-frame-options", "DENY");
			res.setHeader("x-content-type-options", "nosniff");
			next();
		});
		app.use(express.static(uiRoot, { index: false }));
		app.get(/^(?!\/api(?:\/|$)).*/u, (_req, res, next) => {
			res.sendFile("index.html", { root: uiRoot }, (error) => {
				if (error !== undefined) next(error);
			});
		});
	}

	app.get("/", (_req, res) => {
		res.json({ status: "ok" });
	});

	app.use((_req, res) => {
		res.status(404).json({ code: "not_found", error: "route not found" });
	});

	const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
		void next;
		const message = requestErrorMessage(error);
		const status =
			error instanceof Error &&
			"type" in error &&
			error.type === "entity.too.large"
				? 413
				: 500;
		res.status(status).json({
			code: status === 413 ? "body_too_large" : "internal_error",
			error: message,
		});
	};
	app.use(errorHandler);
}

export function createCommonspaceApp({
	service,
	mcpGateway,
	directoryPicker,
	uiRoot,
	workspaceImportBodyLimitBytes = MAX_WORKSPACE_IMPORT_BODY_BYTES,
}: CreateCommonspaceAppOptions): Express {
	const app = express();
	const pickDirectory = directoryPicker ?? selectLocalDirectory;
	configureApiTransport(app, workspaceImportBodyLimitBytes);
	registerWorkspaceRoutes(app, service, mcpGateway);
	registerRetentionAndSearchRoutes(app, service);
	registerRoutingRoutes(app, service);
	registerChannelContextRoutes(app, service);
	registerThreadContextRoutes(app, service);
	registerProjectRoutes(app, service);
	registerAgentRoutes(app, service, pickDirectory);
	registerDeliveryRoutes(app, service);
	registerMessageAndPinRoutes(app, service);
	registerRunControlRoutes(app, service);
	registerAttachmentRoutes(app, service);
	registerFallbackRoutes(app, uiRoot);
	return app;
}
