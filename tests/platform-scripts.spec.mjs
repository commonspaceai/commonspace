import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	nodeToolCommand,
	npmCommand,
	pnpmCommand,
	runTool,
} from "../scripts/tool-command.mjs";
import {
	isolatedRuntimeEnv,
	waitForRuntimeExit,
} from "../scripts/verify-npm-package.mjs";

const run = promisify(execFile);
const roots = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("portable validation commands", () => {
	it("observes graceful process exit after the parent disconnects IPC", async () => {
		const child = spawn(
			process.execPath,
			[
				"-e",
				'process.on("message", () => {}); process.on("disconnect", () => {}); process.stdout.write("ready");',
			],
			{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		const stopped = waitForRuntimeExit(child);
		let deadline;
		try {
			await once(child.stdout, "data");
			child.disconnect();
			await expect(
				Promise.race([
					stopped,
					new Promise((resolve) => {
						deadline = setTimeout(
							() => resolve("exit was not observed"),
							2_000,
						);
					}),
				]),
			).resolves.toBe(0);
		} finally {
			clearTimeout(deadline);
			if (child.exitCode === null) child.kill("SIGKILL");
		}
	});

	it("propagates a tool failure to the caller", async () => {
		await expect(
			runTool({ command: process.execPath, args: ["-e", "process.exit(17)"] }),
		).resolves.toBe(17);
	});

	it("runs a package bin directly with literal spaced and shell-special arguments", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace tools & spaces "));
		roots.push(root);
		const packageRoot = join(root, "node_modules", "fixture-tool");
		await mkdir(packageRoot, { recursive: true });
		await writeFile(
			join(packageRoot, "package.json"),
			JSON.stringify({ bin: { fixture: "cli.cjs" } }),
		);
		await writeFile(
			join(packageRoot, "cli.cjs"),
			"process.stdout.write(JSON.stringify(process.argv.slice(2)))",
		);
		const args = [
			"two words",
			"a&b",
			"%PATH%",
			"$(echo unexpected)",
			'quote"here',
		];
		const command = nodeToolCommand(
			"fixture-tool",
			"fixture",
			args,
			pathToFileURL(join(root, "runner.mjs")),
		);
		const result = await run(command.command, command.args, { cwd: root });
		expect(JSON.parse(result.stdout)).toEqual(args);
	});
});

describe("npm command and runtime isolation", () => {
	it("runs pnpm through its JavaScript entry on Windows", () => {
		const command = pnpmCommand(["check", "two words", "a&b"], {
			platform: "win32",
			execPath: "C:\\Program Files\\nodejs\\node.exe",
			env: { npm_execpath: "C:\\tools\\pnpm.cjs" },
		});
		expect(command).toEqual({
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: ["C:\\tools\\pnpm.cjs", "check", "two words", "a&b"],
		});
	});

	it("fails clearly when a Windows pnpm JavaScript entry is unavailable", () => {
		expect(() =>
			pnpmCommand(["check"], {
				platform: "win32",
				execPath: "C:\\node\\node.exe",
				env: {},
			}),
		).toThrow("pnpm JavaScript entry");
	});

	it("resolves npm's JavaScript entry on Windows without executing a cmd shim", () => {
		const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
		const command = npmCommand(["pack", "C:\\package & spaces"], {
			platform: "win32",
			execPath: "C:\\Program Files\\nodejs\\node.exe",
			env: { npm_execpath: "C:\\tools\\pnpm.cjs", Path: "C:\\tools" },
			exists: (path) => path === cli,
		});
		expect(command).toEqual({
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: [cli, "pack", "C:\\package & spaces"],
		});
	});

	it("finds npm beside a PATH entry and fails clearly if npm is unavailable", () => {
		const cli = "D:\\npm tools\\node_modules\\npm\\bin\\npm-cli.js";
		const options = {
			platform: "win32",
			execPath: "C:\\node\\node.exe",
			env: { Path: '"D:\\npm tools";C:\\Windows' },
			exists: (path) => path === cli,
		};
		expect(npmCommand(["--version"], options).args).toEqual([cli, "--version"]);
		expect(() => npmCommand([], { ...options, exists: () => false })).toThrow(
			"npm-cli.js",
		);
	});

	it("preserves Windows system variables while isolating runtime homes and credentials", () => {
		const home = join(tmpdir(), "isolated home");
		const env = isolatedRuntimeEnv(home, {
			SystemRoot: "C:\\Windows",
			Path: "C:\\node",
			TEMP: "C:\\temp",
			USERPROFILE: "private profile",
			APPDATA: "private appdata",
			NODE_OPTIONS: "--require private-script",
			MODEL_PROVIDER_TOKEN: "private key",
		});
		expect(env).toMatchObject({
			SystemRoot: "C:\\Windows",
			Path: "C:\\node",
			TEMP: "C:\\temp",
			HOME: home,
			USERPROFILE: home,
			APPDATA: join(home, "AppData", "Roaming"),
			LOCALAPPDATA: join(home, "AppData", "Local"),
		});
		expect(env).not.toHaveProperty("MODEL_PROVIDER_TOKEN");
		expect(env).not.toHaveProperty("NODE_OPTIONS");
		expect(JSON.stringify(env)).not.toContain("private");
	});
});
