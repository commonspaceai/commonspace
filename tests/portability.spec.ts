import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommonspaceApp } from "../server/src/app.ts";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { CommonspaceHostService } from "../server/src/service.ts";
import { applyMutation, createInitialState } from "../server/src/state.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("workspace portability HTTP workflow", () => {
	it("rejects an oversized export plan before reading attachment bytes", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-export-plan-limit-"),
		);
		roots.push(root);
		const state = createInitialState();
		state.agents = [
			{
				id: "codex",
				displayName: "Review Bot",
				adapter: "codex",
				model: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		];
		state.messages["dm:codex"] = [
			{
				id: randomUUID(),
				conversation: { kind: "dm", id: "codex" },
				authorType: "user",
				authorId: "user",
				authorName: "You",
				text: "Synthetic oversized export plan.",
				createdAt: "2026-01-01T00:00:00.000Z",
				replyStatus: "complete",
				files: Array.from({ length: 7 }, (_, index) => ({
					id: randomUUID(),
					name: `fixture-${String(index)}.bin`,
					mimeType: "application/octet-stream",
					size: 8 * 1024 * 1024,
				})),
			},
		];
		await writeFile(join(root, "state.json"), JSON.stringify(state));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
			},
		);
		await service.initialize();

		await expect(service.exportWorkspace()).rejects.toThrow(
			"workspace archive exceeds the supported 48 MiB limit",
		);
	});

	it("restores combined attachments larger than the generic API body limit", async () => {
		const sourceRoot = await mkdtemp(
			join(tmpdir(), "commonspace-http-export-source-"),
		);
		roots.push(sourceRoot);
		const source = await startCommonspaceServer({
			root: sourceRoot,
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
			dependencies: {
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Portable reply." }),
			},
		});
		servers.push(source);
		await addTestHarness(source.service, "codex", "Review Bot");
		const fixtureBytes = [
			Buffer.alloc(96 * 1024, 0x61),
			Buffer.alloc(96 * 1024, 0x62),
			Buffer.alloc(96 * 1024, 0x63),
		];
		await source.service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Preserve every attachment.",
			files: fixtureBytes.map((data, index) => ({
				name: `fixture-${String(index)}.bin`,
				mimeType: "application/octet-stream",
				data: data.toString("base64"),
			})),
		});
		await source.service.whenIdle();

		const exportResponse = await fetch(`${source.url}/api/export`, {
			headers: { origin: source.url },
		});
		expect(exportResponse.status).toBe(200);
		const archive = await exportResponse.json();
		const importBody = JSON.stringify({ archive, projectMappings: {} });
		expect(Buffer.byteLength(importBody)).toBeGreaterThan(128 * 1024);

		const targetRoot = await mkdtemp(
			join(tmpdir(), "commonspace-http-export-target-"),
		);
		roots.push(targetRoot);
		const target = await startCommonspaceServer({
			root: targetRoot,
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
			dependencies: { discoverAgents: discoverTestHarnesses },
		});
		servers.push(target);
		const importResponse = await fetch(`${target.url}/api/import`, {
			method: "POST",
			headers: {
				origin: target.url,
				"content-type": "application/json",
			},
			body: importBody,
		});
		expect(importResponse.status).toBe(200);

		const importedFiles =
			target.service.snapshot().messages["dm:codex"]?.[0]?.files ?? [];
		expect(importedFiles).toHaveLength(fixtureBytes.length);
		for (const [index, file] of importedFiles.entries()) {
			await expect(target.service.readFileAttachment(file.id)).resolves.toEqual(
				{
					metadata: file,
					data: fixtureBytes[index],
				},
			);
		}

		const constrainedRoot = await mkdtemp(
			join(tmpdir(), "commonspace-http-export-constrained-"),
		);
		roots.push(constrainedRoot);
		const constrainedService = new CommonspaceHostService(
			{},
			{ root: constrainedRoot },
			{ discoverAgents: discoverTestHarnesses },
		);
		await constrainedService.initialize();
		const constrainedServer = createServer(
			createCommonspaceApp({
				service: constrainedService,
				workspaceImportBodyLimitBytes: 128 * 1024,
			}),
		);
		await new Promise<void>((resolve) =>
			constrainedServer.listen(0, "127.0.0.1", resolve),
		);
		const address = constrainedServer.address();
		if (address === null || typeof address === "string")
			throw new Error("constrained import server did not bind");
		const constrainedUrl = `http://127.0.0.1:${String(address.port)}`;
		try {
			const oversizedResponse = await fetch(`${constrainedUrl}/api/import`, {
				method: "POST",
				headers: {
					origin: constrainedUrl,
					"content-type": "application/json",
				},
				body: importBody,
			});
			expect(oversizedResponse.status).toBe(413);
			await expect(oversizedResponse.json()).resolves.toMatchObject({
				code: "body_too_large",
			});
			expect(constrainedService.snapshot().revision).toBe(0);
		} finally {
			await new Promise<void>((resolve, reject) =>
				constrainedServer.close((error) => {
					if (error === undefined) resolve();
					else reject(error);
				}),
			);
			await constrainedService.close();
		}
	});
});

describe("workspace portability", () => {
	it("imports version-1 routing corrections without an explicit Project scope", async () => {
		const sourceRoot = await mkdtemp(
			join(tmpdir(), "commonspace-legacy-export-"),
		);
		const targetRoot = await mkdtemp(
			join(tmpdir(), "commonspace-legacy-import-"),
		);
		roots.push(sourceRoot, targetRoot);
		let state = createInitialState();
		state.agents.push(
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes",
				model: null,
				createdAt: "2026-08-30T00:00:00.000Z",
			},
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes",
				model: null,
				createdAt: "2026-08-30T00:00:00.000Z",
			},
		);
		state.projects.push({
			id: "project-1",
			name: "App",
			paths: [sourceRoot],
			createdAt: "2026-08-30T00:00:00.000Z",
		});
		state = applyMutation(state, {
			action: "create-channel",
			name: "portable",
			agentIds: ["frontend", "backend"],
		});
		const channel = mustExist(state.channels[0]);
		state.messages[`channel:${channel.id}`] = [
			{
				id: "source",
				conversation: { kind: "channel", id: channel.id },
				authorType: "user",
				authorId: "user",
				authorName: "Human",
				text: "Fix the API.",
				createdAt: "2026-08-30T00:00:00.000Z",
				routing: {
					source: "ai",
					agentIds: ["frontend", "backend"],
					assignments: [
						{ id: "from", agentId: "frontend", projectIds: [] },
						{
							id: "to",
							agentId: "backend",
							projectIds: ["project-1"],
						},
					],
					corrections: [
						{
							id: "correction-1",
							fromAssignmentId: "from",
							toAssignmentId: "to",
							projectIds: ["project-1"],
							createdAt: "2026-08-30T00:00:01.000Z",
						},
					],
					inferredProjectIds: [],
					reason: "Initial route",
				},
			},
		];
		await writeFile(join(sourceRoot, "state.json"), JSON.stringify(state));
		const source = new CommonspaceHostService(
			{},
			{ root: sourceRoot },
			{ discoverAgents: discoverTestHarnesses },
		);
		await source.initialize();
		const archive = await source.exportWorkspace();
		await source.close();
		expect(archive.version).toBe(2);
		const legacyArchive = { ...archive, version: 1 };
		const legacyCorrection = mustExist(
			legacyArchive.workspace.messages[`channel:${channel.id}`]?.[0]?.routing
				?.corrections[0],
		);
		Reflect.deleteProperty(legacyCorrection, "projectIds");

		const target = new CommonspaceHostService(
			{},
			{ root: targetRoot },
			{ discoverAgents: discoverTestHarnesses },
		);
		await target.initialize();
		await expect(
			target.importWorkspace(archive, { "project-1": [targetRoot] }),
		).rejects.toThrow("workspace archive failed structural validation");
		await target.importWorkspace(legacyArchive, { "project-1": [targetRoot] });
		const imported = mustExist(
			target.snapshot().messages[`channel:${channel.id}`]?.[0],
		);
		expect(imported.text).toBe("Fix the API.");
		expect(imported.routing?.corrections[0]).toMatchObject({
			fromAssignmentId: "from",
			toAssignmentId: "to",
			projectIds: ["project-1"],
		});
		expect(
			(await target.exportWorkspace()).workspace.messages[
				`channel:${channel.id}`
			]?.[0]?.routing?.corrections[0]?.projectIds,
		).toEqual(["project-1"]);
		await target.close();
	});

	it("exports sanitized metadata and imports into a clean workspace with explicit Project remapping", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-export-source-"));
		roots.push(root);
		const projectRoot = join(root, "private-source-project");
		await mkdir(projectRoot);
		const sharedRoot = await realpath("/tmp");
		const source = new CommonspaceHostService(
			{},
			{ root: join(root, "state") },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({
					text: "Portable reply.",
					sessionId: "123e4567-e89b-42d3-a456-426614174777",
				}),
			},
		);
		await source.initialize();
		await addTestHarness(source, "codex", "Review Bot");
		await source.mutate({
			action: "set-defaults",
			maxAgentsPerTurn: 6,
			memoryThreads: 8,
		});
		await source.mutate({
			action: "create-channel",
			name: "portable-room",
			agentIds: ["codex"],
		});
		await source.mutate({
			action: "set-notifications",
			notifications: {
				enabled: true,
				replies: true,
				mentions: true,
				permissions: true,
				failures: true,
				sound: false,
			},
		});
		const project = mustExist(
			(
				await source.mutate({
					action: "create-project",
					name: "Portable App",
					paths: [projectRoot, sharedRoot],
				})
			).projects[0],
		);
		await source.send({
			conversation: { kind: "dm", id: "codex" },
			projectIds: [project.id],
			text: "Keep portable history.",
			files: [
				{
					name: "opaque.bin",
					mimeType: "application/octet-stream",
					data: sharedRoot,
				},
			],
		});
		await source.whenIdle();
		const exportWorkspace = source.exportWorkspace;

		const archive = await exportWorkspace.call(source);
		const serialized = JSON.stringify(archive);
		expect(archive).toMatchObject({
			format: "commonspace-workspace",
			version: 2,
			workspace: {
				projects: [{ id: project.id, name: "Portable App", rootCount: 2 }],
			},
			attachments: [
				expect.objectContaining({ name: "opaque.bin", data: sharedRoot }),
			],
		});
		expect(serialized).not.toContain(await realpath(projectRoot));
		expect(serialized).not.toContain("123e4567-e89b-42d3-a456-426614174777");
		expect(serialized).not.toContain("agentSessions");
		expect(serialized).not.toContain("dmSessions");
		await source.close();

		const targetRoot = await mkdtemp(
			join(tmpdir(), "commonspace-export-target-"),
		);
		roots.push(targetRoot);
		const mappedProject = join(targetRoot, "mapped-project");
		await mkdir(mappedProject);
		let importedNotificationCount = 0;
		const target = new CommonspaceHostService(
			{},
			{ root: join(targetRoot, "state") },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "No run expected." }),
				notify: async () => {
					importedNotificationCount += 1;
				},
			},
		);
		await target.initialize();
		target.attachClientUrl("http://127.0.0.1:3100");
		const importWorkspace = target.importWorkspace;
		const mappings = { [project.id]: [mappedProject, targetRoot] };
		const malformed = structuredClone(archive);
		malformed.workspace.channels.push({});
		await expect(
			importWorkspace.call(target, malformed, mappings),
		).rejects.toThrow("workspace archive failed structural validation");
		await importWorkspace.call(target, archive, mappings);

		expect(importedNotificationCount).toBe(0);
		expect(target.snapshot().defaults).toMatchObject({
			maxAgentsPerTurn: 6,
			memoryThreads: 8,
		});
		expect(target.snapshot().channels[0]).toMatchObject({
			name: "portable-room",
			agentIds: ["codex"],
		});
		expect(target.snapshot().channels[0]).not.toHaveProperty("settings");
		expect(target.snapshot().projects[0]).toMatchObject({
			id: project.id,
			paths: [await realpath(mappedProject), await realpath(targetRoot)],
		});
		expect(
			target.snapshot().messages["dm:codex"]?.map((message) => message.text),
		).toEqual(["Keep portable history.", "Portable reply."]);
		expect(target.snapshot().agentSessions).toEqual({});
		expect(target.snapshot().dmSessions).toEqual({});
		const fileId = target.snapshot().messages["dm:codex"]?.[0]?.files?.[0]?.id;
		await expect(
			target.readFileAttachment(mustExist(fileId)),
		).resolves.toMatchObject({
			data: Buffer.from(sharedRoot, "base64"),
		});
		await expect(
			importWorkspace.call(target, archive, mappings),
		).rejects.toThrow("workspace import requires an empty workspace");
		await target.close();
	});
});
