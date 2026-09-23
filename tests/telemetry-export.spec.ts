import { once } from "node:events";
import { createServer } from "node:http";
import { SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { expect, it, vi } from "vitest";
import {
	recordOperationException,
	serverTracer,
	shutdownTelemetry,
	startTelemetry,
} from "../server/src/telemetry.ts";

it("exports only bounded records to the configured loopback collector", async () => {
	const requests: { path: string; body: string }[] = [];
	const collector = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		requests.push({
			path: request.url ?? "",
			body: Buffer.concat(chunks).toString("utf8"),
		});
		response.writeHead(200);
		response.end();
	});
	collector.listen(0, "127.0.0.1");
	await once(collector, "listening");
	const address = collector.address();
	if (address === null || typeof address === "string")
		throw new Error("collector did not expose a port");
	try {
		const sdk = await startTelemetry(
			`http://127.0.0.1:${String(address.port)}`,
		);
		if (sdk === undefined) throw new Error("telemetry was not enabled");
		try {
			serverTracer.startActiveSpan("commonspace.test", (span) => {
				recordOperationException(new Error("PRIVATE_CONTENT"), {
					eventName: "commonspace.test.exception",
					body: "Test failure",
					severity: SeverityNumber.ERROR,
				});
				span.setStatus({ code: SpanStatusCode.OK });
				span.end();
			});
		} finally {
			await sdk.shutdown();
		}
		expect(requests.map((request) => request.path).sort()).toEqual([
			"/v1/logs",
			"/v1/traces",
		]);
		expect(
			requests.every((request) => !request.body.includes("PRIVATE_CONTENT")),
		).toBe(true);
		expect(
			requests.every((request) => !request.body.includes("process.")),
		).toBe(true);
	} finally {
		await new Promise<void>((resolve, reject) =>
			collector.close((error) =>
				error === undefined ? resolve() : reject(error),
			),
		);
	}
});

it("does not fail server shutdown when optional export fails", async () => {
	const stderr = vi
		.spyOn(process.stderr, "write")
		.mockImplementation(() => true);
	try {
		await expect(
			shutdownTelemetry({
				shutdown: async () => {
					throw new Error("PRIVATE_COLLECTOR_DETAIL");
				},
			}),
		).resolves.toBeUndefined();
		expect(stderr).toHaveBeenCalledWith(
			"Commonspace telemetry export failed during shutdown\n",
		);
	} finally {
		stderr.mockRestore();
	}
});
