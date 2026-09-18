import { describe, expect, it, vi } from "vitest";
import { createCodexAdapter } from "../server/src/adapters/codex.ts";

const agent = {
	id: "codex",
	displayName: "Codex",
	adapter: "codex" as const,
	model: null,
	status: "stopped" as const,
};

describe("Codex runtime selection", () => {
	it("uses the bridge's compatible bundled runtime unless explicitly overridden", async () => {
		vi.stubEnv("CODEX_PATH", "/unrelated/old-codex");
		try {
			const launch = await createCodexAdapter({}).launch(
				agent,
				false,
				new AbortController().signal,
			);
			expect(launch.env?.CODEX_PATH).toBeUndefined();
			const custom = await createCodexAdapter({
				codexPath: "/chosen/codex",
			}).launch(agent, false, new AbortController().signal);
			expect(custom.env?.CODEX_PATH).toBe("/chosen/codex");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
