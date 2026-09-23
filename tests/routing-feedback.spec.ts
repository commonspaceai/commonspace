import type { CommonspaceMessage } from "@commonspace/shared";
import { expect, it } from "vitest";
import {
	currentRoutingExamples,
	parseRoutingMemoryCompaction,
	routingSummaryStillSupported,
} from "../server/src/routing-memory.ts";
import { applyMutation, createInitialState } from "../server/src/state.ts";
import { mustExist } from "./test-helpers.ts";

it("uses only current human corrections, excluding deleted, replaced, and ineligible examples", () => {
	const state = applyMutation(createInitialState(), {
		action: "create-channel",
		name: "review",
		agentIds: [],
	});
	const channel = mustExist(state.channels[0]);
	channel.agentIds = ["a", "b", "c"];
	channel.routingMemory.correctionCount = 2;
	const message: CommonspaceMessage = {
		id: "request",
		conversation: { kind: "channel", id: channel.id },
		authorType: "user",
		authorId: "human",
		authorName: "Human",
		createdAt: "2026-09-22T00:00:00Z",
		text: "Review the migration.",
		routing: {
			source: "ai",
			agentIds: ["a", "b", "c"],
			assignments: [
				{ id: "first", agentId: "a", projectIds: [] },
				{ id: "second", agentId: "b", projectIds: [] },
				{ id: "third", agentId: "c", projectIds: [] },
			],
			corrections: [
				{
					id: "correction-1",
					fromAssignmentId: "first",
					toAssignmentId: "second",
					createdAt: "2026-09-22T00:00:01Z",
				},
				{
					id: "correction-2",
					fromAssignmentId: "second",
					toAssignmentId: "third",
					createdAt: "2026-09-22T00:00:02Z",
				},
			],
			inferredProjectIds: [],
			reason: "Initial inference",
		},
	};
	const messages = [message];
	state.messages[`channel:${channel.id}`] = messages;
	expect(
		routingSummaryStillSupported(
			state,
			channel.id,
			"correction-2",
			"2026-09-22T00:00:02.500Z",
		),
	).toBe(true);
	expect(currentRoutingExamples(state, channel.id)).toContain('"agentId":"c"');
	expect(currentRoutingExamples(state, channel.id)).not.toContain(
		'"agentId":"b"',
	);
	channel.routingMemory.status = "current";
	expect(currentRoutingExamples(state, channel.id)).toContain('"agentId":"c"');
	channel.routingMemory.summary = "The current user correction is summarized.";
	expect(currentRoutingExamples(state, channel.id)).toBeNull();
	channel.routingMemory.status = "stale";
	message.text = `${"Review this migration. ".repeat(55)}Check the final index.`;
	expect(currentRoutingExamples(state, channel.id)).toContain(
		"[excerpt omitted]",
	);
	expect(currentRoutingExamples(state, channel.id)).toContain('"agentId":"c"');
	message.text = "Review the migration.";
	channel.agentIds = ["a", "b"];
	expect(currentRoutingExamples(state, channel.id)).toBeNull();
	channel.agentIds.push("c");
	const current = mustExist(message.routing?.assignments[2]);
	current.projectIds = ["removed-project"];
	expect(currentRoutingExamples(state, channel.id)).toBeNull();
	current.projectIds = [];
	message.deletedAt = "2026-09-22T00:00:03Z";
	expect(currentRoutingExamples(state, channel.id)).toBeNull();
	delete message.deletedAt;
	messages.push({
		...message,
		id: "replacement",
		createdAt: "2026-09-22T00:00:04Z",
		routing: {
			source: "ai",
			agentIds: [],
			assignments: [],
			corrections: [],
			inferredProjectIds: [],
			reason: "Unconfirmed",
		},
		supersedesMessageId: message.id,
	});
	expect(currentRoutingExamples(state, channel.id)).toBeNull();
	expect(
		routingSummaryStillSupported(
			state,
			channel.id,
			"correction-2",
			"2026-09-22T00:00:02.500Z",
		),
	).toBe(false);
});

it("rejects an empty routing correction summary", () => {
	expect(() => parseRoutingMemoryCompaction('{"summary":""}')).toThrow(
		"routing memory summary is empty",
	);
});
