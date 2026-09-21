import {
	parseHermesProfileDescription,
	parseHermesProfileList,
} from "../relay.js";
import { unavailableGroup } from "./capability-inventory.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

// Hermes ACP launches with this documented, curated surface. These names are
// metadata only: inspection must not initialize Hermes or load provider hooks.
const HERMES_ACP_TOOLS = [
	"web_search",
	"web_extract",
	"terminal",
	"process",
	"read_file",
	"write_file",
	"patch",
	"search_files",
	"vision_analyze",
	"skills_list",
	"skill_view",
	"skill_manage",
	"browser_navigate",
	"browser_snapshot",
	"browser_click",
	"browser_type",
	"browser_scroll",
	"browser_back",
	"browser_press",
	"browser_get_images",
	"browser_vision",
	"browser_console",
	"browser_cdp",
	"browser_dialog",
	"browser_exec",
	"todo",
	"memory",
	"session_search",
	"execute_code",
	"delegate_task",
] as const;

export function createHermesAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.hermesPath ?? "hermes";
	const command = config.hermesAcpCommand ?? cliPath;
	const args = [...(config.hermesAcpArgs ?? [])];
	return {
		privatePaths: [cliPath, command, ...args],
		async inspectCapabilities() {
			return (
				["tools", "mcp", "skills", "plugins", "memory", "agents"] as const
			).map((id) => {
				if (id === "tools")
					return {
						id,
						status: "available" as const,
						source: "Hermes ACP default surface",
						notice:
							"Tools declared by the supported Hermes ACP integration. Local Hermes version, configuration, dependencies, and session policy determine runtime availability; no native hooks were executed.",
						items: HERMES_ACP_TOOLS.map((name) => ({
							name,
							status: "configured" as const,
						})),
					};
				return unavailableGroup(
					id,
					"Hermes native configuration",
					"Native inventory commands can initialize files or execute provider hooks. Read-only inspection is unavailable; native configuration and memory remain untouched.",
				);
			});
		},
		async discover() {
			const profiles = parseHermesProfileList(
				await readHarnessCommand(cliPath, ["profile", "list"]),
			);
			return Promise.all(
				profiles.map(async (profile) => {
					try {
						const description = parseHermesProfileDescription(
							await readHarnessCommand(cliPath, [
								"profile",
								"describe",
								profile.id,
							]),
						);
						return description === undefined
							? profile
							: { ...profile, description };
					} catch {
						// Optional descriptions do not invalidate a discovered native profile.
						return profile;
					}
				}),
			);
		},
		launch(agent, fullAccess) {
			return {
				command,
				args: [
					...args,
					...(agent.id === "hermes" ? [] : ["-p", agent.id]),
					"acp",
					...(fullAccess ? ["--accept-hooks"] : []),
				],
				env: { ...process.env, NO_BROWSER: "1" },
			};
		},
		sessionSettings({ fullAccess }) {
			return { modeId: fullAccess ? "dont_ask" : "accept_edits" };
		},
	};
}
