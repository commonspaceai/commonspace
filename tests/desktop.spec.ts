import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
	type DesktopHost,
	desktopHostFiles,
	startDesktopHost,
} from "../packages/desktop/src/host.ts";
import { desktopNavigation } from "../packages/desktop/src/navigation.ts";

const hosts: DesktopHost[] = [];
const roots: string[] = [];
const runFile = promisify(execFile);
const entry = fileURLToPath(
	new URL("./fixtures/desktop-host.mjs", import.meta.url),
);

async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-desktop-host-"));
	roots.push(root);
	return realpath(root);
}

function start(root: string, args: string[] = [], executable?: string) {
	const options = {
		entry,
		args,
		env: { ...process.env, COMMONSPACE_HOME: root },
	};
	const host = startDesktopHost(
		executable === undefined ? options : { ...options, executable },
	);
	hosts.push(host);
	return host;
}

function hostPid(host: DesktopHost): number {
	if (host.pid === undefined)
		throw new Error(
			"The host must announce a process identity before observation",
		);
	return host.pid;
}

afterEach(async () => {
	for (const host of hosts.splice(0)) await host.stop().catch(() => undefined);
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("desktop host ownership", () => {
	it("keeps one independently running host after detachment and reconnects before explicit stop", async () => {
		const root = await workspace();
		const marker = join(root, "stopped");
		const host = start(root, ["ready", marker]);
		const url = await host.ready;
		expect(new URL(url).hostname).toBe("127.0.0.1");
		await host.detach();
		expect(() => process.kill(hostPid(host), 0)).not.toThrow();
		const reopened = start(root, ["exit-before-ready"]);
		await expect(reopened.ready).resolves.toBe(url);
		expect(reopened.pid).toBe(host.pid);
		await Promise.all([reopened.stop(), reopened.stop()]);
		expect(await readFile(marker, "utf8")).toBe("host stopped");
		expect(() => process.kill(hostPid(host), 0)).toThrow();
		await expect(host.exited).resolves.toEqual({
			type: "exit",
			code: 0,
			signal: null,
		});
	});

	it("lets the launching client exit while the same host keeps writing to file logs", async () => {
		const root = await workspace();
		const loader = fileURLToPath(
			new URL("../server/node_modules/tsx/dist/loader.mjs", import.meta.url),
		);
		const launcher = fileURLToPath(
			new URL("./fixtures/desktop-launcher.mjs", import.meta.url),
		);
		const result = await runFile(
			process.execPath,
			["--import", loader, launcher],
			{ env: { ...process.env, COMMONSPACE_HOME: root }, timeout: 10_000 },
		);
		const announced = JSON.parse(result.stdout);
		const attached = start(root, ["exit-before-ready"]);
		await attached.ready;
		expect(hostPid(attached)).toBe(announced.pid);
		const before = await readFile(desktopHostFiles(root).stdout, "utf8");
		await delay(150);
		const after = await readFile(desktopHostFiles(root).stdout, "utf8");
		expect(after.length).toBeGreaterThan(before.length);
		expect(after).toContain("host still running");
		expect(() => process.kill(announced.pid, 0)).not.toThrow();
	});

	it("attaches to a host that was started independently by its CLI", async () => {
		const root = await workspace();
		const child = spawn(process.execPath, [entry], {
			detached: true,
			stdio: "ignore",
			env: { ...process.env, COMMONSPACE_HOME: root },
		});
		try {
			const deadline = Date.now() + 5_000;
			while (true) {
				try {
					await readFile(desktopHostFiles(root).locator);
					break;
				} catch {
					if (Date.now() >= deadline)
						throw new Error("The standalone host did not publish ownership");
					await delay(50);
				}
			}
			const attached = start(root, ["exit-before-ready"]);
			await attached.ready;
			expect(hostPid(attached)).toBe(child.pid);
			await attached.stop();
		} finally {
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGTERM");
		}
	});

	it("serializes competing host starts without spawning a second workspace writer", async () => {
		const root = await workspace();
		const first = start(root, ["slow-start"]);
		const second = start(root, ["slow-start"]);
		const results = await Promise.allSettled([first.ready, second.ready]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const failed = results.find((result) => result.status === "rejected");
		expect(failed?.status === "rejected" && failed.reason.message).toContain(
			"Another desktop client",
		);
		const running = first.pid === undefined ? second : first;
		expect(
			JSON.parse(await readFile(desktopHostFiles(root).locator, "utf8")).pid,
		).toBe(hostPid(running));
		const reopened = start(root, ["exit-before-ready"]);
		await reopened.ready;
		expect(hostPid(reopened)).toBe(hostPid(running));
	});

	it("reports startup and later host crashes", async () => {
		const failed = start(await workspace(), ["exit-before-ready"]);
		await expect(failed.ready).rejects.toThrow("code 7");
		const crashed = start(await workspace(), ["crash"]);
		await crashed.ready;
		await expect(crashed.exited).resolves.toEqual({
			type: "exit",
			code: 8,
			signal: null,
		});
	});

	it("rejects a host address outside the loopback HTTP origin", async () => {
		const host = start(await workspace(), ["invalid-url"]);
		await expect(host.ready).rejects.toThrow("host identity could not be read");
	});

	it("settles a failed process launch so Quit cannot wait forever", async () => {
		const root = await workspace();
		const host = start(root, [], join(tmpdir(), "missing-commonspace-node"));
		await expect(host.ready).rejects.toThrow("ENOENT");
		await expect(host.exited).resolves.toMatchObject({ type: "startup-error" });
		await expect(
			readFile(desktopHostFiles(root).locator),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("uses the server's private locator and keeps process logs private", async () => {
		const root = await workspace();
		const host = start(root);
		await host.ready;
		const files = desktopHostFiles(root);
		const locator = JSON.parse(await readFile(files.locator, "utf8"));
		expect(locator).toMatchObject({
			version: 1,
			root,
			pid: host.pid,
		});
		for (const path of [files.locator, files.stdout, files.stderr])
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await stat(files.directory)).mode & 0o777).toBe(0o700);
	});

	it("uses the same exact workspace through a symlink without starting a second writer", async () => {
		const root = await workspace();
		const aliasRoot = await workspace();
		const alias = join(aliasRoot, "workspace");
		await symlink(root, alias);
		const host = start(root);
		const url = await host.ready;
		const reused = start(alias, ["exit-before-ready"]);
		await expect(reused.ready).resolves.toBe(url);
		expect(reused.pid).toBe(host.pid);
	});

	it("refuses a live locator whose root or host capability does not match", async () => {
		const root = await workspace();
		const host = start(root);
		await host.ready;
		const files = desktopHostFiles(root);
		const saved = JSON.parse(await readFile(files.locator, "utf8"));
		await writeFile(
			files.locator,
			JSON.stringify({ ...saved, root: join(root, "different") }),
		);
		await expect(start(root).ready).rejects.toThrow(
			"does not match this workspace",
		);
		await writeFile(
			files.locator,
			JSON.stringify({ ...saved, id: randomUUID() }),
		);
		await expect(start(root).ready).rejects.toThrow("could not be verified");
		expect(() => process.kill(hostPid(host), 0)).not.toThrow();
		await writeFile(files.locator, JSON.stringify(saved));
	});

	it("starts again after a dead host and lets the new server replace its own locator", async () => {
		const root = await workspace();
		const first = start(root, ["crash"]);
		await first.ready;
		await first.exited;
		const recovered = start(root);
		await recovered.ready;
		expect(recovered.pid).not.toBe(first.pid);
		expect(
			JSON.parse(await readFile(desktopHostFiles(root).locator, "utf8")).pid,
		).toBe(recovered.pid);
	});

	it("refuses an unrelated live PID without signaling it", async () => {
		const root = await workspace();
		const files = desktopHostFiles(root);
		await mkdir(files.directory, { mode: 0o700 });
		await writeFile(
			files.locator,
			JSON.stringify({
				version: 1,
				root,
				id: randomUUID(),
				token: "a".repeat(43),
				pid: process.pid,
				url: "http://127.0.0.1:1",
			}),
			{ mode: 0o600 },
		);
		await expect(start(root).ready).rejects.toThrow();
		expect(() => process.kill(process.pid, 0)).not.toThrow();
		expect(JSON.parse(await readFile(files.locator, "utf8")).pid).toBe(
			process.pid,
		);
	});
});

describe("desktop navigation", () => {
	it.each([
		["http://127.0.0.1:3100/channels/synthetic", "workspace"],
		["https://example.com/docs", "external"],
		["http://127.0.0.1:4100", "external"],
		["file:///tmp/private", "blocked"],
		["javascript:alert(1)", "blocked"],
		["commonspace://workspace", "blocked"],
		["http://user:secret@127.0.0.1:3100", "blocked"],
		["invalid URL", "blocked"],
	])("routes %s to %s", (address, expected) => {
		expect(desktopNavigation(address, "http://127.0.0.1:3100")).toBe(expected);
	});
});

import { execFile, spawn } from "node:child_process";
