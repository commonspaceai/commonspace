import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	CommonspaceSearchRequest,
	SendMessageRequest,
} from "@commonspace/shared";
import { buildChannelContextCompactionPrompt } from "../server/src/context.ts";
import { projectChannelMemory } from "../server/src/memory.ts";
import { searchCommonspace } from "../server/src/search.ts";
import {
	type CommonspaceHostPerformanceMeasurement,
	CommonspaceHostPerformancePhase,
	CommonspaceHostService,
} from "../server/src/service.ts";
import {
	buildThreadContextCompactionPrompt,
	projectThreadMemory,
} from "../server/src/thread-context.ts";
import {
	BenchmarkWorkspaceShape,
	benchmarkDependencies,
	benchmarkWorkspaceCounts,
	createBenchmarkFixture,
	writeBenchmarkFixture,
} from "./benchmark-workspace-fixtures.ts";

interface Measurement<T> {
	result: T;
	durationMs: number;
	heapDeltaBytes: number;
	rssDeltaBytes: number;
}

const acceptancePhaseNames = {
	requestPreparation:
		CommonspaceHostPerformancePhase.AcceptanceRequestPreparation,
	stateMutation: CommonspaceHostPerformancePhase.AcceptanceStateMutation,
	persistenceSerialization:
		CommonspaceHostPerformancePhase.AcceptancePersistenceSerialization,
	persistenceQueue: CommonspaceHostPerformancePhase.AcceptancePersistenceQueue,
	persistenceWrite: CommonspaceHostPerformancePhase.AcceptancePersistenceWrite,
	responseSnapshot: CommonspaceHostPerformancePhase.AcceptanceResponseSnapshot,
} satisfies Record<string, CommonspaceHostPerformancePhase>;

const bootstrapPhaseNames = {
	stateSnapshot: CommonspaceHostPerformancePhase.BootstrapStateSnapshot,
	assembly: CommonspaceHostPerformancePhase.BootstrapAssembly,
} satisfies Record<string, CommonspaceHostPerformancePhase>;

function phaseDuration(
	measurements: readonly CommonspaceHostPerformanceMeasurement[],
	phase: CommonspaceHostPerformancePhase,
) {
	const matches = measurements.filter(
		(measurement) => measurement.phase === phase,
	);
	if (matches.length !== 1)
		throw new Error(
			`Expected one ${phase} measurement, received ${String(matches.length)}`,
		);
	const match = matches[0];
	if (match === undefined) throw new Error(`Missing ${phase} measurement`);
	return match.durationMs;
}

function percentOf(durationMs: number, parentDurationMs: number) {
	if (parentDurationMs <= 0) return 0;
	return (durationMs / parentDurationMs) * 100;
}

function acceptancePhaseMetrics(
	measurements: readonly CommonspaceHostPerformanceMeasurement[],
	parentDurationMs: number,
) {
	const metric = (phase: CommonspaceHostPerformancePhase) => {
		const durationMs = phaseDuration(measurements, phase);
		return {
			durationMs,
			percentOfAcceptance: percentOf(durationMs, parentDurationMs),
		};
	};
	return {
		requestPreparation: metric(acceptancePhaseNames.requestPreparation),
		stateMutation: metric(acceptancePhaseNames.stateMutation),
		persistenceSerialization: metric(
			acceptancePhaseNames.persistenceSerialization,
		),
		persistenceQueue: metric(acceptancePhaseNames.persistenceQueue),
		persistenceWrite: metric(acceptancePhaseNames.persistenceWrite),
		responseSnapshot: metric(acceptancePhaseNames.responseSnapshot),
	};
}

function bootstrapPhaseMetrics(
	measurements: readonly CommonspaceHostPerformanceMeasurement[],
	parentDurationMs: number,
) {
	const metric = (phase: CommonspaceHostPerformancePhase) => {
		const durationMs = phaseDuration(measurements, phase);
		return {
			durationMs,
			percentOfBootstrap: percentOf(durationMs, parentDurationMs),
		};
	};
	return {
		stateSnapshot: metric(bootstrapPhaseNames.stateSnapshot),
		assembly: metric(bootstrapPhaseNames.assembly),
	};
}

async function measure<T>(
	operation: () => T | Promise<T>,
): Promise<Measurement<T>> {
	globalThis.gc?.();
	const before = process.memoryUsage();
	const startedAt = performance.now();
	const result = await operation();
	const durationMs = performance.now() - startedAt;
	const after = process.memoryUsage();
	return {
		result,
		durationMs,
		heapDeltaBytes: after.heapUsed - before.heapUsed,
		rssDeltaBytes: after.rss - before.rss,
	};
}

function metrics<T>(measurement: Measurement<T>) {
	return {
		durationMs: measurement.durationMs,
		heapDeltaBytes: measurement.heapDeltaBytes,
		rssDeltaBytes: measurement.rssDeltaBytes,
	};
}

function configuredSizes(): number[] {
	const raw = process.env.COMMONSPACE_BENCHMARK_SIZES ?? "100,1000,5000";
	const sizes = raw.split(",").map((value) => Number(value.trim()));
	if (
		sizes.some(
			(value) => !Number.isSafeInteger(value) || value < 2 || value % 2 !== 0,
		)
	)
		throw new Error(
			"COMMONSPACE_BENCHMARK_SIZES must contain positive even integers",
		);
	return sizes;
}

function configuredRepetitions(): number {
	const repetitions = Number(
		process.env.COMMONSPACE_BENCHMARK_REPETITIONS ?? "3",
	);
	if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20)
		throw new Error(
			"COMMONSPACE_BENCHMARK_REPETITIONS must be an integer from 1 to 20",
		);
	return repetitions;
}

function configuredShapes(): BenchmarkWorkspaceShape[] {
	const values = (
		process.env.COMMONSPACE_BENCHMARK_SHAPES ?? "dm,multi-channel"
	)
		.split(",")
		.map((value) => value.trim());
	const shapes = values.filter(
		(value): value is BenchmarkWorkspaceShape =>
			value === BenchmarkWorkspaceShape.Dm ||
			value === BenchmarkWorkspaceShape.MultiChannel,
	);
	if (shapes.length !== values.length || new Set(shapes).size !== shapes.length)
		throw new Error(
			"COMMONSPACE_BENCHMARK_SHAPES must contain dm and/or multi-channel without duplicates",
		);
	return shapes;
}

async function measureContext(service: CommonspaceHostService) {
	const state = service.snapshot();
	// Use the busiest Channel and its longest Thread, selected outside timed operations.
	const channel = state.channels.toSorted(
		(a, b) =>
			(state.messages[`channel:${b.id}`]?.length ?? 0) -
			(state.messages[`channel:${a.id}`]?.length ?? 0),
	)[0];
	if (channel === undefined) return {};
	const counts = new Map<string, number>();
	for (const message of state.messages[`channel:${channel.id}`] ?? []) {
		if (message.threadId !== undefined)
			counts.set(message.threadId, (counts.get(message.threadId) ?? 0) + 1);
	}
	const thread = state.threads
		.filter((entry) => entry.channelId === channel.id)
		.toSorted((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
	if (thread === undefined) throw new Error("Benchmark Channel has no Threads");
	const channelProjection = await measure(() =>
		projectChannelMemory(state, channel.id),
	);
	const channelCompactionPreparation = await measure(() =>
		buildChannelContextCompactionPrompt(
			state,
			channel.id,
			channelProjection.result,
		),
	);
	const threadProjection = await measure(() =>
		projectThreadMemory(state, thread.id),
	);
	const threadCompactionPreparation = await measure(() =>
		buildThreadContextCompactionPrompt(state, thread.id),
	);
	return {
		contextScope: {
			channelMessageCount: state.messages[`channel:${channel.id}`]?.length ?? 0,
			threadMessageCount: counts.get(thread.id) ?? 0,
		},
		channelProjection: metrics(channelProjection),
		channelCompactionPreparation: {
			...metrics(channelCompactionPreparation),
			promptBytes: Buffer.byteLength(channelCompactionPreparation.result),
		},
		threadProjection: metrics(threadProjection),
		threadCompactionPreparation: {
			...metrics(threadCompactionPreparation),
			promptBytes: Buffer.byteLength(threadCompactionPreparation.result),
		},
	};
}

async function seedWorkspace(
	root: string,
	shape: BenchmarkWorkspaceShape,
	messageCount: number,
) {
	const fixture = createBenchmarkFixture(shape, messageCount, root);
	await writeBenchmarkFixture(root, fixture);
	return benchmarkWorkspaceCounts(fixture.state);
}

function createMeasuredService(
	root: string,
	measurements: CommonspaceHostPerformanceMeasurement[],
) {
	return new CommonspaceHostService(
		{},
		{ root },
		{
			...benchmarkDependencies,
			onPerformanceMeasurement: (measurement) => {
				measurements.push(measurement);
			},
		},
	);
}

function acceptanceRequest(
	workspaceShape: BenchmarkWorkspaceShape,
): SendMessageRequest {
	if (workspaceShape === BenchmarkWorkspaceShape.Dm) {
		return {
			conversation: { kind: "dm", id: "codex" },
			text: "Synthetic benchmark acceptance turn.",
		};
	}
	return {
		conversation: { kind: "channel", id: "benchmark-channel-0" },
		text: "@benchmark-agent Synthetic benchmark acceptance turn.",
	};
}

async function measureBootstrap(
	service: CommonspaceHostService,
	phaseMeasurements: CommonspaceHostPerformanceMeasurement[],
) {
	phaseMeasurements.length = 0;
	const bootstrap = await measure(() => service.bootstrap());
	const bootstrapPhases = bootstrapPhaseMetrics(
		phaseMeasurements,
		bootstrap.durationMs,
	);
	const serialized = await measure(() => JSON.stringify(bootstrap.result));
	return {
		bootstrap,
		bootstrapPhases,
		bootstrapBytes: Buffer.byteLength(serialized.result, "utf8"),
		bootstrapPayloadSerialization: {
			...metrics(serialized),
			percentOfBootstrapProcessing: percentOf(
				serialized.durationMs,
				bootstrap.durationMs,
			),
		},
	};
}

async function runSize(
	messageCount: number,
	workspaceShape: BenchmarkWorkspaceShape,
) {
	const root = await mkdtemp(
		join(tmpdir(), "commonspace-workspace-benchmark-"),
	);
	let importRoot: string | undefined;
	let service: CommonspaceHostService | undefined;
	let imported: CommonspaceHostService | undefined;
	try {
		importRoot = await mkdtemp(
			join(tmpdir(), "commonspace-workspace-import-benchmark-"),
		);
		const seededCounts = await seedWorkspace(
			root,
			workspaceShape,
			messageCount,
		);
		const phaseMeasurements: CommonspaceHostPerformanceMeasurement[] = [];
		service = createMeasuredService(root, phaseMeasurements);
		const source = service;
		const initialization = await measure(() => source.initialize());
		phaseMeasurements.length = 0;
		const acceptance = await measure(() =>
			source.send(acceptanceRequest(workspaceShape)),
		);
		const acceptancePhases = acceptancePhaseMetrics(
			phaseMeasurements,
			acceptance.durationMs,
		);
		await source.whenIdle();
		const {
			bootstrap,
			bootstrapBytes,
			bootstrapPayloadSerialization,
			bootstrapPhases,
		} = await measureBootstrap(source, phaseMeasurements);
		const search = await measure(() =>
			searchCommonspace(bootstrap.result, {
				query: "benchmark needle",
				limit: 24,
			}),
		);
		const exported = await measure(() => source.exportWorkspace());
		const archiveJson = JSON.stringify(exported.result);
		const archiveBytes = Buffer.byteLength(archiveJson, "utf8");
		const importArchive = JSON.parse(archiveJson);
		imported = new CommonspaceHostService(
			{},
			{ root: importRoot },
			benchmarkDependencies,
		);
		const target = imported;
		await target.initialize();
		const projectMappings: Record<string, string[]> = {};
		for (const project of bootstrap.result.state.projects) {
			const path = join(importRoot, "projects", project.id);
			await mkdir(path, { recursive: true });
			projectMappings[project.id] = [path];
		}
		const importMeasurement = await measure(() =>
			target.importWorkspace(importArchive, projectMappings),
		);
		const restoredCounts = benchmarkWorkspaceCounts(target.snapshot());
		const measuredCounts = benchmarkWorkspaceCounts(bootstrap.result.state);
		if (JSON.stringify(restoredCounts) !== JSON.stringify(measuredCounts))
			throw new Error("Benchmark restore changed the workload counts");
		const filteredQuery: CommonspaceSearchRequest = {
			query: "benchmark needle",
			kinds: ["message", "dm"],
			limit: 24,
		};
		const project = bootstrap.result.state.projects[0];
		if (project !== undefined) filteredQuery.projectId = project.id;
		const filteredSearch = await measure(() =>
			searchCommonspace(bootstrap.result, filteredQuery),
		);
		return {
			messageCount,
			workspaceShape,
			seededCounts,
			measuredCounts,
			restoredCounts,
			initialization,
			acceptance: metrics(acceptance),
			acceptancePhases,
			bootstrap: { ...metrics(bootstrap), payloadBytes: bootstrapBytes },
			bootstrapPhases,
			bootstrapPayloadSerialization,
			search: { ...metrics(search), resultCount: search.result.results.length },
			export: { ...metrics(exported), archiveBytes },
			import: metrics(importMeasurement),
			filteredSearch: {
				...metrics(filteredSearch),
				resultCount: filteredSearch.result.results.length,
			},
			...(await measureContext(source)),
		};
	} finally {
		try {
			await imported?.close();
		} finally {
			try {
				await service?.close();
			} finally {
				await rm(root, { recursive: true, force: true });
				if (importRoot !== undefined)
					await rm(importRoot, { recursive: true, force: true });
			}
		}
	}
}

function distribution(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b);
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
		throw new Error("Cannot summarize an empty benchmark sample");
	return { min, median: (lower + upper) / 2, max };
}

type WorkspaceBenchmarkSample = Awaited<ReturnType<typeof runSize>>;

function summarizeAcceptancePhase(
	samples: WorkspaceBenchmarkSample[],
	phase: keyof WorkspaceBenchmarkSample["acceptancePhases"],
) {
	return {
		durationMs: distribution(
			samples.map((sample) => sample.acceptancePhases[phase].durationMs),
		),
		percentOfAcceptance: distribution(
			samples.map(
				(sample) => sample.acceptancePhases[phase].percentOfAcceptance,
			),
		),
	};
}

function summarizeBootstrapPhase(
	samples: WorkspaceBenchmarkSample[],
	phase: keyof WorkspaceBenchmarkSample["bootstrapPhases"],
) {
	return {
		durationMs: distribution(
			samples.map((sample) => sample.bootstrapPhases[phase].durationMs),
		),
		percentOfBootstrap: distribution(
			samples.map((sample) => sample.bootstrapPhases[phase].percentOfBootstrap),
		),
	};
}

function summarize(samples: WorkspaceBenchmarkSample[]) {
	const operations = [
		"initialization",
		"acceptance",
		"bootstrap",
		"search",
		"export",
		"import",
		"filteredSearch",
		"channelProjection",
		"channelCompactionPreparation",
		"threadProjection",
		"threadCompactionPreparation",
	] as const;
	const operationSummary = Object.fromEntries(
		operations.flatMap((operation) => {
			const measurements = samples.flatMap((sample) =>
				sample[operation] === undefined ? [] : [sample[operation]],
			);
			if (measurements.length === 0) return [];
			return [
				[
					operation,
					{
						durationMs: distribution(
							measurements.map((entry) => entry.durationMs),
						),
						heapDeltaBytes: distribution(
							measurements.map((entry) => entry.heapDeltaBytes),
						),
						rssDeltaBytes: distribution(
							measurements.map((entry) => entry.rssDeltaBytes),
						),
					},
				],
			];
		}),
	);
	return {
		...operationSummary,
		acceptancePhases: {
			requestPreparation: summarizeAcceptancePhase(
				samples,
				"requestPreparation",
			),
			stateMutation: summarizeAcceptancePhase(samples, "stateMutation"),
			persistenceSerialization: summarizeAcceptancePhase(
				samples,
				"persistenceSerialization",
			),
			persistenceQueue: summarizeAcceptancePhase(samples, "persistenceQueue"),
			persistenceWrite: summarizeAcceptancePhase(samples, "persistenceWrite"),
			responseSnapshot: summarizeAcceptancePhase(samples, "responseSnapshot"),
		},
		bootstrapPhases: {
			stateSnapshot: summarizeBootstrapPhase(samples, "stateSnapshot"),
			assembly: summarizeBootstrapPhase(samples, "assembly"),
		},
		bootstrapPayloadSerialization: {
			durationMs: distribution(
				samples.map(
					(sample) => sample.bootstrapPayloadSerialization.durationMs,
				),
			),
			heapDeltaBytes: distribution(
				samples.map(
					(sample) => sample.bootstrapPayloadSerialization.heapDeltaBytes,
				),
			),
			rssDeltaBytes: distribution(
				samples.map(
					(sample) => sample.bootstrapPayloadSerialization.rssDeltaBytes,
				),
			),
			percentOfBootstrapProcessing: distribution(
				samples.map(
					(sample) =>
						sample.bootstrapPayloadSerialization.percentOfBootstrapProcessing,
				),
			),
		},
	};
}

async function sourceProvenance() {
	const cwd = fileURLToPath(new URL("../", import.meta.url));
	const files = [
		"scripts/benchmark-workspace.ts",
		"scripts/benchmark-workspace-fixtures.ts",
		"server/src/service.ts",
		"server/src/thread-context.ts",
		"package.json",
	];
	return {
		commit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd,
			encoding: "utf8",
		}).trim(),
		worktreeChanges: execFileSync(
			"git",
			["status", "--porcelain", "--untracked-files=all"],
			{ cwd, encoding: "utf8" },
		)
			.trim()
			.split("\n")
			.filter(Boolean),
		benchmarkFiles: await Promise.all(
			files.map(async (path) => ({
				path,
				sha256: createHash("sha256")
					.update(await readFile(join(cwd, path)))
					.digest("hex"),
			})),
		),
	};
}

const sizes = configuredSizes();
const repetitions = configuredRepetitions();
const shapes = configuredShapes();
const source = await sourceProvenance();
const startedAt = new Date().toISOString();
for (const shape of shapes) {
	process.stderr.write(`Warm-up: ${shape}, ${String(sizes[0])} messages\n`);
	await runSize(sizes[0] ?? 100, shape);
}
const results = [];
for (const size of sizes) {
	for (const shape of shapes) {
		const samples = [];
		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			process.stderr.write(
				`Sample: ${shape}, ${String(size)} messages, ${String(repetition + 1)}/${String(repetitions)}\n`,
			);
			samples.push(await runSize(size, shape));
		}
		results.push({
			messageCount: size,
			workspaceShape: shape,
			summary: summarize(samples),
			samples,
		});
	}
}

process.stdout.write(
	`${JSON.stringify(
		{
			methodology: {
				source,
				startedAt,
				completedAt: new Date().toISOString(),
				node: process.version,
				platform: process.platform,
				osRelease: release(),
				arch: process.arch,
				cpu: cpus()[0]?.model ?? "unknown",
				logicalCpuCount: cpus().length,
				totalMemoryBytes: totalmem(),
				workspaceShapes: shapes,
				messageShape:
					"dm: original alternating request/reply pairs; multi-channel: 4 Channels, 3 agents, 3 Projects, cyclic 1/3/8/16-pair Threads, two Projects per Thread, routing receipts, tool activity, corrections/pins/4 KiB attachments every fifth Thread",
				acceptance:
					"one service.send call through atomic JSON persistence; DM or new Channel root with explicit @benchmark-agent; optional service instrumentation separates request preparation, state mutation, JSON serialization, persistence queue wait, atomic file work, and response snapshot/redaction; stub reply finishes outside acceptance timing",
				bootstrap:
					"service bootstrap processing split into public state snapshot/redaction and remaining assembly; serialized UTF-8 payload time and size measured separately outside service processing, with its duration also reported as a comparison percentage of service bootstrap processing and therefore allowed to exceed 100%",
				search:
					"original broad two-term query, limit 24; synthetic Project directories are empty",
				filteredSearch:
					"same query restricted to message/dm transcript results and first Project when present",
				context:
					"busiest Channel and its longest Thread; projection and prompt preparation separately; no inference calls",
				exportImport:
					"version-1 archive through service boundaries, actual managed attachment bytes and explicit temporary Project remapping; archive serialization size outside timing",
				memory:
					"process.memoryUsage deltas, not peaks or retained memory; GC before each operation when available",
				explicitGcAvailable: typeof globalThis.gc === "function",
				warmup:
					"one discarded run per shape at the first configured message count",
				repetitions,
				dispersion:
					"min/median/max for each operation; samples run serially in configured size and shape order",
				limits:
					"service-level synthetic measurements exclude HTTP/browser rendering, reconnect, providers, native sessions, concurrent streaming, and separate routing/reply persistence timings",
			},
			results,
		},
		null,
		2,
	)}\n`,
);
