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
	it.each(["invalid", "noncanonical"] as const)(
		"recovers schedules from backup when current state has %s schedules",
		async (damage) => {
			const root = await workspaceRoot();
			const saved = applyMutation(savedConversation("Keep this work."), {
				action: "create-channel",
				name: "updates",
				agentIds: [],
			});
			const channel = saved.channels[0];
			if (channel === undefined) throw new Error("missing test Channel");
			saved.schedules.push({
				id: "schedule-1",
				title: "Daily update",
				channelId: channel.id,
				text: "Check the build.",
				timing: { kind: "once", runAt: "2030-01-01T00:00:00.000Z" },
				paused: false,
				nextRunAt: "2030-01-01T00:00:00.000Z",
				lastRunAt: null,
				createdAt: timestamp,
			});
			const backup = JSON.stringify(saved);
			const primary = JSON.stringify({
				...saved,
				schedules:
					damage === "invalid"
						? {}
						: saved.schedules.map((schedule) => ({
								...schedule,
								title: ` ${schedule.title} `,
							})),
			});
			await writeFile(join(root, "state.json"), primary);
			await writeFile(join(root, "state.backup.json"), backup);

			const service = await openWorkspace(root);
			expect(service.snapshot().schedules).toEqual(saved.schedules);
			expect(await readFile(join(root, "state.corrupt.json"), "utf8")).toBe(
				primary,
			);
			expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
				backup,
			);
		},
	);

	it("migrates a dual emoji-version-35 pair from the newer primary without losing native sessions", async () => {
		const root = await workspaceRoot();
		const scope = "Commonspace DM: 00000000-0000-4000-8000-000000000001";
		const saved = applyMutation(
			savedConversation("Newer primary conversation."),
			{
				action: "create-channel",
				name: "updates",
				agentIds: ["codex"],
			},
		);
		saved.projects = [
			{
				id: "project-1",
				name: "Work",
				emoji: "🧭",
				paths: [root],
				createdAt: timestamp,
			},
		];
		const channel = saved.channels[0];
		if (channel === undefined) throw new Error("missing test Channel");
		channel.emoji = "🧩";
		saved.dmSessions = { codex: scope };
		saved.agentSessions = { codex: { [scope]: "native-session-1" } };
		const primary = JSON.stringify({
			...saved,
			version: 35,
			schedules: undefined,
		});
		const prior = structuredClone(saved);
		const priorMessage = prior.messages["dm:codex"]?.[0];
		if (priorMessage === undefined) throw new Error("missing test message");
		priorMessage.text = "Older backup conversation.";
		const backup = JSON.stringify({
			...prior,
			version: 35,
			schedules: undefined,
		});
		await writeFile(join(root, "state.json"), primary);
		await writeFile(join(root, "state.backup.json"), backup);

		const service = await openWorkspace(root);
		const state = service.snapshot();
		expect(state.version).toBe(36);
		expect(state.schedules).toEqual([]);
		expect(state.projects[0]?.emoji).toBe("🧭");
		expect(state.channels[0]?.emoji).toBe("🧩");
		expect(state.messages["dm:codex"]?.[0]?.text).toBe(
			"Newer primary conversation.",
		);
		expect(state.dmSessions).toEqual({ codex: scope });
		expect(state.agentSessions).toEqual({
			codex: { [scope]: "native-session-1" },
		});
		expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
			primary,
		);
		await service.close();
		services.splice(services.indexOf(service), 1);
		const restarted = await openWorkspace(root);
		expect(restarted.snapshot().messages["dm:codex"]?.[0]?.text).toBe(
			"Newer primary conversation.",
		);
		expect(restarted.snapshot().agentSessions).toEqual({
			codex: { [scope]: "native-session-1" },
		});
	});

	it.each(["primary", "backup"] as const)(
		"migrates a sole marked emoji-version-35 %s",
		async (location) => {
			const root = await workspaceRoot();
			const saved = savedConversation("Keep this sole conversation.");
			saved.projects = [
				{
					id: "project-1",
					name: "Work",
					emoji: "🧭",
					paths: [root],
					createdAt: timestamp,
				},
			];
			const raw = JSON.stringify({
				...saved,
				version: 35,
				schedules: undefined,
			});
			await writeFile(
				join(root, location === "primary" ? "state.json" : "state.backup.json"),
				raw,
			);

			const service = await openWorkspace(root);
			expect(service.snapshot().version).toBe(36);
			expect(service.snapshot().schedules).toEqual([]);
			expect(service.snapshot().projects[0]?.emoji).toBe("🧭");
			expect(service.snapshot().messages["dm:codex"]?.[0]?.text).toBe(
				"Keep this sole conversation.",
			);
			expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(raw);
		},
	);

	it.each(["mixed", "unmarked"] as const)(
		"preserves both raw files when version-35 recovery is %s",
		async (kind) => {
			const root = await workspaceRoot();
			const saved = savedConversation("Newer primary conversation.");
			if (kind === "mixed") {
				saved.projects = [
					{
						id: "project-1",
						name: "Work",
						emoji: "🧭",
						paths: [root],
						createdAt: timestamp,
					},
				];
			}
			const primary = JSON.stringify({
				...saved,
				version: 35,
				schedules: undefined,
			});
			const backupState = structuredClone(saved);
			const backupMessage = backupState.messages["dm:codex"]?.[0];
			if (backupMessage === undefined) throw new Error("missing test message");
			backupMessage.text = "Older backup conversation.";
			const backup = JSON.stringify({
				...backupState,
				version: 35,
				schedules: [],
			});
			await writeFile(join(root, "state.json"), primary);
			await writeFile(join(root, "state.backup.json"), backup);

			await expect(openWorkspace(root)).rejects.toThrow(
				"version-35 state without schedules requires manual recovery",
			);
			expect(await readFile(join(root, "state.json"), "utf8")).toBe(primary);
			expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
				backup,
			);
			await expect(
				readFile(join(root, "state.corrupt.json")),
			).rejects.toMatchObject({
				code: "ENOENT",
			});
		},
	);

	it("preserves an invalid strict primary and an emoji-version-35 backup", async () => {
		const root = await workspaceRoot();
		const saved = savedConversation("Newer primary conversation.");
		const primary = JSON.stringify({ ...saved, version: 35, schedules: {} });
		const older = savedConversation("Older backup conversation.");
		older.projects = [
			{
				id: "project-1",
				name: "Work",
				emoji: "🧭",
				paths: [root],
				createdAt: timestamp,
			},
		];
		const backup = JSON.stringify({
			...older,
			version: 35,
			schedules: undefined,
		});
		await writeFile(join(root, "state.json"), primary);
		await writeFile(join(root, "state.backup.json"), backup);

		await expect(openWorkspace(root)).rejects.toThrow(
			"version-35 state without schedules requires manual recovery",
		);
		expect(await readFile(join(root, "state.json"), "utf8")).toBe(primary);
		expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
			backup,
		);
	});

	it("loads the newer version-36 primary when cosmetic emoji needs normalization", async () => {
		const root = await workspaceRoot();
		const saved = savedConversation("Newer primary conversation.");
		saved.projects = [
			{
				id: "project-1",
				name: "Work",
				emoji: " 🧭 ",
				paths: [root],
				createdAt: timestamp,
			},
		];
		const primary = JSON.stringify(saved);
		const backup = JSON.stringify(
			savedConversation("Older backup conversation."),
		);
		await writeFile(join(root, "state.json"), primary);
		await writeFile(join(root, "state.backup.json"), backup);

		const service = await openWorkspace(root);
		expect(service.snapshot().messages["dm:codex"]?.[0]?.text).toBe(
			"Newer primary conversation.",
		);
		expect(service.snapshot().projects[0]?.emoji).toBe("🧭");
		await expect(
			readFile(join(root, "state.corrupt.json")),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

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
		const privateToken = "synthetic-portability-secret";
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
		const managedText = root + " " + projectRoot + " " + nativeSessionId;
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
		const bytes = Buffer.from(authored + "\n" + privateToken);
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
		for (const privateValue of [root, projectRoot, nativeSessionId])
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
