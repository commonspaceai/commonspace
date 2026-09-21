import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, win32 } from "node:path";

// Launch JavaScript tools with Node, including on hosts where package managers
// expose .cmd shims that cannot be passed directly to spawn/execFile.
export function nodeToolCommand(
	packageName,
	binName,
	args,
	from = import.meta.url,
) {
	const require = createRequire(from);
	const manifestPath = require.resolve(`${packageName}/package.json`);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const bin =
		typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
	if (typeof bin !== "string")
		throw new Error(`Missing ${binName} bin in ${packageName}`);
	return {
		command: process.execPath,
		args: [join(dirname(manifestPath), bin), ...args],
	};
}

export function npmCommand(args, options = {}) {
	const {
		platform = process.platform,
		execPath = process.execPath,
		env = process.env,
		exists = existsSync,
	} = options;
	if (platform !== "win32") return { command: "npm", args };
	const pathValue =
		Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ??
		"";
	const directories = [
		win32.dirname(execPath),
		...pathValue
			.split(";")
			.filter(Boolean)
			.map((entry) => entry.replace(/^"|"$/gu, "")),
	];
	const candidates = directories.map((directory) =>
		win32.join(directory, "node_modules/npm/bin/npm-cli.js"),
	);
	if (env.npm_execpath && win32.basename(env.npm_execpath) === "npm-cli.js")
		candidates.unshift(env.npm_execpath);
	const cli = candidates.find((candidate) => exists(candidate));
	if (cli === undefined)
		throw new Error(
			"Cannot locate npm-cli.js. Install Node.js with npm and put its installation directory on PATH.",
		);
	return { command: execPath, args: [cli, ...args] };
}

export function pnpmCommand(args, options = {}) {
	const {
		platform = process.platform,
		execPath = process.execPath,
		env = process.env,
	} = options;
	if (typeof env.npm_execpath === "string" && env.npm_execpath !== "") {
		return { command: execPath, args: [env.npm_execpath, ...args] };
	}
	if (platform !== "win32") return { command: "pnpm", args };
	throw new Error(
		"Cannot locate pnpm JavaScript entry. Run this command through pnpm.",
	);
}

export function runTool(command, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command.command, command.args, {
			...options,
			shell: false,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code) => resolve(code ?? 1));
	});
}
