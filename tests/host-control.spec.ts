import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HostControlIdentitySchema,
	PRIVATE_HOST_LOCATOR_FILE_NAME,
	PrivateHostLocatorSchema,
} from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { developmentServerMessages } from "../server/src/dev-supervisor.ts";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
	await Promise.all(
		children.splice(0).map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill("SIGTERM");
			await exited;
		}),
	);
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createRoot() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-control-"));
	roots.push(root);
	return root;
}

async function locatorAt(root: string) {
	const value: unknown = JSON.parse(
		await readFile(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME), "utf8"),
	);
	return PrivateHostLocatorSchema.parse(value);
}

describe("private local host control", () => {
	it("publishes one private canonical locator and requires its capability without browser headers", async () => {
		const root = await createRoot();
		const logs: string[] = [];
		const running = await startCommonspaceServer({
			root,
			port: 0,
			logger: {
				info: (message) => logs.push(message),
				warn: (message) => logs.push(String(message)),
			},
		});
		servers.push(running);
		const locator = await locatorAt(root);
		expect(locator.root).toBe(await realpath(root));
		expect(locator.url).toBe(running.url);
		expect(locator.pid).toBe(process.pid);
		expect((await stat(join(root, "host"))).mode & 0o777).toBe(0o700);
		expect(
			(await stat(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME))).mode &
				0o777,
		).toBe(0o600);
		for (const headers of [
			{},
			{ authorization: "Bearer invalid-synthetic-control" },
			{ authorization: `Bearer ${locator.token}`, origin: running.url },
			{ authorization: `Bearer ${locator.token}`, referer: `${running.url}/` },
			{
				authorization: `Bearer ${locator.token}`,
				"sec-fetch-site": "same-origin",
			},
		]) {
			const response = await fetch(`${running.url}/api/host/control`, {
				headers,
			});
			expect(response.status).toBe(403);
		}
		const authorized = await fetch(`${running.url}/api/host/control`, {
			headers: { authorization: `Bearer ${locator.token}` },
		});
		expect(authorized.status).toBe(200);
		expect(HostControlIdentitySchema.parse(await authorized.json())).toEqual({
			id: locator.id,
			pid: process.pid,
		});
		for (const path of ["/api/bootstrap", "/api/export"]) {
			const response = await fetch(`${running.url}${path}`, {
				headers: { origin: running.url },
			});
			const text = await response.text();
			expect(text).not.toContain(locator.token);
			expect(text).not.toContain(locator.id);
			expect(text).not.toContain(locator.root);
		}
		expect(logs.join("\n")).not.toContain(locator.token);
		expect(logs.join("\n")).not.toContain(locator.id);
	});

	it("acknowledges stop before closing both listeners and removes only that host's locator", async () => {
		const root = await createRoot();
		const running = await startCommonspaceServer({
			root,
			port: 0,
			remoteAccess: {
				origin: "https://commonspace.example.ts.net",
				ownerLogin: "owner@example.invalid",
				port: 0,
			},
		});
		servers.push(running);
		const locator = await locatorAt(root);
		const remoteUrl = mustExist(running.remoteLoopbackUrl);
		const denied = await fetch(`${running.url}/api/host/control/stop`, {
			method: "POST",
		});
		expect(denied.status).toBe(403);
		expect(running.service.isClosed).toBe(false);
		const response = await fetch(`${running.url}/api/host/control/stop`, {
			method: "POST",
			headers: { authorization: `Bearer ${locator.token}` },
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ status: "stopping" });
		await vi.waitFor(async () => {
			expect(running.service.isClosed).toBe(true);
			await expect(
				access(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME)),
			).rejects.toMatchObject({ code: "ENOENT" });
		});
		await expect(fetch(`${running.url}/api/health`)).rejects.toThrow();
		await expect(fetch(`${remoteUrl}/api/health`)).rejects.toThrow();
		const restarted = await startCommonspaceServer({ root, port: 0 });
		servers.push(restarted);
		const nextLocator = await locatorAt(root);
		expect(nextLocator.id).not.toBe(locator.id);
		expect(nextLocator.token).not.toBe(locator.token);
		expect(
			(
				await fetch(`${restarted.url}/api/host/control`, {
					headers: { authorization: `Bearer ${locator.token}` },
				})
			).status,
		).toBe(403);
		await running.close();
		expect(await locatorAt(root)).toEqual(nextLocator);
	});

	it("preserves a replacement ownership record when the old host closes", async () => {
		const root = await createRoot();
		const running = await startCommonspaceServer({ root, port: 0 });
		servers.push(running);
		const replacement = { ...(await locatorAt(root)), id: randomUUID() };
		await writeFile(
			join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME),
			JSON.stringify(replacement),
		);
		await running.close();
		expect(await locatorAt(root)).toEqual(replacement);
	});

	it("releases a fully stopped host's lease when locator cleanup fails", async () => {
		const root = await createRoot();
		const running = await startCommonspaceServer({ root, port: 0 });
		servers.push(running);
		const path = join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME);
		await rm(path);
		await mkdir(path);
		await expect(running.close()).rejects.toThrow(
			"Commonspace could not remove host ownership.",
		);
		expect(running.service.isClosed).toBe(true);
		await expect(fetch(`${running.url}/api/health`)).rejects.toThrow();
		servers.splice(servers.indexOf(running), 1);
		await rm(path, { recursive: true });
		const recovered = await startCommonspaceServer({ root, port: 0 });
		servers.push(recovered);
		expect((await fetch(`${recovered.url}/api/health`)).status).toBe(200);
	});

	it("keeps conversation data and releases its lease after locator publication fails", async () => {
		const root = await createRoot();
		const initial = await startCommonspaceServer({ root, port: 0 });
		await initial.service.mutate({
			action: "create-channel",
			name: "Keep work",
			agentIds: [],
		});
		await initial.close();
		const saved = await readFile(join(root, "state.json"));
		await mkdir(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME));
		await expect(startCommonspaceServer({ root, port: 0 })).rejects.toThrow(
			"Commonspace could not publish host ownership.",
		);
		expect(await readFile(join(root, "state.json"))).toEqual(saved);
		expect(
			(
				await stat(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME))
			).isDirectory(),
		).toBe(true);
		await rm(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME), {
			recursive: true,
		});
		const recovered = await startCommonspaceServer({ root, port: 0 });
		servers.push(recovered);
		expect(
			recovered.service.snapshot().channels.map((channel) => channel.name),
		).toEqual(["keep-work"]);
	});

	it("lets the desktop stop a CLI host and closes the classifier before the process exits", async () => {
		const root = await createRoot();
		const child = fork(
			fileURLToPath(new URL("./fixtures/host-control-cli.ts", import.meta.url)),
			[],
			{
				execArgv: [
					"--import",
					fileURLToPath(
						new URL(
							"../server/node_modules/tsx/dist/loader.mjs",
							import.meta.url,
						),
					),
				],
				env: {
					COMMONSPACE_HOME: root,
					COMMONSPACE_PORT: "0",
					COMMONSPACE_REMOTE_ORIGIN: "https://commonspace.example.ts.net",
					COMMONSPACE_REMOTE_OWNER_LOGIN: "owner@example.invalid",
					COMMONSPACE_REMOTE_PORT: "0",
					COMMONSPACE_LOG_LEVEL: "error",
				},
				stdio: ["ignore", "pipe", "pipe", "ipc"],
			},
		);
		children.push(child);
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		const [message] = await once(child, "message");
		const ready = z
			.object({
				type: z.literal(developmentServerMessages.ready),
				url: z.url(),
				remoteLoopbackUrl: z.url(),
			})
			.parse(message);
		const locator = await locatorAt(root);
		expect(locator.pid).toBe(child.pid);
		expect(locator.url).toBe(ready.url);
		const response = await fetch(`${ready.url}/api/host/control/stop`, {
			method: "POST",
			headers: { authorization: `Bearer ${locator.token}` },
		});
		expect(response.status).toBe(202);
		if (child.exitCode === null) await once(child, "exit");
		expect(child.exitCode).toBe(0);
		expect(await readFile(join(root, "classifier-closed"), "utf8")).toBe(
			"closed",
		);
		await expect(
			access(join(root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME)),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(fetch(`${ready.url}/api/health`)).rejects.toThrow();
		await expect(
			fetch(`${ready.remoteLoopbackUrl}/api/health`),
		).rejects.toThrow();
		for (const secret of [locator.id, locator.token, locator.root]) {
			expect(JSON.stringify(message)).not.toContain(secret);
			expect(output).not.toContain(secret);
		}
	});
});
