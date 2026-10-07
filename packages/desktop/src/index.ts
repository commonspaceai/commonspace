import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import {
	type DesktopHost,
	describeHostExit,
	startDesktopHost,
} from "./host.js";
import { desktopNavigation } from "./navigation.js";

type DesktopState =
	| { type: "idle" }
	| { type: "starting"; host: DesktopHost }
	| { type: "running"; host: DesktopHost; url: string }
	| {
			type: "stopping";
			host: DesktopHost;
			url: string;
			complete: Promise<void>;
	  }
	| { type: "quitting"; complete: Promise<void> }
	| { type: "stopped" };

let state: DesktopState = { type: "idle" };
let workspaceWindow: BrowserWindow | undefined;

async function stopHost(): Promise<void> {
	if (state.type === "stopping") return state.complete;
	if (state.type !== "running") return;
	const running = state;
	const complete = running.host.stop();
	state = { type: "stopping", host: running.host, url: running.url, complete };
	updateMenu();
	try {
		await complete;
		state = { type: "stopped" };
		workspaceWindow?.close();
		updateMenu();
	} catch (error) {
		state = running;
		updateMenu();
		throw error;
	}
}

function updateMenu(): void {
	const running = state.type === "running";
	const status = running
		? "Hosting on This Mac"
		: state.type === "starting"
			? "Starting Host…"
			: state.type === "stopping"
				? "Stopping Host…"
				: "Hosting Stopped";
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "Commonspace",
				submenu: [
					{ role: "about" },
					{
						label: "Open Workspace",
						enabled: running || state.type === "stopped",
						click: openWorkspace,
					},
					{ label: status, enabled: false },
					{
						label: "Stop Hosting",
						enabled: running,
						click: () =>
							void stopHost().catch((error: Error) =>
								dialog.showErrorBox("Could not stop hosting", error.message),
							),
					},
					{ type: "separator" },
					{ label: "Quit Commonspace", role: "quit" },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]),
	);
}

function openExternal(address: string): void {
	void shell.openExternal(address).catch((error: Error) => {
		dialog.showErrorBox("Could not open link", error.message);
	});
}

function openWorkspace(): void {
	if (state.type === "stopped") {
		void connectHost().catch(showStartupFailure);
		return;
	}
	if (state.type !== "running") return;
	if (workspaceWindow !== undefined) {
		workspaceWindow.show();
		workspaceWindow.focus();
		return;
	}
	const url = state.url;
	const window = new BrowserWindow({
		width: 1440,
		height: 960,
		show: false,
		title: "Commonspace",
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	workspaceWindow = window;
	window.once("ready-to-show", () => window.show());
	window.once("closed", () => {
		workspaceWindow = undefined;
	});
	window.webContents.on("will-navigate", (event, address) => {
		const destination = desktopNavigation(address, url);
		if (destination === "workspace") return;
		event.preventDefault();
		if (destination === "external") openExternal(address);
	});
	window.webContents.on("will-redirect", (event, address) => {
		if (desktopNavigation(address, url) !== "workspace") event.preventDefault();
	});
	window.webContents.setWindowOpenHandler(({ url: address }) => {
		const destination = desktopNavigation(address, url);
		if (destination === "external") openExternal(address);
		else if (destination === "workspace") {
			void window.loadURL(address).catch(showWindowFailure);
		}
		return { action: "deny" };
	});
	window.webContents.session.setPermissionRequestHandler(
		(_contents, permission, callback, details) =>
			callback(
				permission === "clipboard-sanitized-write" &&
					desktopNavigation(details.requestingUrl, url) === "workspace",
			),
	);
	window.webContents.session.setPermissionCheckHandler(
		(_contents, permission, requestingOrigin) =>
			permission === "clipboard-sanitized-write" && requestingOrigin === url,
	);
	void window.loadURL(url).catch(showWindowFailure);
}

function showWindowFailure(error: Error): void {
	if (
		state.type === "stopping" ||
		state.type === "stopped" ||
		state.type === "quitting"
	)
		return;
	dialog.showErrorBox("Commonspace could not open", error.message);
	app.quit();
}

function showStartupFailure(error: Error): void {
	if (state.type === "quitting") return;
	state = { type: "stopped" };
	updateMenu();
	dialog.showErrorBox("Commonspace could not start", error.message);
}

async function connectHost(): Promise<void> {
	if (state.type !== "idle" && state.type !== "stopped") return;
	const host = startDesktopHost({
		entry: fileURLToPath(
			new URL("../../../cli/dist/index.js", import.meta.url),
		),
		args: process.argv.includes("--no-classifier") ? ["--no-classifier"] : [],
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			COMMONSPACE_UI_ROOT:
				process.env.COMMONSPACE_UI_ROOT ??
				fileURLToPath(new URL("../../../ui/dist", import.meta.url)),
		},
	});
	state = { type: "starting", host };
	updateMenu();
	const url = await host.ready;
	if (state.type !== "starting") return;
	state = { type: "running", host, url };
	updateMenu();
	void host.exited.then((outcome) => {
		if (state.type !== "running" || state.host !== host) return;
		state = { type: "stopped" };
		workspaceWindow?.close();
		updateMenu();
		dialog.showErrorBox(
			"Commonspace host stopped",
			`The local host stopped (${describeHostExit(outcome)}). Launch Commonspace again to continue.`,
		);
	});
	openWorkspace();
}

app.setName("Commonspace");
if (process.env.COMMONSPACE_HOME !== undefined) {
	const userData = resolve(process.env.COMMONSPACE_HOME, "desktop");
	mkdirSync(userData, { recursive: true, mode: 0o700 });
	app.setPath("userData", userData);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", openWorkspace);
	app.on("activate", openWorkspace);
	app.on("window-all-closed", () => undefined);
	app.on("before-quit", (event) => {
		if (state.type === "idle" || state.type === "stopped") return;
		event.preventDefault();
		if (state.type === "quitting") return;
		const complete =
			state.type === "stopping" ? state.complete : state.host.detach();
		state = { type: "quitting", complete };
		void complete
			.catch(() => undefined)
			.then(() => {
				state = { type: "stopped" };
				setImmediate(() => app.quit());
			});
	});
	void app.whenReady().then(connectHost).catch(showStartupFailure);
}
