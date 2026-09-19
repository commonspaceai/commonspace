import { expect, it } from "vitest";
import {
	assertBurstControl,
	assertSuppressedRevisionControl,
	type BrowserRefreshSample,
	summarizeBrowserRefreshSamples,
} from "../scripts/browser-refresh-metrics.ts";

function journey(
	visibleDurationMs: number,
	requestDurationMs: number,
	totalBootstrapBytes: number,
) {
	return {
		visibleDurationMs,
		visibleAfterLastResponseMs: visibleDurationMs / 10,
		bootstrapRequestCount: 1,
		bootstrapBytes: [totalBootstrapBytes],
		totalBootstrapBytes,
		requestDurationMs: [requestDurationMs],
		serviceBootstrapStateSnapshotDurationMs: [requestDurationMs / 2],
		serviceBootstrapAssemblyDurationMs: [1],
	};
}

function sample(offset: number): BrowserRefreshSample {
	return {
		initialLoad: journey(100 + offset, 40 + offset, 1_000 + offset),
		revisionRefresh: {
			...journey(80 + offset, 30 + offset, 1_100 + offset),
			mutationResponseBytes: [1_200 + offset],
			totalMutationResponseBytes: 1_200 + offset,
		},
		burstRefresh: {
			...journey(120 + offset, 50 + offset, 2_200 + offset),
			bootstrapRequestCount: 2,
			bootstrapBytes: [1_100, 1_100],
			requestDurationMs: [50 + offset, 35 + offset],
			serviceBootstrapStateSnapshotDurationMs: [25 + offset, 20 + offset],
			serviceBootstrapAssemblyDurationMs: [1, 1],
			mutationResponseBytes: [1_200, 1_210, 1_220, 1_230],
			totalMutationResponseBytes: 4_860,
			maxConcurrentBootstrapRequests: 1,
		},
		suppressedRevision: {
			bootstrapRequestsBeforeReload: 0,
			changeVisibleBeforeReload: false,
			mutationResponseBytes: 1_300 + offset,
			reloadRecoveryMs: 90 + offset,
			reloadBootstrapRequestCount: 1,
		},
	};
}

it("summarizes raw assembled-browser samples without inventing thresholds", () => {
	const summary = summarizeBrowserRefreshSamples([
		sample(0),
		sample(20),
		sample(40),
	]);
	expect(summary.initialLoad.visibleDurationMs).toEqual({
		min: 100,
		median: 120,
		max: 140,
	});
	expect(summary.initialLoad.bootstrapResponseBytes.median).toBe(1_020);
	expect(summary.revisionRefresh.totalBootstrapBytes.median).toBe(1_120);
	expect(summary.burstRefresh.bootstrapRequestCount).toEqual({
		min: 2,
		median: 2,
		max: 2,
	});
	expect(summary.burstRefresh.requestDurationMs).toEqual({
		min: 35,
		median: 62.5,
		max: 90,
	});
	expect(summary.suppressedRevision.reloadRecoveryMs.median).toBe(110);
});

it("requires one held refresh, one serialized catch-up, and no refresh when revisions are suppressed", () => {
	const valid = sample(0);
	expect(() => assertBurstControl(valid.burstRefresh)).not.toThrow();
	expect(() =>
		assertBurstControl({
			...valid.burstRefresh,
			maxConcurrentBootstrapRequests: 2,
		}),
	).toThrow("parallel bootstrap requests");
	expect(() =>
		assertBurstControl({
			...valid.burstRefresh,
			bootstrapRequestCount: 3,
		}),
	).toThrow("exactly two bootstrap requests");
	expect(() =>
		assertSuppressedRevisionControl(valid.suppressedRevision),
	).not.toThrow();
	expect(() =>
		assertSuppressedRevisionControl({
			...valid.suppressedRevision,
			bootstrapRequestsBeforeReload: 1,
		}),
	).toThrow("triggered a bootstrap refresh");
	expect(() =>
		assertSuppressedRevisionControl({
			...valid.suppressedRevision,
			mutationResponseBytes: 0,
		}),
	).toThrow("did not receive a mutation response");
});
