import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpanStatusCode } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { expect, it } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { configuredTelemetryEndpoint } from "../server/src/telemetry.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

it("records bounded acceptance and agent outcomes with one correlated exception", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-telemetry-"));
	const privateDetail = `secret in ${root}`;
	const spans = new InMemorySpanExporter();
	const logExporter = new InMemoryLogRecordExporter();
	let signalFirstRun!: () => void;
	let releaseFirstRun!: () => void;
	const firstRunStarted = new Promise<void>((resolve) => {
		signalFirstRun = resolve;
	});
	const firstRunFinished = new Promise<void>((resolve) => {
		releaseFirstRun = resolve;
	});
	let runCount = 0;
	const resource = resourceFromAttributes({
		"service.name": "commonspace-test",
	});
	const tracerProvider = new NodeTracerProvider({
		resource,
		spanProcessors: [new SimpleSpanProcessor(spans)],
	});
	const loggerProvider = new LoggerProvider({
		resource,
		processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
	});
	tracerProvider.register();
	logs.setGlobalLoggerProvider(loggerProvider);
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => {
				runCount += 1;
				if (runCount === 1) {
					signalFirstRun();
					await firstRunFinished;
					return { text: "Done." };
				}
				throw new Error(privateDetail, { cause: new TypeError(privateDetail) });
			},
		},
	);
	try {
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const first = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: privateDetail,
		});
		await firstRunStarted;
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: privateDetail,
		});
		releaseFirstRun();
		await service.whenIdle();
		await service.editMessage({
			messageId: first.accepted.id,
			text: privateDetail,
		});
		await service.whenIdle();
		await expect(
			service.send({
				conversation: { kind: "dm", id: "missing" },
				text: privateDetail,
			}),
		).rejects.toThrow();

		const records = spans.getFinishedSpans();
		const acceptances = records.filter(
			(span) =>
				span.name === "commonspace.message.accept" &&
				span.status.code === SpanStatusCode.OK,
		);
		const agentRuns = records.filter(
			(span) => span.name === "commonspace.agent.run",
		);
		const agentRun = agentRuns.find(
			(span) => span.status.code === SpanStatusCode.ERROR,
		);
		const attempt = records.find(
			(span) =>
				span.name === "commonspace.agent.run_attempt" &&
				span.status.code === SpanStatusCode.ERROR,
		);
		expect(acceptances).toHaveLength(3);
		expect(acceptances[0]?.attributes).toMatchObject({
			"commonspace.conversation.kind": "dm",
			"commonspace.message.source": "send",
			"commonspace.message.accepted": true,
		});
		expect(acceptances[2]?.attributes["commonspace.message.source"]).toBe(
			"edit",
		);
		expect(agentRun?.status.code).toBe(SpanStatusCode.ERROR);
		expect(agentRun?.attributes["error.type"]).toBe("Error");
		expect(attempt?.status.code).toBe(SpanStatusCode.ERROR);
		expect(attempt?.attributes["error.type"]).toBe("Error");
		expect(attempt?.parentSpanContext?.spanId).toBe(
			agentRun?.spanContext().spanId,
		);
		expect(agentRuns.map((span) => span.spanContext().traceId)).toEqual(
			acceptances.map((span) => span.spanContext().traceId),
		);
		expect(acceptances[0]?.spanContext().traceId).not.toBe(
			acceptances[1]?.spanContext().traceId,
		);

		const exceptions = logExporter
			.getFinishedLogRecords()
			.filter((record) => record.eventName?.endsWith(".exception"));
		expect(exceptions.map((record) => record.eventName).sort()).toEqual([
			"commonspace.agent.run.exception",
			"commonspace.agent.run.exception",
			"commonspace.message.accept.exception",
		]);
		const agentException = exceptions.find(
			(record) => record.eventName === "commonspace.agent.run.exception",
		);
		expect(agentException?.severityNumber).toBe(SeverityNumber.ERROR);
		expect(agentException?.attributes["exception.type"]).toBe("Error");
		expect(agentException?.attributes["commonspace.error.cause_types"]).toEqual(
			["TypeError"],
		);
		expect(agentException?.spanContext?.traceId).toBe(
			agentRun?.spanContext().traceId,
		);
		expect(
			JSON.stringify(
				records.map((span) => ({
					attributes: span.attributes,
					status: span.status,
				})),
			),
		).not.toContain(privateDetail);
		expect(
			JSON.stringify(
				exceptions.map((record) => ({
					body: record.body,
					attributes: record.attributes,
				})),
			),
		).not.toContain(privateDetail);
	} finally {
		await service.close();
		await loggerProvider.shutdown();
		await tracerProvider.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});

it("only accepts an explicitly configured loopback OTLP collector", () => {
	expect(configuredTelemetryEndpoint(undefined)).toBeUndefined();
	expect(configuredTelemetryEndpoint("http://127.0.0.1:4318")).toBe(
		"http://127.0.0.1:4318",
	);
	expect(() =>
		configuredTelemetryEndpoint("https://collector.example.com"),
	).toThrow();
	expect(() =>
		configuredTelemetryEndpoint("http://localhost:4318/private"),
	).toThrow();
});
