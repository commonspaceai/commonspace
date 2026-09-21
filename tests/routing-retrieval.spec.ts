import type { CommonspaceMessage } from "@commonspace/shared";
import { describe, expect, it } from "vitest";
import {
	buildRetrievedRoutingContext,
	RoutingMessageIndex,
} from "../server/src/routing-retrieval.ts";
import { applyMutation, createInitialState } from "../server/src/state.ts";

function message(
	id: string,
	text: string,
	threadId = "auth",
): CommonspaceMessage {
	return {
		id,
		text,
		threadId,
		conversation: { kind: "channel", id: "engineering" },
		authorType: "user",
		authorId: "user",
		authorName: "Human",
		createdAt: "2026-09-17T00:00:00Z",
	};
}
describe("routing retrieval", () => {
	it("reserves space for retrieved evidence even with dense pins, notes, and recent history", () => {
		const state = applyMutation(createInitialState(), {
			action: "create-channel",
			name: "engineering",
			agentIds: [],
		});
		const channel = state.channels[0];
		if (channel === undefined) throw new Error("Test Channel is missing");
		channel.memory.summary = `${"history ".repeat(1200)}Refresh tokens need Backend ownership.`;
		state.pins = Array.from({ length: 12 }, (_, i) => ({
			id: String(i),
			kind: "note",
			note: "Long pinned background. ".repeat(150),
			scope: { kind: "channel", id: channel.id },
			createdAt: "now",
			removedAt: null,
		}));
		state.messages[`channel:${channel.id}`] = [
			message("old", "Refresh tokens belong to Backend."),
			...Array.from({ length: 12 }, (_, i) =>
				message(String(i), "Recent screen status. ".repeat(70)),
			),
		];
		state.pins.unshift({
			id: "source",
			kind: "message",
			messageId: "old",
			scope: { kind: "channel", id: channel.id },
			createdAt: "now",
			removedAt: null,
		});
		state.pins.unshift({
			id: "empty-note",
			kind: "note",
			note: "",
			scope: { kind: "channel", id: channel.id },
			createdAt: "now",
			removedAt: null,
		});
		const context = buildRetrievedRoutingContext({
			state,
			channelId: channel.id,
			query: "refresh tokens",
			index: new RoutingMessageIndex(),
			thread: undefined,
			scopeThreadId: undefined,
		});
		expect(context.some((item) => item.includes("Retrieved message old"))).toBe(
			true,
		);
		expect(context.some((item) => item.includes("Pinned message old"))).toBe(
			true,
		);
		expect(
			context.some((item) => item.startsWith("Pinned note empty-note")),
		).toBe(false);
		expect(
			context.find((item) => item.startsWith("Channel context")),
		).toContain("Backend ownership");
		expect(Buffer.byteLength(context.join(""))).toBeLessThanOrEqual(14_000);
	});
	it("finds relevant older evidence and ranks rare terms above generic chatter", () => {
		const index = new RoutingMessageIndex();
		index.sync([
			message(
				"constraint",
				"Expired tokens belong to Backend. Preserve the token refresh protocol.",
			),
			...Array.from({ length: 30 }, (_, i) =>
				message(String(i), "We are reviewing the screens today."),
			),
		]);
		expect(
			index.search("fix expired tokens", "auth").map((p) => p.messageId),
		).toContain("constraint");
		expect(index.search("expired tokens screens", "auth")[0]?.messageId).toBe(
			"constraint",
		);
	});
	it("filters evidence to the requested Thread and removes deleted or edited source text", () => {
		const index = new RoutingMessageIndex();
		const first = message("old", "refresh tokens");
		index.sync([first, message("other", "refresh tokens", "billing")]);
		expect(
			index.search("refresh tokens", "auth").map((p) => p.messageId),
		).toEqual(["old"]);
		index.sync([
			{ ...first, text: "screens only" },
			{ ...message("deleted", "refresh tokens"), deletedAt: "now" },
		]);
		expect(index.search("refresh tokens", "auth")).toEqual([]);
	});
	it("chunks long messages so a constraint after the first thousand characters stays searchable", () => {
		const index = new RoutingMessageIndex();
		index.sync([
			message(
				"long",
				`${"status ".repeat(600)}Do not change the refresh-token protocol.`,
			),
		]);
		expect(index.search("refresh-token protocol", "auth")[0]?.text).toContain(
			"Do not change",
		);
	});
});
