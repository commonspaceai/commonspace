import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommonspaceApp } from "../server/src/app.ts";
import {
	type RunningCommonspaceServer,
	type StartCommonspaceServerOptions,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { RemoteAccessConfigurationSchema } from "../server/src/remote-access.ts";
import type { CommonspaceHostDependencies } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const origin = "https://commonspace.example.ts.net";
const ownerLogin = "owner@example.invalid";
const ownerHeaders = {
	host: "commonspace.example.ts.net",
	"tailscale-user-login": ownerLogin,
};
const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function startHost(dependencies?: Partial<CommonspaceHostDependencies>) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-remote-"));
	roots.push(root);
	const options: StartCommonspaceServerOptions = {
		root,
		port: 0,
		remoteAccess: { origin, ownerLogin, port: 0 },
		logger: { warn: () => undefined, info: () => undefined },
	};
	if (dependencies !== undefined) options.dependencies = dependencies;
	const running = await startCommonspaceServer(options);
	servers.push(running);
	return { root, running, remoteUrl: mustExist(running.remoteLoopbackUrl) };
}

// Node fetch discards Host overrides; the proxy fixture must preserve this header.
function fetch(
	url: string,
	options: { method?: string; headers?: HeadersInit; body?: string } = {},
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const outgoing = request(
			url,
			{
				method: options.method ?? "GET",
				headers: Object.fromEntries(new Headers(options.headers)),
			},
			(incoming) => {
				const headers = new Headers();
				for (const [name, value] of Object.entries(incoming.headers)) {
					if (value === undefined) continue;
					headers.set(name, Array.isArray(value) ? value.join(", ") : value);
				}
				resolve(
					new Response(Readable.toWeb(incoming), {
						status: mustExist(incoming.statusCode),
						headers,
					}),
				);
			},
		);
		outgoing.once("error", reject);
		outgoing.end(options.body);
	});
}

describe("remote host transport", () => {
	it("keeps local same-origin behavior and requires the configured owner, Host and HTTPS origin remotely", async () => {
		const { running, remoteUrl } = await startHost();
		expect(running.remoteUrl).toBe(origin);
		const local = await fetch(`${running.url}/api/bootstrap`, {
			headers: { origin: running.url },
		});
		expect(local.status).toBe(200);
		const remote = await fetch(`${remoteUrl}/api/bootstrap`, {
			headers: { ...ownerHeaders, origin },
		});
		expect(remote.status).toBe(200);
		expect(await remote.json()).toEqual(await local.json());
		for (const headers of [
			{ host: ownerHeaders.host, origin },
			{
				...ownerHeaders,
				"tailscale-user-login": "other@example.invalid",
				origin,
			},
			{
				...ownerHeaders,
				host: "attacker.example.invalid",
				"x-forwarded-host": ownerHeaders.host,
				"x-forwarded-proto": "https",
				origin,
			},
			{ ...ownerHeaders, host: new URL(running.url).host, origin: running.url },
			{ ...ownerHeaders, origin: "https://attacker.example.invalid" },
			{ ...ownerHeaders, origin: "null" },
			ownerHeaders,
		]) {
			expect(
				(await fetch(`${remoteUrl}/api/bootstrap`, { headers })).status,
			).toBe(403);
		}
		const missingOwner = await fetch(`${remoteUrl}/`, {
			headers: { host: ownerHeaders.host },
		});
		expect(missingOwner.status).toBe(403);
		const localCsrf = await fetch(`${running.url}/api/mutate`, {
			method: "POST",
			headers: {
				origin: "https://attacker.example.invalid",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				action: "create-channel",
				name: "Injected",
				agentIds: [],
			}),
		});
		expect(localCsrf.status).toBe(403);
		expect(running.service.snapshot().channels).toHaveLength(0);
	});

	it.each([
		"/api/mcp",
		"/API/MCP",
		"/api/%6dcp",
		"/api/mcp%2ftools",
		"/%61pi/mcp",
		"//api/mcp",
		"/api/host/control",
		"/api/%68ost/control",
		"/api/select-directory",
		"/api/select-directory/",
		"/API/SELECT-DIRECTORY/",
		"/api/select-directory%2F",
		"/api/projects/example/open",
	])("keeps the local capability %s out of the remote app", async (path) => {
		const { running } = await startHost();
		let pickerCalls = 0;
		const remote = createServer(
			createCommonspaceApp({
				service: running.service,
				ingress: {
					kind: "remote",
					remoteAccess: RemoteAccessConfigurationSchema.parse({
						origin,
						ownerLogin,
						port: 0,
					}),
				},
				directoryPicker: async () => {
					pickerCalls++;
					return "/synthetic/private-folder";
				},
			}),
		);
		await new Promise<void>((resolve) =>
			remote.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = remote.address();
			if (address === null || typeof address === "string")
				throw new Error("Missing remote fixture port.");
			const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
				method: "POST",
				headers: { ...ownerHeaders, origin },
			});
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				code: "local_control_required",
				error: "This capability is available only on the host.",
			});
			expect(pickerCalls).toBe(0);
		} finally {
			remote.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				remote.close((error) =>
					error === undefined ? resolve() : reject(error),
				),
			);
		}
		const localMcp = await fetch(`${running.url}/api/mcp`);
		expect(localMcp.status).toBe(401);
	});

	it("accepts remote browser messages and returns the exact native permission choice to the same host", async () => {
		let permissionChoice: string | undefined;
		const { running, remoteUrl } = await startHost({
			discoverAgents: discoverTestHarnesses,
			runAgent: async ({ onPermissionRequest }) => {
				const response = await mustExist(onPermissionRequest)({
					toolCallId: "synthetic-write",
					title: "Write a synthetic file",
					options: [
						{
							optionId: "allow-once",
							name: "Allow once",
							kind: "allow_once",
						},
					],
				});
				permissionChoice = response.optionId;
				return { text: "Synthetic work complete." };
			},
		});
		await addTestHarness(running.service, "codex", "Codex");
		const headers = {
			...ownerHeaders,
			origin,
			"content-type": "application/json",
		};
		const body = {
			submissionId: "synthetic-browser",
			conversation: { kind: "dm", id: "codex" },
			text: "Continue the host session.",
		};
		const send = await fetch(`${remoteUrl}/api/send`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		expect(send.status).toBe(202);
		await vi.waitFor(() =>
			expect(running.service.snapshot().permissions).toHaveLength(1),
		);
		const permission = mustExist(running.service.snapshot().permissions[0]);
		const unauthorized = await fetch(
			`${remoteUrl}/api/permissions/${permission.id}/respond`,
			{
				method: "POST",
				headers: { ...ownerHeaders, "content-type": "application/json" },
				body: JSON.stringify({ optionId: "allow-once" }),
			},
		);
		expect(unauthorized.status).toBe(403);
		expect(permissionChoice).toBeUndefined();
		const response = await fetch(
			`${remoteUrl}/api/permissions/${permission.id}/respond`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ optionId: "allow-once" }),
			},
		);
		expect(response.status).toBe(200);
		await running.service.whenIdle();
		expect(permissionChoice).toBe("allow-once");
		expect(
			running.service
				.snapshot()
				.messages["dm:codex"]?.map((message) => message.text),
		).toEqual(["Continue the host session.", "Synthetic work complete."]);
		const replay = await fetch(`${remoteUrl}/api/send`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		expect(replay.status).toBe(202);
		const conflict = await fetch(`${remoteUrl}/api/send`, {
			method: "POST",
			headers,
			body: JSON.stringify({ ...body, text: "A different request." }),
		});
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toEqual({
			code: "message_submission_conflict",
			error: "This submission ID was already used for a different message.",
		});
	});

	it("streams the shared host revision to a same-origin browser and closes active events on shutdown", async () => {
		const { running, remoteUrl } = await startHost();
		const denied = await fetch(`${remoteUrl}/api/events`, {
			headers: {
				...ownerHeaders,
				referer: "https://attacker.example.invalid/",
			},
		});
		expect(denied.status).toBe(403);
		const stream = await fetch(`${remoteUrl}/api/events`, {
			headers: { ...ownerHeaders, referer: `${origin}/channels` },
		});
		expect(stream.status).toBe(200);
		const reader = mustExist(stream.body).getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader.read()).value)).toContain(
			'event: revision\ndata: {"revision":0}',
		);
		await running.service.mutate({
			action: "create-channel",
			name: "Shared work",
			agentIds: [],
		});
		let events = "";
		while (!events.includes('event: revision\ndata: {"revision":1}')) {
			const chunk = await reader.read();
			if (chunk.done)
				throw new Error("Event stream ended before the accepted revision.");
			events += decoder.decode(chunk.value);
		}
		await running.close();
		await expect(reader.read()).rejects.toThrow();
		await expect(fetch(`${running.url}/api/health`)).rejects.toThrow();
		await expect(
			fetch(`${remoteUrl}/api/health`, { headers: ownerHeaders }),
		).rejects.toThrow();
	});

	it("guards GitHub imports before validating repository input and keeps rejected requests out of host state", async () => {
		const { running, remoteUrl } = await startHost();
		const body = JSON.stringify({
			repositoryUrl: "https://attacker.example.invalid/repository",
			name: "Injected",
		});
		const denied = await fetch(`${remoteUrl}/api/projects/import-github`, {
			method: "POST",
			headers: {
				...ownerHeaders,
				origin: "https://attacker.example.invalid",
				"content-type": "application/json",
			},
			body,
		});
		expect(denied.status).toBe(403);
		const invalid = await fetch(`${remoteUrl}/api/projects/import-github`, {
			method: "POST",
			headers: { ...ownerHeaders, origin, "content-type": "application/json" },
			body,
		});
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			code: "project_import_invalid",
			error:
				"Enter a GitHub repository URL, a valid branch, and a Project name.",
		});
		expect(running.service.snapshot().projects).toHaveLength(0);
	});

	it("releases the workspace and both listeners after a remote-port startup failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-remote-port-"));
		roots.push(root);
		const initial = await startCommonspaceServer({ root, port: 0 });
		await initial.service.mutate({
			action: "create-channel",
			name: "Keep work",
			agentIds: [],
		});
		await initial.close();
		const saved = await readFile(join(root, "state.json"));
		const occupied = createServer();
		await new Promise<void>((resolve) =>
			occupied.listen(0, "127.0.0.1", resolve),
		);
		const address = occupied.address();
		if (address === null || typeof address === "string")
			throw new Error("Missing fixture port");
		try {
			await expect(
				startCommonspaceServer({
					root,
					port: 0,
					remoteAccess: { origin, ownerLogin, port: address.port },
				}),
			).rejects.toMatchObject({ code: "EADDRINUSE" });
			expect(await readFile(join(root, "state.json"))).toEqual(saved);
		} finally {
			await new Promise<void>((resolve, reject) =>
				occupied.close((error) =>
					error === undefined ? resolve() : reject(error),
				),
			);
		}
		const running = await startCommonspaceServer({
			root,
			port: 0,
			remoteAccess: { origin, ownerLogin, port: 0 },
		});
		servers.push(running);
		const remoteUrl = mustExist(running.remoteLoopbackUrl);
		await running.drainAndClose();
		expect(running.service.isClosed).toBe(true);
		await expect(fetch(`${running.url}/api/health`)).rejects.toThrow();
		await expect(
			fetch(`${remoteUrl}/api/health`, { headers: ownerHeaders }),
		).rejects.toThrow();
	});
});
