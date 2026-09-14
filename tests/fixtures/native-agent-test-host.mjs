import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { startCommonspaceServer } from "../../server/src/index.ts";

const root = process.argv[2];
if (root === undefined)
	throw new Error("A temporary workspace root is required");

// Resolve through the pinned server dependency, including its platform-specific CLI.
// This process receives an isolated environment from the test, never a native login.
const require = createRequire(
	new URL("../../server/package.json", import.meta.url),
);
const adapter = process.argv[3];
const options = {
	root,
	port: 0,
	runBudgetSeconds: 30,
	logger: { info: () => undefined, warn: (message) => console.error(message) },
};
switch (adapter) {
	case "claude-code": {
		const { claudeCliPath } = await import(
			require.resolve("@agentclientprotocol/claude-agent-acp/dist/acp-agent.js")
		);
		options.claudeCodePath = await claudeCliPath();
		break;
	}
	case "gemini": {
		options.geminiPath =
			process.env.COMMONSPACE_TEST_GEMINI_PATH ??
			join(
				dirname(require.resolve("@google/gemini-cli/package.json")),
				"bundle/gemini.js",
			);
		break;
	}
	case "opencode": {
		const opencodeRequire = createRequire(
			require.resolve("opencode-ai/package.json"),
		);
		const platform =
			process.platform === "win32" ? "windows" : process.platform;
		const baseline = process.arch === "x64" ? "-baseline" : "";
		const binary = process.platform === "win32" ? "opencode.exe" : "opencode";
		options.opencodePath = opencodeRequire.resolve(
			`opencode-${platform}-${process.arch}${baseline}/bin/${binary}`,
		);
		break;
	}
	default:
		throw new Error("Unknown native integration adapter");
}
const server = await startCommonspaceServer(options);
process.send?.({ url: server.url });
await new Promise((resolve) => {
	process.once("SIGTERM", resolve);
	process.once("SIGINT", resolve);
	process.once("disconnect", resolve);
});
await server.close();
if (process.connected) process.disconnect();
