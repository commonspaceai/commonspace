import { homedir } from "node:os";
import { join } from "node:path";
import { unavailableGroup } from "./capability-inventory.js";
import {
	inspectMcpMetadata,
	inspectResourceDirectories,
	inspectUserSkills,
} from "./capability-metadata.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

/** Compatibility baseline only; native late-history replay remains an upstream limitation. */
export function assertGeminiAcpVersion(output: string): void {
	const version = output.trim().replace(/^v/u, "");
	if (/^0\.(39|4[0-3])\.(0|[1-9]\d*)$/u.test(version) && version !== "0.39.0")
		return;
	throw new Error(
		"Gemini CLI is outside the supported ACP version range: stable >=0.39.1 and <0.44.0. The tested baseline is 0.43.0; native history replay remains an upstream limitation. Newer versions require revalidation.",
	);
}

export function createGeminiAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.geminiPath ?? "gemini";
	const command = config.geminiAcpCommand ?? cliPath;
	const args = [...(config.geminiAcpArgs ?? ["--acp"])];
	return {
		privatePaths: [
			cliPath,
			command,
			...args,
			...[
				process.env.GEMINI_CLI_HOME,
				process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,
				process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH,
			].filter((path): path is string => path !== undefined),
		],
		inspectCapabilities() {
			const source = "Gemini CLI user configuration";
			const root = join(process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini");
			return Promise.all([
				unavailableGroup(
					"tools",
					source,
					"This verified Gemini CLI version has no bounded read-only tool listing.",
				),
				inspectMcpMetadata(
					[join(root, "settings.json")],
					"mcpServers",
					"Gemini CLI user settings metadata",
				),
				inspectUserSkills(
					[join(root, "skills")],
					"Gemini CLI user skills metadata",
				),
				inspectResourceDirectories([join(root, "extensions")], {
					id: "plugins",
					marker: "gemini-extension.json",
					source: "Gemini CLI user extension directory metadata",
					notice:
						"User extension folders containing gemini-extension.json. Linked folders are included; runtime loading and enabled state are not verified. Contents and host paths remain private.",
				}),
				unavailableGroup(
					"memory",
					source,
					"Memory contents and host paths remain private.",
				),
				unavailableGroup(
					"agents",
					source,
					"Gemini CLI does not expose a configured-agent inventory.",
				),
			]);
		},
		async discover() {
			assertGeminiAcpVersion(await readHarnessCommand(cliPath, ["--version"]));
			return [
				{
					id: "gemini",
					displayName: "Gemini CLI",
					adapter: "gemini",
					model: null,
					status: "stopped",
					description: "Installed Gemini CLI harness.",
				},
			];
		},
		async launch(_agent, _fullAccess, signal) {
			// Recheck at launch in case an installed CLI was upgraded after discovery.
			assertGeminiAcpVersion(
				await readHarnessCommand(cliPath, ["--version"], signal),
			);
			return {
				command,
				args,
				env: { ...process.env, NO_BROWSER: "1" },
				// The ACP executable can differ from discovery or change after preflight.
				validateInitialization(response) {
					assertGeminiAcpVersion(response.agentInfo?.version ?? "");
				},
			};
		},
		sessionSettings({ fullAccess, model }) {
			const settings: ReturnType<NativeAgentAdapter["sessionSettings"]> = {
				modeId: fullAccess ? "yolo" : "default",
			};
			if (model !== undefined) settings.modelId = model;
			return settings;
		},
	};
}
