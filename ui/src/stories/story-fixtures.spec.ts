import { expect, it } from "vitest";
import { createStoryStore, storyBootstrap } from "./story-fixtures.ts";

it("preserves an explicitly absent active Project", () => {
	const store = createStoryStore(storyBootstrap, { activeProjectId: null });

	expect(store.getSnapshot().activeProjectId).toBeNull();
});
