import type { Serializable } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
	AGENT_ADAPTER_KINDS,
	type AgentAdapterKind,
	isAgentAdapterKind,
	type PrivateHostLocator,
} from "@commonspace/shared";
import { context, trace } from "@opentelemetry/api";
import pino from "pino";
import { type CommonspaceAppIngress, createCommonspaceApp } from "./app.js";
import { CommonspaceMcpGateway } from "./commonspace-mcp.js";
import { developmentServerMessages } from "./dev-supervisor.js";
import {
	createHostLocator,
	publishHostLocator,
	removeHostLocator,
} from "./host-locator.js";
import type { RunningClassifier } from "./local-classifier.js";
import {
	type RemoteAccessConfiguration,
	RemoteAccessConfigurationSchema,
	remoteAccessFromEnvironment,
} from "./remote-access.js";
import {
	type CommonspaceHostConfig,
	type CommonspaceHostDependencies,
	CommonspaceHostService,
} from "./service.js";
import { shutdownTelemetry, startTelemetry } from "./telemetry.js";
import { acquireWorkspaceLock } from "./workspace-lock.js";

interface CommonspaceLogger {
	info(message: string): void;
	warn(message: Error | string): void;
}

export interface StartCommonspaceServerOptions extends CommonspaceHostConfig {
	port?: number;
	uiRoot?: string;
	directoryPicker?: () => Promise<string | null>;
	dependencies?: Partial<CommonspaceHostDependencies>;
	logger?: CommonspaceLogger;
	remoteAccess?: RemoteAccessConfiguration;
	onHostStop?: () => void;
}

export interface RunningCommonspaceServer {
	url: string;
	remoteUrl?: string;
	remoteLoopbackUrl?: string;
	service: CommonspaceHostService;
	close(): Promise<void>;
	drainAndClose(): Promise<void>;
}

function defaultLogger(): CommonspaceLogger {
	const logger = pino({
		level: process.env.COMMONSPACE_LOG_LEVEL ?? "info",
		mixin: () => {
			const span = trace.getSpan(context.active());
			if (span === undefined) return {};
			const spanContext = span.spanContext();
			if (!trace.isSpanContextValid(spanContext)) return {};
			const { traceId, spanId } = spanContext;
			return { trace_id: traceId, span_id: spanId };
		},
	});
	return {
		info: (message) => logger.info(message),
		warn: (message) =>
			logger.warn(
				{ error: message instanceof Error ? message.message : message },
				"Commonspace warning",
			),
	};
}

async function closeHttpServer(server: Server): Promise<void> {
	if (!server.listening) return;
	const closing = new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => {
			if (error === undefined) resolveClose();
			else rejectClose(error);
		});
	});
	server.closeAllConnections();
	await closing;
}

async function listenOnLoopback(server: Server, port: number): Promise<string> {
	await new Promise<void>((resolveListen, rejectListen) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			rejectListen(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolveListen();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "127.0.0.1");
	});
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Commonspace server did not expose a TCP address");
	return new URL(`http://127.0.0.1:${String(address.port)}`).origin;
}

export async function startCommonspaceServer(
	options: StartCommonspaceServerOptions = {},
): Promise<RunningCommonspaceServer> {
	const logger = options.logger ?? defaultLogger();
	const remoteAccess =
		options.remoteAccess === undefined
			? undefined
			: RemoteAccessConfigurationSchema.parse(options.remoteAccess);
	const service = new CommonspaceHostService(
		{ logger },
		options,
		options.dependencies,
	);
	const releaseWorkspace = await acquireWorkspaceLock(service.root);
	const server = createServer((_request, response) => {
		response.writeHead(503, { "content-type": "text/plain" });
		response.end("Commonspace is starting.");
	});
	const remoteListener =
		remoteAccess === undefined
			? undefined
			: { server: createServer(), access: remoteAccess };
	const httpServers = [server];
	if (remoteListener !== undefined) httpServers.push(remoteListener.server);
	const closeHttpServers = async () => {
		await Promise.all(httpServers.map(closeHttpServer));
	};
	let url: string;
	let remoteLoopbackUrl: string | undefined;
	let locator: PrivateHostLocator;
	try {
		url = await listenOnLoopback(server, options.port ?? 47321);
		if (remoteListener !== undefined)
			remoteLoopbackUrl = await listenOnLoopback(
				remoteListener.server,
				remoteListener.access.port,
			);
		locator = await createHostLocator(service.root, url);
	} catch (error) {
		await closeHttpServers().catch(() => undefined);
		await releaseWorkspace();
		throw error;
	}
	const mcpGateway = new CommonspaceMcpGateway(service);
	try {
		await service.initialize();
		const ingress: Extract<CommonspaceAppIngress, { kind: "local" }> = {
			kind: "local",
			hostControl: {
				id: locator.id,
				token: locator.token,
				stop: () => {
					if (options.onHostStop !== undefined) options.onHostStop();
					else
						void stop(service.close()).catch((error: Error) =>
							logger.warn(error),
						);
				},
			},
		};
		const clientOptions: Pick<
			Parameters<typeof createCommonspaceApp>[0],
			"service" | "uiRoot"
		> = { service };
		if (options.uiRoot !== undefined) clientOptions.uiRoot = options.uiRoot;
		const appOptions: Parameters<typeof createCommonspaceApp>[0] = {
			...clientOptions,
			mcpGateway,
			ingress,
		};
		if (options.directoryPicker !== undefined)
			appOptions.directoryPicker = options.directoryPicker;
		const app = createCommonspaceApp(appOptions);
		service.attachMcpGateway(mcpGateway, `${url}/api/mcp`);
		service.attachClientUrl(url);
		server.removeAllListeners("request");
		server.on("request", app);
		if (remoteListener !== undefined) {
			const remoteOptions: Parameters<typeof createCommonspaceApp>[0] = {
				...clientOptions,
				ingress: { kind: "remote", remoteAccess: remoteListener.access },
			};
			remoteListener.server.on("request", createCommonspaceApp(remoteOptions));
		}
		await publishHostLocator(locator);
	} catch (error) {
		await closeHttpServers().catch(() => undefined);
		await mcpGateway.close().catch(() => undefined);
		await service.close().catch(() => undefined);
		await removeHostLocator(locator).catch(() => undefined);
		if (service.isClosed) await releaseWorkspace();
		throw error;
	}
	let httpCloseOperation: Promise<void> | undefined;
	const stop = async (operation: Promise<void>): Promise<void> => {
		try {
			await operation;
		} finally {
			httpCloseOperation ??= (async () => {
				await closeHttpServers();
				if (service.isClosed) {
					try {
						await removeHostLocator(locator);
					} finally {
						await releaseWorkspace();
					}
				}
			})();
			await httpCloseOperation;
		}
	};
	const running: RunningCommonspaceServer = {
		url,
		service,
		close: () => stop(service.close()),
		drainAndClose: () => stop(service.drainAndClose()),
	};
	if (remoteAccess !== undefined && remoteLoopbackUrl !== undefined) {
		running.remoteUrl = remoteAccess.origin;
		running.remoteLoopbackUrl = remoteLoopbackUrl;
	}
	return running;
}

function configuredPort(value: string | undefined): number {
	if (value === undefined || value === "") return 47321;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error("COMMONSPACE_PORT must be an integer from 0 to 65535");
	}
	return port;
}

function configuredAgentYolo(
	value: string | undefined,
): boolean | AgentAdapterKind {
	if (value === undefined || value === "" || value === "0") return false;
	if (value === "1") return true;
	if (isAgentAdapterKind(value)) return value;
	throw new Error(
		`COMMONSPACE_AGENT_YOLO must be 0, 1, or one harness name: ${AGENT_ADAPTER_KINDS.join(", ")}`,
	);
}

function cliServerOptions(): StartCommonspaceServerOptions {
	const serverOptions: StartCommonspaceServerOptions = {
		port: configuredPort(process.env.COMMONSPACE_PORT),
		agentYolo: configuredAgentYolo(process.env.COMMONSPACE_AGENT_YOLO),
	};
	const remoteAccess = remoteAccessFromEnvironment(process.env);
	if (remoteAccess !== undefined) serverOptions.remoteAccess = remoteAccess;
	if (process.env.COMMONSPACE_HOME !== undefined)
		serverOptions.root = process.env.COMMONSPACE_HOME;
	if (process.env.INIT_CWD !== undefined)
		serverOptions.defaultCwd = process.env.INIT_CWD;
	if (process.env.COMMONSPACE_HERMES_PATH !== undefined)
		serverOptions.hermesPath = process.env.COMMONSPACE_HERMES_PATH;
	if (process.env.COMMONSPACE_CODEX_PATH !== undefined)
		serverOptions.codexPath = process.env.COMMONSPACE_CODEX_PATH;
	if (process.env.COMMONSPACE_HERMES_ACP_PATH !== undefined)
		serverOptions.hermesAcpCommand = process.env.COMMONSPACE_HERMES_ACP_PATH;
	if (process.env.COMMONSPACE_CODEX_ACP_PATH !== undefined)
		serverOptions.codexAcpCommand = process.env.COMMONSPACE_CODEX_ACP_PATH;
	if (process.env.COMMONSPACE_CLAUDE_CODE_PATH !== undefined)
		serverOptions.claudeCodePath = process.env.COMMONSPACE_CLAUDE_CODE_PATH;
	if (process.env.COMMONSPACE_CLAUDE_CODE_ACP_PATH !== undefined)
		serverOptions.claudeCodeAcpCommand =
			process.env.COMMONSPACE_CLAUDE_CODE_ACP_PATH;
	if (process.env.COMMONSPACE_GEMINI_PATH !== undefined)
		serverOptions.geminiPath = process.env.COMMONSPACE_GEMINI_PATH;
	if (process.env.COMMONSPACE_GEMINI_ACP_PATH !== undefined)
		serverOptions.geminiAcpCommand = process.env.COMMONSPACE_GEMINI_ACP_PATH;
	if (process.env.COMMONSPACE_OPENCODE_PATH !== undefined)
		serverOptions.opencodePath = process.env.COMMONSPACE_OPENCODE_PATH;
	if (process.env.COMMONSPACE_OPENCODE_ACP_PATH !== undefined)
		serverOptions.opencodeAcpCommand =
			process.env.COMMONSPACE_OPENCODE_ACP_PATH;
	if (process.env.COMMONSPACE_UI_ROOT !== undefined)
		serverOptions.uiRoot = process.env.COMMONSPACE_UI_ROOT;
	return serverOptions;
}

function readyMessage(running: RunningCommonspaceServer) {
	const ready: Pick<
		RunningCommonspaceServer,
		"url" | "remoteUrl" | "remoteLoopbackUrl"
	> & {
		type: typeof developmentServerMessages.ready;
	} = { type: developmentServerMessages.ready, url: running.url };
	if (
		running.remoteUrl !== undefined &&
		running.remoteLoopbackUrl !== undefined
	) {
		ready.remoteUrl = running.remoteUrl;
		ready.remoteLoopbackUrl = running.remoteLoopbackUrl;
	}
	return ready;
}

export async function runCommonspaceCli(
	options: { classifier?: RunningClassifier; signal?: AbortSignal } = {},
): Promise<void> {
	const serverOptions = cliServerOptions();
	if (options.classifier !== undefined) {
		const classifier = options.classifier;
		serverOptions.dependencies = {
			classifyRouting: (request, signal) =>
				classifier.classify(request, signal),
		};
	}
	options.signal?.throwIfAborted();
	const telemetry = await startTelemetry(process.env.COMMONSPACE_OTLP_ENDPOINT);
	let telemetryClose: Promise<void> | undefined;
	const closeTelemetry = () =>
		(telemetryClose ??= shutdownTelemetry(telemetry));
	let running: RunningCommonspaceServer;
	try {
		running = await startCommonspaceServer(serverOptions);
	} catch (error) {
		await closeTelemetry();
		throw error;
	}
	if (options.signal?.aborted === true) {
		try {
			await running.close();
		} finally {
			try {
				await options.classifier?.close();
			} finally {
				await closeTelemetry();
			}
		}
		options.signal.throwIfAborted();
	}
	process.stdout.write(`Commonspace is running at ${running.url}\n`);
	let finalized = false;
	const finalize = (operation: Promise<void>) => {
		const finish = async () => {
			try {
				await operation;
			} finally {
				try {
					await options.classifier?.close();
				} finally {
					await closeTelemetry();
				}
			}
		};
		void finish()
			.then(() => {
				if (finalized) return;
				finalized = true;
				process.exitCode = 0;
				if (process.connected) process.disconnect?.();
			})
			.catch((error: Error) => {
				if (finalized) return;
				finalized = true;
				process.stderr.write(`${String(error)}\n`);
				process.exitCode = 1;
				if (process.connected) process.disconnect?.();
			});
	};
	const stop = () => {
		finalize(running.close());
	};
	serverOptions.onHostStop = stop;
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	process.once("disconnect", stop);
	process.on("message", (message: Serializable) => {
		if (
			typeof message !== "object" ||
			message === null ||
			!("type" in message) ||
			message.type !== developmentServerMessages.restart
		)
			return;
		finalize(running.drainAndClose());
	});
	const ready = readyMessage(running);
	process.send?.(ready);
}

const entryPath = process.argv[1]?.replaceAll("\\", "/");
if (
	entryPath?.endsWith("/server/src/index.ts") === true ||
	entryPath?.endsWith("/server/dist/index.js") === true
) {
	void runCommonspaceCli().catch((error: Error) => {
		process.stderr.write(`${String(error)}\n`);
		process.exitCode = 1;
	});
}
