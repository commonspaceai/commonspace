import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { acquireWorkspaceLock } from "../server/src/workspace-lock.ts";

const roots: string[] = [];
const releases: Array<() => Promise<void>> = [];
const owners: ChildProcess[] = [];
const servers: RunningCommonspaceServer[] = [];
const logger = { warn: () => undefined, info: () => undefined };

afterEach(async () => {
	await Promise.all(
		owners.splice(0).map(async (owner) => {
			if (owner.exitCode !== null || owner.signalCode !== null) return;
			const exited = once(owner, "exit");
			owner.kill("SIGKILL");
			await exited;
		}),
	);
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(releases.splice(0).map((release) => release()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function workspaceRoot() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-workspace-lock-"));
	roots.push(root);
	return join(root, "workspace");
}

async function acquire(root: string) {
	const release = await acquireWorkspaceLock(root);
	releases.push(release);
	return release;
}

async function start(root: string) {
	const running = await startCommonspaceServer({ root, port: 0, logger });
	servers.push(running);
	return running;
}

async function startOwner(root: string) {
	const moduleUrl = new URL("../server/src/index.ts", import.meta.url).href;
	const loaderUrl = new URL(
		"../server/node_modules/tsx/dist/loader.mjs",
		import.meta.url,
	).href;
	const owner = spawn(
		process.execPath,
		[
			"--import",
			loaderUrl,
			"--input-type=module",
			"--eval",
			`import { startCommonspaceServer } from ${JSON.stringify(moduleUrl)};
const running = await startCommonspaceServer({
	root: process.argv[1], port: 0, logger: { info() {}, warn() {} }
});
await running.service.mutate({ action: "create-channel", name: "recovered", agentIds: [] });
process.stdout.write("owned\\n");
`,
			root,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	owners.push(owner);
	const exited = once(owner, "exit");
	let errors = "";
	owner.stderr.on("data", (data: Buffer) => {
		errors += data.toString();
	});
	await Promise.race([
		once(owner.stdout, "data"),
		exited.then(() => {
			throw new Error(`Workspace owner exited before acquisition: ${errors}`);
		}),
	]);
	return { owner, exited };
}

describe("workspace writer ownership", () => {
	it("settles in-flight message acceptance before releasing ownership to a new host", async () => {
		const root = await workspaceRoot();
		let resumeAdmission: () => void = () => undefined;
		const admission = new Promise<void>((resolve) => {
			resumeAdmission = resolve;
		});
		let admissionHeld = false;
		const running = await startCommonspaceServer({
			root,
			port: 0,
			logger,
			dependencies: {
				beforeAcceptSend: async () => {
					admissionHeld = true;
					await admission;
				},
			},
		});
		servers.push(running);
		await running.service.mutate({
			action: "create-channel",
			name: "original",
			agentIds: [],
		});
		const channel = running.service.snapshot().channels[0];
		if (channel === undefined) throw new Error("Missing test Channel");
		const send = running.service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Request accepted while the host is closing.",
		});
		await vi.waitFor(() => expect(admissionHeld).toBe(true));
		const closing = running.close();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(running.service.isClosed).toBe(false);
		await expect(start(root)).rejects.toThrow("already open");
		resumeAdmission();
		await Promise.all([send, closing]);
		const restarted = await start(root);
		await restarted.service.mutate({
			action: "create-channel",
			name: "new-host-kept",
			agentIds: [],
		});
		expect(await readFile(join(root, "state.json"), "utf8")).toContain(
			'"name": "new-host-kept"',
		);
		expect(
			restarted.service.snapshot().channels.map((item) => item.name),
		).toEqual(["original", "new-host-kept"]);
	});

	it.skipIf(process.platform === "win32")(
		"requires write access only inside the configured workspace",
		async () => {
			const root = await workspaceRoot();
			await mkdir(root, { mode: 0o700 });
			const parent = dirname(root);
			await chmod(parent, 0o555);
			try {
				const release = await acquire(root);
				await expect(acquireWorkspaceLock(root)).rejects.toThrow(
					"already open",
				);
				await release();
			} finally {
				await chmod(parent, 0o700);
			}
		},
	);

	it("refuses a second server on another port for a canonical workspace without rewriting state", async () => {
		const root = await workspaceRoot();
		const running = await start(root);
		await running.service.mutate({
			action: "create-channel",
			name: "kept",
			agentIds: [],
		});
		const files = ["state.json", "state.backup.json"];
		const saved = await Promise.all(
			files.map((file) => readFile(join(root, file), "utf8")),
		);
		const alias = join(root, "..", "alias");
		await symlink(root, alias, "dir");

		await expect(start(alias)).rejects.toThrow("already open");
		expect(
			await Promise.all(
				files.map((file) => readFile(join(root, file), "utf8")),
			),
		).toEqual(saved);
		expect(
			running.service.snapshot().channels.map((channel) => channel.name),
		).toContain("kept");
	});

	it("releases once and does not release a later owner during repeated shutdown", async () => {
		const root = await workspaceRoot();
		const release = await acquire(root);
		await Promise.all([release(), release()]);
		await acquire(root);
		await release();

		await expect(acquireWorkspaceLock(root)).rejects.toThrow("already open");
	});

	it("releases ownership on shutdown so a later server restores the conversation", async () => {
		const root = await workspaceRoot();
		const running = await start(root);
		await running.service.mutate({
			action: "create-channel",
			name: "kept",
			agentIds: [],
		});
		await running.close();
		const restarted = await start(root);

		expect(
			restarted.service.snapshot().channels.map((channel) => channel.name),
		).toContain("kept");
		await expect(start(root)).rejects.toThrow("already open");
	});

	it("releases ownership when initialization fails", async () => {
		const root = await workspaceRoot();
		await expect(
			startCommonspaceServer({
				root,
				port: 0,
				logger,
				defaultCwd: join(root, "missing"),
			}),
		).rejects.toMatchObject({ code: "ENOENT" });
		const running = await start(root);
		await running.service.mutate({
			action: "create-channel",
			name: "started",
			agentIds: [],
		});

		expect(
			running.service.snapshot().channels.map((channel) => channel.name),
		).toContain("started");
	});

	it("recovers ownership after an abruptly killed owner becomes stale", async () => {
		const root = await workspaceRoot();
		const { owner, exited } = await startOwner(root);
		owner.kill("SIGKILL");
		await exited;
		await expect(start(root)).rejects.toThrow("already open");

		let recovered: RunningCommonspaceServer | undefined;
		await expect
			.poll(
				async () => {
					try {
						recovered = await start(root);
						return "acquired";
					} catch (error) {
						if (
							error instanceof Error &&
							error.message.includes("already open")
						)
							return "owned";
						throw error;
					}
				},
				{ timeout: 15_000, interval: 250 },
			)
			.toBe("acquired");
		expect(
			recovered?.service.snapshot().channels.map((channel) => channel.name),
		).toContain("recovered");
	});
});
