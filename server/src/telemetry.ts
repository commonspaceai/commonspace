import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import {
	ATTR_ERROR_TYPE,
	ATTR_EXCEPTION_TYPE,
	ATTR_SERVICE_NAME,
} from "@opentelemetry/semantic-conventions";

export const serverTracer = trace.getTracer("commonspace.server");
const serverLogger = logs.getLogger("commonspace.server");

function errorTypes(error: Error | undefined): string[] {
	const types: string[] = [];
	const seen = new Set<Error>();
	let cause: unknown = error;
	while (cause instanceof Error && types.length < 8 && !seen.has(cause)) {
		seen.add(cause);
		const name = cause.constructor.name;
		if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name)) break;
		types.push(name);
		cause = cause.cause;
	}
	return types;
}

export function markOperationFailed(
	span: Span,
	error: Error | undefined,
	description: string,
): void {
	span.setStatus({ code: SpanStatusCode.ERROR, message: description });
	const type = errorTypes(error)[0];
	if (type !== undefined) span.setAttribute(ATTR_ERROR_TYPE, type);
}

export function recordOperationException(
	error: Error | undefined,
	options: {
		eventName: string;
		body: string;
		severity: SeverityNumber.WARN | SeverityNumber.ERROR;
		recoveryAction?: string;
	},
): void {
	const types = errorTypes(error);
	const attributes: Record<string, string | string[]> = {};
	if (types[0] !== undefined) attributes[ATTR_EXCEPTION_TYPE] = types[0];
	if (types.length > 1)
		attributes["commonspace.error.cause_types"] = types.slice(1);
	if (options.recoveryAction !== undefined)
		attributes["commonspace.recovery.action"] = options.recoveryAction;
	serverLogger.emit({
		eventName: options.eventName,
		severityNumber: options.severity,
		severityText: SeverityNumber[options.severity],
		body: options.body,
		attributes,
	});
}

export function configuredTelemetryEndpoint(
	value: string | undefined,
): string | undefined {
	if (value === undefined || value === "") return undefined;
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new Error("COMMONSPACE_OTLP_ENDPOINT must be a loopback HTTP origin");
	}
	if (
		endpoint.protocol !== "http:" ||
		!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
		endpoint.username !== "" ||
		endpoint.password !== "" ||
		endpoint.pathname !== "/" ||
		endpoint.search !== "" ||
		endpoint.hash !== ""
	) {
		throw new Error("COMMONSPACE_OTLP_ENDPOINT must be a loopback HTTP origin");
	}
	return endpoint.origin;
}

export async function startTelemetry(value: string | undefined) {
	const endpoint = configuredTelemetryEndpoint(value);
	if (endpoint === undefined) return undefined;
	const [
		{ NodeTracerProvider },
		{ BatchSpanProcessor },
		{ OTLPTraceExporter },
		{ OTLPLogExporter },
		{ BatchLogRecordProcessor, LoggerProvider },
		{ resourceFromAttributes },
	] = await Promise.all([
		import("@opentelemetry/sdk-trace-node"),
		import("@opentelemetry/sdk-trace-base"),
		import("@opentelemetry/exporter-trace-otlp-http"),
		import("@opentelemetry/exporter-logs-otlp-http"),
		import("@opentelemetry/sdk-logs"),
		import("@opentelemetry/resources"),
	]);
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "commonspace",
	});
	const tracerProvider = new NodeTracerProvider({
		resource,
		spanProcessors: [
			new BatchSpanProcessor(
				new OTLPTraceExporter({
					url: `${endpoint}/v1/traces`,
					timeoutMillis: 1_500,
				}),
				{ exportTimeoutMillis: 2_000 },
			),
		],
	});
	const loggerProvider = new LoggerProvider({
		resource,
		processors: [
			new BatchLogRecordProcessor({
				exporter: new OTLPLogExporter({
					url: `${endpoint}/v1/logs`,
					timeoutMillis: 1_500,
				}),
				exportTimeoutMillis: 2_000,
			}),
		],
	});
	tracerProvider.register();
	logs.setGlobalLoggerProvider(loggerProvider);
	return {
		async shutdown() {
			const results = await Promise.allSettled([
				loggerProvider.shutdown(),
				tracerProvider.shutdown(),
			]);
			for (const result of results) {
				if (result.status === "rejected") throw result.reason;
			}
		},
	};
}

export async function shutdownTelemetry(
	telemetry: { shutdown(): Promise<void> } | undefined,
): Promise<void> {
	try {
		await telemetry?.shutdown();
	} catch {
		process.stderr.write(
			"Commonspace telemetry export failed during shutdown\n",
		);
	}
}
