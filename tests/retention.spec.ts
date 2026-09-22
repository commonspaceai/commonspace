import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

async function retentionWorkspace() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-retention-"));
	roots.push(root);
	const runAgent = vi.fn(async () => ({ text: "Retained reply." }));
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
	const channel = mustExist(
		(
			await service.mutate({
				action: "create-channel",
				name: "retention",
				agentIds: ["codex"],
			})
		).channels[0],
	);
	const conversation = { kind: "channel", id: channel.id } as const;
	const sent = await service.send({
		conversation,
		text: "@review-bot retain until explicit purge.",
		attachments: [
			{ name: "retention.png", mimeType: "image/png", data: "AA==" },
		],
		files: [
			{
				name: "retention.txt",
				mimeType: "text/plain",
				data: Buffer.from("retention").toString("base64"),
			},
		],
	});
	await service.whenIdle();
	await service.addPin({
		scope: { kind: "thread", id: mustExist(sent.thread).id },
		kind: "message",
		messageId: sent.accepted.id,
	});
	await service.send({
		conversation: { kind: "dm", id: "codex" },
		text: "Unrelated DM history.",
	});
	await service.whenIdle();
	const fileId = mustExist(sent.accepted.files?.[0]).id;
	return {
		root,
		service,
		runAgent,
		conversation,
		sent,
		fileId,
		imagePath: join(
			root,
			"attachments",
			mustExist(sent.accepted.attachments?.[0]).id,
		),
		filePath: join(root, "attachments", fileId),
	};
}

function cleanupBoundary(service: CommonspaceHostService) {
	// biome-ignore lint/nursery/noUnsafeTypeAssertion lint/plugin: Test-only access to the service's known private cleanup method avoids a production dependency seam.
	return service as unknown as {
		removeFileAttachments(ids: readonly string[]): Promise<void>;
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("explicit retention", () => {
	it("previews without deleting and purges only the selected conversation", async () => {
		const { root, service, conversation, sent, fileId, imagePath, filePath } =
			await retentionWorkspace();
		const messages = service.snapshot().messages;
		expect(await readFile(imagePath)).toEqual(Buffer.from([0]));
		expect(await readFile(filePath, "utf8")).toBe("retention");

		const preview = service.previewRetention(conversation);

		expect(preview).toMatchObject({
			messages: 2,
			threads: 1,
			attachments: 2,
			pins: 1,
		});
		expect(service.snapshot().messages).toEqual(messages);
		await service.applyRetention({
			conversation,
			expectedRevision: preview.revision,
		});

		const state = service.snapshot();
		expect(
			state.channels.some((channel) => channel.id === conversation.id),
		).toBe(true);
		expect(state.messages[`channel:${conversation.id}`]).toBeUndefined();
		expect(
			state.threads.some((thread) => thread.channelId === conversation.id),
		).toBe(false);
		expect(state.pins).toHaveLength(0);
		expect(state.messages["dm:codex"]).toEqual(messages["dm:codex"]);
		await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(service.readFileAttachment(fileId)).rejects.toThrow(
			"unknown file attachment",
		);
		expect(await readFile(join(root, "state.json"), "utf8")).not.toContain(
			sent.accepted.id,
		);
	});

	it("rejects a stale preview without removing messages or attachments", async () => {
		const { service, conversation, filePath } = await retentionWorkspace();
		const preview = service.previewRetention(conversation);
		await service.mutate({
			action: "set-channel-context",
			channelId: conversation.id,
			instructions: "Changed after preview.",
		});
		const messages = service.snapshot().messages;

		await expect(
			service.applyRetention({
				conversation,
				expectedRevision: preview.revision,
			}),
		).rejects.toThrow("retention preview is stale");

		expect(service.snapshot().messages).toEqual(messages);
		expect(await readFile(filePath, "utf8")).toBe("retention");
	});

	it("rejects purging a conversation while native work is active", async () => {
		const { service, runAgent, conversation, filePath } =
			await retentionWorkspace();
		let signalRunStarted = () => {};
		let releaseRun = () => {};
		const runStarted = new Promise<void>((resolve) => {
			signalRunStarted = resolve;
		});
		const heldRun = new Promise<{ text: string }>((resolve) => {
			releaseRun = () => resolve({ text: "Held reply." });
		});
		runAgent.mockImplementationOnce(async () => {
			signalRunStarted();
			return heldRun;
		});
		try {
			await service.send({
				conversation,
				text: "@review-bot keep this run active.",
			});
			await runStarted;
			const messages = service.snapshot().messages;
			const preview = service.previewRetention(conversation);

			await expect(
				service.applyRetention({
					conversation,
					expectedRevision: preview.revision,
				}),
			).rejects.toThrow("conversation has active work");

			expect(service.snapshot().messages).toEqual(messages);
			expect(await readFile(filePath, "utf8")).toBe("retention");
		} finally {
			releaseRun();
			await service.whenIdle();
		}
	});

	it("retries partial attachment cleanup on restart without restoring purged history", async () => {
		const { root, service, conversation, sent, imagePath, filePath } =
			await retentionWorkspace();
		const unrelatedMessages = service.snapshot().messages["dm:codex"];
		const preview = service.previewRetention(conversation);
		const cleanup = vi
			.spyOn(cleanupBoundary(service), "removeFileAttachments")
			.mockRejectedValueOnce(new Error("synthetic cleanup failure"));

		await expect(
			service.applyRetention({
				conversation,
				expectedRevision: preview.revision,
			}),
		).rejects.toThrow("attachment cleanup is pending");
		cleanup.mockRestore();

		expect(await readFile(filePath, "utf8")).toBe("retention");
		await expect(readFile(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(join(root, "state.json"), "utf8")).not.toContain(
			sent.accepted.id,
		);
		await service.close();
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses },
		);
		services.push(restarted);
		await restarted.initialize();

		expect(restarted.previewRetention(conversation)).toMatchObject({
			messages: 0,
			attachments: 0,
		});
		expect(restarted.snapshot().messages["dm:codex"]).toEqual(
			unrelatedMessages,
		);
		await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).not.toHaveProperty("pendingAttachmentDeletions");
	});
});
