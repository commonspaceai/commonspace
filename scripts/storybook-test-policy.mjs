const baseEnvironment = {
	COMMONSPACE_STORYBOOK_TEST: "1",
	STORYBOOK_DISABLE_TELEMETRY: "1",
};

export function storybookMaxWorkers({ ci, availableWorkers }) {
	return Math.min(availableWorkers, ci ? 2 : 4);
}

export function storybookTestPlan(mode, forwardedArguments) {
	const configuredArguments = [
		"--config",
		"vitest.config.ts",
		...forwardedArguments,
	];
	switch (mode) {
		case "run":
			return {
				environment: { ...baseEnvironment },
				vitestArguments: ["run", ...configuredArguments],
			};
		case "smoke":
			return {
				environment: {
					...baseEnvironment,
					COMMONSPACE_STORYBOOK_TAG: "smoke",
				},
				vitestArguments: ["run", ...configuredArguments],
			};
		case "watch":
			return {
				environment: { ...baseEnvironment },
				vitestArguments: ["watch", ...configuredArguments],
			};
		default:
			throw new Error(`Unknown Storybook test mode: ${String(mode)}`);
	}
}
