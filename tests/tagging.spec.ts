import { describe, expect, it } from "vitest";
import {
	hermesAgent,
	storyBootstrap,
} from "../ui/src/stories/story-fixtures.ts";
import { tagSuggestions } from "../ui/src/tagging.ts";

describe("composer tag suggestions", () => {
	it("keeps a bare agent mention focused on named agents", () => {
		const channel = storyBootstrap.state.channels[0];
		const suggestions = tagSuggestions("@", storyBootstrap, channel?.agentIds);

		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions.map((suggestion) => suggestion.token)).not.toContain(
			"@all",
		);
	});

	it("reveals the all-agents mention only after the full token is typed", () => {
		const channel = storyBootstrap.state.channels[0];
		const partial = tagSuggestions("@al", storyBootstrap, channel?.agentIds);
		const complete = tagSuggestions("@all", storyBootstrap, channel?.agentIds);

		expect(partial.map((suggestion) => suggestion.token)).not.toContain("@all");
		expect(complete.map((suggestion) => suggestion.token)).toContain("@all");
	});

	it("reserves a result for @all when named matches fill the menu", () => {
		const crowdedBootstrap = structuredClone(storyBootstrap);
		crowdedBootstrap.agents = Array.from({ length: 6 }, (_, index) => ({
			...hermesAgent,
			id: `agent-all-${String(index)}`,
			displayName: `All ${String(index)}`,
		}));
		const suggestions = tagSuggestions(
			"@all",
			crowdedBootstrap,
			crowdedBootstrap.agents.map((agent) => agent.id),
		);

		expect(suggestions).toHaveLength(6);
		expect(suggestions.at(-1)?.token).toBe("@all");
	});

	it("describes Thread membership and Thread-scoped broadcast honestly", () => {
		const thread = storyBootstrap.state.threads.find(
			(candidate) => candidate.id === "thread-review",
		);
		expect(thread).toBeDefined();
		if (thread === undefined) throw new Error("Missing Thread fixture.");
		const named = tagSuggestions(
			"@build",
			storyBootstrap,
			[hermesAgent.id],
			"thread",
		);
		const broadcast = tagSuggestions(
			"@all",
			storyBootstrap,
			thread.agentIds,
			"thread",
		);

		expect(named[0]).toMatchObject({
			token: "@build-smith",
			channelMembership: "outside",
			membershipScope: "thread",
		});
		expect(broadcast.at(-1)).toMatchObject({
			token: "@all",
			label: "All agents · sends to everyone in this thread",
			membershipScope: "thread",
		});
	});
});
