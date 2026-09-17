import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("runs both benchmark shapes and reports restored workloads, raw samples, and dispersion", async () => {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		[
			"--expose-gc",
			"--import",
			"./server/node_modules/tsx/dist/loader.mjs",
			"scripts/benchmark-workspace.ts",
		],
		{
			env: {
				...process.env,
				COMMONSPACE_BENCHMARK_SIZES: "120",
				COMMONSPACE_BENCHMARK_REPETITIONS: "1",
				COMMONSPACE_BENCHMARK_SHAPES: "dm,multi-channel",
			},
		},
	);
	const report: unknown = JSON.parse(stdout);
	expect(report).toMatchObject({
		methodology: {
			explicitGcAvailable: true,
			repetitions: 1,
			source: { commit: expect.stringMatching(/^[0-9a-f]{40}$/u) },
		},
		results: [
			{
				messageCount: 120,
				workspaceShape: "dm",
				summary: {
					acceptance: {
						durationMs: {
							min: expect.any(Number),
							median: expect.any(Number),
							max: expect.any(Number),
						},
					},
				},
				samples: [
					{
						seededCounts: { messages: 120, channels: 0 },
						filteredSearch: { resultCount: 24 },
						measuredCounts: { messages: 122 },
						restoredCounts: { messages: 122 },
					},
				],
			},
			{
				messageCount: 120,
				workspaceShape: "multi-channel",
				summary: {
					channelProjection: { durationMs: { median: expect.any(Number) } },
				},
				samples: [
					{
						seededCounts: {
							messages: 120,
							channels: 4,
							projects: 3,
							agents: 3,
						},
						measuredCounts: { messages: 122 },
						restoredCounts: { messages: 122 },
						search: { resultCount: 24 },
						filteredSearch: { resultCount: 24 },
						contextScope: { threadMessageCount: 32 },
					},
				],
			},
		],
	});
});
