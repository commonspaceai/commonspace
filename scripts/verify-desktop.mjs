import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";
import { _electron as electron } from "playwright";
import { PRIVATE_HOST_LOCATOR_FILE_NAME } from "../packages/shared/dist/hosting.js";

const runFile = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const desktopEntry = join(repoRoot, "packages/desktop/dist/index.js");
const cliEntry = join(repoRoot, "cli/dist/index.js");
const electronExecutable = createRequire(
	join(repoRoot, "packages/desktop/package.json"),
)("electron");
const temporaryRoot = await mkdtemp(join(tmpdir(), "commonspace-desktop-"));
const home = join(temporaryRoot, "home");
const workspaceRoot = join(temporaryRoot, "workspace");
const projectRoot = join(temporaryRoot, "project");
const artifactDir = join(
	repoRoot,
	"artifacts/desktop",
	new Date().toISOString().replace(/[:.]/gu, "-"),
);
const systemKeys = new Set([
	"path",
	"pathext",
	"systemroot",
	"systemdrive",
	"windir",
	"comspec",
	"temp",
	"tmp",
	"display",
	"xauthority",
	"dbus_session_bus_address",
]);
const env = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			systemKeys.has(key.toLowerCase()),
		),
	),
	HOME: home,
	USERPROFILE: home,
	APPDATA: join(home, "AppData/Roaming"),
	LOCALAPPDATA: join(home, "AppData/Local"),
	COMMONSPACE_HOME: workspaceRoot,
	COMMONSPACE_PORT: "0",
};
const channelName = "desktop-smoke";
const channelNavigationName = new RegExp(
	`^Open channel ${channelName}(?:, \\d+ unread)?$`,
	"u",
);
const projectName = "Desktop fixture";
const messageText =
	"Desktop smoke keeps this conversation after closing and reopening the window.";
const fileText = "This synthetic project file is served by the desktop host.";
const runs = [];
const standaloneHosts = [];
const failures = [];
const observations = { screenshots: [], checks: [] };

async function bounded(promise, label, timeout = 15_000) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} timed out`)),
					timeout,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function waitFor(predicate, label, timeout = 10_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await delay(100);
	}
	throw new Error(`${label} timed out`);
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

async function ownedHostPid() {
	const locator = JSON.parse(
		await readFile(
			join(workspaceRoot, "host", PRIVATE_HOST_LOCATOR_FILE_NAME),
			"utf8",
		),
	);
	assert.equal(locator.version, 1);
	assert.equal(locator.root, await realpath(workspaceRoot));
	const response = await fetch(`${locator.url}/api/host/control`, {
		headers: { authorization: `Bearer ${locator.token}` },
		signal: globalThis.AbortSignal.timeout(5_000),
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { id: locator.id, pid: locator.pid });
	const processInfo = await runFile("ps", [
		"-ww",
		"-p",
		String(locator.pid),
		"-o",
		"command=",
	]);
	assert(
		processInfo.stdout.includes(cliEntry),
		"The exact verified process runs the source CLI",
	);
	return locator.pid;
}

async function request(run, path, body) {
	const response = await fetch(new URL(path, run.url), {
		method: body === undefined ? "GET" : "POST",
		headers: { origin: run.url, "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: globalThis.AbortSignal.timeout(5_000),
	});
	const value = await response.json();
	assert.equal(
		response.status,
		200,
		`${path} succeeds on the owning origin. ${value.error ?? ""}`,
	);
	return value;
}

async function prepareWindow(run, page) {
	run.page = page;
	page.setDefaultTimeout(10_000);
	page.on("pageerror", (error) => run.pageErrors.push(error.message));
	await page.locator("#root").waitFor();
	const window = await run.application.browserWindow(page);
	await window.evaluate((nativeWindow) => {
		nativeWindow.setContentSize(1440, 960);
		nativeWindow.show();
		nativeWindow.focus();
	});
	await page.waitForFunction(
		() => globalThis.innerWidth === 1440 && globalThis.innerHeight === 960,
	);
}

async function launch() {
	const application = await electron.launch({
		executablePath: electronExecutable,
		args: [desktopEntry, "--no-classifier"],
		chromiumSandbox: true,
		cwd: repoRoot,
		env,
		timeout: 30_000,
	});
	const run = {
		application,
		child: application.process(),
		pageErrors: [],
		output: "",
	};
	runs.push(run);
	for (const stream of [run.child.stdout, run.child.stderr]) {
		stream.on("data", (data) => {
			run.output = `${run.output}${data.toString()}`.slice(-32_000);
		});
	}
	const page = await application.firstWindow({ timeout: 15_000 });
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/u, { timeout: 15_000 });
	run.url = new URL(page.url()).origin;
	assert.equal(new URL(run.url).hostname, "127.0.0.1");
	assert.equal(new URL(run.url).protocol, "http:");
	run.hostPid = await ownedHostPid();
	assert(isAlive(run.hostPid), "The verified host is a live native process");
	const window = await application.browserWindow(page);
	run.initialBounds = await window.evaluate((nativeWindow) =>
		nativeWindow.getBounds(),
	);
	assert.equal(run.initialBounds.width, 1440);
	assert.equal(run.initialBounds.height, 960);
	await prepareWindow(run, page);
	return run;
}

async function launchStandaloneHost() {
	const output = await open(join(workspaceRoot, "host/manual.log"), "a", 0o600);
	let child;
	try {
		child = spawn(process.execPath, [cliEntry, "--no-classifier"], {
			cwd: repoRoot,
			detached: true,
			stdio: ["ignore", output.fd, output.fd],
			env: { ...env, COMMONSPACE_UI_ROOT: join(repoRoot, "ui/dist") },
		});
		standaloneHosts.push(child);
		await new Promise((resolveSpawn, rejectSpawn) => {
			child.once("spawn", resolveSpawn);
			child.once("error", rejectSpawn);
		});
		child.unref();
	} finally {
		await output.close();
	}
	await waitFor(async () => {
		const source = await readFile(
			join(workspaceRoot, "host", PRIVATE_HOST_LOCATOR_FILE_NAME),
			"utf8",
		).catch((error) => {
			if (error.code === "ENOENT") return undefined;
			throw error;
		});
		return source !== undefined && JSON.parse(source).pid === child.pid;
	}, "independent CLI ownership publication");
	assert.equal(await ownedHostPid(), child.pid);
	return child.pid;
}

async function verifySecurity(run) {
	const renderer = await run.page.evaluate(() => ({
		require: typeof globalThis.require,
		process: typeof globalThis.process,
		origin: globalThis.location.origin,
	}));
	assert.deepEqual(renderer, {
		require: "undefined",
		process: "undefined",
		origin: run.url,
	});
	const preferences = await run.application.evaluate(
		({ app, BrowserWindow }) => {
			const prefs =
				BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
			return {
				name: app.getName(),
				sandbox: prefs.sandbox,
				contextIsolation: prefs.contextIsolation,
				nodeIntegration: prefs.nodeIntegration,
				userData: app.getPath("userData"),
			};
		},
	);
	assert.deepEqual(preferences, {
		name: "Commonspace",
		sandbox: true,
		contextIsolation: true,
		nodeIntegration: false,
		userData: join(workspaceRoot, "desktop"),
	});
	const denied = await fetch(new URL("/api/mutate", run.url), {
		method: "POST",
		headers: {
			origin: "http://127.0.0.1:1",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			action: "create-channel",
			name: "denied",
			agentIds: [],
		}),
		signal: globalThis.AbortSignal.timeout(5_000),
	});
	assert.equal(
		denied.status,
		403,
		"Foreign origins cannot mutate the workspace",
	);
	observations.renderer = renderer;
	observations.checks.push("renderer isolation and same-origin mutation guard");
}

async function verifyNavigation(run) {
	await run.application.evaluate(({ shell }) => {
		globalThis.__desktopSmokeOpenExternal = shell.openExternal;
		globalThis.__desktopSmokeExternalUrls = [];
		shell.openExternal = async (url) => {
			globalThis.__desktopSmokeExternalUrls.push(url);
		};
	});
	try {
		const blocked = await run.page.evaluate(() =>
			globalThis.open("file:///desktop-smoke-blocked"),
		);
		assert.equal(blocked, null, "Unsafe schemes cannot open a native window");
		assert.equal(run.application.windows().length, 1);
		assert.equal(new URL(run.page.url()).origin, run.url);
		await run.page.evaluate(() =>
			globalThis.open("https://example.invalid/desktop-smoke"),
		);
		await waitFor(
			async () =>
				(await run.application.evaluate(
					() => globalThis.__desktopSmokeExternalUrls.length,
				)) === 1,
			"external link dispatch",
		);
		assert.deepEqual(
			await run.application.evaluate(
				() => globalThis.__desktopSmokeExternalUrls,
			),
			["https://example.invalid/desktop-smoke"],
		);
		assert.equal(run.application.windows().length, 1);
		assert.equal(new URL(run.page.url()).origin, run.url);
	} finally {
		await run.application.evaluate(({ shell }) => {
			shell.openExternal = globalThis.__desktopSmokeOpenExternal;
			delete globalThis.__desktopSmokeOpenExternal;
			delete globalThis.__desktopSmokeExternalUrls;
		});
	}
	observations.checks.push(
		"blocked unsafe popup and external link dispatch keep one workspace window",
	);
}

async function capture(run, mode) {
	await run.page.getByRole("button", { name: "Commonspace settings" }).click();
	await run.page
		.getByRole("group", { name: "Color mode" })
		.getByText(mode, { exact: true })
		.click();
	await run.page.waitForFunction(
		(color) => globalThis.document.documentElement.classList.contains(color),
		mode.toLowerCase(),
	);
	await run.page.getByRole("button", { name: "Close settings" }).click();
	await run.page.getByLabel(`Post in ${channelName}`).focus();
	const screenshot = join(
		artifactDir,
		`conversation-${mode.toLowerCase()}.png`,
	);
	await run.page.screenshot({
		path: screenshot,
		scale: "css",
		animations: "disabled",
	});
	const png = await readFile(screenshot);
	assert.equal(png.readUInt32BE(16), 1440);
	assert.equal(png.readUInt32BE(20), 960);
	observations.screenshots.push(screenshot);
}

async function reopen(run, operation) {
	await run.application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].close(),
	);
	await waitFor(() => run.application.windows().length === 0, "window close");
	assert(
		isAlive(run.hostPid),
		"Closing the window preserves the live host process",
	);
	assert.deepEqual(await request(run, "/api/health"), { status: "ok" });
	const opened = run.application.waitForEvent("window", { timeout: 10_000 });
	await operation();
	await prepareWindow(run, await opened);
	assert.equal(await ownedHostPid(), run.hostPid);
	await run.page.getByRole("button", { name: channelNavigationName }).click();
	await run.page.getByText(messageText, { exact: true }).waitFor();
}

async function quit(run) {
	await bounded(run.application.close(), "explicit Quit");
	assert(isAlive(run.hostPid), "Quit leaves the independent host running");
	assert.deepEqual(await request(run, "/api/health"), { status: "ok" });
	assert.equal(await ownedHostPid(), run.hostPid);
	assert.equal(run.child.exitCode, 0);
	assert.deepEqual(run.pageErrors, []);
}

async function stopHosting(run) {
	await run.application.evaluate(({ Menu }) => {
		const action = Menu.getApplicationMenu()
			.items.find((item) => item.label === "Commonspace")
			.submenu.items.find((item) => item.label === "Stop Hosting");
		if (!action.enabled)
			throw new Error("Stop Hosting must be available for a running host");
		action.click();
	});
	await waitFor(() => !isAlive(run.hostPid), "Stop Hosting process exit");
	await assert.rejects(
		fetch(new URL("/api/health", run.url), {
			signal: globalThis.AbortSignal.timeout(2_000),
		}),
		(error) => error.cause?.code === "ECONNREFUSED",
		"Stop Hosting closes the host HTTP listener",
	);
	await waitFor(
		async () =>
			run.application.evaluate(({ Menu }) =>
				Menu.getApplicationMenu()
					.items.find((item) => item.label === "Commonspace")
					.submenu.items.some((item) => item.label === "Hosting Stopped"),
			),
		"stopped native host status",
	);
	assert.equal(
		isAlive(run.child.pid),
		true,
		"Stop Hosting leaves the client available to start hosting again",
	);
	assert.deepEqual(run.pageErrors, []);
}

async function verifyWorkspace(run) {
	await run.page
		.getByRole("heading", {
			name: "Bring an agent. Give the workspace a mind.",
		})
		.waitFor();
	const bootstrap = await run.page.evaluate(async () => {
		const response = await globalThis.fetch("/api/bootstrap");
		return { status: response.status, ...(await response.json()) };
	});
	assert.equal(bootstrap.status, 200);
	assert.equal(bootstrap.state.channels.length, 0);
	assert.equal(bootstrap.state.agents.length, 0);
	const archive = await request(run, "/api/export");
	archive.workspace.agents.push({
		id: "codex",
		displayName: "Desktop fixture agent",
		adapter: "codex",
		model: null,
		createdAt: new Date().toISOString(),
	});
	await request(run, "/api/import", { archive, projectMappings: {} });
	await run.page.getByRole("radio", { name: /Desktop fixture agent/u }).check();
	await run.page
		.getByRole("button", { name: "Use selected agent", exact: true })
		.click();
	await run.page
		.getByRole("button", { name: "Commonspace settings" })
		.waitFor();
	observations.checks.push(
		"first-run onboarding and synthetic fixture inference selection",
	);
	let result = await request(run, "/api/mutate", {
		action: "create-project",
		name: projectName,
		paths: [projectRoot],
	});
	const project = result.state.projects[0];
	result = await request(run, "/api/mutate", {
		action: "create-channel",
		name: channelName,
		agentIds: [],
	});
	const channel = result.state.channels[0];
	await run.page
		.getByRole("button", { name: `Select project ${projectName}` })
		.click();
	await run.page.getByRole("tab", { name: "Files", exact: true }).click();
	await run.page
		.getByRole("button", { name: "Open file smoke.txt", exact: true })
		.click();
	await run.page.getByText(fileText, { exact: true }).waitFor();
	await run.page.getByRole("button", { name: channelNavigationName }).click();
	await run.page.getByLabel(`Post in ${channelName}`).fill(messageText);
	await run.page
		.getByRole("button", { name: "Post message", exact: true })
		.click();
	await run.page
		.getByRole("button", { name: "Close thread", exact: true })
		.click();
	result = await request(run, "/api/bootstrap");
	const message = result.state.messages[`channel:${channel.id}`].find(
		(item) => item.text === messageText,
	);
	assert(
		message,
		"The submitted conversation is accepted into durable host state",
	);
	await run.page.locator(`#commonspace-message-${message.id}`).waitFor();
	assert.equal(result.state.channels.length, 1);
	observations.checks.push(
		"renderer bootstrap, project file view, and accepted conversation",
	);
	return { project, channel, message };
}

async function cleanup(run) {
	const child = run.child;
	if (run.hostPid === undefined) {
		try {
			run.hostPid = await ownedHostPid();
		} catch (error) {
			if (error.code !== "ENOENT") failures.push(error.stack ?? String(error));
		}
	}
	if (child.exitCode === null && child.signalCode === null) {
		if (run.hostPid !== undefined && isAlive(run.hostPid))
			await bounded(stopHosting(run), "cleanup Stop Hosting", 5_000).catch(
				() => undefined,
			);
		await bounded(run.application.close(), "cleanup Quit", 5_000).catch(() =>
			child.kill("SIGKILL"),
		);
	}
	if (run.hostPid !== undefined && isAlive(run.hostPid)) {
		process.kill(run.hostPid, "SIGTERM");
		await waitFor(
			() => !isAlive(run.hostPid),
			"cleanup host exit",
			5_000,
		).catch(() => process.kill(run.hostPid, "SIGKILL"));
		await waitFor(
			() => !isAlive(run.hostPid),
			"cleanup host termination",
			5_000,
		);
	}
}

try {
	await mkdir(artifactDir, { recursive: true });
	await mkdir(home, { recursive: true });
	await mkdir(projectRoot, { recursive: true });
	await writeFile(join(projectRoot, "smoke.txt"), `${fileText}\n`);
	const nativeModule = createRequire(
		join(repoRoot, "server/package.json"),
	).resolve("onnxruntime-node");
	const moduleUrl = JSON.stringify(pathToFileURL(nativeModule).href);
	const workerSource = `import { parentPort } from "node:worker_threads"; const ort = await import(${moduleUrl}); parentPort.postMessage(typeof ort.InferenceSession === "function");`;
	const native = await runFile(
		electronExecutable,
		[
			"--input-type=module",
			"--eval",
			`import { Worker } from "node:worker_threads";
const ort = await import(${moduleUrl});
const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent(${JSON.stringify(workerSource)})));
const workerOnnx = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
await worker.terminate();
process.stdout.write(JSON.stringify({electron: process.versions.electron, node: process.versions.node, onnx: typeof ort.InferenceSession === "function", workerOnnx}));`,
		],
		{ env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 15_000 },
	);
	observations.runtime = JSON.parse(native.stdout);
	assert.equal(observations.runtime.electron, "44.5.1");
	assert.equal(observations.runtime.onnx, true);
	assert.equal(observations.runtime.workerOnnx, true);
	observations.checks.push(
		"ONNX native module imports in Electron Node mode and a worker thread; inference unverified",
	);
	const first = await launch();
	await verifySecurity(first);
	const fixture = await verifyWorkspace(first);
	await capture(first, "Light");
	await capture(first, "Dark");
	await verifyNavigation(first);
	await reopen(first, () =>
		first.application.evaluate(({ Menu }) => {
			Menu.getApplicationMenu()
				.items.find((item) => item.label === "Commonspace")
				.submenu.items.find((item) => item.label === "Open Workspace")
				.click();
		}),
	);
	observations.checks.push(
		"window close and Open Workspace reopen preserve the same host and conversation",
	);
	await reopen(first, () =>
		runFile(electronExecutable, [desktopEntry, "--no-classifier"], {
			cwd: repoRoot,
			env,
			timeout: 15_000,
		}),
	);
	observations.checks.push(
		"second instance reopens the existing workspace without a second host",
	);
	await quit(first);
	const restarted = await launch();
	assert.equal(
		restarted.hostPid,
		first.hostPid,
		"Relaunch reconnects to the same independent host process",
	);
	const recovered = await request(restarted, "/api/bootstrap");
	assert.equal(recovered.state.channels[0].id, fixture.channel.id);
	assert.equal(recovered.state.projects[0].id, fixture.project.id);
	assert.equal(
		recovered.state.messages[`channel:${fixture.channel.id}`].find(
			(message) => message.id === fixture.message.id,
		)?.text,
		messageText,
	);
	await restarted.page
		.getByRole("button", { name: channelNavigationName })
		.click();
	await restarted.page
		.locator(`#commonspace-message-${fixture.message.id}`)
		.waitFor();
	observations.checks.push(
		"Quit preserves the independent host and relaunch reconnects to its exact channel, project, and accepted message",
	);
	await stopHosting(restarted);
	await bounded(restarted.application.close(), "Quit after Stop Hosting");
	const standalonePid = await launchStandaloneHost();
	const afterStop = await launch();
	assert.notEqual(afterStop.hostPid, first.hostPid);
	assert.equal(
		afterStop.hostPid,
		standalonePid,
		"Desktop connects to the independently launched source CLI without spawning another host",
	);
	const persisted = await request(afterStop, "/api/bootstrap");
	assert.equal(persisted.state.channels[0].id, fixture.channel.id);
	assert.equal(
		persisted.state.messages[`channel:${fixture.channel.id}`].find(
			(message) => message.id === fixture.message.id,
		)?.text,
		messageText,
	);
	await stopHosting(afterStop);
	await bounded(afterStop.application.close(), "final client Quit");
	observations.checks.push(
		"Stop Hosting stops the exact host and listener; desktop attaches to a separately launched CLI and preserves the saved conversation; final Stop Hosting cleans up",
	);
	observations.initialWindowBounds = first.initialBounds;
	observations.hostPids = runs.map((run) => run.hostPid);
	observations.candidate = {};
	for (const file of [
		"scripts/verify-desktop.mjs",
		"packages/desktop/src/host.ts",
		"packages/desktop/src/index.ts",
		"packages/desktop/dist/index.js",
		"packages/shared/dist/hosting.js",
		"cli/dist/index.js",
		"ui/dist/index.html",
	]) {
		observations.candidate[file] = createHash("sha256")
			.update(await readFile(join(repoRoot, file)))
			.digest("hex");
	}
} catch (error) {
	failures.push(error.stack ?? String(error));
	if (error.stdout !== undefined || error.stderr !== undefined)
		observations.commandFailure = {
			code: error.code ?? null,
			signal: error.signal ?? null,
			killed: error.killed ?? false,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	const page = runs.at(-1)?.page;
	if (page !== undefined && !page.isClosed()) {
		await page
			.screenshot({ path: join(artifactDir, "failure.png"), scale: "css" })
			.catch(() => undefined);
	}
} finally {
	for (const run of runs.toReversed()) {
		await cleanup(run).catch((error) =>
			failures.push(error.stack ?? String(error)),
		);
	}
	for (const child of standaloneHosts) {
		if (
			child.exitCode !== null ||
			child.signalCode !== null ||
			child.pid === undefined
		)
			continue;
		child.kill("SIGTERM");
		await waitFor(
			() => !isAlive(child.pid),
			"standalone host cleanup",
			5_000,
		).catch(() => child.kill("SIGKILL"));
		await waitFor(
			() => !isAlive(child.pid),
			"standalone host termination",
			5_000,
		).catch((error) => failures.push(error.stack ?? String(error)));
	}
	observations.hostLogs = {};
	for (const name of ["host.log", "host.error.log", "manual.log"])
		observations.hostLogs[name] = await readFile(
			join(workspaceRoot, "host", name),
			"utf8",
		).catch(() => "");
	await rm(temporaryRoot, { recursive: true, force: true });
	await writeFile(
		join(artifactDir, "result.json"),
		`${JSON.stringify(
			{
				status: failures.length === 0 ? "passed" : "failed",
				...observations,
				failures,
				logs: runs.map((run) => run.output),
			},
			null,
			2,
		)}\n`,
	);
}

if (failures.length > 0) {
	process.stderr.write(`${failures.join("\n")}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write(
		`Native Electron smoke passed. Evidence ${artifactDir}\n`,
	);
}
