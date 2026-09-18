import { homedir } from "node:os";
import { join } from "node:path";
import { CommonspaceReasoning } from "@commonspace/shared";
import {
	inspectCommandCapabilities,
	unavailableGroup,
} from "./capability-inventory.js";
import {
	inspectMcpMetadata,
	inspectUserSkills,
} from "./capability-metadata.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

export function createOpenCodeAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.opencodePath ?? "opencode";
	const command = config.opencodeAcpCommand ?? cliPath;
	const args = [...(config.opencodeAcpArgs ?? ["acp"])];
	return {
		privatePaths: [
			cliPath,
			command,
			...args,
			...[
				process.env.XDG_CONFIG_HOME,
				process.env.XDG_DATA_HOME,
				process.env.XDG_CACHE_HOME,
				process.env.XDG_STATE_HOME,
				process.env.OPENCODE_CONFIG,
				process.env.OPENCODE_CONFIG_DIR,
			].filter((path): path is string => path !== undefined),
		],
		async inspectCapabilities() {
			const source = "OpenCode user configuration";
			const configRoot = join(
				process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
				"opencode",
			);
			const mcp = await inspectMcpMetadata(
				[
					join(configRoot, "config.json"),
					join(configRoot, "opencode.json"),
					join(configRoot, "opencode.jsonc"),
				],
				"mcp",
				"OpenCode global MCP metadata (environment and project overrides excluded)",
			);
			const skills = await inspectUserSkills(
				[
					join(configRoot, "skills"),
					join(homedir(), ".claude", "skills"),
					join(homedir(), ".agents", "skills"),
				],
				"OpenCode global skill directory metadata",
			);
			return inspectCommandCapabilities(
				cliPath,
				[],
				[
					unavailableGroup(
						"tools",
						source,
						"OpenCode has no bounded read-only effective tool listing.",
					),
					mcp,
					skills,
					unavailableGroup(
						"plugins",
						source,
						"OpenCode has no bounded read-only plugin listing.",
					),
					unavailableGroup(
						"memory",
						source,
						"OpenCode has no bounded read-only memory status listing.",
					),
					unavailableGroup(
						"agents",
						source,
						"OpenCode has no bounded read-only configured-agent listing.",
					),
				],
			);
		},
		async discover() {
			await readHarnessCommand(cliPath, ["--version"]);
			return [
				{
					id: "opencode",
					displayName: "OpenCode",
					adapter: "opencode",
					model: null,
					status: "stopped",
					description: "Installed OpenCode harness.",
				},
			];
		},
		launch(_agent, fullAccess) {
			const env: NodeJS.ProcessEnv = { ...process.env, NO_BROWSER: "1" };
			if (fullAccess)
				env.OPENCODE_PERMISSION = JSON.stringify({ "*": "allow" });
			return { command, args, env };
		},
		sessionSettings({ model, reasoning }) {
			const configOptions: Record<string, string> = {};
			if (model !== undefined) configOptions.model = model;
			if (reasoning !== undefined && reasoning !== CommonspaceReasoning.Native)
				configOptions.effort = reasoning;
			return { configOptions };
		},
	};
}
