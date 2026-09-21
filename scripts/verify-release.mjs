import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { runReleaseVerification } from "./release-verification.mjs";
import { pnpmCommand, runTool } from "./tool-command.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

process.exitCode = await runReleaseVerification({
	platform: process.platform,
	runStep: async ({ label, args }) => {
		process.stdout.write(`\n==> ${label}\n`);
		return runTool(pnpmCommand(args), { cwd: repoRoot });
	},
});
