import { nodeToolCommand, runTool } from "./tool-command.mjs";

const [flag, ...args] = process.argv.slice(2);
const allowedFlags = new Set([
	"COMMONSPACE_LIVE_ACP",
	"COMMONSPACE_LIVE_ACP_MCP",
	"COMMONSPACE_LIVE_NOTIFICATIONS",
	"COMMONSPACE_ROUTING_EVAL",
]);
if (!allowedFlags.has(flag))
	throw new Error(`Unknown verification flag: ${flag}`);
if (args[0] === "--") args.shift();
process.exitCode = await runTool(
	nodeToolCommand("vitest", "vitest", ["run", ...args]),
	{
		env: { ...process.env, [flag]: "1" },
	},
);
