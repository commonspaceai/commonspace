import { describe, expect, it } from "vitest";
import {
	storybookMaxWorkers,
	storybookTestPlan,
} from "../scripts/storybook-test-policy.mjs";

describe("Storybook test policy", () => {
	it("keeps watch mode persistent while full and smoke checks remain one-shot", () => {
		expect(storybookTestPlan("watch", ["Conversation"])).toEqual({
			environment: {
				COMMONSPACE_STORYBOOK_TEST: "1",
				STORYBOOK_DISABLE_TELEMETRY: "1",
			},
			vitestArguments: [
				"watch",
				"--config",
				"vitest.config.ts",
				"Conversation",
			],
		});
		expect(storybookTestPlan("run", [])).toMatchObject({
			vitestArguments: ["run", "--config", "vitest.config.ts"],
		});
		expect(storybookTestPlan("smoke", [])).toEqual({
			environment: {
				COMMONSPACE_STORYBOOK_TAG: "smoke",
				COMMONSPACE_STORYBOOK_TEST: "1",
				STORYBOOK_DISABLE_TELEMETRY: "1",
			},
			vitestArguments: ["run", "--config", "vitest.config.ts"],
		});
	});

	it("rejects unknown execution modes", () => {
		expect(() => storybookTestPlan("turbo", [])).toThrow(
			"Unknown Storybook test mode: turbo",
		);
	});

	it("bounds browser workers by both the host and the execution environment", () => {
		expect(storybookMaxWorkers({ ci: false, availableWorkers: 8 })).toBe(4);
		expect(storybookMaxWorkers({ ci: false, availableWorkers: 2 })).toBe(2);
		expect(storybookMaxWorkers({ ci: true, availableWorkers: 8 })).toBe(2);
		expect(storybookMaxWorkers({ ci: true, availableWorkers: 1 })).toBe(1);
	});
});
