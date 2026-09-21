import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { CommonspaceReasoning } from "@commonspace/shared";
import {
	inspectCommandCapabilities,
	parseNamedJsonInventory,
	unavailableGroup,
} from "./capability-inventory.js";
import {
	inspectMcpMetadata,
	inspectResourceDirectories,
	inspectUserSkills,
} from "./capability-metadata.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

const moduleRequire = createRequire(import.meta.url);

async function inspectClaudeCodeCapabilities(cliPath: string) {
	const source = "Claude Code user configuration";
	const configRoot =
		process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
	const legacyConfig = join(configRoot, ".config.json");
	const [mcp, skills, agents] = await Promise.all([
		inspectMcpMetadata(
			[
				existsSync(legacyConfig)
					? legacyConfig
					: join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json"),
			],
			"mcpServers",
			"Claude Code user MCP metadata",
		),
		inspectUserSkills(
			[join(configRoot, "skills")],
			"Claude Code user skill directory metadata",
		),
		inspectResourceDirectories([join(configRoot, "agents")], {
			id: "agents",
			extension: ".md",
			source: "Claude Code user agent definition filenames",
			notice:
				"User .md agent definition filenames only; prompts, contents, and session inventory remain private. Project, plugin, and built-in agents are excluded; runtime loading is not verified.",
		}),
	]);
	return inspectCommandCapabilities(
		cliPath,
		[
			{
				id: "plugins",
				args: ["plugin", "list", "--json"],
				source: "claude plugin list --json",
				notice: "Installed plugin names and native state from Claude Code.",
				parse: parseNamedJsonInventory,
			},
		],
		[
			unavailableGroup(
				"tools",
				source,
				"Claude Code does not expose the effective tool inventory without starting a session.",
			),
			mcp,
			skills,
			agents,
			unavailableGroup(
				"memory",
				source,
				"Memory contents and host paths remain private.",
			),
		],
	);
}

export function createClaudeCodeAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.claudeCodePath ?? "claude";
	const command = config.claudeCodeAcpCommand ?? process.execPath;
	const args =
		config.claudeCodeAcpArgs === undefined
			? config.claudeCodeAcpCommand === undefined
				? [
						moduleRequire.resolve(
							"@agentclientprotocol/claude-agent-acp/dist/index.js",
						),
					]
				: []
			: [...config.claudeCodeAcpArgs];
	return {
		privatePaths: [cliPath, command, ...args],
		inspectCapabilities() {
			return inspectClaudeCodeCapabilities(cliPath);
		},
		async discover() {
			await readHarnessCommand(cliPath, ["--version"]);
			return [
				{
					id: "claude-code",
					displayName: "Claude Code",
					adapter: "claude-code",
					model: null,
					status: "stopped",
					description: "Installed Claude Code harness.",
				},
			];
		},
		launch() {
			return {
				command,
				args,
				env: {
					...process.env,
					CLAUDE_CODE_EXECUTABLE: cliPath,
					NO_BROWSER: "1",
				},
			};
		},
		sessionSettings({ fullAccess, model, reasoning }) {
			if (
				reasoning !== undefined &&
				reasoning !== CommonspaceReasoning.Native &&
				!["low", "medium", "high", "max"].includes(reasoning)
			)
				throw new Error(
					"Claude Code does not support this reasoning override. Select a supported value or Use native session settings.",
				);
			const configOptions: Record<string, string> = {};
			if (model !== undefined) configOptions.model = model;
			// Only map native effort levels; unsupported workspace choices leave Claude's default intact.
			if (
				reasoning === CommonspaceReasoning.Low ||
				reasoning === CommonspaceReasoning.Medium ||
				reasoning === CommonspaceReasoning.High ||
				reasoning === CommonspaceReasoning.Max
			)
				configOptions.effort = reasoning;
			return {
				modeId: fullAccess ? "bypassPermissions" : "default",
				configOptions,
			};
		},
	};
}
