// @vitest-environment node
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommonspaceState } from "@commonspace/shared";
import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CommonspaceHostService } from "../server/src/service.ts";
import { applyMutation, createInitialState } from "../server/src/state.ts";

const timestamp = "2026-09-01T00:00:00.000Z";
const roots: string[] = [];
const services: CommonspaceHostService[] = [];

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function workspaceRoot(): Promise<string> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "commonspace-durable-boundaries-")),
	);
	roots.push(root);
	return root;
}

function savedConversation(text: string): CommonspaceState {
	const state = createInitialState();
	state.revision = 7;
	state.agents = [
		{
			id: "codex",
			displayName: "Codex",
			adapter: "codex",
			model: null,
			createdAt: timestamp,
		},
	];
	state.messages["dm:codex"] = [
		{
			id: "message-1",
			conversation: { kind: "dm", id: "codex" },
			authorType: "user",
			authorId: "user",
			authorName: "User",
			text,
			createdAt: timestamp,
			replyStatus: "complete",
		},
	];
	return state;
}

async function openWorkspace(
	root: string,
	state?: CommonspaceState,
): Promise<CommonspaceHostService> {
	if (state !== undefined)
		await writeFile(join(root, "state.json"), JSON.stringify(state));
	const service = new CommonspaceHostService(
		{},
		{ root },
		{ discoverAgents: async () => [] },
	);
	await service.initialize();
	services.push(service);
	return service;
}

async function archiveFixture(text = "Imported conversation.") {
	const source = await openWorkspace(
		await workspaceRoot(),
		savedConversation(text),
	);
	return source.exportWorkspace();
}

describe("workspace recovery boundaries", () => {
	it("restores a missing primary from its backup after an interrupted recovery", async () => {
		const root = await workspaceRoot();
		const saved = savedConversation("Preserve the recovered conversation.");
		const backup = JSON.stringify(saved);
		const corrupt = '{"version":';
		await writeFile(join(root, "state.backup.json"), backup);
		await writeFile(join(root, "state.corrupt.json"), corrupt);

		const service = await openWorkspace(root);

		expect(service.snapshot().messages).toEqual(saved.messages);
		expect(await readFile(join(root, "state.json"), "utf8")).toContain(
			"Preserve the recovered conversation.",
		);
		expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
			backup,
		);
		expect(await readFile(join(root, "state.corrupt.json"), "utf8")).toBe(
			corrupt,
		);
	});

	it.each(['{"version":', '{"version":999}'])(
		"fails closed with a missing primary and invalid backup %s",
		async (backup) => {
			const root = await workspaceRoot();
			await writeFile(join(root, "state.backup.json"), backup);

			await expect(openWorkspace(root)).rejects.toThrow(
				"Commonspace state and rollback backup are both invalid",
			);

			expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
				backup,
			);
			await expect(readFile(join(root, "state.json"))).rejects.toMatchObject({
				code: "ENOENT",
			});
		},
	);

	it("does not replace an orphaned corrupt-state record with a fresh workspace", async () => {
		const root = await workspaceRoot();
		await writeFile(join(root, "state.corrupt.json"), "unrecoverable history");

		await expect(openWorkspace(root)).rejects.toThrow(
			"Commonspace saved state is corrupt and no rollback backup is available",
		);
		await expect(readFile(join(root, "state.json"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await readFile(join(root, "state.corrupt.json"), "utf8")).toBe(
			"unrecoverable history",
		);
	});
});

describe("exclusive workspace import", () => {
	it("rejects overlapping imports and mutations, then releases admission after success", async () => {
		const archive = await archiveFixture("The winning import.");
		const competing = structuredClone(archive);
		const competingMessage = competing.workspace.messages["dm:codex"]?.[0];
		if (competingMessage === undefined)
			throw new Error("missing fixture message");
		competingMessage.text = "The rejected import.";
		const target = await openWorkspace(await workspaceRoot());

		const importing = target.importWorkspace(z.json().parse(archive), {});
		const second = target.importWorkspace(z.json().parse(competing), {});
		const mutation = target.mutate({
			action: "create-channel",
			name: "blocked",
			agentIds: [],
		});
		await Promise.all([
			expect(second).rejects.toThrow("workspace import is in progress"),
			expect(mutation).rejects.toThrow("workspace import is in progress"),
		]);
		await importing;

		expect(
			target.snapshot().messages["dm:codex"]?.map((message) => message.text),
		).toEqual(["The winning import."]);
		expect(target.snapshot().channels).toEqual([]);
		const persisted = await readFile(join(target.root, "state.json"), "utf8");
		expect(persisted).toContain("The winning import.");
		expect(persisted).not.toContain("The rejected import.");
		await target.mutate({
			action: "create-channel",
			name: "after-import",
			agentIds: [],
		});
		expect(target.snapshot().channels[0]?.name).toBe("after-import");
	});

	it("rejects import while an existing mutation admission is in flight", async () => {
		const archive = await archiveFixture();
		const target = await openWorkspace(await workspaceRoot());
		const mutation = target.mutate({
			action: "create-project",
			name: "Existing mutation",
			paths: [target.root],
		});

		await expect(
			target.importWorkspace(z.json().parse(archive), {}),
		).rejects.toThrow("workspace import requires no in-flight operations");
		await mutation;

		expect(target.snapshot().projects[0]?.name).toBe("Existing mutation");
		expect(target.snapshot().messages).toEqual({});
	});

	it("releases exclusive admission after archive validation fails", async () => {
		const archive = await archiveFixture();
		const target = await openWorkspace(await workspaceRoot());

		await expect(
			target.importWorkspace(z.json().parse({ ...archive, version: 999 }), {}),
		).rejects.toThrow("unsupported Commonspace workspace archive");
		await target.importWorkspace(z.json().parse(archive), {});

		expect(target.snapshot().messages["dm:codex"]?.[0]?.text).toBe(
			"Imported conversation.",
		);
	});

	it("rolls back bytes and releases admission when state persistence fails", async () => {
		const archive = await archiveFixture();
		const message = archive.workspace.messages["dm:codex"]?.[0];
		if (message === undefined) throw new Error("missing fixture message");
		const bytes = Buffer.from("Exact imported attachment.");
		const metadata = {
			id: "223e4567-e89b-42d3-a456-426614174111",
			name: "exact.bin",
			mimeType: "application/octet-stream",
			size: bytes.length,
		};
		message.files = [metadata];
		archive.attachments = [
			{ kind: "file", ...metadata, data: bytes.toString("base64") },
		];
		const target = await openWorkspace(await workspaceRoot());
		const statePath = join(target.root, "state.json");
		await rm(statePath);
		await mkdir(statePath);

		await expect(
			target.importWorkspace(z.json().parse(archive), {}),
		).rejects.toMatchObject({ code: "EISDIR" });

		expect(target.snapshot().revision).toBe(0);
		expect(target.snapshot().messages).toEqual({});
		await expect(
			readFile(join(target.root, "attachments", metadata.id)),
		).rejects.toMatchObject({ code: "ENOENT" });
		await rm(statePath, { recursive: true });
		await writeFile(statePath, JSON.stringify(createInitialState()));
		await target.importWorkspace(z.json().parse(archive), {});
		await expect(target.readFileAttachment(metadata.id)).resolves.toMatchObject(
			{
				data: bytes,
			},
		);
	});
});

describe("portable authored content and managed metadata", () => {
	it("round-trips authored paths and context while keeping managed secrets private and attachment bytes exact", async () => {
		const root = await workspaceRoot();
		const projectRoot = join(root, "project");
		await mkdir(projectRoot);
		const nativeSessionId = "123e4567-e89b-42d3-a456-426614174777";
		const apiKey = "synthetic-portability-secret";
		const authored =
			"Read " +
			projectRoot +
			"/src/main.ts; workspace " +
			root +
			"; session " +
			nativeSessionId +
			".";
		let state = savedConversation(authored);
		state.projects = [
			{
				id: "project-1",
				name: "Project",
				paths: [projectRoot],
				createdAt: timestamp,
			},
		];
		state.agentSessions = { codex: { "Bot Chat": nativeSessionId } };
		state = applyMutation(
			state,
			{ action: "create-channel", name: "context", agentIds: ["codex"] },
			{ ids: () => "channel-1", now: () => timestamp },
		);
		state = applyMutation(state, {
			action: "set-channel-configuration",
			channelId: "channel-1",
			agentIds: ["codex"],
			instructions: authored,
			summary: authored,
			decisions: [authored],
			openQuestions: [authored],
		});
		state.pins = [
			{
				id: "pin-1",
				scope: { kind: "channel", id: "channel-1" },
				kind: "note",
				note: authored,
				createdAt: timestamp,
				removedAt: null,
			},
		];
		const managedText =
			root + " " + projectRoot + " " + nativeSessionId + " " + apiKey;
		state.messages["dm:codex"]?.push({
			id: "reply-1",
			conversation: { kind: "dm", id: "codex" },
			authorType: "agent",
			authorId: "codex",
			authorName: "Codex",
			text: "Reply: " + authored,
			createdAt: timestamp,
			replyStatus: "error",
			replyError: managedText,
			trace: {
				adapter: "codex",
				startedAt: timestamp,
				completedAt: timestamp,
				entries: [
					{
						type: "tool",
						id: "tool-1",
						title: "Read project",
						status: "failed",
						input: managedText,
						createdAt: timestamp,
						updatedAt: timestamp,
					},
				],
			},
		});
		const bytes = Buffer.from(authored + "\n" + apiKey);
		const metadata = {
			id: "223e4567-e89b-42d3-a456-426614174222",
			name: "authored.bin",
			mimeType: "application/octet-stream",
			size: bytes.length,
		};
		const userMessage = state.messages["dm:codex"]?.[0];
		if (userMessage === undefined) throw new Error("missing fixture message");
		userMessage.files = [metadata];
		await mkdir(join(root, "attachments"));
		await writeFile(join(root, "attachments", metadata.id), bytes);
		await writeFile(
			join(root, "routing.json"),
			JSON.stringify({
				provider: CommonspaceRoutingProvider.OpenAiCompatible,
				model: "test-model",
				harnessAgentId: null,
				baseUrl: "https://api.openai.com/v1",
				apiKey,
			}),
		);
		const source = await openWorkspace(root, state);

		const archive = await source.exportWorkspace();

		expect(
			archive.workspace.messages["dm:codex"]?.map((message) => message.text),
		).toEqual([authored, "Reply: " + authored]);
		expect(archive.workspace.channels).toEqual(source.snapshot().channels);
		expect(archive.workspace.pins).toEqual(source.snapshot().pins);
		expect(archive.workspace).not.toHaveProperty("dmSessions");
		expect(archive.workspace).not.toHaveProperty("agentSessions");
		expect(archive.workspace).not.toHaveProperty("routing");
		expect(archive.workspace.projects).toEqual([
			{ id: "project-1", name: "Project", rootCount: 1, createdAt: timestamp },
		]);
		const reply = archive.workspace.messages["dm:codex"]?.[1];
		expect(reply?.trace?.entries).toHaveLength(1);
		const managed = JSON.stringify({
			projects: archive.workspace.projects,
			agents: archive.workspace.agents,
			permissions: archive.workspace.permissions,
			trace: reply?.trace,
			replyError: reply?.replyError,
		});
		for (const privateValue of [root, projectRoot, nativeSessionId, apiKey])
			expect(managed).not.toContain(privateValue);
		expect(archive.attachments[0]?.data).toBe(bytes.toString("base64"));

		const target = await openWorkspace(await workspaceRoot());
		const imported = await target.importWorkspace(z.json().parse(archive), {
			"project-1": [target.root],
		});
		expect(
			imported.messages["dm:codex"]?.map((message) => message.text),
		).toEqual([authored, "Reply: " + authored]);
		expect(imported.channels).toEqual(archive.workspace.channels);
		expect(imported.pins).toEqual(archive.workspace.pins);
		await expect(target.readFileAttachment(metadata.id)).resolves.toMatchObject(
			{
				data: bytes,
			},
		);
	});
});
