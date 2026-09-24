import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import {
	serverTracer,
	shutdownTelemetry,
	startTelemetry,
} from "../server/src/telemetry.ts";

it("warns once when export fails during shutdown", async () => {
	const collector = createServer((_request, response) => {
		response.writeHead(400);
		response.end();
	});
	collector.listen(0, "127.0.0.1");
	await once(collector, "listening");
	const address = collector.address();
	if (address === null || typeof address === "string")
		throw new Error("collector did not expose a port");
	const stderr = vi
		.spyOn(process.stderr, "write")
		.mockImplementation(() => true);
	try {
		const sdk = await startTelemetry(
			`http://127.0.0.1:${String(address.port)}`,
		);
		if (sdk === undefined) throw new Error("telemetry was not enabled");
		serverTracer.startActiveSpan("commonspace.test", (span) => span.end());
		await shutdownTelemetry(sdk);
		expect(stderr.mock.calls.map(([message]) => message)).toEqual([
			"Commonspace telemetry export failed; records may be missing\n",
		]);
	} finally {
		stderr.mockRestore();
		await new Promise<void>((resolve, reject) =>
			collector.close((error) =>
				error === undefined ? resolve() : reject(error),
			),
		);
	}
}, 8_000);
