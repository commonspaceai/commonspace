import { describe, expect, it, vi } from "vitest";
import {
	releaseVerificationSteps,
	runReleaseVerification,
} from "../scripts/release-verification.mjs";

describe("release verification", () => {
	it("runs the complete release candidate sequence in order", async () => {
		const commands = [];
		const result = await runReleaseVerification({
			platform: "darwin",
			runStep: async ({ args }) => {
				commands.push(args);
				return 0;
			},
		});

		expect(result).toBe(0);
		expect(commands).toEqual(releaseVerificationSteps.map(({ args }) => args));
		expect(commands).toEqual([
			["install", "--frozen-lockfile"],
			["exec", "playwright", "install", "chromium"],
			["check"],
			["test:visual:built"],
			["test:messaging:built"],
			["test:e2e:built"],
			["verify:live:built"],
			["package:npm"],
			["verify:npm-package"],
		]);
	});

	it("stops at the first failed release step", async () => {
		const runStep = vi
			.fn()
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(19);

		await expect(
			runReleaseVerification({ platform: "darwin", runStep }),
		).resolves.toBe(19);
		expect(runStep).toHaveBeenCalledTimes(3);
	});

	it("rejects hosts without the reviewed visual baseline", async () => {
		const runStep = vi.fn();

		await expect(
			runReleaseVerification({ platform: "linux", runStep }),
		).rejects.toThrow("must run on macOS");
		expect(runStep).not.toHaveBeenCalled();
	});
});
