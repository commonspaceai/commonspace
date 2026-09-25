import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
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
import { expect, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

it("reports an inference deadline as failure rather than cancellation", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-telemetry-timeout-"));
	const spans = new InMemorySpanExporter();
	const logExporter = new InMemoryLogRecordExporter();
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
	const deadline = new AbortController();
	const timeout = vi
		.spyOn(AbortSignal, "timeout")
		.mockReturnValue(deadline.signal);
	const inferenceStarted = Promise.withResolvers<void>();
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async (input) => {
				if (input.ephemeralSession !== true)
					throw new Error("expected an inference run");
				inferenceStarted.resolve();
				return new Promise<never>((_resolve, reject) => {
					input.signal.addEventListener(
						"abort",
						() => reject(input.signal.reason),
						{ once: true },
					);
				});
			},
		},
	);
	try {
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const state = await service.mutate({
			action: "create-channel",
			name: "telemetry",
			agentIds: ["codex"],
		});
		const channel = state.channels[0];
		if (channel === undefined) throw new Error("channel was not created");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Route this request",
		});
		await inferenceStarted.promise;
		deadline.abort(new DOMException("PRIVATE_TIMEOUT_DETAIL", "TimeoutError"));
		await service.whenIdle();

		const run = spans
			.getFinishedSpans()
			.find((span) => span.name === "commonspace.agent.run");
		const attempt = spans
			.getFinishedSpans()
			.find((span) => span.name === "commonspace.agent.run_attempt");
		expect(run?.attributes["commonspace.agent.outcome"]).toBe("timeout");
		expect(run?.status.code).toBe(SpanStatusCode.ERROR);
		expect(attempt?.attributes["commonspace.agent.outcome"]).toBe("timeout");
		expect(attempt?.status.code).toBe(SpanStatusCode.ERROR);
		expect(
			logExporter
				.getFinishedLogRecords()
				.some(
					(record) =>
						record.eventName === "commonspace.agent.run.exception" &&
						record.severityNumber === SeverityNumber.ERROR &&
						record.spanContext?.traceId === run?.spanContext().traceId,
				),
		).toBe(true);
		expect(
			JSON.stringify({
				spans: spans.getFinishedSpans().map((span) => span.attributes),
				logs: logExporter
					.getFinishedLogRecords()
					.map((record) => record.attributes),
			}),
		).not.toContain("PRIVATE_TIMEOUT_DETAIL");
	} finally {
		timeout.mockRestore();
		await service.close();
		await loggerProvider.shutdown();
		await tracerProvider.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});
