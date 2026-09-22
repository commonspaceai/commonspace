import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMONSPACE_STATE_VERSION } from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentRunInput,
	type CommonspaceHostEnvironment,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { createInitialState } from "../server/src/state.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

function deletionService(
	root: string,
	environment: CommonspaceHostEnvironment,
) {
	const service = new CommonspaceHostService(
		environment,
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => ({
				text: "Deletion-safe reply.",
				sessionId: "native-deletion-session",
			}),
		},
	);
	services.push(service);
	return service;
}

async function deletionWorkspace() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-message-deletion-"));
	roots.push(root);
	const service = deletionService(root, {});
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	const channel = mustExist(
		(
			await service.mutate({
				action: "create-channel",
				name: "deletions",
				agentIds: ["codex"],
			})
		).channels[0],
	);
	const sent = await service.send({
		conversation: { kind: "channel", id: channel.id },
		text: "@review-bot remove secret-delete-body after delivery.",
		attachments: [{ name: "remove.png", mimeType: "image/png", data: "AA==" }],
		files: [{ name: "remove.txt", mimeType: "text/plain", data: "cmVtb3Zl" }],
	});
	await service.whenIdle();
	const imageId = mustExist(sent.accepted.attachments?.[0]).id;
	const fileId = mustExist(sent.accepted.files?.[0]).id;
	return {
		root,
		service,
		channel,
		sent,
		imageId,
		fileId,
		imagePath: join(root, "attachments", imageId),
		filePath: join(root, "attachments", fileId),
	};
}

function deletionBoundary(service: CommonspaceHostService) {
	// biome-ignore lint/nursery/noUnsafeTypeAssertion lint/plugin: Test-only access to the service's known private I/O methods avoids a production dependency seam.
	return service as unknown as {
		removeFileAttachments(ids: readonly string[]): Promise<void>;
		persist(): Promise<void>;
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("message versions", () => {
	it("branches an edited human message into a new Thread and native session", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-message-version-"));
		roots.push(root);
		const runAgent = vi.fn(async (input: AgentRunInput) => ({
			text: `Reply to: ${input.message}`,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent,
			},
		);
		services.push(service);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const firstPath = join(root, "first-project");
		const secondPath = join(root, "second-project");
		await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
		const firstProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "First",
					paths: [firstPath],
				})
			).projects[0],
		);
		const secondProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Second",
					paths: [secondPath],
				})
			).projects[1],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "versions",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const original = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectIds: [firstProject.id],
			text: "@review-bot inspect the original boundary.",
		});
		await service.whenIdle();
		const editMessage = service.editMessage;

		const edited = await editMessage.call(service, {
			messageId: original.accepted.id,
			text: "@review-bot @@second inspect only the corrected boundary.",
		});
		await service.whenIdle();

		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		const editedMessage = messages.find(
			(message) => message.id === edited.accepted.id,
		);
		expect(edited.thread?.id).not.toBe(original.thread?.id);
		expect(editedMessage).toMatchObject({
			text: "@review-bot @@second inspect only the corrected boundary.",
			projectIds: [secondProject.id],
			versionRootMessageId: original.accepted.id,
			supersedesMessageId: original.accepted.id,
			branchId: expect.any(String),
		});
		expect(
			messages.find((message) => message.id === original.accepted.id)?.text,
		).toBe("@review-bot inspect the original boundary.");
		expect(messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sourceMessageId: original.accepted.id,
					text: "Reply to: @review-bot inspect the original boundary.",
				}),
				expect.objectContaining({
					sourceMessageId: edited.accepted.id,
					text: "Reply to: @review-bot @@second inspect only the corrected boundary.",
				}),
			]),
		);
		expect(runAgent.mock.calls.map((call) => call[0].sessionName)).toHaveLength(
			2,
		);
		expect(runAgent.mock.calls[0]?.[0].sessionName).not.toBe(
			runAgent.mock.calls[1]?.[0].sessionName,
		);

		const agentReply = mustExist(
			messages.find((message) => message.authorType === "agent"),
		);
		await expect(
			editMessage.call(service, {
				messageId: agentReply.id,
				text: "Pretend this was native output.",
			}),
		).rejects.toThrow("only human messages can be edited");
	});

	it("rotates the native DM generation for an edited human message", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-dm-version-"));
		roots.push(root);
		const runAgent = vi.fn(async (input: AgentRunInput) => ({
			text: `Reply to: ${input.message}`,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent,
			},
		);
		services.push(service);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const original = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Inspect the original DM boundary.",
		});
		await service.whenIdle();

		const edited = await service.editMessage({
			messageId: original.accepted.id,
			text: "Inspect only the corrected DM boundary.",
		});
		await service.whenIdle();

		expect(runAgent.mock.calls.map((call) => call[0].sessionName)).toEqual([
			"Bot Chat",
			expect.stringMatching(/^Commonspace DM: /u),
		]);
		expect(service.snapshot().messages["dm:codex"]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: original.accepted.id,
					text: "Inspect the original DM boundary.",
				}),
				expect.objectContaining({
					id: edited.accepted.id,
					text: "Inspect only the corrected DM boundary.",
					versionRootMessageId: original.accepted.id,
					supersedesMessageId: original.accepted.id,
				}),
				expect.objectContaining({
					authorType: "system",
					text: expect.stringContaining("New session started"),
				}),
			]),
		);
	});

	it("does not rotate a DM generation when the edited version is invalid", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-invalid-dm-version-"),
		);
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Reply." }),
			},
		);
		services.push(service);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const original = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Valid original.",
		});
		await service.whenIdle();

		await expect(
			service.editMessage({ messageId: original.accepted.id, text: "   " }),
		).rejects.toThrow("message text or image is required");

		expect(service.snapshot().dmSessions.codex).toBeUndefined();
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.some(
					(message) => message.authorType === "system",
				),
		).toBe(false);
	});

	it("carries only pre-branch Thread history into an edited reply branch", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-thread-reply-version-"),
		);
		roots.push(root);
		const scopes: NonNullable<AgentRunInput["commonspaceScope"]>[] = [];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					if (input.commonspaceScope !== undefined)
						scopes.push(input.commonspaceScope);
					return { text: `Reply to: ${input.message}` };
				},
			},
		);
		services.push(service);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "reply-branches",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot establish branch context.",
		});
		await service.whenIdle();
		const followup = await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(first.thread).id,
			targetAgentId: "codex",
			text: "Superseded follow-up body.",
		});
		await service.whenIdle();

		const edited = await service.editMessage({
			messageId: followup.accepted.id,
			text: "@review-bot corrected follow-up body.",
		});
		await service.whenIdle();

		expect(edited.thread).toMatchObject({
			branchedFromThreadId: mustExist(first.thread).id,
			branchPointMessageId: followup.accepted.id,
		});
		const context = await service.readContext(mustExist(scopes.at(-1)));
		expect(context.messages.map((message) => message.text)).toEqual([
			"@review-bot establish branch context.",
			"Reply to: @review-bot establish branch context.",
			"@review-bot corrected follow-up body.",
			"Reply to: @review-bot corrected follow-up body.",
		]);
	});

	it("tombstones delivered content while preserving replies and session identity", async () => {
		const { root, service, channel, sent, imageId, imagePath, filePath } =
			await deletionWorkspace();
		expect(await readFile(imagePath)).toEqual(Buffer.from([0]));
		expect(await readFile(filePath, "utf8")).toBe("remove");
		const sessions = service.snapshot().agentSessions;
		expect(JSON.stringify(sessions)).toContain("native-deletion-session");

		await service.deleteMessage(sent.accepted.id);

		const messages = mustExist(
			service.snapshot().messages[`channel:${channel.id}`],
		);
		const tombstone = mustExist(
			messages.find((message) => message.id === sent.accepted.id),
		);
		expect(tombstone).toMatchObject({
			text: "",
			deletedAt: expect.any(String),
			routing: expect.objectContaining({ source: "explicit" }),
		});
		expect(tombstone.attachments).toBeUndefined();
		expect(tombstone.files).toBeUndefined();
		expect(messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					authorType: "agent",
					text: "Deletion-safe reply.",
				}),
			]),
		);
		expect(JSON.stringify(service.snapshot())).not.toContain(
			"secret-delete-body",
		);
		await expect(readFile(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(service.readImageAttachment(imageId)).rejects.toThrow(
			"unknown image attachment",
		);
		await expect(
			service.editMessage({
				messageId: sent.accepted.id,
				text: "Revive deleted content.",
			}),
		).rejects.toThrow("deleted messages cannot be edited");

		await service.close();
		const restarted = deletionService(root, {});
		await restarted.initialize();
		expect(restarted.snapshot().agentSessions).toEqual(sessions);
		expect(restarted.snapshot().messages[`channel:${channel.id}`]).toEqual(
			messages,
		);
		expect(restarted.snapshot()).not.toHaveProperty(
			"pendingAttachmentDeletions",
		);
	});

	it("persists private cleanup intent after partial deletion and completes it on restart", async () => {
		const {
			root,
			service,
			channel,
			sent,
			imageId,
			fileId,
			imagePath,
			filePath,
		} = await deletionWorkspace();
		const cleanup = vi
			.spyOn(deletionBoundary(service), "removeFileAttachments")
			.mockRejectedValueOnce(new Error("synthetic cleanup failure"));

		await expect(service.deleteMessage(sent.accepted.id)).rejects.toThrow(
			"attachment cleanup is pending",
		);
		cleanup.mockRestore();

		await expect(readFile(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(filePath, "utf8")).toBe("remove");
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).toMatchObject({
			pendingAttachmentDeletions: { imageIds: [imageId], fileIds: [fileId] },
			messages: {
				[`channel:${channel.id}`]: expect.arrayContaining([
					expect.objectContaining({
						id: sent.accepted.id,
						text: "",
						deletedAt: expect.any(String),
					}),
				]),
			},
		});
		expect((await service.bootstrap()).state).not.toHaveProperty(
			"pendingAttachmentDeletions",
		);
		expect((await service.exportWorkspace()).workspace).not.toHaveProperty(
			"pendingAttachmentDeletions",
		);

		await service.close();
		const restarted = deletionService(root, {});
		await restarted.initialize();
		await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).not.toHaveProperty("pendingAttachmentDeletions");
		expect(JSON.stringify(restarted.snapshot())).not.toContain(
			"secret-delete-body",
		);
	});

	it("keeps startup available after cleanup failure and lets the deletion be retried", async () => {
		const { root, service, sent, imagePath, filePath } =
			await deletionWorkspace();
		vi.spyOn(
			deletionBoundary(service),
			"removeFileAttachments",
		).mockRejectedValueOnce(new Error("synthetic cleanup failure"));
		await expect(service.deleteMessage(sent.accepted.id)).rejects.toThrow(
			"attachment cleanup is pending",
		);
		const messages = service.snapshot().messages;
		await service.close();
		const warn = vi.fn();
		const restarted = deletionService(root, {
			logger: { info: vi.fn(), warn },
		});
		const cleanup = vi
			.spyOn(deletionBoundary(restarted), "removeFileAttachments")
			.mockRejectedValueOnce(new Error("synthetic startup cleanup failure"));

		await restarted.initialize();
		cleanup.mockRestore();

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Attachment cleanup is pending"),
		);
		expect(restarted.snapshot().messages).toEqual(messages);
		expect(await readFile(filePath, "utf8")).toBe("remove");
		await restarted.deleteMessage(sent.accepted.id);
		await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).not.toHaveProperty("pendingAttachmentDeletions");
	});

	it("migrates v32 without losing conversations, attachments, or native sessions", async () => {
		const { root, service, imagePath, filePath } = await deletionWorkspace();
		const saved = service.snapshot();
		expect(JSON.stringify(saved.agentSessions)).toContain(
			"native-deletion-session",
		);
		await service.close();
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({ ...saved, version: 32 }),
		);

		const restarted = deletionService(root, {});
		await restarted.initialize();

		expect(restarted.snapshot().version).toBe(COMMONSPACE_STATE_VERSION);
		expect(restarted.snapshot().messages).toEqual(saved.messages);
		expect(restarted.snapshot().agentSessions).toEqual(saved.agentSessions);
		expect(restarted.snapshot()).not.toHaveProperty(
			"pendingAttachmentDeletions",
		);
		expect(await readFile(imagePath)).toEqual(Buffer.from([0]));
		expect(await readFile(filePath, "utf8")).toBe("remove");
	});

	it("keeps overlapping deletion bytes recoverable when cleanup acknowledgement and the next commit fail", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-deletion-overlap-"));
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => ({ text: "Reply." }),
			},
		);
		services.push(service);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const first = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Delete first.",
			files: [{ name: "first.txt", mimeType: "text/plain", data: "Zmlyc3Q=" }],
		});
		await service.whenIdle();
		const second = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Keep second if commit fails.",
			files: [{ name: "second.txt", mimeType: "text/plain", data: "c2Vjb25k" }],
		});
		await service.whenIdle();
		const firstId = mustExist(first.accepted.files?.[0]).id;
		const secondId = mustExist(second.accepted.files?.[0]).id;
		const boundary = deletionBoundary(service);
		const originalCleanup = boundary.removeFileAttachments.bind(service);
		let releaseCleanup = () => {};
		let signalCleanup = () => {};
		const cleanupStarted = new Promise<void>((resolve) => {
			signalCleanup = resolve;
		});
		const cleanupReleased = new Promise<void>((resolve) => {
			releaseCleanup = resolve;
		});
		const cleanup = vi
			.spyOn(boundary, "removeFileAttachments")
			.mockImplementationOnce(async (ids) => {
				signalCleanup();
				await cleanupReleased;
				await originalCleanup(ids);
			});
		const firstDeletion = service.deleteMessage(first.accepted.id);
		const deletions = [firstDeletion];
		try {
			await cleanupStarted;
			const persistence = vi
				.spyOn(boundary, "persist")
				.mockRejectedValueOnce(new Error("synthetic acknowledgement failure"))
				.mockRejectedValueOnce(new Error("synthetic next commit failure"));
			const secondDeletion = service.deleteMessage(second.accepted.id);
			deletions.push(secondDeletion);
			const outcomes = Promise.allSettled(deletions);
			expect(
				service
					.snapshot()
					.messages["dm:codex"]?.find(
						(message) => message.id === second.accepted.id,
					)?.text,
			).toBe("Keep second if commit fails.");
			releaseCleanup();
			expect(await outcomes).toMatchObject([
				{
					status: "rejected",
					reason: {
						message: expect.stringContaining("attachment cleanup is pending"),
						cause: { message: "synthetic acknowledgement failure" },
					},
				},
				{
					status: "rejected",
					reason: { message: "synthetic next commit failure" },
				},
			]);
			persistence.mockRestore();
		} finally {
			releaseCleanup();
			await Promise.allSettled(deletions);
			cleanup.mockRestore();
		}
		await expect(
			readFile(join(root, "attachments", firstId)),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(join(root, "attachments", secondId), "utf8")).toBe(
			"second",
		);
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).toMatchObject({
			pendingAttachmentDeletions: { imageIds: [], fileIds: [firstId] },
		});
		await service.close();
		const restarted = deletionService(root, {});
		await restarted.initialize();
		expect(
			restarted
				.snapshot()
				.messages["dm:codex"]?.find(
					(message) => message.id === second.accepted.id,
				)?.text,
		).toBe("Keep second if commit fails.");
		expect(await readFile(join(root, "attachments", secondId), "utf8")).toBe(
			"second",
		);
		expect(restarted.snapshot()).not.toHaveProperty(
			"pendingAttachmentDeletions",
		);
	});

	it.each(["../retained.txt", "..\\retained.txt", "/retained.txt"])(
		"rejects a saved cleanup ID outside managed attachment storage: %s",
		async (id) => {
			const root = await mkdtemp(
				join(tmpdir(), "commonspace-deletion-validation-"),
			);
			roots.push(root);
			await writeFile(join(root, "retained.txt"), "Retained bytes.");
			await writeFile(
				join(root, "state.json"),
				JSON.stringify({
					...createInitialState(),
					pendingAttachmentDeletions: { imageIds: [], fileIds: [id] },
				}),
			);
			const service = new CommonspaceHostService({}, { root });
			services.push(service);
			await expect(service.initialize()).rejects.toThrow(
				"Commonspace state and rollback backup are both invalid",
			);
			expect(await readFile(join(root, "retained.txt"), "utf8")).toBe(
				"Retained bytes.",
			);
		},
	);
});
