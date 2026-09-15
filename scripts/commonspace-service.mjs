#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
	access,
	chmod,
	lstat,
	mkdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { URL } from "node:url";

export const COMMONSPACE_SERVICE_LABEL = "dev.commonspace.service";
export const DEFAULT_COMMONSPACE_SOURCE =
	"git@github.com:commonspaceai/commonspace.git";

const DEFAULT_PORT = 3100;

function writeLine(message) {
	process.stdout.write(`${message}\n`);
}

function writeError(message) {
	process.stderr.write(`${message}\n`);
}

function xml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function defaultUid() {
	const uid = process.getuid?.();
	if (!Number.isSafeInteger(uid) || uid < 0)
		throw new Error(
			"Commonspace service installation requires a local owner UID",
		);
	return uid;
}

export function serviceLayout(options = {}) {
	const home = resolve(options.home ?? homedir());
	const uid = options.uid ?? defaultUid();
	const appRoot = resolve(
		options.appRoot ??
			join(home, "Library", "Application Support", "Commonspace"),
	);
	if (
		appRoot === home ||
		!basename(appRoot).toLocaleLowerCase().includes("commonspace")
	) {
		throw new Error(
			"Commonspace installation root must be a dedicated Commonspace directory",
		);
	}
	const current = join(appRoot, "current");
	return {
		home,
		uid,
		appRoot,
		current,
		previous: join(appRoot, "previous"),
		releaseMetadata: join(current, "commonspace-release.json"),
		launchAgentPath: join(
			home,
			"Library",
			"LaunchAgents",
			`${COMMONSPACE_SERVICE_LABEL}.plist`,
		),
		logsRoot: join(home, "Library", "Logs", "Commonspace"),
		binPath: join(home, ".local", "bin", "commonspace"),
		stateRoot: join(home, ".commonspace"),
		domain: `gui/${String(uid)}`,
		target: `gui/${String(uid)}/${COMMONSPACE_SERVICE_LABEL}`,
		url: `http://127.0.0.1:${String(DEFAULT_PORT)}`,
	};
}

export function launchAgentPlist(layout, dependencies = {}) {
	const nodePath = dependencies.nodePath ?? process.execPath;
	const pathEnvironment =
		dependencies.pathEnvironment ??
		process.env.PATH ??
		"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	const values = {
		nodePath,
		serverPath: join(layout.current, "server", "dist", "index.js"),
		uiRoot: join(layout.current, "ui", "dist"),
		stdout: join(layout.logsRoot, "service.log"),
		stderr: join(layout.logsRoot, "service.error.log"),
	};
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(COMMONSPACE_SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(values.nodePath)}</string><string>${xml(values.serverPath)}</string></array>
  <key>WorkingDirectory</key><string>${xml(layout.current)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COMMONSPACE_HOME</key><string>${xml(layout.stateRoot)}</string>
    <key>COMMONSPACE_PORT</key><string>${String(DEFAULT_PORT)}</string>
    <key>COMMONSPACE_UI_ROOT</key><string>${xml(values.uiRoot)}</string>
    <key>HOME</key><string>${xml(layout.home)}</string>
    <key>PATH</key><string>${xml(pathEnvironment)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(values.stdout)}</string>
  <key>StandardErrorPath</key><string>${xml(values.stderr)}</string>
</dict>
</plist>
`;
}

async function defaultRun(command, args, options = {}) {
	return new Promise((resolveRun) => {
		execFile(
			command,
			args,
			{
				cwd: options.cwd,
				env: process.env,
				maxBuffer: 4 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				resolveRun({
					exitCode:
						typeof error?.code === "number"
							? error.code
							: error === null || error === undefined
								? 0
								: 1,
					stdout,
					stderr: error !== null && stderr === "" ? error.message : stderr,
				});
			},
		);
	});
}

export async function serviceHealth(url, layout, run = defaultRun) {
	try {
		const service = await run("/bin/launchctl", ["print", layout.target]);
		const pid = /^\s*pid = ([1-9][0-9]*)\s*$/mu.exec(service.stdout)?.[1];
		if (service.exitCode !== 0 || pid === undefined) return false;
		const endpoint = new URL(url);
		const listener = await run("/usr/sbin/lsof", [
			"-nP",
			"-a",
			"-p",
			pid,
			`-iTCP@${endpoint.hostname}:${endpoint.port}`,
			"-sTCP:LISTEN",
			"-Fp",
		]);
		if (
			listener.exitCode !== 0 ||
			!listener.stdout.split("\n").includes(`p${pid}`)
		)
			return false;
		const response = await fetch(`${url}/api/health`, {
			signal: globalThis.AbortSignal.timeout(1_000),
		});
		return response.ok && (await response.json()).status === "ok";
	} catch {
		return false;
	}
}

function dependencies(overrides = {}) {
	return {
		platform: overrides.platform ?? process.platform,
		home: overrides.home ?? homedir(),
		uid: overrides.uid ?? defaultUid(),
		nodePath: overrides.nodePath ?? process.execPath,
		pathEnvironment:
			overrides.pathEnvironment ??
			process.env.PATH ??
			"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
		now: overrides.now ?? (() => new Date().toISOString()),
		randomId:
			overrides.randomId ??
			(() => `${String(process.pid)}-${globalThis.crypto.randomUUID()}`),
		health: overrides.health ?? serviceHealth,
		log:
			overrides.log ??
			((message) => {
				writeLine(message);
			}),
		run: overrides.run ?? defaultRun,
	};
}

function requireMacOwner(runtime) {
	if (runtime.platform !== "darwin")
		throw new Error(
			"Commonspace background service installation currently supports macOS",
		);
	if (!Number.isSafeInteger(runtime.uid) || runtime.uid < 0)
		throw new Error(
			"Commonspace service installation requires a local owner UID",
		);
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function assertManagedPath(layout, path) {
	const child = relative(layout.appRoot, path);
	if (child === "" || child.startsWith("..") || isAbsolute(child))
		throw new Error(
			"refusing to modify a path outside the Commonspace installation",
		);
}

async function removeManaged(layout, path) {
	assertManagedPath(layout, path);
	await rm(path, { recursive: true, force: true });
}

async function requiredRun(runtime, command, args, options = {}) {
	const result = await runtime.run(command, args, options);
	if (result.exitCode !== 0) {
		const detail =
			result.stderr.trim() ||
			result.stdout.trim() ||
			`exit ${String(result.exitCode)}`;
		throw new Error(`${command} failed: ${detail}`);
	}
	return result;
}

async function waitForHealth(runtime, layout) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await runtime.health(layout.url, layout, runtime.run)) return;
		await new Promise((resolveWait) => {
			setTimeout(resolveWait, 250);
		});
	}
	throw new Error(
		`Commonspace service did not become healthy at ${layout.url}`,
	);
}

async function writeRegistration(layout, runtime) {
	await mkdir(layout.appRoot, { recursive: true, mode: 0o700 });
	await chmod(layout.appRoot, 0o700);
	await mkdir(join(layout.home, "Library", "LaunchAgents"), {
		recursive: true,
	});
	await mkdir(layout.logsRoot, { recursive: true, mode: 0o700 });
	await mkdir(join(layout.home, ".local", "bin"), {
		recursive: true,
		mode: 0o700,
	});
	const temporaryPlist = `${layout.launchAgentPath}.${String(process.pid)}.tmp`;
	try {
		await writeFile(temporaryPlist, launchAgentPlist(layout, runtime), {
			mode: 0o600,
		});
		await requiredRun(runtime, "/usr/bin/plutil", ["-lint", temporaryPlist]);
		await rename(temporaryPlist, layout.launchAgentPath);
	} finally {
		await rm(temporaryPlist, { force: true });
	}
	const commandTarget = join(
		layout.current,
		"scripts",
		"commonspace-service.mjs",
	);
	try {
		const command = await lstat(layout.binPath);
		if (!command.isSymbolicLink())
			throw new Error("refusing to overwrite an unrelated Commonspace command");
		const existingTarget = resolve(
			dirname(layout.binPath),
			await readlink(layout.binPath),
		);
		const child = relative(layout.appRoot, existingTarget);
		if (
			existingTarget !== commandTarget &&
			(child.startsWith("..") || isAbsolute(child))
		) {
			throw new Error("refusing to overwrite an unrelated Commonspace command");
		}
		await rm(layout.binPath);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "refusing to overwrite an unrelated Commonspace command"
		)
			throw error;
		if (error?.code !== "ENOENT") throw error;
	}
	await symlink(commandTarget, layout.binPath);
}

async function removeManagedCommandLink(layout) {
	try {
		const command = await lstat(layout.binPath);
		if (!command.isSymbolicLink()) return;
		const existingTarget = resolve(
			dirname(layout.binPath),
			await readlink(layout.binPath),
		);
		const child = relative(layout.appRoot, existingTarget);
		if (!child.startsWith("..") && !isAbsolute(child)) await rm(layout.binPath);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
}

async function releaseIsComplete(path) {
	const required = [
		join(path, "server", "dist", "index.js"),
		join(path, "ui", "dist", "index.html"),
		join(path, "scripts", "commonspace-service.mjs"),
	];
	for (const file of required) {
		if (!(await stat(file)).isFile())
			throw new Error(`Commonspace release is missing ${basename(file)}`);
	}
}

async function prepareRelease(layout, runtime, options) {
	await mkdir(layout.appRoot, { recursive: true, mode: 0o700 });
	await chmod(layout.appRoot, 0o700);
	const staging = join(
		layout.appRoot,
		`.staging-${runtime.randomId().replaceAll(/[^a-zA-Z0-9_.-]/gu, "-")}`,
	);
	assertManagedPath(layout, staging);
	try {
		await requiredRun(runtime, "git", [
			"clone",
			"--depth",
			"1",
			"--branch",
			"main",
			"--",
			options.source,
			staging,
		]);
		await requiredRun(
			runtime,
			"corepack",
			["pnpm", "install", "--frozen-lockfile"],
			{ cwd: staging },
		);
		await requiredRun(runtime, "corepack", ["pnpm", "build"], { cwd: staging });
		await releaseIsComplete(staging);
		await chmod(join(staging, "scripts", "commonspace-service.mjs"), 0o755);
		const revision = (
			await requiredRun(runtime, "git", ["rev-parse", "HEAD"], { cwd: staging })
		).stdout.trim();
		if (!/^[a-zA-Z0-9._-]{1,200}$/u.test(revision))
			throw new Error("Commonspace release returned an invalid revision");
		await writeFile(
			join(staging, "commonspace-release.json"),
			`${JSON.stringify({ revision, source: options.source, installedAt: runtime.now() }, null, 2)}\n`,
			{ mode: 0o600 },
		);
		return staging;
	} catch (error) {
		await removeManaged(layout, staging);
		throw error;
	}
}

export async function stopService(options = {}, overrides = {}) {
	const runtime = dependencies(overrides);
	requireMacOwner(runtime);
	const layout = serviceLayout({
		...options,
		home: runtime.home,
		uid: runtime.uid,
	});
	const result = await runtime.run("/bin/launchctl", [
		"bootout",
		layout.target,
	]);
	if (result.exitCode === 3 || result.exitCode === 113) return false;
	if (result.exitCode !== 0)
		throw new Error(
			`launchctl bootout failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`}`,
		);
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const loaded = await runtime.run("/bin/launchctl", [
			"print",
			layout.target,
		]);
		if (loaded.exitCode === 3 || loaded.exitCode === 113) return true;
		if (loaded.exitCode !== 0)
			throw new Error(
				`launchctl print failed while stopping: ${loaded.stderr.trim() || loaded.stdout.trim()}`,
			);
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error("Commonspace service did not finish stopping");
}

export async function startService(options = {}, overrides = {}) {
	const runtime = dependencies(overrides);
	requireMacOwner(runtime);
	const layout = serviceLayout({
		...options,
		home: runtime.home,
		uid: runtime.uid,
	});
	if (
		!(await exists(layout.launchAgentPath)) ||
		!(await exists(layout.current))
	)
		throw new Error("Commonspace is not installed");
	const bootstrap = await runtime.run("/bin/launchctl", [
		"bootstrap",
		layout.domain,
		layout.launchAgentPath,
	]);
	if (bootstrap.exitCode !== 0) {
		const loaded = await runtime.run("/bin/launchctl", [
			"print",
			layout.target,
		]);
		if (loaded.exitCode !== 0)
			throw new Error(
				`launchctl bootstrap failed: ${bootstrap.stderr.trim() || bootstrap.stdout.trim()}`,
			);
		const kickstart = await runtime.run("/bin/launchctl", [
			"kickstart",
			"-k",
			layout.target,
		]);
		if (kickstart.exitCode !== 0 && kickstart.exitCode !== 37) {
			throw new Error(
				`launchctl kickstart failed: ${kickstart.stderr.trim() || kickstart.stdout.trim() || `exit ${String(kickstart.exitCode)}`}`,
			);
		}
	}
	await waitForHealth(runtime, layout);
	return layout;
}

async function activateRelease(layout, runtime, staging) {
	await stopService({ appRoot: layout.appRoot }, runtime);
	if (await exists(layout.previous)) {
		await removeManaged(layout, layout.previous);
		runtime.log("Removed the superseded rollback release.");
	}
	const hadCurrent = await exists(layout.current);
	if (hadCurrent) await rename(layout.current, layout.previous);
	await rename(staging, layout.current);
	try {
		await writeRegistration(layout, runtime);
		await startService({ appRoot: layout.appRoot }, runtime);
	} catch (error) {
		await stopService({ appRoot: layout.appRoot }, runtime);
		const failed = join(
			layout.appRoot,
			`.failed-${runtime.randomId().replaceAll(/[^a-zA-Z0-9_.-]/gu, "-")}`,
		);
		await rename(layout.current, failed);
		if (hadCurrent) {
			await rename(layout.previous, layout.current);
			await writeRegistration(layout, runtime);
			await startService({ appRoot: layout.appRoot }, runtime);
		} else {
			await rm(layout.launchAgentPath, { force: true });
			await removeManagedCommandLink(layout);
		}
		await removeManaged(layout, failed);
		runtime.log(
			"Removed the failed release after restoring the previous installation.",
		);
		throw error;
	}
}

function releaseInput(options) {
	if (options.release !== undefined)
		throw new Error("Commonspace no longer accepts packaged releases");
	const source = options.source ?? DEFAULT_COMMONSPACE_SOURCE;
	if (typeof source !== "string" || source.trim() === "")
		throw new Error("Commonspace source is required");
	return { source };
}

export async function installOrUpdate(options = {}, overrides = {}) {
	const runtime = dependencies(overrides);
	requireMacOwner(runtime);
	const mode = options.mode ?? "install";
	if (mode !== "install" && mode !== "update")
		throw new Error("service mode must be install or update");
	const input = releaseInput(options);
	const layout = serviceLayout({
		...options,
		home: runtime.home,
		uid: runtime.uid,
	});
	if (mode === "update" && !(await exists(layout.current)))
		throw new Error("Commonspace is not installed; run install first");
	const staging = await prepareRelease(layout, runtime, input);
	await activateRelease(layout, runtime, staging);
	const metadata = JSON.parse(await readFile(layout.releaseMetadata, "utf8"));
	runtime.log(
		`${mode === "install" ? "Installed" : "Updated"} Commonspace ${String(metadata.version ?? metadata.revision)}.`,
	);
	runtime.log(`Open ${layout.url}`);
	runtime.log(`CLI: ${layout.binPath}`);
	return layout;
}

export async function rollbackRelease(options = {}, overrides = {}) {
	const runtime = dependencies(overrides);
	requireMacOwner(runtime);
	const layout = serviceLayout({
		...options,
		home: runtime.home,
		uid: runtime.uid,
	});
	if (!(await exists(layout.current)) || !(await exists(layout.previous)))
		throw new Error("no Commonspace rollback release is available");
	await stopService({ appRoot: layout.appRoot }, runtime);
	const swap = join(
		layout.appRoot,
		`.rollback-${runtime.randomId().replaceAll(/[^a-zA-Z0-9_.-]/gu, "-")}`,
	);
	await rename(layout.current, swap);
	await rename(layout.previous, layout.current);
	await rename(swap, layout.previous);
	await writeRegistration(layout, runtime);
	await startService({ appRoot: layout.appRoot }, runtime);
	runtime.log("Rolled Commonspace back to the previous release.");
	return layout;
}

export async function serviceStatus(options = {}, overrides = {}) {
	const runtime = dependencies(overrides);
	requireMacOwner(runtime);
	const layout = serviceLayout({
		...options,
		home: runtime.home,
		uid: runtime.uid,
	});
	const installed =
		(await exists(layout.current)) && (await exists(layout.launchAgentPath));
	const loaded =
		installed &&
		(await runtime.run("/bin/launchctl", ["print", layout.target])).exitCode ===
			0;
	const healthy =
		loaded && (await runtime.health(layout.url, layout, runtime.run));
	let release = null;
	try {
		const metadata = JSON.parse(await readFile(layout.releaseMetadata, "utf8"));
		release = typeof metadata.revision === "string" ? metadata.revision : null;
	} catch {
		// A missing release file is reflected as an unknown revision.
	}
	return { installed, loaded, healthy, release, url: layout.url };
}

function parsedCli(argv) {
	const [command = "help", ...rest] = argv;
	const options = {};
	for (let index = 0; index < rest.length; index += 1) {
		const flag = rest[index];
		const value = rest[index + 1];
		if (flag === "--source" && value !== undefined) {
			options.source = value;
			index += 1;
		} else if (flag === "--app-root" && value !== undefined) {
			options.appRoot = value;
			index += 1;
		} else {
			throw new Error(`unknown Commonspace service option: ${String(flag)}`);
		}
	}
	return { command, options };
}

async function runCli() {
	const { command, options } = parsedCli(process.argv.slice(2));
	if (command === "install" || command === "update") {
		await installOrUpdate({ ...options, mode: command });
		return;
	}
	if (command === "start") {
		const layout = await startService(options);
		writeLine(`Commonspace is healthy at ${layout.url}`);
		return;
	}
	if (command === "stop") {
		await stopService(options);
		writeLine("Commonspace service stopped.");
		return;
	}
	if (command === "restart") {
		await stopService(options);
		const layout = await startService(options);
		writeLine(`Commonspace restarted at ${layout.url}`);
		return;
	}
	if (command === "rollback") {
		await rollbackRelease(options);
		return;
	}
	if (command === "status") {
		const status = await serviceStatus(options);
		writeLine(
			`Commonspace: ${status.healthy ? "healthy" : status.loaded ? "unhealthy" : status.installed ? "stopped" : "not installed"}`,
		);
		writeLine(`Release: ${status.release ?? "unknown"}`);
		writeLine(`URL: ${status.url}`);
		if (!status.healthy) process.exitCode = 1;
		return;
	}
	writeLine(
		"Usage: commonspace <install|update|start|stop|restart|status|rollback> [--source <git-url>] [--app-root <path>]",
	);
}

const invokedPath = process.argv[1];
if (
	invokedPath === "-" ||
	(invokedPath !== undefined &&
		["commonspace", "commonspace-service.mjs"].includes(basename(invokedPath)))
) {
	void runCli().catch((error) => {
		writeError(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
