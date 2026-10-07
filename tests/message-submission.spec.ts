import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CommonspaceHostDependencies,
	CommonspaceHostService,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const nativeSessionId = "123e4567-e89b-42d3-a456-426614174000";
const request = {
	submissionId: "submission-lost-response",
	conversation: { kind: "dm" as const, id: "codex" },
	text: "Keep this request exactly once",
};

async function fixture(runAgent?: CommonspaceHostDependencies["runAgent"]) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-submission-"));
	roots.push(root);
	let runs = 0;
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent:
				runAgent ??
				(async () => ({
					text: `Synthetic reply ${String(++runs)}`,
					sessionId: nativeSessionId,
				})),
		},
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	return { root, service, runs: () => runs };
}

async function restart(root: string) {
	let runs = 0;
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => `Unexpected retry run ${String(++runs)}`,
		},
	);
	services.push(service);
	await service.initialize();
	return { service, runs: () => runs };
}

afterEach(async () => {
	for (const service of services.splice(0)) await service.close();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("durable message submission", () => {
	it("returns the accepted message after a lost response without another run", async () => {
		const { service, runs } = await fixture();
		const original = await service.send(request);
		await service.whenIdle();

		const replay = await service.send({ ...request });
		await service.whenIdle();

		expect(replay.accepted.id).toBe(original.accepted.id);
		expect(
			service.snapshot().messages["dm:codex"]?.map((message) => message.text),
		).toEqual(["Keep this request exactly once", "Synthetic reply 1"]);
		expect(runs()).toBe(1);
		expect(replay.state).not.toHaveProperty("messageSubmissions");
		expect((await service.bootstrap()).state).not.toHaveProperty(
			"messageSubmissions",
		);
		expect((await service.exportWorkspace()).workspace).not.toHaveProperty(
			"messageSubmissions",
		);
	});

	it("admits concurrent retries once while admitting an independent submission", async () => {
		const { service, runs } = await fixture();
		const [first, retry, independent] = await Promise.all([
			service.send(request),
			service.send({ ...request }),
			service.send({ ...request, submissionId: "submission-independent" }),
		]);
		await service.whenIdle();

		expect(retry.accepted.id).toBe(first.accepted.id);
		expect(independent.accepted.id).not.toBe(first.accepted.id);
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.filter(
					(message) => message.authorType === "user",
				),
		).toHaveLength(2);
		expect(runs()).toBe(2);
	});

	it("removes duplicate attachment writes from concurrent retries", async () => {
		const { root, service, runs } = await fixture();
		const submission = {
			...request,
			attachments: [
				{
					name: "evidence.png",
					mimeType: "image/png" as const,
					data: "iVBORw==",
				},
			],
			files: [
				{ name: "evidence.txt", mimeType: "text/plain", data: "ZXZpZGVuY2U=" },
			],
		};
		const [first, retry] = await Promise.all([
			service.send(submission),
			service.send(submission),
		]);
		await service.whenIdle();

		expect(retry.accepted.id).toBe(first.accepted.id);
		expect(first.accepted.attachments).toMatchObject([
			{ name: "evidence.png", size: 4 },
		]);
		expect(first.accepted.files).toMatchObject([
			{ name: "evidence.txt", size: 8 },
		]);
		expect(await readdir(join(root, "attachments"))).toHaveLength(2);
		expect(runs()).toBe(1);
	});

	it.each([
		{ text: "Changed request" },
		{ delivery: "steer" as const },
		{ projectIds: [] },
		{
			files: [
				{ name: "evidence.txt", mimeType: "text/plain", data: "ZXZpZGVuY2U=" },
			],
		},
	])(
		"rejects reuse of an accepted ID with another payload %j",
		async (change) => {
			const { service, runs } = await fixture();
			await service.send(request);
			await service.whenIdle();

			await expect(service.send({ ...request, ...change })).rejects.toThrow(
				"This submission ID was already used for a different message.",
			);
			expect(runs()).toBe(1);
			expect(
				service
					.snapshot()
					.messages["dm:codex"]?.filter(
						(message) => message.authorType === "user",
					),
			).toHaveLength(1);
		},
	);

	it("preserves the receipt and exact native session after restart", async () => {
		const { root, service } = await fixture();
		const original = await service.send(request);
		await service.whenIdle();
		const sessions = service.snapshot().agentSessions;
		await service.close();

		const restored = await restart(root);
		const replay = await restored.service.send(request);
		await restored.service.whenIdle();

		expect(replay.accepted.id).toBe(original.accepted.id);
		expect(restored.service.snapshot().agentSessions).toEqual(sessions);
		expect(restored.service.snapshot().agentSessions.codex).toEqual({
			"Bot Chat": nativeSessionId,
		});
		expect(restored.runs()).toBe(0);
	});

	it("recovers an interrupted acceptance without silently starting another run", async () => {
		const { root, service } = await fixture(
			async ({ signal }) =>
				new Promise<never>((_resolve, reject) => {
					const cancel = () => reject(new Error("Synthetic process stopped"));
					if (signal.aborted) cancel();
					else signal.addEventListener("abort", cancel, { once: true });
				}),
		);
		const original = await service.send(request);
		const interruptedRoot = await mkdtemp(
			join(tmpdir(), "commonspace-interrupted-submission-"),
		);
		roots.push(interruptedRoot);
		await writeFile(
			join(interruptedRoot, "state.json"),
			await readFile(join(root, "state.json"), "utf8"),
		);
		await service.close();

		const restored = await restart(interruptedRoot);
		const replay = await restored.service.send(request);

		expect(replay.accepted).toMatchObject({
			id: original.accepted.id,
			text: "Keep this request exactly once",
			replyStatus: "error",
			replyError:
				"The previous Commonspace process ended before the agent completed.",
		});
		expect(restored.runs()).toBe(0);
		expect(restored.service.snapshot().messages["dm:codex"]).toHaveLength(1);
	});

	it("keeps old IDs consumed after message deletion and conversation retention", async () => {
		const { root, service, runs } = await fixture();
		const original = await service.send(request);
		await service.whenIdle();
		await service.deleteMessage(original.accepted.id);
		await expect(service.send(request)).rejects.toThrow(
			"The accepted message or conversation is no longer available.",
		);
		const preview = service.previewRetention(request.conversation);
		await service.applyRetention({
			conversation: request.conversation,
			expectedRevision: preview.revision,
		});
		await service.close();

		const restored = await restart(root);
		await expect(restored.service.send(request)).rejects.toThrow(
			"The accepted message or conversation is no longer available.",
		);
		expect(restored.service.snapshot().messages["dm:codex"]).toBeUndefined();
		expect(runs()).toBe(1);
		expect(restored.runs()).toBe(0);
	});

	it("keeps the submission consumed after its Channel and Thread are removed", async () => {
		const { service, runs } = await fixture();
		const state = await service.mutate({
			action: "create-channel",
			name: "review",
			agentIds: ["codex"],
		});
		const channel = state.channels[0];
		if (channel === undefined) throw new Error("Channel fixture missing");
		const submission = {
			...request,
			conversation: { kind: "channel" as const, id: channel.id },
			text: "@review-bot Keep the Channel request",
		};
		const original = await service.send(submission);
		await service.whenIdle();
		const previousRuns = runs();
		await service.mutate({ action: "remove-channel", channelId: channel.id });

		await expect(service.send(submission)).rejects.toThrow(
			"The accepted message or conversation is no longer available.",
		);
		expect(
			service
				.snapshot()
				.threads.find((thread) => thread.id === original.thread?.id),
		).toBeUndefined();
		expect(runs()).toBe(previousRuns);
	});

	it("rolls back the message and receipt together after a failed state write", async () => {
		const { root, service, runs } = await fixture();
		const path = join(root, "state.json");
		await rm(path);
		await mkdir(path);
		await expect(service.send(request)).rejects.toThrow();
		expect(service.snapshot().messages["dm:codex"]).toBeUndefined();
		expect(runs()).toBe(0);
		await rm(path, { recursive: true });

		const accepted = await service.send(request);
		await service.whenIdle();
		expect(accepted.accepted.text).toBe("Keep this request exactly once");
		expect(runs()).toBe(1);
		expect((await service.send(request)).accepted.id).toBe(
			accepted.accepted.id,
		);
	});

	it("migrates version 36 without losing conversations or native session references", async () => {
		const { root, service } = await fixture();
		const original = await service.send({
			conversation: request.conversation,
			text: "Existing conversation",
		});
		await service.whenIdle();
		const legacy = service.snapshot();
		delete legacy.messageSubmissions;
		await service.close();
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({ ...legacy, version: 36 }),
		);

		const restored = await restart(root);
		expect(restored.service.snapshot().version).toBe(37);
		expect(restored.service.snapshot().messages["dm:codex"]?.[0]).toMatchObject(
			{ id: original.accepted.id, text: "Existing conversation" },
		);
		expect(restored.service.snapshot().agentSessions.codex).toEqual({
			"Bot Chat": nativeSessionId,
		});
		expect(restored.service.snapshot().messageSubmissions).toEqual({});
		expect(restored.runs()).toBe(0);
	});

	it.each(["fingerprint", "map", "missing map"])(
		"recovers valid receipts from a corrupt canonical state (%s)",
		async (malformed) => {
			const { root, service, runs } = await fixture();
			const original = await service.send(request);
			await service.whenIdle();
			await service.close();
			const saved = await readFile(join(root, "state.json"), "utf8");
			await writeFile(join(root, "state.backup.json"), saved);
			const corrupt =
				malformed === "fingerprint"
					? saved.replace(
							/"fingerprint": "[a-f0-9]+"/u,
							'"fingerprint": "invalid"',
						)
					: JSON.stringify({
							...service.snapshot(),
							messageSubmissions: malformed === "map" ? null : undefined,
						});
			await writeFile(join(root, "state.json"), corrupt);

			const restored = await restart(root);
			const replay = await restored.service.send(request);
			await restored.service.whenIdle();

			expect(replay.accepted.id).toBe(original.accepted.id);
			const snapshot = restored.service.snapshot();
			expect(
				snapshot.messages["dm:codex"]?.filter(
					(message) => message.authorType === "user",
				),
			).toHaveLength(1);
			expect(snapshot.agentSessions).toEqual({
				codex: { "Bot Chat": nativeSessionId },
			});
			expect(runs()).toBe(1);
			expect(restored.runs()).toBe(0);
			expect(await readFile(join(root, "state.corrupt.json"), "utf8")).toBe(
				corrupt,
			);
		},
	);
});
