import process from "node:process";
import { URL } from "node:url";
import { storybookTestPlan } from "./storybook-test-policy.mjs";
import { nodeToolCommand, runTool } from "./tool-command.mjs";

const mode = process.argv[2];
const forwardedArguments = process.argv.slice(3);
if (forwardedArguments[0] === "--") forwardedArguments.shift();
const plan = storybookTestPlan(mode, forwardedArguments);
process.exitCode = await runTool(
	nodeToolCommand("vitest", "vitest", plan.vitestArguments),
	{
		cwd: new URL("../ui", import.meta.url),
		env: { ...process.env, ...plan.environment },
	},
);
