import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { CommonspaceReasoning } from "@commonspace/shared";
import {
	inspectCommandCapabilities,
	parseNamedJsonInventory,
	unavailableGroup,
} from "./capability-inventory.js";
import { inspectUserSkills } from "./capability-metadata.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

const moduleRequire = createRequire(import.meta.url);

export function createCodexAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.codexPath ?? "codex";
	const command = config.codexAcpCommand ?? process.execPath;
	const args =
		config.codexAcpArgs === undefined
			? config.codexAcpCommand === undefined
				? [moduleRequire.resolve("@agentclientprotocol/codex-acp")]
				: []
			: [...config.codexAcpArgs];
	return {
		privatePaths: [cliPath, command, ...args],
		async inspectCapabilities() {
			const source = "Codex user configuration";
			const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
			const skills = await inspectUserSkills(
				[
					join(codexHome, "skills"),
					join(codexHome, "skills", ".system"),
					join(homedir(), ".agents", "skills"),
				],
				"Codex user skill directory metadata",
			);
			return inspectCommandCapabilities(
				cliPath,
				[
					{
						id: "mcp",
						args: ["mcp", "list", "--json"],
						source: "codex mcp list --json",
						notice:
							"Server names and enabled state from the native Codex user configuration.",
						parse: parseNamedJsonInventory,
					},
					{
						id: "plugins",
						args: ["plugin", "list", "--json"],
						source: "codex plugin list --json",
						notice:
							"Plugin names and installation state from configured marketplace snapshots.",
						parse: parseNamedJsonInventory,
					},
				],
				[
					unavailableGroup(
						"tools",
						source,
						"Codex has no read-only command for its effective tool inventory.",
					),
					skills,
					unavailableGroup(
						"memory",
						source,
						"Memory contents and host paths remain private.",
					),
					unavailableGroup(
						"agents",
						source,
						"Codex has no read-only native command for configured agents.",
					),
				],
			);
		},
		async discover() {
			await readHarnessCommand(cliPath, ["--version"]);
			return [
				{
					id: "codex",
					displayName: "Codex",
					adapter: "codex",
					model: null,
					status: "stopped",
					description: "Installed Codex harness.",
				},
			];
		},
		launch(_agent, fullAccess) {
			return {
				command,
				args,
				env: {
					...process.env,
					// Let the bridge use its compatible bundled CLI by default.
					CODEX_PATH: config.codexPath,
					INITIAL_AGENT_MODE: fullAccess ? "agent-full-access" : "agent",
					NO_BROWSER: "1",
				},
			};
		},
		sessionSettings({ fullAccess, model, reasoning }) {
			const configOptions: Record<string, string> = {};
			if (model !== undefined) configOptions.model = model;
			if (
				reasoning !== undefined &&
				reasoning !== CommonspaceReasoning.Native
			) {
				configOptions.reasoning_effort = reasoning;
			}
			return {
				modeId: fullAccess ? "agent-full-access" : "agent",
				configOptions,
			};
		},
	};
}
