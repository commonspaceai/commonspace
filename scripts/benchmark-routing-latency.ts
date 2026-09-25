import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommonspaceRoutingDecision } from "@commonspace/shared";
import type { RunningClassifier } from "../server/src/local-classifier.ts";
import {
	type AgentRunInput,
	CommonspaceHostService,
	type CommonspaceRouteInput,
	type CommonspaceRouteResult,
} from "../server/src/service.ts";

type Branch =
	| "local-accepted"
	| "local-abstained"
	| "local-unavailable"
	| "classifier-error"
	| "correction-fallback"
	| "parallel-fallback";

interface Scenario {
	branch: Branch;
	text: string;
	expectedAgents: readonly string[];
	expectedSource: "local" | "ai" | "explicit";
	expectedClassifierCalls: number;
	expectedFallbackCalls: number;
}

type SampleMetric =
	| "acceptanceToResolutionMs"
	| "acceptanceToFirstDispatchMs"
	| "acceptanceToLastDispatchMs";

interface Sample {
	durableAcceptanceObservedAt: string;
	responseReturnedAt: string;
	responseReturnAfterDurableAcceptanceMs: number;
	routingSource: CommonspaceRoutingDecision["source"];
	routedAgentIds: string[];
	routingStartedAt: string;
	routingResolvedAt: string;
	routingResolutionObservedAt: string;
	firstWorkerStartedAt: string;
	lastWorkerStartedAt: string;
	acceptanceToResolutionMs: number;
	acceptanceToFirstDispatchMs: number;
	acceptanceToLastDispatchMs: number;
	observedRoutingMs: number;
	persistedRoutingMs: number;
	routingClockDifferenceMs: number;
	classifierCalls: number;
	fallbackCalls: number;
	fallbackAttempts: number;
	workerCompletionAfterFirstStartMs: number;
}

interface Capture {
	scenario: Scenario;
	classifierDelayMs: number;
	fallbackDelayMs: number;
	workerDelayMs: number;
	wrongOwner: boolean;
	classifierCalls: number;
	fallbackCalls: number;
	workerStarts: { agentId: string; atMs: number; at: string }[];
	workerReturns: number[];
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const repetitions = Number(
	process.env.COMMONSPACE_ROUTING_BENCHMARK_REPETITIONS ?? 20,
);
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 30)
	throw new Error("COMMONSPACE_ROUTING_BENCHMARK_REPETITIONS must be 1–30");

const agents = [
	{
		id: "frontend",
		displayName: "Frontend",
		description: "React and CSS",
		adapter: "hermes" as const,
		model: null,
		status: "stopped" as const,
	},
	{
		id: "backend",
		displayName: "Backend",
		description: "APIs and persistence",
		adapter: "hermes" as const,
		model: null,
		status: "stopped" as const,
	},
];

const scenarios: readonly Scenario[] = [
	{
		branch: "local-accepted",
		text: "hi frontend",
		expectedAgents: ["frontend"],
		expectedSource: "local",
		expectedClassifierCalls: 1,
		expectedFallbackCalls: 0,
	},
	{
		branch: "local-abstained",
		text: "hi frontend",
		expectedAgents: ["frontend"],
		expectedSource: "ai",
		expectedClassifierCalls: 1,
		expectedFallbackCalls: 1,
	},
	{
		branch: "local-unavailable",
		text: "hi frontend",
		expectedAgents: ["frontend"],
		expectedSource: "ai",
		expectedClassifierCalls: 1,
		expectedFallbackCalls: 1,
	},
	{
		branch: "classifier-error",
		text: "hi frontend",
		expectedAgents: ["frontend"],
		expectedSource: "ai",
		expectedClassifierCalls: 1,
		expectedFallbackCalls: 1,
	},
	{
		branch: "correction-fallback",
		text: "@Frontend @Backend: complete your independent tasks.",
		expectedAgents: ["frontend", "backend"],
		expectedSource: "explicit",
		expectedClassifierCalls: 0,
		expectedFallbackCalls: 1,
	},
	{
		branch: "parallel-fallback",
		text: "Implement the dashboard UI and API independently.",
		expectedAgents: ["frontend", "backend"],
		expectedSource: "ai",
		expectedClassifierCalls: 0,
		expectedFallbackCalls: 1,
	},
];

const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`Missing ${label}`);
	return value;
}

function summary(samples: readonly Sample[], field: SampleMetric) {
	const sorted = samples
		.map((sample) => sample[field])
		.toSorted((a, b) => a - b);
	return {
		p50Ms: requireValue(sorted[Math.ceil(sorted.length * 0.5) - 1], "p50"),
		p95Ms: requireValue(sorted[Math.ceil(sorted.length * 0.95) - 1], "p95"),
		maxMs: requireValue(sorted.at(-1), "max"),
	};
}

async function benchmarkScenario(scenario: Scenario) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-routing-latency-"));
	let active: Capture | undefined;
	const classifyRouting: RunningClassifier["classify"] = async (request) => {
		const capture = requireValue(active, "active classifier sample");
		capture.classifierCalls += 1;
		if (capture.classifierDelayMs > 0) await delay(capture.classifierDelayMs);
		if (scenario.branch === "classifier-error")
			throw new Error("synthetic classifier unavailable");
		if (scenario.branch === "local-unavailable") return null;
		if (scenario.branch === "local-abstained")
			return request.options.map((option) => ({ id: option.id, score: 0.25 }));
		const recipient = request.options.find(
			(option) =>
				option.id.startsWith("greeting-agent:") &&
				option.description.toLowerCase() === "frontend",
		);
		if (recipient === undefined)
			throw new Error("Local control did not request greeting recipients");
		return request.options.map((option) => ({
			id: option.id,
			score: option.id === recipient.id ? 0.95 : 0.01,
		}));
	};
	const routeAgents = async (
		input: CommonspaceRouteInput,
	): Promise<CommonspaceRouteResult> => {
		const capture = active;
		if (capture !== undefined) {
			capture.fallbackCalls += 1;
			if (
				scenario.branch === "correction-fallback" &&
				!input.routingMemory.includes('"agentId":"backend"')
			)
				throw new Error("Correction fallback omitted saved routing evidence");
			if (capture.fallbackDelayMs > 0) await delay(capture.fallbackDelayMs);
		}
		const ids =
			capture?.wrongOwner === true
				? ["backend"]
				: (capture?.scenario.expectedAgents ?? ["frontend"]);
		return {
			mode: "parallel",
			assignments: ids.map((agentId) => ({ agentId, projectIds: [] })),
			reason: "Synthetic fixture owner decision.",
		};
	};
	const runAgent = async (input: AgentRunInput) => {
		if (input.sessionName.startsWith("Commonspace Inference:"))
			return JSON.stringify({ summary: "", decisions: [], openQuestions: [] });
		const capture = active;
		if (capture !== undefined && input.message === capture.scenario.text) {
			capture.workerStarts.push({
				agentId: input.agent.id,
				atMs: performance.now(),
				at: new Date().toISOString(),
			});
			if (capture.workerDelayMs > 0) await delay(capture.workerDelayMs);
			capture.workerReturns.push(performance.now());
		}
		return "Synthetic worker completed.";
	};
	const service = new CommonspaceHostService(
		{},
		{ root, defaultCwd: root },
		{
			discoverAgents: async () => agents,
			classifyRouting,
			routeAgents,
			runAgent,
		},
	);
	try {
		await service.initialize();
		for (const agent of agents)
			await service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
			});
		const channel = requireValue(
			(
				await service.mutate({
					action: "create-channel",
					name: `routing-${scenario.branch}`,
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
			"benchmark Channel",
		);
		const conversation = { kind: "channel" as const, id: channel.id };
		const key = `channel:${channel.id}`;
		if (scenario.branch === "correction-fallback") {
			const seed = await service.send({
				conversation,
				text: "@Frontend fix the login layout.",
			});
			await service.whenIdle();
			const assignment = requireValue(
				service
					.snapshot()
					.messages[key]?.find((item) => item.id === seed.accepted.id)?.routing
					?.assignments[0],
				"correction seed assignment",
			);
			await service.rerouteAssignment({
				sourceMessageId: seed.accepted.id,
				assignmentId: assignment.id,
				agentIds: ["backend"],
				projectIds: [],
			});
			await service.whenIdle();
			if (service.snapshot().channels[0]?.routingMemory.correctionCount !== 1)
				throw new Error("Correction fixture did not save routing memory");
		}

		async function measure(
			options: {
				classifierDelayMs?: number;
				fallbackDelayMs?: number;
				workerDelayMs?: number;
				wrongOwner?: boolean;
			} = {},
		): Promise<Sample> {
			const priorIds = new Set(
				(service.snapshot().messages[key] ?? []).map((message) => message.id),
			);
			const capture: Capture = {
				scenario,
				classifierDelayMs: options.classifierDelayMs ?? 0,
				fallbackDelayMs: options.fallbackDelayMs ?? 0,
				workerDelayMs: options.workerDelayMs ?? 0,
				wrongOwner: options.wrongOwner ?? false,
				classifierCalls: 0,
				fallbackCalls: 0,
				workerStarts: [],
				workerReturns: [],
			};
			active = capture;
			let pendingAtMs: number | undefined;
			let pendingAt: string | undefined;
			let resolvedAtMs: number | undefined;
			let resolvedAt: string | undefined;
			const unsubscribe = service.subscribeToRevisions(() => {
				const message = (service.snapshot().messages[key] ?? []).find(
					(item) => item.text === scenario.text && !priorIds.has(item.id),
				);
				if (
					message?.routing?.status === "pending" &&
					pendingAtMs === undefined
				) {
					pendingAtMs = performance.now();
					pendingAt = new Date().toISOString();
				}
				if (
					message?.routing?.status === "resolved" &&
					resolvedAtMs === undefined
				) {
					resolvedAtMs = performance.now();
					resolvedAt = new Date().toISOString();
				}
			});
			try {
				const sent = await service.send({ conversation, text: scenario.text });
				const responseReturnedAtMs = performance.now();
				const responseReturnedAt = new Date().toISOString();
				await service.whenIdle();
				if (
					!(await readFile(join(root, "state.json"), "utf8")).includes(
						sent.accepted.id,
					)
				)
					throw new Error("Accepted request missing from durable state");
				const saved = requireValue(
					service
						.snapshot()
						.messages[key]?.find((item) => item.id === sent.accepted.id),
					"persisted request",
				);
				const routing = saved.routing;
				if (routing?.status !== "resolved")
					throw new Error(`${scenario.branch}: routing did not resolve`);
				const actualAgents = routing.assignments
					.map((assignment) => assignment.agentId)
					.toSorted();
				if (
					routing.source !== scenario.expectedSource ||
					JSON.stringify(actualAgents) !==
						JSON.stringify([...scenario.expectedAgents].sort())
				)
					throw new Error(`${scenario.branch}: quality: wrong source or owner`);
				if (
					capture.classifierCalls !== scenario.expectedClassifierCalls ||
					capture.fallbackCalls !== scenario.expectedFallbackCalls
				)
					throw new Error(
						`${scenario.branch}: wrong classifier/fallback call count`,
					);
				const starts = capture.workerStarts.toSorted((a, b) => a.atMs - b.atMs);
				if (
					JSON.stringify(starts.map((start) => start.agentId).toSorted()) !==
					JSON.stringify([...scenario.expectedAgents].sort())
				)
					throw new Error(`${scenario.branch}: wrong worker participant set`);
				const first = requireValue(starts[0], "first worker start");
				const last = requireValue(starts.at(-1), "last worker start");
				const resolution = requireValue(
					resolvedAtMs,
					"persisted routing observation",
				);
				const pending = requireValue(
					pendingAtMs,
					"pending routing observation",
				);
				if (
					responseReturnedAtMs < pending ||
					resolution < pending ||
					first.atMs < resolution
				)
					throw new Error(
						`${scenario.branch}: timing boundaries are out of order`,
					);
				const observedRoutingMs = resolution - pending;
				const persistedRoutingMs = requireValue(
					routing.durationMs,
					"routing duration",
				);
				return {
					durableAcceptanceObservedAt: requireValue(
						pendingAt,
						"durable acceptance observation",
					),
					responseReturnedAt,
					responseReturnAfterDurableAcceptanceMs:
						responseReturnedAtMs - pending,
					routingSource: routing.source,
					routedAgentIds: actualAgents,
					routingStartedAt: requireValue(
						routing.startedAt,
						"persisted routing start",
					),
					routingResolvedAt: requireValue(
						routing.resolvedAt,
						"persisted routing resolution",
					),
					routingResolutionObservedAt: requireValue(
						resolvedAt,
						"observed routing resolution",
					),
					firstWorkerStartedAt: first.at,
					lastWorkerStartedAt: last.at,
					acceptanceToResolutionMs: resolution - pending,
					acceptanceToFirstDispatchMs: first.atMs - pending,
					acceptanceToLastDispatchMs: last.atMs - pending,
					observedRoutingMs,
					persistedRoutingMs,
					routingClockDifferenceMs: observedRoutingMs - persistedRoutingMs,
					classifierCalls: capture.classifierCalls,
					fallbackCalls: capture.fallbackCalls,
					fallbackAttempts: capture.fallbackCalls,
					workerCompletionAfterFirstStartMs:
						requireValue(capture.workerReturns.at(-1), "worker return") -
						first.atMs,
				};
			} finally {
				unsubscribe();
				active = undefined;
			}
		}

		const first = await measure();
		const warm: Sample[] = [];
		for (let index = 0; index < repetitions; index += 1)
			warm.push(await measure());
		const controls: Record<string, boolean> = {};
		if (scenario.branch === "local-accepted") {
			const baseline = await measure();
			const delayed = await measure({ classifierDelayMs: 300 });
			controls.localDelayMovesResolutionAndDispatch =
				delayed.acceptanceToResolutionMs - baseline.acceptanceToResolutionMs >
					200 &&
				delayed.acceptanceToFirstDispatchMs -
					baseline.acceptanceToFirstDispatchMs >
					200;
			const unusedFallbackDelay = await measure({ fallbackDelayMs: 300 });
			controls.fallbackDelayDoesNotRunOnLocalPath =
				unusedFallbackDelay.fallbackCalls === 0 &&
				unusedFallbackDelay.acceptanceToFirstDispatchMs -
					baseline.acceptanceToFirstDispatchMs <
					150;
		} else if (scenario.branch === "local-abstained") {
			const baseline = await measure();
			const delayed = await measure({ fallbackDelayMs: 300 });
			controls.fallbackDelayMovesResolutionAndDispatch =
				delayed.acceptanceToResolutionMs - baseline.acceptanceToResolutionMs >
					200 &&
				delayed.acceptanceToFirstDispatchMs -
					baseline.acceptanceToFirstDispatchMs >
					200;
			const slowWorker = await measure({ workerDelayMs: 300 });
			controls.workerDelayExcludedFromDispatch =
				slowWorker.workerCompletionAfterFirstStartMs >= 250 &&
				slowWorker.acceptanceToFirstDispatchMs -
					baseline.acceptanceToFirstDispatchMs <
					150;
			let wrong = false;
			try {
				await measure({ wrongOwner: true });
			} catch (error) {
				wrong =
					error instanceof Error &&
					error.message.includes("quality: wrong source or owner");
			}
			controls.fastWrongOwnerRejected = wrong;
		}
		if (Object.values(controls).some((passed) => !passed))
			throw new Error(`${scenario.branch}: sensitivity control failed`);
		return {
			branch: scenario.branch,
			fixture: {
				text: scenario.text,
				expectedAgents: scenario.expectedAgents,
				expectedSource: scenario.expectedSource,
				candidateCount: agents.length,
				projectCount: 0,
				firstScope:
					scenario.branch === "correction-fallback"
						? "after saved correction"
						: "fresh Channel",
			},
			first,
			warm: {
				count: warm.length,
				acceptanceToResolution: summary(warm, "acceptanceToResolutionMs"),
				acceptanceToFirstDispatch: summary(warm, "acceptanceToFirstDispatchMs"),
				acceptanceToLastDispatch: summary(warm, "acceptanceToLastDispatchMs"),
				samples: warm,
			},
			controls,
		};
	} finally {
		await service.close();
		await rm(root, { recursive: true, force: true });
	}
}

const source = {
	commit: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim(),
	worktreeChanges: execFileSync("git", ["status", "--porcelain"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	})
		.toString()
		.trim()
		.split("\n")
		.filter(Boolean),
};
const results = [];
for (const scenario of scenarios) {
	process.stderr.write(`Benchmarking ${scenario.branch}\n`);
	results.push(await benchmarkScenario(scenario));
}
process.stdout.write(
	`${JSON.stringify(
		{
			methodology: {
				source,
				node: process.version,
				pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
				platform: process.platform,
				osRelease: release(),
				arch: process.arch,
				cpu: cpus()[0]?.model ?? "unknown",
				repetitions,
				primaryBoundary:
					"The durable pending-routing revision is observed before routing begins; monotonic acceptance-to-resolution and acceptance-to-worker-start durations use that event. send() response-return time is recorded separately because routing may already be running when send() resolves.",
				limits:
					"Provider-free synthetic service routing and stub workers. The classifier and Harness fallback are controlled doubles; real Laya latency is measured by benchmark:laya and evaluate:classifier. Startup, model download, native sessions, and network/provider latency are excluded.",
			},
			results,
		},
		null,
		2,
	)}\n`,
);
