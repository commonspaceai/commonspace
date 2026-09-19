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

	it("turns the configured accent into the avatar appearance", () => {
		expect(agentAvatarStyle("#7c3aed")).toEqual({
			backgroundColor: "color-mix(in srgb, #7c3aed 16%, var(--background))",
			color: "color-mix(in srgb, #7c3aed 45%, var(--foreground))",
		});
		expect(agentAvatarStyle(undefined)).toBeUndefined();
	});
});
