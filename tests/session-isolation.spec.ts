import { expect, it } from "vitest";
import {
	assertSessionIsolationControl,
	runSessionIsolationScenario,
	type SessionIsolationPair,
	SessionIsolationScenario,
	summarizeSessionIsolationPairs,
} from "../scripts/session-isolation-harness.ts";

it("lets an independent same-Agent Thread finish while serializing a same-Thread follow-up", async () => {
	const sample = await runSessionIsolationScenario(
		SessionIsolationScenario.Contended,
	);

	expect(() => assertSessionIsolationControl(sample.control)).not.toThrow();
	expect(sample.control.runStartOrder).toEqual([
		"slow-root",
		"fast-independent",
		"slow-followup",
	]);
	expect(sample.fixtureCounts).toEqual({
		agents: 1,
		channels: 1,
		threads: 0,
		messages: 0,
	});
});

it("summarizes paired raw responsiveness samples without a latency threshold", () => {
	const pairs: SessionIsolationPair[] = [
		{
			baseline: {
				scenario: SessionIsolationScenario.Baseline,
				fixtureCounts: { agents: 1, channels: 1, threads: 0, messages: 0 },
				fast: {
					acceptanceDurationMs: 2,
					workerStartDurationMs: 3,
					completionDurationMs: 5,
				},
			},
			contended: {
				scenario: SessionIsolationScenario.Contended,
				fixtureCounts: { agents: 1, channels: 1, threads: 0, messages: 0 },
				fast: {
					acceptanceDurationMs: 3,
					workerStartDurationMs: 4,
					completionDurationMs: 7,
				},
				control: {
					fastWorkerStartedBeforeSlowRelease: true,
					fastReplyPersistedBeforeSlowRelease: true,
					slowRemainedActiveThroughFastCompletion: true,
					followupAcceptedAndQueued: true,
					followupStartedBeforeSlowRelease: false,
					followupStartedAfterSlowRelease: true,
					distinctThreadSessions: true,
					followupResumedSlowSession: true,
					uniqueSourceMessages: true,
					repliesStayedInSourceThreads: true,
					runStartOrder: ["slow-root", "fast-independent", "slow-followup"],
				},
			},
		},
		{
			baseline: {
				scenario: SessionIsolationScenario.Baseline,
				fixtureCounts: { agents: 1, channels: 1, threads: 0, messages: 0 },
				fast: {
					acceptanceDurationMs: 4,
					workerStartDurationMs: 5,
					completionDurationMs: 9,
				},
			},
			contended: {
				scenario: SessionIsolationScenario.Contended,
				fixtureCounts: { agents: 1, channels: 1, threads: 0, messages: 0 },
				fast: {
					acceptanceDurationMs: 5,
					workerStartDurationMs: 6,
					completionDurationMs: 12,
				},
				control: {
					fastWorkerStartedBeforeSlowRelease: true,
					fastReplyPersistedBeforeSlowRelease: true,
					slowRemainedActiveThroughFastCompletion: true,
					followupAcceptedAndQueued: true,
					followupStartedBeforeSlowRelease: false,
					followupStartedAfterSlowRelease: true,
					distinctThreadSessions: true,
					followupResumedSlowSession: true,
					uniqueSourceMessages: true,
					repliesStayedInSourceThreads: true,
					runStartOrder: ["slow-root", "fast-independent", "slow-followup"],
				},
			},
		},
	];

	const summary = summarizeSessionIsolationPairs(pairs);
	expect(summary.baseline.completionDurationMs.median).toBe(7);
	expect(summary.contended.completionDurationMs.median).toBe(9.5);
	expect(summary.delta.completionDurationMs.median).toBe(2.5);
});
