import { describe, expect, it } from "vitest";
import {
	agentAvatarStyle,
	agentAvatarText,
} from "../ui/src/design-system/AgentAvatar.tsx";

describe("agent avatar identity", () => {
	it("prefers the configured emoji and falls back to the display name", () => {
		expect(agentAvatarText({ displayName: "Atlas", avatarEmoji: "🧭" })).toBe(
			"🧭",
		);
		expect(agentAvatarText({ displayName: "Atlas", avatarEmoji: "" })).toBe(
			"A",
		);
		expect(agentAvatarText({ displayName: "" })).toBe("?");
	});

	it("uses the configured color as the exact avatar background", () => {
		expect(agentAvatarStyle("#ff00a2")).toEqual({
			backgroundColor: "#ff00a2",
		});
		expect(agentAvatarStyle(undefined)).toBeUndefined();
	});
});
