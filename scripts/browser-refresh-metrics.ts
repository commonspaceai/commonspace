export interface BrowserJourneySample {
	visibleDurationMs: number;
	visibleAfterLastResponseMs: number;
	bootstrapRequestCount: number;
	bootstrapBytes: number[];
	totalBootstrapBytes: number;
	requestDurationMs: number[];
	serviceBootstrapStateSnapshotDurationMs: number[];
	serviceBootstrapAssemblyDurationMs: number[];
}

export interface BrowserRevisionSample extends BrowserJourneySample {
	mutationResponseBytes: number[];
	totalMutationResponseBytes: number;
}

export interface BrowserBurstSample extends BrowserRevisionSample {
	maxConcurrentBootstrapRequests: number;
}

export interface SuppressedRevisionSample {
	bootstrapRequestsBeforeReload: number;
	changeVisibleBeforeReload: boolean;
	mutationResponseBytes: number;
	reloadRecoveryMs: number;
	reloadBootstrapRequestCount: number;
}

export interface BrowserRefreshSample {
	initialLoad: BrowserJourneySample;
	revisionRefresh: BrowserRevisionSample;
	burstRefresh: BrowserBurstSample;
	suppressedRevision: SuppressedRevisionSample;
}

function distribution(values: readonly number[]) {
	const sorted = values.toSorted((left, right) => left - right);
	const min = sorted[0];
	const max = sorted.at(-1);
	const lower = sorted[Math.floor((sorted.length - 1) / 2)];
	const upper = sorted[Math.floor(sorted.length / 2)];
	if (
		min === undefined ||
		max === undefined ||
		lower === undefined ||
		upper === undefined
	)
		throw new Error("Cannot summarize empty browser benchmark samples");
	return { min, median: (lower + upper) / 2, max };
}

function summarizeJourneys(samples: readonly BrowserJourneySample[]) {
	return {
		visibleDurationMs: distribution(
			samples.map((sample) => sample.visibleDurationMs),
		),
		visibleAfterLastResponseMs: distribution(
			samples.map((sample) => sample.visibleAfterLastResponseMs),
		),
		bootstrapRequestCount: distribution(
			samples.map((sample) => sample.bootstrapRequestCount),
		),
		bootstrapResponseBytes: distribution(
			samples.flatMap((sample) => sample.bootstrapBytes),
		),
		totalBootstrapBytes: distribution(
			samples.map((sample) => sample.totalBootstrapBytes),
		),
		requestDurationMs: distribution(
			samples.flatMap((sample) => sample.requestDurationMs),
		),
		serviceBootstrapStateSnapshotDurationMs: distribution(
			samples.flatMap(
				(sample) => sample.serviceBootstrapStateSnapshotDurationMs,
			),
		),
		serviceBootstrapAssemblyDurationMs: distribution(
			samples.flatMap((sample) => sample.serviceBootstrapAssemblyDurationMs),
		),
	};
}

function summarizeRevisionJourneys(samples: readonly BrowserRevisionSample[]) {
	return {
		...summarizeJourneys(samples),
		mutationResponseBytes: distribution(
			samples.flatMap((sample) => sample.mutationResponseBytes),
		),
		totalMutationResponseBytes: distribution(
			samples.map((sample) => sample.totalMutationResponseBytes),
		),
	};
}

export function summarizeBrowserRefreshSamples(
	samples: readonly BrowserRefreshSample[],
) {
	const bursts = samples.map((sample) => sample.burstRefresh);
	const suppressed = samples.map((sample) => sample.suppressedRevision);
	return {
		initialLoad: summarizeJourneys(samples.map((sample) => sample.initialLoad)),
		revisionRefresh: summarizeRevisionJourneys(
			samples.map((sample) => sample.revisionRefresh),
		),
		burstRefresh: {
			...summarizeRevisionJourneys(bursts),
			maxConcurrentBootstrapRequests: distribution(
				bursts.map((sample) => sample.maxConcurrentBootstrapRequests),
			),
		},
		suppressedRevision: {
			bootstrapRequestsBeforeReload: distribution(
				suppressed.map((sample) => sample.bootstrapRequestsBeforeReload),
			),
			reloadRecoveryMs: distribution(
				suppressed.map((sample) => sample.reloadRecoveryMs),
			),
			mutationResponseBytes: distribution(
				suppressed.map((sample) => sample.mutationResponseBytes),
			),
			reloadBootstrapRequestCount: distribution(
				suppressed.map((sample) => sample.reloadBootstrapRequestCount),
			),
			allChangesHiddenBeforeReload: suppressed.every(
				(sample) => !sample.changeVisibleBeforeReload,
			),
		},
	};
}

export function assertBurstControl(sample: BrowserBurstSample) {
	if (sample.bootstrapRequestCount !== 2)
		throw new Error(
			"Burst control requires exactly two bootstrap requests: one held refresh and one catch-up refresh",
		);
	if (sample.maxConcurrentBootstrapRequests !== 1)
		throw new Error("Burst control produced parallel bootstrap requests");
}

export function assertSuppressedRevisionControl(
	sample: SuppressedRevisionSample,
) {
	if (sample.bootstrapRequestsBeforeReload !== 0)
		throw new Error("Suppressed revision triggered a bootstrap refresh");
	if (sample.mutationResponseBytes < 1)
		throw new Error(
			"Suppressed revision control did not receive a mutation response",
		);
	if (sample.changeVisibleBeforeReload)
		throw new Error("Suppressed revision became visible before reload");
	if (sample.reloadBootstrapRequestCount < 1)
		throw new Error("Reload did not request a bootstrap for recovery");
}
