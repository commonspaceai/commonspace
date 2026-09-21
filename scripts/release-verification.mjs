import process from "node:process";

export const releaseVerificationSteps = Object.freeze(
	[
		["Install the locked dependency graph", ["install", "--frozen-lockfile"]],
		[
			"Install the managed Chromium browser",
			["exec", "playwright", "install", "chromium"],
		],
		["Run repository checks and production builds", ["check"]],
		["Verify reviewed macOS visual baselines", ["test:visual:built"]],
		["Verify Storybook messaging flows", ["test:messaging:built"]],
		["Verify the built application browser flows", ["test:e2e:built"]],
		["Verify the built live application flow", ["verify:live:built"]],
		["Build the npm candidate", ["package:npm"]],
		["Verify the npm candidate in a clean install", ["verify:npm-package"]],
	].map(([label, args]) => Object.freeze({ label, args: Object.freeze(args) })),
);

export async function runReleaseVerification({
	platform = process.platform,
	runStep,
}) {
	if (platform !== "darwin") {
		throw new Error(
			"pnpm verify:release must run on macOS because the reviewed visual baselines are Darwin-specific.",
		);
	}
	if (typeof runStep !== "function") {
		throw new TypeError("runReleaseVerification requires a runStep function");
	}

	for (const step of releaseVerificationSteps) {
		const exitCode = await runStep(step);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
}
