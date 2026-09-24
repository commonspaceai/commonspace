// @vitest-environment node
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

it("inspects only added agents on demand, excludes native secrets, and leaves workspace state unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-capabilities-"));
	roots.push(root);
	const calls = join(root, "calls");
	const cli = join(root, "codex-fixture");
	await writeFile(calls, "");
	await writeFile(
		cli,
		String.raw`#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\n');
if (process.argv.includes('mcp')) {
  console.log(JSON.stringify([{name:'catalog', enabled:true, transport:{type:'stdio',command:'/private/native-command',args:['TOKEN=private-token'],env:{SECRET:'private-credential'}}}]));
} else { console.log('[]'); }
`,
	);
	await chmod(cli, 0o700);
	const running = await startCommonspaceServer({
		root: join(root, "state"),
		port: 0,
		codexPath: cli,
		dependencies: { discoverAgents: discoverTestHarnesses },
		logger: { info: () => undefined, warn: () => undefined },
	});
	servers.push(running);
	await addTestHarness(running.service, "codex");
	const before = JSON.stringify(running.service.snapshot());
	await fetch(`${running.url}/api/bootstrap`, {
		headers: { origin: running.url },
	});
	expect(await readFile(calls, "utf8")).toBe("");
	const endpoint = `${running.url}/api/agents/codex/capabilities`;
	const denied = await fetch(endpoint, {
		headers: { origin: "https://external.invalid" },
	});
	expect(denied.status).toBe(403);
	const missing = await fetch(
		`${running.url}/api/agents/not-added/capabilities`,
		{ headers: { origin: running.url } },
	);
	expect(missing.status).toBe(404);
	expect(await readFile(calls, "utf8")).toBe("");
	const response = await fetch(endpoint, { headers: { origin: running.url } });
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const body: unknown = await response.json();
	expect(body).toMatchObject({
		agentId: "codex",
		groups: expect.arrayContaining([
			expect.objectContaining({
				id: "mcp",
				status: "available",
				items: expect.arrayContaining([
					expect.objectContaining({ name: "catalog" }),
				]),
			}),
		]),
	});
	const serialized = JSON.stringify(body);
	for (const secret of [
		root,
		"/private/native-command",
		"private-token",
		"private-credential",
		"transport",
		"env",
	]) {
		expect(serialized).not.toContain(secret);
	}
	expect(JSON.stringify(running.service.snapshot())).toBe(before);
});

it("runs native MCP reauthentication only for an added agent and an eligible server", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-mcp-auth-"));
	roots.push(root);
	const status = join(root, "status");
	const calls = join(root, "calls");
	const cli = join(root, "codex-fixture");
	await writeFile(status, "not_logged_in");
	await writeFile(calls, "");
	await writeFile(
		cli,
		`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'mcp' && args[1] === 'list') {
  console.log(JSON.stringify([
    { name: 'catalog', enabled: true, auth_status: fs.readFileSync(${JSON.stringify(status)}, 'utf8'), transport: { url: 'https://private.example/token' } },
    { name: 'local', enabled: true, auth_status: 'unsupported' }
  ]));
} else if (args[0] === 'mcp' && args[1] === 'login') {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
  fs.writeFileSync(${JSON.stringify(status)}, 'logged_in');
} else {
  console.log('[]');
}
`,
	);
	await chmod(cli, 0o700);
	const running = await startCommonspaceServer({
		root: join(root, "state"),
		port: 0,
		codexPath: cli,
		dependencies: { discoverAgents: discoverTestHarnesses },
		logger: { info: () => undefined, warn: () => undefined },
	});
	servers.push(running);
	await addTestHarness(running.service, "codex");
	const before = JSON.stringify(running.service.snapshot());
	const endpoint = `${running.url}/api/agents/codex/mcp-authentication`;
	const request = (serverName: string, origin = running.url) =>
		fetch(endpoint, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify({ serverName }),
		});
	const initial = await fetch(`${running.url}/api/agents/codex/capabilities`, {
		headers: { origin: running.url },
	});
	const initialBody = await initial.json();
	expect(initialBody).toMatchObject({
		groups: expect.arrayContaining([
			expect.objectContaining({
				id: "mcp",
				items: expect.arrayContaining([
					expect.objectContaining({
						name: "catalog",
						authentication: "not_authenticated",
					}),
				]),
			}),
		]),
	});
	expect(JSON.stringify(initialBody)).not.toContain("private.example");
	expect((await request("catalog", "https://external.invalid")).status).toBe(
		403,
	);
	expect(
		(
			await fetch(`${running.url}/api/agents/not-added/mcp-authentication`, {
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ serverName: "catalog" }),
			})
		).status,
	).toBe(404);
	expect((await request("missing")).status).toBe(409);
	expect((await request("local")).status).toBe(409);
	expect(await readFile(calls, "utf8")).toBe("");
	expect((await request("catalog")).status).toBe(200);
	expect(await readFile(calls, "utf8")).toBe('["mcp","login","catalog"]\n');
	const refreshed = await fetch(
		`${running.url}/api/agents/codex/capabilities`,
		{ headers: { origin: running.url } },
	);
	expect(await refreshed.json()).toMatchObject({
		groups: expect.arrayContaining([
			expect.objectContaining({
				id: "mcp",
				items: expect.arrayContaining([
					expect.objectContaining({
						name: "catalog",
						authentication: "authenticated",
					}),
				]),
			}),
		]),
	});
	expect((await request("catalog")).status).toBe(200);
	const callsBeforeLimit = await readFile(calls, "utf8");
	const limited = await request("catalog");
	expect(limited.status).toBe(429);
	expect(await limited.json()).toMatchObject({
		code: "mcp_authentication_rate_limited",
	});
	expect(await readFile(calls, "utf8")).toBe(callsBeforeLimit);
	expect(JSON.stringify(running.service.snapshot())).toBe(before);
});
