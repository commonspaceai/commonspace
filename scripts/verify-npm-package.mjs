import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { npmCommand } from "./tool-command.mjs";

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function packageArchiveName(name, version) {
	const normalized = name.startsWith("@")
		? name.slice(1).replaceAll("/", "-")
		: name;
	return `${normalized}-${version}.tgz`;
}

export function isolatedRuntimeEnv(home, source = process.env) {
	const systemKeys = new Set([
		"path",
		"pathext",
		"systemroot",
		"systemdrive",
		"windir",
		"comspec",
		"temp",
		"tmp",
	]);
	return {
		...Object.fromEntries(
			Object.entries(source).filter(([key]) =>
				systemKeys.has(key.toLowerCase()),
			),
		),
		HOME: home,
		USERPROFILE: home,
		APPDATA: join(home, "AppData", "Roaming"),
		LOCALAPPDATA: join(home, "AppData", "Local"),
	};
}

async function verifySavedChannel(request, channelId) {
	const bootstrap = await request("/api/bootstrap");
	assert.equal(bootstrap.status, 200);
	const { state } = await bootstrap.json();
	let persistedChannelId = channelId;
	if (channelId === undefined) {
		assert.equal(state.channels.length, 0);
		const mutation = await request("/api/mutate", {
			method: "POST",
			body: JSON.stringify({
				action: "create-channel",
				name: "package-restart-check",
				agentIds: [],
			}),
		});
		assert.equal(mutation.status, 200);
		persistedChannelId = (await mutation.json()).state.channels[0]?.id;
		assert.equal(typeof persistedChannelId, "string");
	} else {
		assert(
			state.channels.some(
				(channel) =>
					channel.id === channelId && channel.name === "package-restart-check",
			),
			"Installed package lost persisted state across restart",
		);
	}
	return persistedChannelId;
}

async function verifyRuntime({
	entry,
	root,
	home,
	version,
	channelId,
	shutdown,
}) {
	const reported = await run(process.execPath, [entry, "--version"], {
		cwd: root,
		env: isolatedRuntimeEnv(home),
	});
	assert.equal(reported.stdout.trim(), version);
	const child = spawn(process.execPath, [entry], {
		cwd: root,
		env: {
			...isolatedRuntimeEnv(home),
			COMMONSPACE_HOME: join(home, ".commonspace"),
			COMMONSPACE_PORT: "0",
			COMMONSPACE_LOG_LEVEL: "error",
		},
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	let output = "";
	let closed = false;
	let spawnError;
	child.on("error", (error) => {
		spawnError = error;
	});
	child.stdout.on("data", (chunk) => {
		output = `${output}${String(chunk)}`.slice(-100_000);
	});
	child.stderr.on("data", (chunk) => {
		output = `${output}${String(chunk)}`.slice(-100_000);
	});
	const stopped = new Promise((resolveStop) => {
		child.once("close", (code) => {
			closed = true;
			resolveStop(code);
		});
	});
	try {
		let url;
		for (let attempt = 0; attempt < 120; attempt += 1) {
			if (spawnError !== undefined) throw spawnError;
			url = output.match(
				/Commonspace is running at (http:\/\/127\.0\.0\.1:\d+)/u,
			)?.[1];
			if (url !== undefined || closed) break;
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
		}
		assert(
			url !== undefined,
			`Installed npm package failed to start:\n${output}`,
		);
		const request = (path, options = {}) =>
			fetch(`${url}${path}`, {
				...options,
				headers: {
					Origin: url,
					"Sec-Fetch-Site": "same-origin",
					"Content-Type": "application/json",
				},
				signal: globalThis.AbortSignal.timeout(5_000),
			});
		const health = await request("/api/health");
		assert.equal(health.status, 200);
		assert.deepEqual(await health.json(), { status: "ok" });
		const page = await request("/");
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.match(html, /id="root"/u);
		const assets = [
			...html.matchAll(/(?:src|href)="(\/assets\/[^"#]+)"/gu),
		].map((match) => match[1]);
		assert(assets.some((asset) => asset.endsWith(".js")));
		for (const asset of assets) {
			const response = await request(asset);
			assert.equal(response.status, 200, `Missing packaged asset: ${asset}`);
		}
		const persistedChannelId = await verifySavedChannel(request, channelId);
		// Windows process signals forcibly terminate the child. IPC disconnect
		// exercises the existing CLI close handler; console Ctrl+C needs a real terminal.
		if (shutdown === "ipc-disconnect") child.disconnect();
		else child.kill("SIGINT");
		const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
		try {
			assert.equal(
				await stopped,
				0,
				`Installed npm package failed to stop:\n${output}`,
			);
		} finally {
			clearTimeout(deadline);
		}
		return persistedChannelId;
	} finally {
		if (!closed) {
			child.kill("SIGTERM");
			const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
			await stopped;
			clearTimeout(deadline);
		}
	}
}

async function main() {
	if (process.argv.length > 3)
		throw new Error("Usage: node scripts/verify-npm-package.mjs [package.tgz]");
	const sourceManifest = JSON.parse(
		await readFile(join(repoRoot, "cli/package.json"), "utf8"),
	);
	const archive = resolve(
		process.argv[2] ??
			join(
				repoRoot,
				"artifacts/npm",
				packageArchiveName(sourceManifest.name, sourceManifest.version),
			),
	);
	const temporary = await mkdtemp(join(tmpdir(), "commonspace npm smoke "));
	try {
		const home = join(temporary, "user home");
		const installRoot = join(temporary, "installed package");
		const runtimeRoot = join(temporary, "outside checkout & install");
		await mkdir(join(home, "AppData", "Roaming"), { recursive: true });
		await mkdir(join(home, "AppData", "Local"), { recursive: true });
		await mkdir(runtimeRoot);
		const npm = npmCommand([
			"install",
			"--prefix",
			installRoot,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			archive,
		]);
		await run(npm.command, npm.args, {
			cwd: temporary,
			maxBuffer: 8 * 1024 * 1024,
		});
		const packageRoot = join(installRoot, "node_modules", sourceManifest.name);
		const installedManifest = JSON.parse(
			await readFile(join(packageRoot, "package.json"), "utf8"),
		);
		assert.equal(installedManifest.version, sourceManifest.version);
		assert.equal(installedManifest.private, undefined);
		assert(
			Object.values(installedManifest.dependencies).every(
				(specifier) => !specifier.startsWith("workspace:"),
			),
		);
		for (const flag of ["--version", "--help"]) {
			const binCommand = npmCommand([
				"exec",
				"--offline",
				"--prefix",
				installRoot,
				"--",
				"commonspace",
				flag,
			]);
			const result = await run(binCommand.command, binCommand.args, {
				cwd: runtimeRoot,
				env: isolatedRuntimeEnv(home),
			});
			if (flag === "--version")
				assert.equal(result.stdout.trim(), sourceManifest.version);
			else assert.match(result.stdout, /Usage: commonspace/u);
		}
		const shutdown = process.platform === "win32" ? "ipc-disconnect" : "SIGINT";
		const runtime = {
			entry: join(packageRoot, installedManifest.bin.commonspace),
			root: runtimeRoot,
			home,
			version: sourceManifest.version,
		};
		const channelId = await verifyRuntime({ ...runtime, shutdown });
		await verifyRuntime({ ...runtime, channelId, shutdown: "ipc-disconnect" });
		process.stdout.write(
			`${JSON.stringify({ package: archive, platform: process.platform, arch: process.arch, node: process.version, cleanInstall: true, npmBin: true, runtime: true, uiAssets: true, restartPersistence: true, shutdown: [shutdown, "ipc-disconnect"] })}\n`,
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	void main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
