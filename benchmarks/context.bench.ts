import { bench, describe } from "vitest";
import { buildChannelContextCompactionPrompt } from "../server/src/context.ts";
import { projectChannelMemory } from "../server/src/memory.ts";
import {
	buildThreadContextCompactionPrompt,
	projectThreadMemory,
} from "../server/src/thread-context.ts";
import { benchmarkState, firstChannelId, largestThreadId } from "./fixtures.ts";

const state = benchmarkState();
const channelId = firstChannelId(state);
const threadId = largestThreadId(state);
const projection = projectChannelMemory(state, channelId);

describe("context projection", () => {
	bench("project Channel memory from the transcript", () => {
		projectChannelMemory(state, channelId);
	});

	bench("build the Channel compaction prompt", () => {
		buildChannelContextCompactionPrompt(state, channelId, projection);
	});

	bench("project Thread memory from the transcript", () => {
		projectThreadMemory(state, threadId);
	});

	bench("build the Thread compaction prompt", () => {
		buildThreadContextCompactionPrompt(state, threadId);
	});
});
