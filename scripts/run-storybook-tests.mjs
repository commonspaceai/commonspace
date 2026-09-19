import process from "node:process";
import { URL } from "node:url";
import { nodeToolCommand, runTool } from "./tool-command.mjs";

const mode = process.argv[2];
if (mode !== "run" && mode !== "smoke")
	throw new Error(
		`Expected Storybook test mode run or smoke, received ${mode}`,
	);

const forwardedArguments = process.argv.slice(3);
if (forwardedArguments[0] === "--") forwardedArguments.shift();
const env = {
	...process.env,
	COMMONSPACE_STORYBOOK_TEST: "1",
	STORYBOOK_DISABLE_TELEMETRY: "1",
};
if (mode === "smoke") env.COMMONSPACE_STORYBOOK_TAG = "smoke";
process.exitCode = await runTool(
	nodeToolCommand("vitest", "vitest", [
		"run",
		"--config",
		"vitest.config.ts",
		...forwardedArguments,
	]),
	{
		cwd: new URL("../ui", import.meta.url),
		env,
	},
);
