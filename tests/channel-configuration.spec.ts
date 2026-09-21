import { describe, expect, it } from "vitest";
import { applyMutation, createInitialState } from "../server/src/state.ts";

describe("atomic channel configuration", () => {
	it("updates every editable channel field in one revision", () => {
		const dependencies = {
			ids: () => "channel-id",
			now: () => "2026-09-01T00:00:00.000Z",
		};
		const initial = applyMutation(
			{
				...createInitialState(),
				agents: [
					{
						id: "backend",
						displayName: "Backend",
						adapter: "hermes",
						model: null,
						createdAt: "2026-09-01T00:00:00.000Z",
					},
				],
			},
			{ action: "create-channel", name: "engineering", agentIds: [] },
			dependencies,
		);

		const updated = applyMutation(
			initial,
			{
				action: "set-channel-configuration",
				channelId: "channel-id",
				agentIds: ["backend", "backend", ""],
				instructions: "  Use explicit assignments.  ",
				summary: "  Keep the release stable.  ",
				decisions: [" One mutation ", "One mutation"],
				openQuestions: [" Who verifies rollout? "],
			},
			{
				...dependencies,
				now: () => "2026-09-01T01:00:00.000Z",
			},
		);

		expect(updated.revision).toBe(initial.revision + 1);
		expect(updated.channels[0]).toMatchObject({
			agentIds: ["backend"],
			instructions: "Use explicit assignments.",
			memory: {
				summary: "Keep the release stable.",
				decisions: ["One mutation"],
				openQuestions: ["Who verifies rollout?"],
				updatedAt: "2026-09-01T01:00:00.000Z",
				origin: "user",
				status: "current",
			},
		});
		expect(updated.channels[0]).not.toHaveProperty("settings");
	});
});
