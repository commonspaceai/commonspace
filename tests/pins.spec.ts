import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentRunInput,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("shared context pins", () => {
	it("does not retain a pin when its state write fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-pin-save-"));
		roots.push(root);
		const service = new CommonspaceHostService({}, { root });
		await service.initialize();
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "pins",
					agentIds: [],
				})
			).channels[0],
		);
		const statePath = join(root, "state.json");
		await rm(statePath);
		await mkdir(statePath);
		await expect(
			service.addPin({
				scope: { kind: "channel", id: channel.id },
				kind: "note",
				note: "Do not persist this pin.",
			}),
		).rejects.toThrow();
		expect(service.snapshot().pins).toEqual([]);
		await rm(statePath, { recursive: true });
		await service.close();
	});

	it("inherits active Channel and Thread pins while retaining removed pin history", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-pins-"));
		roots.push(root);
		let scope: AgentRunInput["commonspaceScope"];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					scope = input.commonspaceScope;
					return { text: "Pinned-source reply." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "pins",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot preserve this exact request.",
		});
		await service.whenIdle();
		const addPin = service.addPin;
		const removePin = service.removePin;

		const channelPin = await addPin.call(service, {
			scope: { kind: "channel", id: channel.id },
			kind: "note",
			note: "Keep verification evidence visible.",
		});
		const threadPin = await addPin.call(service, {
			scope: { kind: "thread", id: mustExist(sent.thread).id },
			kind: "message",
			messageId: sent.accepted.id,
		});

		await expect(service.readContext(mustExist(scope))).resolves.toMatchObject({
			pins: [
				{
					id: channelPin.id,
					kind: "note",
					note: "Keep verification evidence visible.",
				},
				{
					id: threadPin.id,
					kind: "message",
					messageId: sent.accepted.id,
					source: {
						authorName: "Ralph",
						text: "@review-bot preserve this exact request.",
					},
				},
			],
		});

		await removePin.call(service, threadPin.id);

		const removed = service
			.snapshot()
			.pins.find((pin) => pin.id === threadPin.id);
		expect(removed?.removedAt).toEqual(expect.any(String));
		await expect(service.readContext(mustExist(scope))).resolves.toMatchObject({
			pins: [{ id: channelPin.id }],
		});
		await service.close();
	});

	it("tombstones Channel and Thread pins when their Channel is removed", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-pin-scope-removal-"),
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
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "remove-pins",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot start.",
		});
		await service.whenIdle();
		await service.addPin({
			scope: { kind: "channel", id: channel.id },
			kind: "note",
			note: "Channel pin.",
		});
		await service.addPin({
			scope: { kind: "thread", id: mustExist(sent.thread).id },
			kind: "note",
			note: "Thread pin.",
		});

		const state = await service.mutate({
			action: "remove-channel",
			channelId: channel.id,
		});

		expect(state.pins).toHaveLength(2);
		expect(state.pins.every((pin) => pin.removedAt !== null)).toBe(true);
		await service.close();
	});

	it("pins exact attachment metadata without exposing attachment bytes or host paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-attachment-pin-"));
		roots.push(root);
		let scope: AgentRunInput["commonspaceScope"];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					scope = input.commonspaceScope;
					return { text: "Reply." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "file-pin",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot inspect this image.",
			attachments: [
				{ name: "evidence.png", mimeType: "image/png", data: "AA==" },
			],
		});
		await service.whenIdle();
		const attachment = mustExist(sent.accepted.attachments?.[0]);

		const pin = await service.addPin({
			scope: { kind: "thread", id: mustExist(sent.thread).id },
			kind: "attachment",
			messageId: sent.accepted.id,
			attachmentId: attachment.id,
		});

		const context = await service.readContext(mustExist(scope));
		expect(context).toMatchObject({
			pins: [
				{
					id: pin.id,
					kind: "attachment",
					messageId: sent.accepted.id,
					attachmentId: attachment.id,
					source: {
						authorName: "Ralph",
						attachment: {
							name: "evidence.png",
							mimeType: "image/png",
							size: 1,
						},
					},
				},
			],
		});
		expect(JSON.stringify(context)).not.toContain("AA==");
		expect(JSON.stringify(context)).not.toContain(root);
		await service.close();
	});
});
