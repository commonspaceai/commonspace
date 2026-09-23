import type {
	CommonspaceBootstrap,
	CommonspaceState,
} from "@commonspace/shared";
import {
	BenchmarkWorkspaceShape,
	createBenchmarkFixture,
} from "../scripts/benchmark-workspace-fixtures.ts";

/** Transcript size of the shared synthetic workspace: large enough to expose scaling costs, small enough to keep one iteration in milliseconds. */
export const BENCHMARK_MESSAGE_COUNT = 1_000;

/** Synthetic multi-channel workspace without Project roots, so benchmarks measure computation instead of local disk. */
export function benchmarkState(
	messageCount: number = BENCHMARK_MESSAGE_COUNT,
): CommonspaceState {
	const { state } = createBenchmarkFixture(
		BenchmarkWorkspaceShape.MultiChannel,
		messageCount,
		"/commonspace-benchmark",
	);
	for (const project of state.projects) project.paths = [];
	return state;
}

export function benchmarkBootstrap(
	state: CommonspaceState,
): CommonspaceBootstrap {
	return {
		agents: [],
		discoveredAgents: [],
		state,
		liveActivities: [],
	};
}

export function firstChannelId(state: CommonspaceState): string {
	const channel = state.channels[0];
	if (channel === undefined) throw new Error("Missing benchmark Channel");
	return channel.id;
}

/** Longest Thread in the workspace, the worst case for Thread context projection. */
export function largestThreadId(state: CommonspaceState): string {
	const counts = new Map<string, number>();
	for (const messages of Object.values(state.messages)) {
		for (const message of messages) {
			if (message.threadId === undefined) continue;
			counts.set(message.threadId, (counts.get(message.threadId) ?? 0) + 1);
		}
	}
	const largest = [...counts.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
	)[0];
	if (largest === undefined) throw new Error("Missing benchmark Thread");
	return largest[0];
}
