import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { serverTracer, startTelemetry } from "../server/src/telemetry.ts";

it("warns when a scheduled export fails before shutdown", async () => {
	const collector = createServer((_request, response) => {
		response.writeHead(400);
		response.end("PRIVATE_COLLECTOR_DETAIL");
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
		try {
			serverTracer.startActiveSpan("commonspace.test", (span) => span.end());
			await vi.waitFor(
				() =>
					expect(stderr).toHaveBeenCalledWith(
						"Commonspace telemetry export failed; records may be missing\n",
					),
				{ timeout: 8_000 },
			);
			expect(stderr.mock.calls.flat().join("")).not.toContain(
				"PRIVATE_COLLECTOR_DETAIL",
			);
		} finally {
			await sdk.shutdown();
		}
	} finally {
		stderr.mockRestore();
		await new Promise<void>((resolve, reject) =>
			collector.close((error) =>
				error === undefined ? resolve() : reject(error),
			),
		);
	}
}, 12_000);
