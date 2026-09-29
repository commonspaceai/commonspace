import { expect, it } from "vitest";
import { storybookMaxWorkers } from "../scripts/storybook-test-policy.mjs";

it("bounds browser workers by both the host and the execution environment", () => {
	expect(storybookMaxWorkers({ ci: false, availableWorkers: 8 })).toBe(4);
	expect(storybookMaxWorkers({ ci: false, availableWorkers: 2 })).toBe(2);
	expect(storybookMaxWorkers({ ci: true, availableWorkers: 8 })).toBe(2);
	expect(storybookMaxWorkers({ ci: true, availableWorkers: 1 })).toBe(1);
});
