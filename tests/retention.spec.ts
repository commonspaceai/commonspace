import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConversationRef } from "@commonspace/shared";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];

function cleanupBoundary(service: CommonspaceHostService) {
	// biome-ignore lint/nursery/noUnsafeTypeAssertion lint/plugin: Test-only access to the service's known private cleanup method avoids a production dependency seam.
	return service as unknown as {
		removeFileAttachments(ids: readonly string[]): Promise<void>;
	};
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("explicit retention", () => {
	it.each([false, true])(
		"previews, revision-guards, and recovers a scoped conversation purge (failure: %s)",
		async (cleanupFails) => {
			const root = await mkdtemp(join(tmpdir(), "commonspace-retention-"));
			roots.push(root);
			let holdRun = false;
			let signalRunStarted = (): void => {};
			let releaseRun = (): void => {};
			const runStarted = new Promise<void>((resolve) => {
				signalRunStarted = resolve;
			});
			const heldRun = new Promise<{ text: string }>((resolve) => {
				releaseRun = () => resolve({ text: "Held reply." });
			});
			const service = new CommonspaceHostService(
				{},
				{ root },
				{
					discoverAgents: discoverTestHarnesses,
					runAgent: async () => {
						if (!holdRun) return { text: "Retained reply." };
						signalRunStarted();
						return heldRun;
					},
				},
			);
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
			const sent = await service.send({
				conversation: { kind: "channel", id: channel.id },
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
			const imagePath = join(
				root,
				"attachments",
				mustExist(sent.accepted.attachments?.[0]).id,
			);
			const filePath = join(root, "attachments", fileId);
			expect(await readFile(imagePath)).toEqual(Buffer.from([0]));
			expect(await readFile(filePath, "utf8")).toBe("retention");
			expectTypeOf<{
				kind: "bogus";
				id: "codex";
			}>().not.toMatchTypeOf<ConversationRef>();

			const preview = service.previewRetention({
				kind: "channel",
				id: channel.id,
			});
			expect(preview).toMatchObject({
				messages: 2,
				threads: 1,
				attachments: 2,
				pins: 1,
			});
			expect(service.snapshot().messages[`channel:${channel.id}`]).toHaveLength(
				2,
			);
			await service.mutate({
				action: "set-channel-context",
				channelId: channel.id,
				instructions: "Changed after preview.",
			});
			await expect(
				service.applyRetention({
					conversation: { kind: "channel", id: channel.id },
					expectedRevision: preview.revision,
				}),
			).rejects.toThrow("retention preview is stale");

			holdRun = true;
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "@review-bot keep this run active.",
			});
			await runStarted;
			const activePreview = service.previewRetention({
				kind: "channel",
				id: channel.id,
			});
			await expect(
				service.applyRetention({
					conversation: { kind: "channel", id: channel.id },
					expectedRevision: activePreview.revision,
				}),
			).rejects.toThrow("conversation has active work");
			releaseRun();
			await service.whenIdle();
			const current = service.previewRetention({
				kind: "channel",
				id: channel.id,
			});
			const request = {
				conversation: { kind: "channel", id: channel.id },
				expectedRevision: current.revision,
			} as const;
			if (cleanupFails) {
				const cleanup = vi
					.spyOn(cleanupBoundary(service), "removeFileAttachments")
					.mockRejectedValueOnce(new Error("synthetic cleanup failure"));
				await expect(service.applyRetention(request)).rejects.toThrow(
					"attachment cleanup is pending",
				);
				cleanup.mockRestore();
				expect(await readFile(filePath, "utf8")).toBe("retention");
			} else {
				await service.applyRetention(request);
				await expect(readFile(filePath)).rejects.toMatchObject({
					code: "ENOENT",
				});
			}
			await expect(readFile(imagePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(
				JSON.parse(await readFile(join(root, "state.json"), "utf8")),
			).toMatchObject({
				messages: {
					"dm:codex": expect.arrayContaining([
						expect.objectContaining({ text: "Unrelated DM history." }),
					]),
				},
			});
			expect(await readFile(join(root, "state.json"), "utf8")).not.toContain(
				sent.accepted.id,
			);

			expect(
				service
					.snapshot()
					.channels.some((candidate) => candidate.id === channel.id),
			).toBe(true);
			expect(
				service.snapshot().messages[`channel:${channel.id}`],
			).toBeUndefined();
			expect(
				service
					.snapshot()
					.threads.some((thread) => thread.channelId === channel.id),
			).toBe(false);
			expect(service.snapshot().pins).toHaveLength(0);
			expect(
				service.snapshot().messages["dm:codex"]?.map((message) => message.text),
			).toEqual(["Unrelated DM history.", "Retained reply."]);
			await expect(service.readFileAttachment(fileId)).rejects.toThrow(
				"unknown file attachment",
			);
			await service.close();
			const restarted = new CommonspaceHostService(
				{},
				{ root },
				{ discoverAgents: discoverTestHarnesses },
			);
			await restarted.initialize();
			const freshPreview = restarted.previewRetention(request.conversation);
			expect(freshPreview).toMatchObject({ messages: 0, attachments: 0 });
			await restarted.applyRetention({
				conversation: request.conversation,
				expectedRevision: freshPreview.revision,
			});
			await expect(readFile(filePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
			await expect(readFile(imagePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(
				restarted
					.snapshot()
					.messages["dm:codex"]?.map((message) => message.text),
			).toEqual(["Unrelated DM history.", "Retained reply."]);
			await restarted.close();
		},
	);
});
