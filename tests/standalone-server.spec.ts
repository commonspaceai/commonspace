import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	COMMONSPACE_STATE_VERSION,
	CommonspaceRoutingProvider,
} from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];
const bootstrapSchema = z.object({
	state: z.object({
		projects: z.array(z.object({ paths: z.array(z.string()) })),
	}),
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("standalone Commonspace server", () => {
	it("keeps canonical Project roots out of browser-visible state", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-private-project-roots-"),
		);
		roots.push(root);
		const workspace = join(root, "private-workspace-name");
		await mkdir(workspace);
		const running = await startCommonspaceServer({
			root: join(root, "state"),
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
		});
		servers.push(running);
		await running.service.mutate({
			action: "create-project",
			name: "Private roots",
			paths: [workspace],
		});
		const privateRoot = mustExist(
			running.service.snapshot().projects[0]?.paths[0],
		);

		const response = await fetch(`${running.url}/api/bootstrap`, {
			headers: { origin: running.url },
		});
		const body = bootstrapSchema.parse(await response.json());

		expect(body.state.projects[0]?.paths).toEqual(["Working folder"]);
		expect(JSON.stringify(body)).not.toContain(privateRoot);
	});

	it("serves an installed UI build on the same loopback origin when configured", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-installed-ui-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		const uiRoot = join(root, "ui");
		await mkdir(workspace);
		await mkdir(join(uiRoot, "assets"), { recursive: true });
		await writeFile(
			join(uiRoot, "index.html"),
			'<!doctype html><main id="root">Installed Commonspace</main>',
		);
		await writeFile(
			join(uiRoot, "assets", "app.js"),
			"globalThis.commonspaceInstalled = true",
		);

		const running = await startCommonspaceServer({
			root,
			defaultCwd: workspace,
			uiRoot,
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
		});
		servers.push(running);

		const documentResponse = await fetch(running.url);
		expect(documentResponse.headers.get("content-type")).toContain("text/html");
		expect(await documentResponse.text()).toContain("Installed Commonspace");
		await expect(
			fetch(`${running.url}/assets/app.js`).then((response) => response.text()),
		).resolves.toContain("commonspaceInstalled");
		await expect(
			fetch(`${running.url}/project/anything`).then((response) =>
				response.text(),
			),
		).resolves.toContain("Installed Commonspace");
		await expect(
			fetch(`${running.url}/api/missing`, {
				headers: { origin: running.url },
			}).then((response) => response.json()),
		).resolves.toEqual({ code: "not_found", error: "API route not found" });
	});

	it("serves the API without serving a UI build", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-standalone-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		let discoveryCalls = 0;

		const running = await startCommonspaceServer({
			root,
			defaultCwd: workspace,
			port: 0,
			directoryPicker: async () => workspace,
			dependencies: {
				discoverAgents: async (adapter) => {
					discoveryCalls += 1;
					return discoverTestHarnesses(adapter);
				},
			},
			logger: { warn: () => undefined, info: () => undefined },
		});
		servers.push(running);

		const documentResponse = await fetch(running.url);
		expect(documentResponse.status).toBe(200);
		await expect(documentResponse.json()).resolves.toEqual({ status: "ok" });

		const assetResponse = await fetch(`${running.url}/assets/app.js`);
		expect(assetResponse.status).toBe(404);

		const healthResponse = await fetch(`${running.url}/api/health`);
		await expect(healthResponse.json()).resolves.toEqual({ status: "ok" });

		const directoryResponse = await fetch(
			`${running.url}/api/select-directory`,
			{
				method: "POST",
				headers: { origin: running.url },
			},
		);
		expect(directoryResponse.status).toBe(200);
		await expect(directoryResponse.json()).resolves.toEqual({
			path: workspace,
		});

		const bootstrapResponse = await fetch(`${running.url}/api/bootstrap`, {
			headers: { origin: running.url },
		});
		expect(bootstrapResponse.status).toBe(200);
		await expect(bootstrapResponse.json()).resolves.toMatchObject({
			agents: [],
			discoveredAgents: [],
			state: { version: COMMONSPACE_STATE_VERSION, revision: 0 },
		});
		expect(discoveryCalls).toBe(0);

		for (const method of ["GET", "PUT"]) {
			const request: RequestInit = {
				method,
				headers: { origin: running.url, "content-type": "application/json" },
			};
			if (method === "PUT") request.body = "{}";
			const configurationResponse = await fetch(
				`${running.url}/api/agents/missing/configuration`,
				request,
			);
			expect(configurationResponse.status).toBe(404);
			await expect(configurationResponse.json()).resolves.toEqual({
				code: "not_found",
				error: "API route not found",
			});
		}

		const managedAgentResponse = await fetch(`${running.url}/api/mutate`, {
			method: "POST",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({
				action: "add-agent",
				displayName: "Invented Agent",
				adapter: "codex",
			}),
		});
		expect(managedAgentResponse.status).toBe(400);
		await expect(managedAgentResponse.json()).resolves.toMatchObject({
			code: "invalid_mutation",
			error: expect.stringContaining("unknown mutation"),
		});
		await running.service.discoverAgents("codex");
		await running.service.mutate({
			action: "add-discovered-agent",
			agentId: "codex",
		});
		discoveryCalls = 0;

		const routingResponse = await fetch(`${running.url}/api/routing`, {
			method: "PUT",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "codex",
			}),
		});
		expect(routingResponse.status).toBe(200);
		await expect(routingResponse.json()).resolves.toEqual({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		const routingReadResponse = await fetch(`${running.url}/api/routing`, {
			headers: { origin: running.url },
		});
		await expect(routingReadResponse.json()).resolves.toEqual({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});

		const rerouteResponse = await fetch(`${running.url}/api/reroute`, {
			method: "POST",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({
				sourceMessageId: "missing-message",
				assignmentId: "missing-assignment",
				agentId: "missing-agent",
				projectIds: [],
			}),
		});
		expect(rerouteResponse.status).toBe(400);
		await expect(rerouteResponse.json()).resolves.toEqual({
			code: "reroute_failed",
			error: "routable source message not found",
		});

		const channel = mustExist(
			(
				await running.service.mutate({
					action: "create-channel",
					name: "context-api",
					agentIds: [],
				})
			).channels[0],
		);
		const contextUpdateResponse = await fetch(
			`${running.url}/api/channels/${encodeURIComponent(channel.id)}/context`,
			{
				method: "PUT",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({
					summary: "Editable canonical context.",
					decisions: ["Keep it local."],
				}),
			},
		);
		expect(contextUpdateResponse.status).toBe(200);
		await expect(contextUpdateResponse.json()).resolves.toMatchObject({
			summary: "Editable canonical context.",
			origin: "user",
			status: "current",
		});
		const contextReadResponse = await fetch(
			`${running.url}/api/channels/${encodeURIComponent(channel.id)}/context`,
			{
				headers: { origin: running.url },
			},
		);
		await expect(contextReadResponse.json()).resolves.toMatchObject({
			summary: "Editable canonical context.",
		});

		const missingThreadContextResponse = await fetch(
			`${running.url}/api/threads/missing/context`,
			{
				headers: { origin: running.url },
			},
		);
		expect(missingThreadContextResponse.status).toBe(404);
		await expect(missingThreadContextResponse.json()).resolves.toEqual({
			code: "thread_context_not_found",
			error: "unknown thread",
		});

		const missingPinResponse = await fetch(
			`${running.url}/api/pins/missing/remove`,
			{
				method: "POST",
				headers: { origin: running.url },
			},
		);
		expect(missingPinResponse.status).toBe(400);
		await expect(missingPinResponse.json()).resolves.toEqual({
			code: "pin_remove_failed",
			error: "unknown pin",
		});

		const missingEditResponse = await fetch(
			`${running.url}/api/messages/missing/edit`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ text: "Edited message." }),
			},
		);
		expect(missingEditResponse.status).toBe(400);
		await expect(missingEditResponse.json()).resolves.toEqual({
			code: "message_edit_failed",
			error: "unknown message",
		});

		const missingDeleteResponse = await fetch(
			`${running.url}/api/messages/missing/delete`,
			{
				method: "POST",
				headers: { origin: running.url },
			},
		);
		expect(missingDeleteResponse.status).toBe(400);
		await expect(missingDeleteResponse.json()).resolves.toEqual({
			code: "message_delete_failed",
			error: "unknown message",
		});

		const missingFileResponse = await fetch(
			`${running.url}/api/files/missing`,
			{ headers: { origin: running.url } },
		);
		expect(missingFileResponse.status).toBe(404);
		await expect(missingFileResponse.json()).resolves.toEqual({
			code: "file_attachment_not_found",
			error: "unknown file attachment",
		});

		const missingPermissionResponse = await fetch(
			`${running.url}/api/permissions/missing/respond`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ optionId: "allow" }),
			},
		);
		expect(missingPermissionResponse.status).toBe(400);
		await expect(missingPermissionResponse.json()).resolves.toEqual({
			code: "permission_response_failed",
			error: "unknown permission request",
		});

		const discoveryResponse = await fetch(
			`${running.url}/api/discover-agents`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ adapter: "hermes" }),
			},
		);
		expect(discoveryResponse.status).toBe(200);
		expect(discoveryCalls).toBe(1);

		const codexDiscoveryResponse = await fetch(
			`${running.url}/api/discover-agents`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ adapter: "codex" }),
			},
		);
		expect(codexDiscoveryResponse.status).toBe(200);
		const codexDiscovery = await codexDiscoveryResponse.json();
		expect(codexDiscovery).toMatchObject({
			discoveredAgents: expect.arrayContaining([
				expect.objectContaining({ id: "codex", adapter: "codex" }),
			]),
		});
		expect(JSON.stringify(codexDiscovery)).not.toContain("nativeProfile");
		expect(discoveryCalls).toBe(2);

		const claudeDiscoveryResponse = await fetch(
			`${running.url}/api/discover-agents`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ adapter: "claude-code" }),
			},
		);
		expect(claudeDiscoveryResponse.status).toBe(200);
		await expect(claudeDiscoveryResponse.json()).resolves.toMatchObject({
			discoveredAgents: expect.arrayContaining([
				expect.objectContaining({ id: "claude-code", adapter: "claude-code" }),
			]),
		});

		for (const adapter of ["gemini", "opencode"]) {
			const response = await fetch(`${running.url}/api/discover-agents`, {
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ adapter }),
			});
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				discoveredAgents: expect.arrayContaining([
					expect.objectContaining({ id: adapter, adapter }),
				]),
			});
		}

		const unsupportedResponse = await fetch(
			`${running.url}/api/discover-agents`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({ adapter: "unsupported-cli" }),
			},
		);
		expect(unsupportedResponse.status).toBe(400);

		const diagnosticsResponse = await fetch(`${running.url}/api/diagnostics`, {
			headers: { origin: running.url },
		});
		expect(diagnosticsResponse.status).toBe(200);
		await expect(diagnosticsResponse.json()).resolves.toMatchObject({
			service: { status: "ready" },
			harnesses: expect.arrayContaining([
				expect.objectContaining({ adapter: "codex", installed: true }),
				expect.objectContaining({ adapter: "hermes", installed: true }),
			]),
		});
		expect(discoveryCalls).toBe(10);

		const exportResponse = await fetch(`${running.url}/api/export`, {
			headers: { origin: running.url },
		});
		expect(exportResponse.status).toBe(200);
		expect(exportResponse.headers.get("content-disposition")).toContain(
			"commonspace-export.json",
		);
		await expect(exportResponse.json()).resolves.toMatchObject({
			format: "commonspace-workspace",
			version: 1,
		});

		const invalidImportResponse = await fetch(`${running.url}/api/import`, {
			method: "POST",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({ archive: {}, projectMappings: {} }),
		});
		expect(invalidImportResponse.status).toBe(400);
		await expect(invalidImportResponse.json()).resolves.toMatchObject({
			code: "workspace_import_failed",
		});

		const invalidRetentionResponse = await fetch(
			`${running.url}/api/retention/preview`,
			{
				method: "POST",
				headers: { origin: running.url, "content-type": "application/json" },
				body: JSON.stringify({
					conversation: { kind: "channel", id: "missing" },
				}),
			},
		);
		expect(invalidRetentionResponse.status).toBe(400);
		await expect(invalidRetentionResponse.json()).resolves.toEqual({
			code: "retention_preview_failed",
			error: "unknown retention conversation",
		});
	});

	it("accepts inbox unread mutations through the API", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-inbox-api-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);

		const running = await startCommonspaceServer({
			root,
			defaultCwd: workspace,
			port: 0,
			dependencies: {
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Reply" }),
			},
			logger: { warn: () => undefined, info: () => undefined },
		});
		servers.push(running);

		await addTestHarness(running.service, "codex");
		await running.service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Create an inbox item.",
		});
		await running.service.whenIdle();
		const message = running.service
			.snapshot()
			.messages["dm:codex"]?.find(
				(candidate) => candidate.authorType === "user",
			);
		if (message === undefined) throw new Error("expected a sent user message");

		const response = await fetch(`${running.url}/api/mutate`, {
			method: "POST",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({
				action: "set-inbox-item-unread",
				messageId: message.id,
				unread: true,
			}),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			state: {
				inboxUnreadMessageIds: expect.arrayContaining([message.id]),
			},
		});
	});
});
