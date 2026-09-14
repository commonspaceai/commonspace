import process from "node:process";
import { URL } from "node:url";
import { nodeToolCommand, runTool } from "./tool-command.mjs";

const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === "--") forwardedArguments.shift();
const uiRoot = new URL("../ui/", import.meta.url);
const buildExitCode = await runTool(
	nodeToolCommand(
		"storybook",
		"storybook",
		["build", "--disable-telemetry"],
		new URL("package.json", uiRoot),
	),
	{ cwd: uiRoot },
);
if (buildExitCode !== 0) process.exitCode = buildExitCode;
else {
	process.exitCode = await runTool(
		nodeToolCommand("@playwright/test", "playwright", [
			"test",
			"--config",
			"playwright.visual.config.ts",
			...forwardedArguments,
		]),
		{ cwd: new URL("..", import.meta.url) },
	);
}
