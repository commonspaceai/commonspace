import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	if (resolvePromise === undefined)
		throw new Error("deferred resolver was not initialized");
	return { promise, resolve: resolvePromise };
}

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

async function closeService(service: CommonspaceHostService): Promise<void> {
	await service.close();
	const index = services.indexOf(service);
	if (index !== -1) services.splice(index, 1);
}

afterEach(async () => {
	for (const service of services.splice(0)) await service.close();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

type AdmissionPoint = "before-accept" | "after-attachments";

interface AdmissionFixtureOptions {
	point?: AdmissionPoint;
	initiallyArmed?: boolean;
}

async function admissionFixture(options: AdmissionFixtureOptions = {}) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-send-admission-"));
	roots.push(root);
	const gate = deferred();
	const reached = deferred();
	const point = options.point ?? "before-accept";
	let armed = options.initiallyArmed ?? true;
	const pauseWhenArmed = async () => {
		if (!armed) return;
		reached.resolve();
		await gate.promise;
	};
	const runAgent = vi.fn(async () => "unexpected Agent run");
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: discoverTestHarnesses,
			beforeAcceptSend: async () => {
				if (point === "before-accept") await pauseWhenArmed();
			},
			afterPersistSendAttachments: async () => {
				if (point === "after-attachments") await pauseWhenArmed();
			},
			runAgent,
		},
	);
	services.push(service);
	await service.initialize();
	await addTestHarness(service, "codex", "Review Bot");
	return {
		arm: () => {
			armed = true;
		},
		gate,
		reached,
		root,
		runAgent,
		service,
	};
}

describe("send admission invariants", () => {
	it("CON-02: rejects a Channel send after its Agent removal commits", async () => {
		const { gate, reached, runAgent, service } = await admissionFixture();
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot inspect the release",
		});

		await reached.promise;
		const removed = await service.mutate({
			action: "remove-agent",
			agentId: "codex",
		});
		expect(removed.agents).toEqual([]);
		expect(mustExist(removed.channels[0]).agentIds).toEqual([]);
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		const state = service.snapshot();
		expect(state.agents).toEqual([]);
		expect(mustExist(state.channels[0]).agentIds).toEqual([]);
		expect(state.threads).toEqual([]);
		expect(state.messages[`channel:${channel.id}`]).toBeUndefined();
		expect(runAgent).not.toHaveBeenCalled();
	});

	it("CON-02/WRK-04: removes persisted attachments when admission changes after storage", async () => {
		const { gate, reached, root, runAgent, service } = await admissionFixture({
			point: "after-attachments",
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot inspect the attached evidence",
			attachments: [
				{
					name: "evidence.png",
					mimeType: "image/png",
					data: "iVBORw==",
				},
			],
			files: [
				{
					name: "evidence.txt",
					mimeType: "text/plain",
					data: "ZXZpZGVuY2U=",
				},
			],
		});

		await reached.promise;
		expect(await readdir(join(root, "attachments"))).toHaveLength(2);
		await service.mutate({ action: "remove-agent", agentId: "codex" });
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		expect(await readdir(join(root, "attachments"))).toEqual([]);
		expect(service.snapshot().threads).toEqual([]);
		expect(
			service.snapshot().messages[`channel:${channel.id}`],
		).toBeUndefined();
		expect(runAgent).not.toHaveBeenCalled();

		await closeService(service);
		const restored = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses },
		);
		services.push(restored);
		await restored.initialize();
		expect(await readdir(join(root, "attachments"))).toEqual([]);
		expect(restored.snapshot().threads).toEqual([]);
		expect(
			restored.snapshot().messages[`channel:${channel.id}`],
		).toBeUndefined();
	});

	it("CON-01: does not overwrite a Channel roster changed during preparation", async () => {
		const { gate, reached, runAgent, service } = await admissionFixture();
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot inspect the release",
		});

		await reached.promise;
		const changed = await service.mutate({
			action: "set-channel-agents",
			channelId: channel.id,
			agentIds: [],
		});
		expect(mustExist(changed.channels[0]).agentIds).toEqual([]);
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		expect(mustExist(service.snapshot().channels[0]).agentIds).toEqual([]);
		expect(
			service.snapshot().messages[`channel:${channel.id}`],
		).toBeUndefined();
		expect(runAgent).not.toHaveBeenCalled();
	});

	it("CON-02/WRK-04: rejects a DM after Agent removal across restart", async () => {
		const { gate, reached, root, runAgent, service } = await admissionFixture();
		const sending = service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "inspect the release",
		});

		await reached.promise;
		const removed = await service.mutate({
			action: "remove-agent",
			agentId: "codex",
		});
		expect(removed.agents).toEqual([]);
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		expect(service.snapshot().messages["dm:codex"]).toBeUndefined();
		expect(runAgent).not.toHaveBeenCalled();

		await closeService(service);
		const restored = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses },
		);
		services.push(restored);
		await restored.initialize();
		expect(restored.snapshot().agents).toEqual([]);
		expect(restored.snapshot().messages["dm:codex"]).toBeUndefined();
	});

	it("CON-02: rejects Project-scoped acceptance after Project removal", async () => {
		const { gate, reached, root, runAgent, service } = await admissionFixture();
		const projectRoot = join(root, "project");
		await mkdir(projectRoot);
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Temporary",
					paths: [projectRoot],
				})
			).projects[0],
		);
		const sending = service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "inspect the Project",
		});

		await reached.promise;
		const removed = await service.mutate({
			action: "remove-project",
			projectId: project.id,
		});
		expect(removed.projects).toEqual([]);
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		const state = service.snapshot();
		expect(state.projects).toEqual([]);
		expect(state.messages["dm:codex"]).toBeUndefined();
		expect(runAgent).not.toHaveBeenCalled();
	});

	it("CON-08: preserves admission across an unrelated Agent removal", async () => {
		const { gate, reached, runAgent, service } = await admissionFixture();
		await addTestHarness(service, "hermes", "Second Bot");
		const sending = service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "inspect the release",
		});

		await reached.promise;
		const removed = await service.mutate({
			action: "remove-agent",
			agentId: "hermes",
		});
		expect(removed.agents.map((agent) => agent.id)).toEqual(["codex"]);
		gate.resolve();

		await expect(sending).resolves.toMatchObject({
			accepted: { text: "inspect the release" },
		});
		await service.whenIdle();
		expect(service.snapshot().messages["dm:codex"]?.[0]?.text).toBe(
			"inspect the release",
		);
		expect(runAgent).toHaveBeenCalledOnce();
	});

	it("CON-01/CON-02: preserves an existing Thread pruned by Agent removal", async () => {
		const { arm, gate, reached, runAgent, service } = await admissionFixture({
			initiallyArmed: false,
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot establish the review Thread",
		});
		await service.whenIdle();
		const thread = mustExist(first.thread);
		expect(thread.agentIds).toEqual(["codex"]);
		expect(runAgent).toHaveBeenCalledOnce();

		arm();
		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			targetAgentId: "codex",
			text: "follow up without restoring removed membership",
		});
		await reached.promise;
		const removed = await service.mutate({
			action: "remove-agent",
			agentId: "codex",
		});
		expect(mustExist(removed.threads[0]).agentIds).toEqual([]);
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		const state = service.snapshot();
		expect(state.threads).toEqual(removed.threads);
		expect(state.messages).toEqual(removed.messages);
		expect(
			state.messages[`channel:${channel.id}`]?.some(
				(message) =>
					message.text === "follow up without restoring removed membership",
			),
		).toBe(false);
		expect(runAgent).toHaveBeenCalledOnce();
	});

	it("CON-01/CON-02: preserves an existing Thread pruned by Project removal", async () => {
		const { arm, gate, reached, root, runAgent, service } =
			await admissionFixture({ initiallyArmed: false });
		const projectRoot = join(root, "project");
		await mkdir(projectRoot);
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Temporary",
					paths: [projectRoot],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: project.id,
			text: "@review-bot establish the Project Thread",
		});
		await service.whenIdle();
		const thread = mustExist(first.thread);
		expect(thread.projectIds).toEqual([project.id]);
		expect(runAgent).toHaveBeenCalledOnce();

		arm();
		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			targetAgentId: "codex",
			text: "follow up without restoring the removed Project",
		});
		await reached.promise;
		const removed = await service.mutate({
			action: "remove-project",
			projectId: project.id,
		});
		expect(mustExist(removed.threads[0])).toMatchObject({
			id: thread.id,
			projectId: null,
			projectIds: [],
		});
		gate.resolve();

		await expect(sending).rejects.toThrow(
			"conversation changed before message acceptance",
		);
		const state = service.snapshot();
		expect(state.threads).toEqual(removed.threads);
		expect(state.messages).toEqual(removed.messages);
		expect(
			state.messages[`channel:${channel.id}`]?.some(
				(message) =>
					message.text === "follow up without restoring the removed Project",
			),
		).toBe(false);
		expect(runAgent).toHaveBeenCalledOnce();
	});
});
