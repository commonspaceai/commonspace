import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import {
	type Browser,
	chromium,
	type Page,
	type Request,
	type Route,
} from "playwright";
import { startCommonspaceServer } from "../server/src/index.ts";
import {
	type CommonspaceHostPerformanceMeasurement,
	CommonspaceHostPerformancePhase,
} from "../server/src/service.ts";
import {
	BenchmarkWorkspaceShape,
	benchmarkDependencies,
	benchmarkWorkspaceCounts,
	createBenchmarkFixture,
	writeBenchmarkFixture,
} from "./benchmark-workspace-fixtures.ts";
import {
	assertBurstControl,
	assertSuppressedRevisionControl,
	type BrowserBurstSample,
	type BrowserJourneySample,
	type BrowserRefreshSample,
	type BrowserRevisionSample,
	summarizeBrowserRefreshSamples,
} from "./browser-refresh-metrics.ts";

interface BootstrapTrafficRecord {
	startedAtMs: number;
	completedAtMs: number;
	durationMs: number;
	bytes: number;
}

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

interface BrowserBenchmarkSample extends BrowserRefreshSample {
	workspaceCounts: ReturnType<typeof benchmarkWorkspaceCounts>;
}

interface RefreshMeasurementContext {
	page: Page;
	traffic: BootstrapTrafficRecorder;
	measurements: CommonspaceHostPerformanceMeasurement[];
	mutate(name: string): Promise<number>;
}

interface JourneyMeasurement {
	startedAtMs: number;
	visibleAtMs: number;
	records: readonly BootstrapTrafficRecord[];
	measurements: readonly CommonspaceHostPerformanceMeasurement[];
	expectedServiceBootstrapCount: number;
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const uiRoot = join(repositoryRoot, "ui", "dist");
const bootstrapPath = "/api/bootstrap";
const revisionSuppressionScript = `(() => {
	const NativeEventSource = window.EventSource;
	class RevisionSuppressedEventSource extends NativeEventSource {
		addEventListener(type, listener, options) {
			if (type === "revision") return;
			return super.addEventListener(type, listener, options);
		}
	}
	window.EventSource = RevisionSuppressedEventSource;
})();`;

function deferred(): Deferred {
	let resolvePromise: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

async function withTimeout<T>(
	promise: Promise<T>,
	label: string,
	timeoutMs = 30_000,
): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(`Timed out waiting for ${label}`));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

function configuredSizes(): number[] {
	const raw = process.env.COMMONSPACE_BROWSER_BENCHMARK_SIZES ?? "1000,20000";
	const sizes = raw.split(",").map((value) => Number(value.trim()));
	if (
		sizes.length === 0 ||
		sizes.some(
			(value) => !Number.isSafeInteger(value) || value < 2 || value % 2 !== 0,
		)
	)
		throw new Error(
			"COMMONSPACE_BROWSER_BENCHMARK_SIZES must contain positive even integers",
		);
	return sizes;
}

function configuredRepetitions(): number {
	const repetitions = Number(
		process.env.COMMONSPACE_BROWSER_BENCHMARK_REPETITIONS ?? "3",
	);
	if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 10)
		throw new Error(
			"COMMONSPACE_BROWSER_BENCHMARK_REPETITIONS must be an integer from 1 to 10",
		);
	return repetitions;
}

function isBootstrapRequest(request: Request): boolean {
	return (
		request.method() === "GET" &&
		new URL(request.url()).pathname === bootstrapPath
	);
}

class BootstrapTrafficRecorder {
	private readonly activeRequests = new Map<Request, number>();
	private readonly pendingCaptures = new Set<Promise<void>>();
	private readonly records: BootstrapTrafficRecord[] = [];

	constructor(page: Page) {
		page.on("request", (request) => {
			if (isBootstrapRequest(request))
				this.activeRequests.set(request, performance.now());
		});
		page.on("requestfailed", (request) => {
			this.activeRequests.delete(request);
		});
		page.on("response", (response) => {
			const request = response.request();
			const startedAtMs = this.activeRequests.get(request);
			if (startedAtMs === undefined) return;
			const capture = response
				.body()
				.then((body) => {
					const observedDurationMs = performance.now() - startedAtMs;
					const responseEndMs = request.timing().responseEnd;
					const durationMs =
						responseEndMs >= 0 ? responseEndMs : observedDurationMs;
					this.records.push({
						startedAtMs,
						completedAtMs: startedAtMs + durationMs,
						durationMs,
						bytes: body.byteLength,
					});
				})
				.finally(() => {
					this.activeRequests.delete(request);
					this.pendingCaptures.delete(capture);
				});
			this.pendingCaptures.add(capture);
		});
	}

	checkpoint(): number {
		return this.records.length;
	}

	recordsSince(checkpoint: number): BootstrapTrafficRecord[] {
		return this.records.slice(checkpoint);
	}

	async waitForIdle(): Promise<void> {
		const deadline = performance.now() + 30_000;
		while (this.activeRequests.size > 0 || this.pendingCaptures.size > 0) {
			if (performance.now() >= deadline)
				throw new Error("Timed out waiting for bootstrap traffic to finish");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
}

function bootstrapServicePhases(
	measurements: readonly CommonspaceHostPerformanceMeasurement[],
) {
	if (measurements.length % 2 !== 0)
		throw new Error(
			"Bootstrap service measurements contain an incomplete pair",
		);
	const stateSnapshotDurationMs: number[] = [];
	const assemblyDurationMs: number[] = [];
	for (let index = 0; index < measurements.length; index += 2) {
		const snapshot = measurements[index];
		const assembly = measurements[index + 1];
		if (
			snapshot?.phase !==
				CommonspaceHostPerformancePhase.BootstrapStateSnapshot ||
			assembly?.phase !== CommonspaceHostPerformancePhase.BootstrapAssembly
		)
			throw new Error("Bootstrap service measurements arrived out of order");
		stateSnapshotDurationMs.push(snapshot.durationMs);
		assemblyDurationMs.push(assembly.durationMs);
	}
	return { stateSnapshotDurationMs, assemblyDurationMs };
}

function maxConcurrentRequests(
	records: readonly BootstrapTrafficRecord[],
): number {
	const events = records
		.flatMap((record) => [
			{ at: record.startedAtMs, delta: 1 },
			{ at: record.completedAtMs, delta: -1 },
		])
		.toSorted((left, right) => left.at - right.at || left.delta - right.delta);
	let active = 0;
	let maximum = 0;
	for (const event of events) {
		active += event.delta;
		maximum = Math.max(maximum, active);
	}
	return maximum;
}

function journeySample(input: JourneyMeasurement): BrowserJourneySample {
	const {
		startedAtMs,
		visibleAtMs,
		records,
		measurements,
		expectedServiceBootstrapCount,
	} = input;
	if (records.length === 0)
		throw new Error("Browser journey completed without a bootstrap request");
	const service = bootstrapServicePhases(measurements);
	if (service.stateSnapshotDurationMs.length !== expectedServiceBootstrapCount)
		throw new Error(
			`Expected ${String(expectedServiceBootstrapCount)} measured service bootstraps, received ${String(service.stateSnapshotDurationMs.length)}`,
		);
	const lastCompletedAtMs = Math.max(
		...records.map((record) => record.completedAtMs),
	);
	const bootstrapBytes = records.map((record) => record.bytes);
	return {
		visibleDurationMs: visibleAtMs - startedAtMs,
		visibleAfterLastResponseMs: visibleAtMs - lastCompletedAtMs,
		bootstrapRequestCount: records.length,
		bootstrapBytes,
		totalBootstrapBytes: bootstrapBytes.reduce(
			(total, bytes) => total + bytes,
			0,
		),
		requestDurationMs: records.map((record) => record.durationMs),
		serviceBootstrapStateSnapshotDurationMs: service.stateSnapshotDurationMs,
		serviceBootstrapAssemblyDurationMs: service.assemblyDurationMs,
	};
}

async function mutateThroughPageRequest(
	page: Page,
	name: string,
): Promise<number> {
	const pageUrl = new URL(page.url());
	const response = await page.request.post(
		new URL("/api/mutate", pageUrl).href,
		{
			headers: { origin: pageUrl.origin },
			data: { action: "create-channel", name, agentIds: [] },
		},
	);
	try {
		const body = await response.body();
		if (!response.ok())
			throw new Error(
				`Mutation failed (${String(response.status())} ${response.statusText()}): ${body.toString("utf8").slice(0, 500)}`,
			);
		return body.byteLength;
	} finally {
		await response.dispose();
	}
}

async function waitForChannel(page: Page, name: string): Promise<void> {
	await page
		.getByRole("button", { name: `Open channel ${name}` })
		.waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForInbox(page: Page): Promise<void> {
	try {
		await page
			.getByRole("main", { name: "Inbox" })
			.waitFor({ state: "visible", timeout: 30_000 });
	} catch (cause) {
		const body = await page
			.locator("body")
			.innerText()
			.catch(() => "<body unavailable>");
		throw new Error(
			`Browser benchmark did not render Inbox at ${page.url()}: ${body.slice(0, 500)}`,
			{ cause },
		);
	}
}

async function measureInitialLoad(
	page: Page,
	url: string,
	traffic: BootstrapTrafficRecorder,
	measurements: CommonspaceHostPerformanceMeasurement[],
): Promise<BrowserJourneySample> {
	const trafficCheckpoint = traffic.checkpoint();
	const measurementCheckpoint = measurements.length;
	const startedAtMs = performance.now();
	await page.goto(url, { waitUntil: "domcontentloaded" });
	await waitForInbox(page);
	await waitForChannel(page, "benchmark-0");
	const visibleAtMs = performance.now();
	await traffic.waitForIdle();
	const records = traffic.recordsSince(trafficCheckpoint);
	return journeySample({
		startedAtMs,
		visibleAtMs,
		records,
		measurements: measurements.slice(measurementCheckpoint),
		expectedServiceBootstrapCount: records.length,
	});
}

async function measureRevisionRefresh(
	context: RefreshMeasurementContext,
	name: string,
): Promise<BrowserRevisionSample> {
	const { page, traffic, measurements, mutate } = context;
	const trafficCheckpoint = traffic.checkpoint();
	const measurementCheckpoint = measurements.length;
	const startedAtMs = performance.now();
	const visibleAt = waitForChannel(page, name).then(() => performance.now());
	const [mutationResponseByteCount, visibleAtMs] = await Promise.all([
		mutate(name),
		visibleAt,
	]);
	const mutationResponseBytes = [mutationResponseByteCount];
	await traffic.waitForIdle();
	const records = traffic.recordsSince(trafficCheckpoint);
	return {
		...journeySample({
			startedAtMs,
			visibleAtMs,
			records,
			measurements: measurements.slice(measurementCheckpoint),
			expectedServiceBootstrapCount:
				records.length + mutationResponseBytes.length,
		}),
		mutationResponseBytes,
		totalMutationResponseBytes: mutationResponseBytes.reduce(
			(total, bytes) => total + bytes,
			0,
		),
	};
}

async function measureBurstRefresh(
	context: RefreshMeasurementContext,
	names: readonly string[],
): Promise<BrowserBurstSample> {
	const { page, traffic, measurements, mutate } = context;
	const firstName = names[0];
	const finalName = names.at(-1);
	if (firstName === undefined || finalName === undefined)
		throw new Error("Burst benchmark requires at least one Channel mutation");
	const heldReady = deferred();
	const releaseHeld = deferred();
	let holdNextBootstrap = true;
	const holdBootstrap = async (route: Route): Promise<void> => {
		if (!isBootstrapRequest(route.request()) || !holdNextBootstrap) {
			await route.continue();
			return;
		}
		holdNextBootstrap = false;
		const response = await route.fetch();
		heldReady.resolve();
		await releaseHeld.promise;
		await route.fulfill({ response });
	};
	await page.route("**/api/bootstrap", holdBootstrap);
	const trafficCheckpoint = traffic.checkpoint();
	const measurementCheckpoint = measurements.length;
	const startedAtMs = performance.now();
	const mutationResponseBytes: number[] = [];
	try {
		mutationResponseBytes.push(await mutate(firstName));
		await withTimeout(heldReady.promise, "the held revision bootstrap request");
		for (const name of names.slice(1))
			mutationResponseBytes.push(await mutate(name));
		releaseHeld.resolve();
		await waitForChannel(page, finalName);
		const visibleAtMs = performance.now();
		await traffic.waitForIdle();
		const records = traffic.recordsSince(trafficCheckpoint);
		const sample = {
			...journeySample({
				startedAtMs,
				visibleAtMs,
				records,
				measurements: measurements.slice(measurementCheckpoint),
				expectedServiceBootstrapCount:
					records.length + mutationResponseBytes.length,
			}),
			mutationResponseBytes,
			totalMutationResponseBytes: mutationResponseBytes.reduce(
				(total, bytes) => total + bytes,
				0,
			),
			maxConcurrentBootstrapRequests: maxConcurrentRequests(records),
		};
		assertBurstControl(sample);
		return sample;
	} finally {
		releaseHeld.resolve();
		await page.unroute("**/api/bootstrap", holdBootstrap);
	}
}

async function measureSuppressedRevision(
	browser: Browser,
	url: string,
	name: string,
) {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 960 },
	});
	await page.addInitScript({ content: revisionSuppressionScript });
	const traffic = new BootstrapTrafficRecorder(page);
	try {
		await page.goto(url, { waitUntil: "domcontentloaded" });
		await waitForInbox(page);
		await waitForChannel(page, "benchmark-0");
		await traffic.waitForIdle();
		const suppressedCheckpoint = traffic.checkpoint();
		const mutationResponseBytes = await mutateThroughPageRequest(page, name);
		await page.waitForTimeout(250);
		await traffic.waitForIdle();
		const bootstrapRequestsBeforeReload =
			traffic.recordsSince(suppressedCheckpoint).length;
		const changeVisibleBeforeReload = await page
			.getByRole("button", { name: `Open channel ${name}`, exact: true })
			.isVisible();
		const reloadCheckpoint = traffic.checkpoint();
		const reloadStartedAtMs = performance.now();
		await page.reload({ waitUntil: "domcontentloaded" });
		await waitForChannel(page, name);
		const reloadRecoveryMs = performance.now() - reloadStartedAtMs;
		await traffic.waitForIdle();
		const sample = {
			bootstrapRequestsBeforeReload,
			changeVisibleBeforeReload,
			mutationResponseBytes,
			reloadRecoveryMs,
			reloadBootstrapRequestCount:
				traffic.recordsSince(reloadCheckpoint).length,
		};
		assertSuppressedRevisionControl(sample);
		return sample;
	} finally {
		await page.close();
	}
}

async function runSample(
	browser: Browser,
	messageCount: number,
): Promise<BrowserBenchmarkSample> {
	const root = await mkdtemp(join(tmpdir(), "commonspace-browser-benchmark-"));
	try {
		const fixture = createBenchmarkFixture(
			BenchmarkWorkspaceShape.MultiChannel,
			messageCount,
			root,
		);
		await writeBenchmarkFixture(root, fixture);
		const measurements: CommonspaceHostPerformanceMeasurement[] = [];
		const running = await startCommonspaceServer({
			port: 0,
			root,
			defaultCwd: root,
			uiRoot,
			logger: { info: () => undefined, warn: () => undefined },
			dependencies: {
				...benchmarkDependencies,
				onPerformanceMeasurement: (measurement) => {
					measurements.push(measurement);
				},
			},
		});
		try {
			await running.service.updateRoutingConfiguration({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "codex",
			});
			const page = await browser.newPage({
				viewport: { width: 1440, height: 960 },
			});
			try {
				const traffic = new BootstrapTrafficRecorder(page);
				const refreshContext: RefreshMeasurementContext = {
					page,
					traffic,
					measurements,
					mutate: (name) => mutateThroughPageRequest(page, name),
				};
				const initialLoad = await measureInitialLoad(
					page,
					running.url,
					traffic,
					measurements,
				);
				const revisionRefresh = await measureRevisionRefresh(
					refreshContext,
					"benchmark-revision-refresh",
				);
				const burstRefresh = await measureBurstRefresh(refreshContext, [
					"benchmark-burst-1",
					"benchmark-burst-2",
					"benchmark-burst-3",
					"benchmark-burst-4",
				]);
				await page.close();
				const suppressedRevision = await measureSuppressedRevision(
					browser,
					running.url,
					"benchmark-suppressed-revision",
				);
				return {
					workspaceCounts: benchmarkWorkspaceCounts(fixture.state),
					initialLoad,
					revisionRefresh,
					burstRefresh,
					suppressedRevision,
				};
			} finally {
				if (!page.isClosed()) await page.close();
			}
		} finally {
			await running.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function sourceProvenance() {
	const files = [
		"scripts/benchmark-browser-refresh.ts",
		"scripts/browser-refresh-metrics.ts",
		"scripts/benchmark-workspace-fixtures.ts",
		"server/src/service.ts",
		"ui/src/commonspace-store.ts",
		"package.json",
	];
	return {
		commit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repositoryRoot,
			encoding: "utf8",
		}).trim(),
		worktreeChanges: execFileSync(
			"git",
			["status", "--porcelain", "--untracked-files=all"],
			{ cwd: repositoryRoot, encoding: "utf8" },
		)
			.split("\n")
			.filter(Boolean),
		benchmarkFiles: await Promise.all(
			files.map(async (path) => ({
				path,
				sha256: createHash("sha256")
					.update(await readFile(join(repositoryRoot, path)))
					.digest("hex"),
			})),
		),
	};
}

await access(join(uiRoot, "index.html"));
const sizes = configuredSizes();
const repetitions = configuredRepetitions();
const source = await sourceProvenance();
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const results: {
	messageCount: number;
	workspaceShape: BenchmarkWorkspaceShape;
	summary: ReturnType<typeof summarizeBrowserRefreshSamples>;
	samples: BrowserBenchmarkSample[];
}[] = [];
try {
	const warmupSize = sizes[0];
	if (warmupSize === undefined)
		throw new Error("Missing browser benchmark size");
	process.stderr.write(`Warm-up: ${String(warmupSize)} messages\n`);
	await runSample(browser, warmupSize);
	for (const messageCount of sizes) {
		const samples: BrowserBenchmarkSample[] = [];
		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			process.stderr.write(
				`Sample: ${String(messageCount)} messages, ${String(repetition + 1)}/${String(repetitions)}\n`,
			);
			samples.push(await runSample(browser, messageCount));
		}
		results.push({
			messageCount,
			workspaceShape: BenchmarkWorkspaceShape.MultiChannel,
			summary: summarizeBrowserRefreshSamples(samples),
			samples,
		});
	}
} finally {
	await browser.close();
}

process.stdout.write(
	`${JSON.stringify(
		{
			methodology: {
				source,
				startedAt,
				completedAt: new Date().toISOString(),
				node: process.version,
				browser: `Chromium ${browserVersion}`,
				platform: process.platform,
				osRelease: release(),
				arch: process.arch,
				cpu: cpus()[0]?.model ?? "unknown",
				logicalCpuCount: cpus().length,
				totalMemoryBytes: totalmem(),
				viewport: { width: 1440, height: 960 },
				workspaceShape:
					"multi-channel synthetic fixture with 4 Channels, 3 agents, 3 Projects, cyclic 1/3/8/16-pair Threads, routing receipts, tool activity, corrections, pins, and attachments",
				initialLoad:
					"navigation start through assembled Inbox and first fixture Channel visibility",
				revisionRefresh:
					"service create-channel mutation through SSE revision, GET /api/bootstrap, store merge, and new Channel visibility",
				burstRefresh:
					"hold the first revision-triggered bootstrap response, apply three additional revisions, release it, and require exactly one serialized catch-up bootstrap",
				suppressedRevisionControl:
					"drop revision EventSource listeners, require no refresh or visible mutation, then reload and require recovery",
				responseBytes:
					"decoded HTTP response body bytes captured per GET /api/bootstrap",
				mutationResponses:
					"same-origin Playwright page.request mutation response bytes recorded separately; the suppressed-revision control proves these responses are not counted as page-originated GET /api/bootstrap traffic",
				servicePhases:
					"optional service observer records state snapshot/redaction and remaining assembly for every service.bootstrap call; page-originated GET counts and same-origin mutation response counts keep the sources distinguishable even when the calls overlap",
				warmup: "one discarded full browser journey at the first size",
				repetitions,
				dispersion:
					"raw samples plus min/median/max; sizes and samples run serially in one browser process",
				limits:
					"synthetic local fixture and provider-free mutations; excludes native agent work, routing inference, network latency, and mobile layouts",
			},
			results,
		},
		null,
		2,
	)}\n`,
);
