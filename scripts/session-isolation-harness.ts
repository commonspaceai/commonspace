import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentAdapterKind,
	CommonspaceAgentProfile,
	CommonspaceMessage,
	CommonspaceState,
} from "@commonspace/shared";
import {
	type AgentRunInput,
	CommonspaceHostService,
} from "../server/src/service.ts";

export const enum SessionIsolationScenario {
	Baseline = "baseline",
	Contended = "contended",
}

export interface SessionIsolationFixtureCounts {
	agents: number;
	channels: number;
	threads: number;
	messages: number;
}

export interface FastResponsivenessSample {
	acceptanceDurationMs: number;
	workerStartDurationMs: number;
	completionDurationMs: number;
}

export interface SessionIsolationControl {
	fastWorkerStartedBeforeSlowRelease: boolean;
	fastReplyPersistedBeforeSlowRelease: boolean;
	slowRemainedActiveThroughFastCompletion: boolean;
	followupAcceptedAndQueued: boolean;
	followupStartedBeforeSlowRelease: boolean;
	followupStartedAfterSlowRelease: boolean;
	distinctThreadSessions: boolean;
	followupResumedSlowSession: boolean;
	uniqueSourceMessages: boolean;
	repliesStayedInSourceThreads: boolean;
	runStartOrder: string[];
}

export interface BaselineSessionIsolationSample {
	scenario: SessionIsolationScenario.Baseline;
	fixtureCounts: SessionIsolationFixtureCounts;
	fast: FastResponsivenessSample;
}

export interface ContendedSessionIsolationSample {
	scenario: SessionIsolationScenario.Contended;
	fixtureCounts: SessionIsolationFixtureCounts;
	fast: FastResponsivenessSample;
	control: SessionIsolationControl;
}

export interface SessionIsolationPair {
	baseline: BaselineSessionIsolationSample;
	contended: ContendedSessionIsolationSample;
}

export type SessionIsolationSample =
	| BaselineSessionIsolationSample
	| ContendedSessionIsolationSample;

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

interface DurableMessageWaiter {
	promise: Promise<number>;
	dispose(): void;
}

interface IsolationFixture {
	channelId: string;
	fixtureCounts: SessionIsolationFixtureCounts;
	service: CommonspaceHostService;
}

interface ContendedWorkerState {
	slowReleased: boolean;
	slowActive: boolean;
	fastWorkerStartedBeforeSlowRelease: boolean;
	followupStartedBeforeSlowRelease: boolean;
	followupStartedAfterSlowRelease: boolean;
	followupResumedSlowSession: boolean;
	runStartOrder: string[];
}

interface ContendedWorker {
	state: ContendedWorkerState;
	runAgent(input: AgentRunInput): Promise<{ text: string; sessionId: string }>;
	slowStarted: Promise<{ sessionName: string }>;
	fastStarted: Promise<{ atMs: number; sessionName: string }>;
	followupStarted: Promise<void>;
	releaseSlow(): void;
}

const benchmarkAgent: CommonspaceAgentProfile = {
	id: "codex",
	displayName: "Codex",
	adapter: "codex",
	model: null,
	status: "stopped",
	description: "Synthetic provider-free session isolation worker.",
};
const fastRequestText = "@codex [fast-independent] Measure independent work.";
const slowRequestText = "@codex [slow-root] Hold this Thread open.";
const followupRequestText = "[slow-followup] Continue the held Thread.";
const fastReplyText = "Fast independent reply persisted.";
const slowReplyText = "Slow root reply persisted.";
const followupReplyText = "Queued same-Thread follow-up persisted.";
const slowSessionId = "10000000-0000-4000-8000-000000000001";
const fastSessionId = "20000000-0000-4000-8000-000000000002";

function deferred<T>(): Deferred<T> {
	let settle: (value: T) => void = () => undefined;
	let settled = false;
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return {
		promise,
		resolve(value) {
			if (settled) return;
			settled = true;
			settle(value);
		},
	};
}

async function withTimeout<T>(
	promise: Promise<T>,
	label: string,
	timeoutMs = 10_000,
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

function workspaceCounts(
	state: CommonspaceState,
): SessionIsolationFixtureCounts {
	return {
		agents: state.agents.length,
		channels: state.channels.length,
		threads: state.threads.length,
		messages: Object.values(state.messages).flat().length,
	};
}

function findMessage(
	state: CommonspaceState,
	predicate: (message: CommonspaceMessage) => boolean,
): CommonspaceMessage | undefined {
	return Object.values(state.messages).flat().find(predicate);
}

function waitForDurableMessage(
	service: CommonspaceHostService,
	text: string,
): DurableMessageWaiter {
	let disposeWaiter: () => void = () => undefined;
	const promise = new Promise<number>((resolve, reject) => {
		let settled = false;
		let unsubscribe: () => void = () => undefined;
		const finish = (settle?: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			unsubscribe();
			settle?.();
		};
		const inspect = () => {
			if (
				findMessage(service.snapshot(), (message) => message.text === text) !==
				undefined
			)
				finish(() => resolve(performance.now()));
		};
		const timeout = setTimeout(() => {
			finish(() => reject(new Error(`Timed out waiting for durable ${text}`)));
		}, 10_000);
		unsubscribe = service.subscribeToRevisions(inspect);
		disposeWaiter = finish;
		inspect();
	});
	return { promise, dispose: () => disposeWaiter() };
}

async function discoverBenchmarkAgent(
	adapter: AgentAdapterKind,
): Promise<CommonspaceAgentProfile[]> {
	return adapter === benchmarkAgent.adapter ? [benchmarkAgent] : [];
}

async function createFixture(
	root: string,
	runAgent: (
		input: AgentRunInput,
	) => Promise<string | { text: string; sessionId: string }>,
): Promise<IsolationFixture> {
	const service = new CommonspaceHostService(
		{},
		{ root, defaultCwd: root },
		{
			discoverAgents: discoverBenchmarkAgent,
			runAgent,
			notify: async () => undefined,
		},
	);
	try {
		await service.initialize();
		await service.mutate({
			action: "add-discovered-agent",
			agentId: benchmarkAgent.id,
			adapter: benchmarkAgent.adapter,
		});
		const state = await service.mutate({
			action: "create-channel",
			name: "session-isolation",
			agentIds: [benchmarkAgent.id],
		});
		const channel = state.channels[0];
		if (channel === undefined)
			throw new Error("Missing isolation benchmark Channel");
		return {
			service,
			channelId: channel.id,
			fixtureCounts: workspaceCounts(state),
		};
	} catch (error) {
		await service.close().catch(() => undefined);
		throw error;
	}
}

async function cleanupFixture(input: {
	service: CommonspaceHostService | undefined;
	root: string;
	waitForIdle?: () => Promise<void>;
}): Promise<void> {
	const failures: unknown[] = [];
	if (input.waitForIdle !== undefined) {
		try {
			await input.waitForIdle();
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await input.service?.close();
	} catch (error) {
		failures.push(error);
	}
	try {
		await rm(input.root, { recursive: true, force: true });
	} catch (error) {
		failures.push(error);
	}
	if (failures.length > 0)
		throw new AggregateError(failures, "Session isolation cleanup failed");
}

function fastMetrics(
	startedAtMs: number,
	acceptedAtMs: number,
	workerStartedAtMs: number,
	completedAtMs: number,
): FastResponsivenessSample {
	return {
		acceptanceDurationMs: acceptedAtMs - startedAtMs,
		workerStartDurationMs: workerStartedAtMs - startedAtMs,
		completionDurationMs: completedAtMs - startedAtMs,
	};
}

async function runBaselineScenario(): Promise<BaselineSessionIsolationSample> {
	const root = await mkdtemp(join(tmpdir(), "commonspace-session-baseline-"));
	const fastStarted = deferred<number>();
	let service: CommonspaceHostService | undefined;
	let fastCompleted: DurableMessageWaiter | undefined;
	let scenarioSucceeded = false;
	try {
		const fixture = await createFixture(root, async (input) => {
			if (!input.message.includes("[fast-independent]"))
				throw new Error(`Unexpected baseline run: ${input.message}`);
			fastStarted.resolve(performance.now());
			return { text: fastReplyText, sessionId: fastSessionId };
		});
		service = fixture.service;
		fastCompleted = waitForDurableMessage(service, fastReplyText);
		const startedAtMs = performance.now();
		await service.send({
			conversation: { kind: "channel", id: fixture.channelId },
			text: fastRequestText,
		});
		const acceptedAtMs = performance.now();
		const [workerStartedAtMs, completedAtMs] = await Promise.all([
			withTimeout(fastStarted.promise, "baseline fast worker start"),
			fastCompleted.promise,
		]);
		await service.whenIdle();
		const sample: BaselineSessionIsolationSample = {
			scenario: SessionIsolationScenario.Baseline,
			fixtureCounts: fixture.fixtureCounts,
			fast: fastMetrics(
				startedAtMs,
				acceptedAtMs,
				workerStartedAtMs,
				completedAtMs,
			),
		};
		scenarioSucceeded = true;
		return sample;
	} finally {
		fastCompleted?.dispose();
		const cleanup = cleanupFixture({ service, root });
		if (scenarioSucceeded) await cleanup;
		else await cleanup.catch(() => undefined);
	}
}

function finalMessageControls(
	state: CommonspaceState,
	runStartOrder: string[],
): Pick<
	SessionIsolationControl,
	"uniqueSourceMessages" | "repliesStayedInSourceThreads" | "runStartOrder"
> {
	const messages = Object.values(state.messages).flat();
	const requests = messages.filter((message) => message.authorType === "user");
	const replies = messages.filter((message) => message.authorType === "agent");
	const requestById = new Map(requests.map((message) => [message.id, message]));
	return {
		uniqueSourceMessages:
			requests.length === 3 &&
			new Set(requests.map((message) => message.id)).size === 3 &&
			replies.length === 3 &&
			new Set(replies.map((message) => message.sourceMessageId)).size === 3,
		repliesStayedInSourceThreads: replies.every((reply) => {
			const source =
				reply.sourceMessageId === undefined
					? undefined
					: requestById.get(reply.sourceMessageId);
			return source !== undefined && source.threadId === reply.threadId;
		}),
		runStartOrder: [...runStartOrder],
	};
}

function createContendedWorker(): ContendedWorker {
	const slowStarted = deferred<{ sessionName: string }>();
	const slowRelease = deferred<void>();
	const fastStarted = deferred<{ atMs: number; sessionName: string }>();
	const followupStarted = deferred<void>();
	const state: ContendedWorkerState = {
		slowReleased: false,
		slowActive: false,
		fastWorkerStartedBeforeSlowRelease: false,
		followupStartedBeforeSlowRelease: false,
		followupStartedAfterSlowRelease: false,
		followupResumedSlowSession: false,
		runStartOrder: [],
	};
	return {
		state,
		slowStarted: slowStarted.promise,
		fastStarted: fastStarted.promise,
		followupStarted: followupStarted.promise,
		async runAgent(input) {
			if (input.message.includes("[slow-root]")) {
				state.runStartOrder.push("slow-root");
				state.slowActive = true;
				slowStarted.resolve({ sessionName: input.sessionName });
				await slowRelease.promise;
				state.slowActive = false;
				return { text: slowReplyText, sessionId: slowSessionId };
			}
			if (input.message.includes("[fast-independent]")) {
				state.runStartOrder.push("fast-independent");
				state.fastWorkerStartedBeforeSlowRelease = !state.slowReleased;
				fastStarted.resolve({
					atMs: performance.now(),
					sessionName: input.sessionName,
				});
				return { text: fastReplyText, sessionId: fastSessionId };
			}
			if (input.message.includes("[slow-followup]")) {
				state.runStartOrder.push("slow-followup");
				state.followupStartedBeforeSlowRelease = !state.slowReleased;
				state.followupStartedAfterSlowRelease = state.slowReleased;
				state.followupResumedSlowSession = input.sessionId === slowSessionId;
				followupStarted.resolve(undefined);
				return { text: followupReplyText, sessionId: slowSessionId };
			}
			throw new Error(`Unexpected contended run: ${input.message}`);
		},
		releaseSlow() {
			if (state.slowReleased) return;
			state.slowReleased = true;
			slowRelease.resolve(undefined);
		},
	};
}

async function runContendedScenario(): Promise<ContendedSessionIsolationSample> {
	const root = await mkdtemp(join(tmpdir(), "commonspace-session-contended-"));
	const worker = createContendedWorker();
	let service: CommonspaceHostService | undefined;
	let fastCompleted: DurableMessageWaiter | undefined;
	let scenarioSucceeded = false;
	try {
		const fixture = await createFixture(root, worker.runAgent);
		service = fixture.service;
		const slow = await service.send({
			conversation: { kind: "channel", id: fixture.channelId },
			text: slowRequestText,
		});
		const slowThread = slow.thread;
		if (slowThread === undefined)
			throw new Error("Missing slow benchmark Thread");
		const slowRun = await withTimeout(worker.slowStarted, "slow worker start");
		const followup = await service.send({
			conversation: { kind: "channel", id: fixture.channelId },
			threadId: slowThread.id,
			targetAgentId: benchmarkAgent.id,
			text: followupRequestText,
			delivery: "queue",
		});
		const followupAcceptedAndQueued = service
			.queuedFollowups()
			.some((item) => item.messageId === followup.accepted.id);
		fastCompleted = waitForDurableMessage(service, fastReplyText);
		const startedAtMs = performance.now();
		const fast = await service.send({
			conversation: { kind: "channel", id: fixture.channelId },
			text: fastRequestText,
		});
		const acceptedAtMs = performance.now();
		const [fastRun, completedAtMs] = await Promise.all([
			withTimeout(worker.fastStarted, "contended fast worker start"),
			fastCompleted.promise,
		]);
		const fastReplyPersistedBeforeSlowRelease = !worker.state.slowReleased;
		const slowRemainedActiveThroughFastCompletion = worker.state.slowActive;
		const fastThread = fast.thread;
		if (fastThread === undefined)
			throw new Error("Missing fast benchmark Thread");

		worker.releaseSlow();
		await withTimeout(worker.followupStarted, "queued same-Thread follow-up");
		await withTimeout(service.whenIdle(), "contended service idle");
		const finalState = service.snapshot();
		const persistedSessions = finalState.agentSessions[benchmarkAgent.id];
		const distinctThreadSessions =
			slowThread.id !== fastThread.id &&
			slowRun.sessionName === `Commonspace Thread: ${slowThread.id}` &&
			fastRun.sessionName === `Commonspace Thread: ${fastThread.id}` &&
			slowRun.sessionName !== fastRun.sessionName &&
			persistedSessions?.[slowRun.sessionName] === slowSessionId &&
			persistedSessions[fastRun.sessionName] === fastSessionId;
		const messageControls = finalMessageControls(
			finalState,
			worker.state.runStartOrder,
		);
		const sample: ContendedSessionIsolationSample = {
			scenario: SessionIsolationScenario.Contended,
			fixtureCounts: fixture.fixtureCounts,
			fast: fastMetrics(startedAtMs, acceptedAtMs, fastRun.atMs, completedAtMs),
			control: {
				fastWorkerStartedBeforeSlowRelease:
					worker.state.fastWorkerStartedBeforeSlowRelease,
				fastReplyPersistedBeforeSlowRelease,
				slowRemainedActiveThroughFastCompletion,
				followupAcceptedAndQueued,
				followupStartedBeforeSlowRelease:
					worker.state.followupStartedBeforeSlowRelease,
				followupStartedAfterSlowRelease:
					worker.state.followupStartedAfterSlowRelease,
				distinctThreadSessions,
				followupResumedSlowSession: worker.state.followupResumedSlowSession,
				...messageControls,
			},
		};
		scenarioSucceeded = true;
		return sample;
	} finally {
		worker.releaseSlow();
		fastCompleted?.dispose();
		const activeService = service;
		const cleanup = cleanupFixture(
			activeService === undefined
				? { service: activeService, root }
				: {
						service: activeService,
						root,
						waitForIdle: () =>
							withTimeout(
								activeService.whenIdle(),
								"session isolation cleanup",
							),
					},
		);
		if (scenarioSucceeded) await cleanup;
		else await cleanup.catch(() => undefined);
	}
}

export function runSessionIsolationScenario(
	scenario: SessionIsolationScenario.Baseline,
): Promise<BaselineSessionIsolationSample>;
export function runSessionIsolationScenario(
	scenario: SessionIsolationScenario.Contended,
): Promise<ContendedSessionIsolationSample>;
export function runSessionIsolationScenario(
	scenario: SessionIsolationScenario,
): Promise<SessionIsolationSample> {
	switch (scenario) {
		case SessionIsolationScenario.Baseline:
			return runBaselineScenario();
		case SessionIsolationScenario.Contended:
			return runContendedScenario();
		default:
			return exhaustiveScenario(scenario);
	}
}

function exhaustiveScenario(scenario: never): never {
	throw new Error(
		`Unsupported session isolation scenario: ${String(scenario)}`,
	);
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
		throw new Error("Cannot summarize empty session isolation samples");
	return { min, median: (lower + upper) / 2, max };
}

function summarizeFast(samples: readonly FastResponsivenessSample[]) {
	return {
		acceptanceDurationMs: distribution(
			samples.map((sample) => sample.acceptanceDurationMs),
		),
		workerStartDurationMs: distribution(
			samples.map((sample) => sample.workerStartDurationMs),
		),
		completionDurationMs: distribution(
			samples.map((sample) => sample.completionDurationMs),
		),
	};
}

export function summarizeSessionIsolationPairs(
	pairs: readonly SessionIsolationPair[],
) {
	const baseline = pairs.map((pair) => pair.baseline.fast);
	const contended = pairs.map((pair) => pair.contended.fast);
	const delta = pairs.map((pair) => ({
		acceptanceDurationMs:
			pair.contended.fast.acceptanceDurationMs -
			pair.baseline.fast.acceptanceDurationMs,
		workerStartDurationMs:
			pair.contended.fast.workerStartDurationMs -
			pair.baseline.fast.workerStartDurationMs,
		completionDurationMs:
			pair.contended.fast.completionDurationMs -
			pair.baseline.fast.completionDurationMs,
	}));
	return {
		baseline: summarizeFast(baseline),
		contended: summarizeFast(contended),
		delta: summarizeFast(delta),
	};
}

export function assertSessionIsolationControl(
	control: SessionIsolationControl,
): void {
	const failed = [
		[
			control.fastWorkerStartedBeforeSlowRelease,
			"fast worker did not start before slow release",
		],
		[
			control.fastReplyPersistedBeforeSlowRelease,
			"fast reply did not persist before slow release",
		],
		[
			control.slowRemainedActiveThroughFastCompletion,
			"slow run was not active through fast completion",
		],
		[
			control.followupAcceptedAndQueued,
			"same-Thread follow-up was not retained in the queue",
		],
		[
			!control.followupStartedBeforeSlowRelease,
			"same-Thread follow-up started before slow release",
		],
		[
			control.followupStartedAfterSlowRelease,
			"same-Thread follow-up did not start after slow release",
		],
		[control.distinctThreadSessions, "independent Threads shared one session"],
		[
			control.followupResumedSlowSession,
			"same-Thread follow-up did not resume the slow native session",
		],
		[control.uniqueSourceMessages, "source or reply messages were duplicated"],
		[
			control.repliesStayedInSourceThreads,
			"a reply crossed its source Thread boundary",
		],
	] satisfies ReadonlyArray<readonly [boolean, string]>;
	const failure = failed.find(([passed]) => !passed);
	if (failure !== undefined) throw new Error(failure[1]);
	if (
		control.runStartOrder.join(",") !==
		"slow-root,fast-independent,slow-followup"
	)
		throw new Error(
			"worker start order did not prove isolation and serialization",
		);
}
