import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";

const percentageEvidenceSchema = z.object({
	results: z
		.array(
			z.object({
				samples: z
					.array(
						z.object({
							bootstrap: z.object({ durationMs: z.number().nonnegative() }),
							bootstrapPayloadSerialization: z.object({
								durationMs: z.number().nonnegative(),
								percentOfBootstrapProcessing: z.number().nonnegative(),
							}),
						}),
					)
					.min(1),
			}),
		)
		.min(1),
});

type PercentageEvidence = z.infer<typeof percentageEvidenceSchema>;

function expectSerializationPercentage(evidence: PercentageEvidence) {
	const dmResult = evidence.results[0];
	if (dmResult === undefined) throw new Error("Expected DM benchmark result");
	const sample = dmResult.samples[0];
	if (sample === undefined) throw new Error("Expected DM benchmark sample");
	const { bootstrap, bootstrapPayloadSerialization: serialization } = sample;
	expect(serialization.percentOfBootstrapProcessing).toBeCloseTo(
		(serialization.durationMs / bootstrap.durationMs) * 100,
		10,
	);
}

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
					acceptancePhases: {
						requestPreparation: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
						stateMutation: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
						persistenceSerialization: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
						persistenceQueue: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
						persistenceWrite: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
						responseSnapshot: {
							durationMs: { median: expect.any(Number) },
							percentOfAcceptance: { median: expect.any(Number) },
						},
					},
					bootstrapPhases: {
						stateSnapshot: {
							durationMs: { median: expect.any(Number) },
							percentOfBootstrap: { median: expect.any(Number) },
						},
						assembly: {
							durationMs: { median: expect.any(Number) },
							percentOfBootstrap: { median: expect.any(Number) },
						},
					},
					bootstrapPayloadSerialization: {
						durationMs: { median: expect.any(Number) },
						percentOfBootstrapProcessing: {
							median: expect.any(Number),
						},
					},
				},
				samples: [
					{
						acceptancePhases: {
							requestPreparation: {
								durationMs: expect.any(Number),
								percentOfAcceptance: expect.any(Number),
							},
							stateMutation: { durationMs: expect.any(Number) },
							persistenceSerialization: {
								durationMs: expect.any(Number),
							},
							persistenceQueue: { durationMs: expect.any(Number) },
							persistenceWrite: { durationMs: expect.any(Number) },
							responseSnapshot: { durationMs: expect.any(Number) },
						},
						bootstrapPhases: {
							stateSnapshot: { durationMs: expect.any(Number) },
							assembly: { durationMs: expect.any(Number) },
						},
						bootstrapPayloadSerialization: {
							durationMs: expect.any(Number),
							percentOfBootstrapProcessing: expect.any(Number),
						},
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
	expectSerializationPercentage(percentageEvidenceSchema.parse(report));
});
