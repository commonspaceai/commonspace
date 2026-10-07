import { type ChildProcess, spawn } from "node:child_process";
import {
	chmod,
	type FileHandle,
	mkdir,
	open,
	readFile,
	realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	HostControlIdentitySchema,
	PRIVATE_HOST_LOCATOR_FILE_NAME,
	type PrivateHostLocator,
	PrivateHostLocatorSchema,
} from "@commonspace/shared";
import lockfile from "proper-lockfile";

export type DesktopHostExit =
	| { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
	| { type: "startup-error"; error: Error };

export interface DesktopHost {
	ready: Promise<string>;
	exited: Promise<DesktopHostExit>;
	readonly pid: number | undefined;
	detach(): Promise<void>;
	stop(): Promise<void>;
}

export function describeHostExit(outcome: DesktopHostExit): string {
	if (outcome.type === "startup-error") return outcome.error.message;
	if (outcome.code === null && outcome.signal === null) return "process exited";
	return outcome.code === null
		? `signal ${outcome.signal ?? "unknown"}`
		: `code ${String(outcome.code)}`;
}

export function desktopHostFiles(root: string) {
	const directory = join(root, "host");
	return {
		directory,
		locator: join(directory, PRIVATE_HOST_LOCATOR_FILE_NAME),
		lock: join(directory, ".control.lock"),
		stdout: join(directory, "host.log"),
		stderr: join(directory, "host.error.log"),
	};
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH")
			return false;
		throw error;
	}
}

async function readLocator(
	root: string,
): Promise<PrivateHostLocator | undefined> {
	let source: string;
	try {
		source = await readFile(desktopHostFiles(root).locator, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return undefined;
		throw error;
	}
	let locator: PrivateHostLocator;
	try {
		locator = PrivateHostLocatorSchema.parse(JSON.parse(source));
	} catch {
		throw new Error(
			"The saved host identity could not be read. Hosting was not changed.",
		);
	}
	if (locator.root !== root)
		throw new Error(
			"The saved host identity does not match this workspace. Hosting was not changed.",
		);
	return locator;
}

async function withControlLock<T>(root: string, operation: () => Promise<T>) {
	let release: () => Promise<void>;
	try {
		release = await lockfile.lock(root, {
			lockfilePath: desktopHostFiles(root).lock,
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ELOCKED")
			throw new Error(
				"Another desktop client is changing this host. Open Commonspace again after it finishes.",
				{ cause: error },
			);
		throw error;
	}
	try {
		return await operation();
	} finally {
		await release();
	}
}

async function verifyIdentity(connection: PrivateHostLocator): Promise<void> {
	const response = await fetch(`${connection.url}/api/host/control`, {
		headers: { authorization: `Bearer ${connection.token}` },
		signal: AbortSignal.timeout(3_000),
	});
	const identity = HostControlIdentitySchema.safeParse(
		await response.json().catch(() => undefined),
	);
	if (
		!response.ok ||
		!identity.success ||
		identity.data.id !== connection.id ||
		identity.data.pid !== connection.pid
	)
		throw new Error(
			"The running host could not be verified for this workspace. Hosting was not changed.",
		);
}

async function waitForReady(
	root: string,
	child: ChildProcess,
): Promise<PrivateHostLocator> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(
				`The local host stopped before startup (code ${String(child.exitCode)}). Check the host logs, then open Commonspace again.`,
			);
		if (child.signalCode !== null)
			throw new Error(
				`The local host stopped before startup (signal ${child.signalCode}). Check the host logs, then open Commonspace again.`,
			);
		const locator = await readLocator(root);
		if (locator !== undefined && locator.pid === child.pid) {
			await verifyIdentity(locator);
			return locator;
		}
		await delay(100);
	}
	throw new Error(
		"The local host did not become ready. Check the host logs before opening Commonspace again.",
	);
}

async function stopFailedLaunch(child: ChildProcess): Promise<void> {
	if (
		child.pid === undefined ||
		child.exitCode !== null ||
		child.signalCode !== null
	)
		return;
	const exited = new Promise<void>((resolveExit) =>
		child.once("exit", () => resolveExit()),
	);
	child.kill("SIGTERM");
	await Promise.race([exited, delay(5_000, undefined, { ref: false })]);
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGKILL");
	await exited;
}

async function launchHost(
	root: string,
	options: StartDesktopHostOptions,
	onExit: (outcome: DesktopHostExit) => void,
): Promise<PrivateHostLocator> {
	const files = desktopHostFiles(root);
	let child: ChildProcess | undefined;
	try {
		const handles: FileHandle[] = [];
		try {
			handles.push(await open(files.stdout, "a", 0o600));
			handles.push(await open(files.stderr, "a", 0o600));
			await Promise.all(handles.map((handle) => handle.chmod(0o600)));
			const [stdout, stderr] = handles;
			if (stdout === undefined || stderr === undefined)
				throw new Error("The host log files could not be opened.");
			child = spawn(
				options.executable ?? process.execPath,
				[options.entry, ...options.args],
				{
					detached: true,
					shell: false,
					env: {
						...options.env,
						COMMONSPACE_HOME: root,
					},
					stdio: ["ignore", stdout.fd, stderr.fd],
				},
			);
			await new Promise<void>((resolveSpawn, rejectSpawn) => {
				child?.once("spawn", resolveSpawn);
				child?.once("error", rejectSpawn);
			});
			if (child.pid === undefined)
				throw new Error("The local host did not start a process.");
			child.once("exit", (code, signal) =>
				onExit({ type: "exit", code, signal }),
			);
			child.unref();
		} finally {
			await Promise.all(handles.map((handle) => handle.close()));
		}
		if (child === undefined)
			throw new Error("The local host did not start a process.");
		return await waitForReady(root, child);
	} catch (error) {
		if (child !== undefined) await stopFailedLaunch(child);
		throw error;
	}
}

interface StartDesktopHostOptions {
	entry: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	executable?: string;
}

async function stopConnection(running: PrivateHostLocator): Promise<void> {
	await withControlLock(running.root, async () => {
		if (!isAlive(running.pid)) return;
		await verifyIdentity(running);
		const response = await fetch(`${running.url}/api/host/control/stop`, {
			method: "POST",
			headers: { authorization: `Bearer ${running.token}` },
			signal: AbortSignal.timeout(3_000),
		});
		if (response.status !== 202)
			throw new Error(
				"The host did not accept Stop Hosting. Hosting was not changed.",
			);
		const deadline = Date.now() + 15_000;
		while (isAlive(running.pid)) {
			if (Date.now() >= deadline)
				throw new Error(
					"The host is still stopping. Check the host logs before starting it again.",
				);
			await delay(100);
		}
	});
}

export function startDesktopHost(
	options: StartDesktopHostOptions,
): DesktopHost {
	let connection: PrivateHostLocator | undefined;
	let monitor: NodeJS.Timeout | undefined;
	let detached = false;
	let resolveExit: (outcome: DesktopHostExit) => void = () => undefined;
	const exited = new Promise<DesktopHostExit>((resolve) => {
		resolveExit = resolve;
	});
	const ready = (async () => {
		const selectedRoot = resolve(
			options.env.COMMONSPACE_HOME ?? join(homedir(), ".commonspace"),
		);
		await mkdir(selectedRoot, { recursive: true, mode: 0o700 });
		const root = await realpath(selectedRoot);
		await mkdir(desktopHostFiles(root).directory, {
			recursive: true,
			mode: 0o700,
		});
		await chmod(desktopHostFiles(root).directory, 0o700);
		connection = await withControlLock(root, async () => {
			const saved = await readLocator(root);
			if (saved !== undefined && isAlive(saved.pid)) {
				await verifyIdentity(saved);
				return saved;
			}
			return launchHost(root, options, resolveExit);
		});
		const running = connection;
		if (!detached) {
			monitor = setInterval(() => {
				if (isAlive(running.pid)) return;
				clearInterval(monitor);
				resolveExit({ type: "exit", code: null, signal: null });
			}, 500);
			monitor.unref();
		}
		return connection.url;
	})();
	void ready.catch((error: Error) =>
		resolveExit({ type: "startup-error", error }),
	);
	let stopping: Promise<void> | undefined;
	return {
		ready,
		exited,
		get pid() {
			return connection?.pid;
		},
		async detach() {
			detached = true;
			clearInterval(monitor);
			await ready;
		},
		stop() {
			stopping ??= (async () => {
				await ready;
				if (connection === undefined) return;
				await stopConnection(connection);
				clearInterval(monitor);
			})().catch((error: Error) => {
				stopping = undefined;
				throw error;
			});
			return stopping;
		},
	};
}
