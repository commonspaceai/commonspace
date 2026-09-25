import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { McpAuthenticationStatus } from "@commonspace/shared";
import {
	inspectCommandCapabilities,
	parseOpenCodeMcpAuthList,
	unavailableGroup,
} from "./capability-inventory.js";
import {
	inspectMcpMetadata,
	inspectUserSkills,
	readOpenCodeOAuthServers,
} from "./capability-metadata.js";
import { readHarnessCommand } from "./discovery.js";
import type { AgentAdapterConfig, NativeAgentAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

async function readOpenCodeOAuthStates(
	cliPath: string,
	servers: ReadonlyMap<string, string>,
) {
	if (servers.size === 0) return new Map<string, McpAuthenticationStatus>();
	const root = await mkdtemp(join(tmpdir(), "commonspace-opencode-auth-"));
	try {
		await mkdir(join(root, "home"));
		const mcp = Object.fromEntries(
			[...servers].map(([name, url]) => [name, { type: "remote", url }]),
		);
		const { stdout } = await execFileAsync(
			cliPath,
			["mcp", "auth", "list", "--pure"],
			{
				cwd: root,
				env: {
					...process.env,
					HOME: join(root, "home"),
					XDG_CONFIG_HOME: join(root, "config"),
					XDG_CACHE_HOME: join(root, "cache"),
					XDG_STATE_HOME: join(root, "state"),
					XDG_DATA_HOME:
						process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
					OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp }),
					OPENCODE_DISABLE_PROJECT_CONFIG: "true",
					COLUMNS: "240",
					NO_COLOR: "1",
				},
				encoding: "utf8",
				maxBuffer: 1024 * 1024,
				timeout: 30_000,
			},
		);
		return parseOpenCodeMcpAuthList(stdout, servers);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function readNativeOpenCodeOAuthStates(
	cliPath: string,
	expectedUrls: ReadonlyMap<string, string>,
) {
	const { stdout } = await execFileAsync(
		cliPath,
		["mcp", "auth", "list", "--pure"],
		{
			cwd: tmpdir(),
			env: {
				...process.env,
				OPENCODE_DISABLE_PROJECT_CONFIG: "true",
				COLUMNS: "240",
				NO_COLOR: "1",
			},
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: 30_000,
		},
	);
	return parseOpenCodeMcpAuthList(stdout, expectedUrls);
}

function runOpenCodeMcpAuth(
	cliPath: string,
	serverName: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			cliPath,
			["mcp", "auth", serverName, "--pure"],
			{
				cwd: tmpdir(),
				env: {
					...process.env,
					OPENCODE_DISABLE_PROJECT_CONFIG: "true",
					COLUMNS: "240",
					NO_COLOR: "1",
				},
				encoding: "utf8",
				maxBuffer: 1024 * 1024,
				timeout: 180_000,
			},
			(error, stdout) => {
				if (error !== null) {
					reject(error);
					return;
				}
				if (!stdout.includes("Authentication successful!")) {
					reject(new Error("OpenCode MCP sign-in was not confirmed"));
					return;
				}
				resolve();
			},
		);
		let outputTail = "";
		let confirmed = false;
		child.stdout?.on("data", (chunk: Buffer | string) => {
			if (confirmed) return;
			outputTail = (outputTail + chunk.toString()).slice(-256);
			if (
				outputTail.includes("already has valid credentials. Re-authenticate?")
			) {
				child.stdin?.write("\r");
				confirmed = true;
			}
		});
	});
}

export function createOpenCodeAdapter(
	config: AgentAdapterConfig,
): NativeAgentAdapter {
	const cliPath = config.opencodePath ?? "opencode";
	const command = config.opencodeAcpCommand ?? cliPath;
	const args = [...(config.opencodeAcpArgs ?? ["acp"])];
	const configRoot = join(
		process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
		"opencode",
	);
	const configPaths = [
		join(configRoot, "config.json"),
		join(configRoot, "opencode.json"),
		join(configRoot, "opencode.jsonc"),
		join(homedir(), ".opencode", "opencode.json"),
		join(homedir(), ".opencode", "opencode.jsonc"),
	];
	const hasConfigOverride =
		process.env.OPENCODE_CONFIG !== undefined ||
		process.env.OPENCODE_CONFIG_DIR !== undefined ||
		process.env.OPENCODE_CONFIG_CONTENT !== undefined;
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
			const mcp = await inspectMcpMetadata(
				configPaths,
				"mcp",
				"OpenCode user MCP metadata (environment and project overrides excluded)",
			);
			if (mcp.status === "available" && hasConfigOverride)
				mcp.notice +=
					" Native OAuth status is not inspected with a configuration override.";
			if (
				mcp.status === "available" &&
				mcp.items.length > 0 &&
				!hasConfigOverride
			) {
				try {
					const { urls, hasTemplatedUrl } =
						await readOpenCodeOAuthServers(configPaths);
					const states = await readOpenCodeOAuthStates(cliPath, urls);
					mcp.items = mcp.items.map((item) => {
						const authentication = states.get(item.name);
						return authentication === undefined
							? item
							: { ...item, authentication };
					});
					mcp.notice +=
						" OAuth status comes from opencode mcp auth list; connection health is not checked.";
					if (hasTemplatedUrl)
						mcp.notice +=
							" OAuth status is unavailable for MCP URLs using variable substitution.";
				} catch {
					mcp.notice += " Native OAuth status could not be inspected.";
				}
			}
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
		async authenticateMcp(serverName) {
			if (hasConfigOverride) return false;
			const mcp = await inspectMcpMetadata(
				configPaths,
				"mcp",
				"OpenCode global MCP metadata",
			);
			if (
				mcp.status !== "available" ||
				!mcp.items.some((item) => item.name === serverName)
			)
				return false;
			const { urls: expectedUrls } =
				await readOpenCodeOAuthServers(configPaths);
			if (!expectedUrls.has(serverName)) return false;
			const status = (
				await readNativeOpenCodeOAuthStates(cliPath, expectedUrls)
			).get(serverName);
			if (
				status !== McpAuthenticationStatus.Authenticated &&
				status !== McpAuthenticationStatus.NotAuthenticated &&
				status !== McpAuthenticationStatus.Expired
			)
				return false;
			await runOpenCodeMcpAuth(cliPath, serverName);
			if (
				(await readNativeOpenCodeOAuthStates(cliPath, expectedUrls)).get(
					serverName,
				) !== McpAuthenticationStatus.Authenticated
			)
				throw new Error("OpenCode MCP sign-in was not confirmed");
			return true;
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
		sessionSettings() {
			return {};
		},
	};
}
