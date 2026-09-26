// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CommonspaceHostDependencies,
	CommonspaceHostService,
} from "../server/src/service.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

async function workspace(overrides: Partial<CommonspaceHostDependencies> = {}) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-schedule-"));
	roots.push(root);
	const runAgent = vi.fn(async () => "Finished scheduled work.");
	const options = {
		discoverAgents: async () => [
			{
				id: "codex",
				displayName: "Codex",
				adapter: "codex" as const,
				model: null,
				status: "stopped" as const,
			},
		],
		runAgent,
		...overrides,
	};
	const service = new CommonspaceHostService({}, { root }, options);
	services.push(service);
	await service.initialize();
	await service.mutate({ action: "add-discovered-agent", agentId: "codex" });
	const channel = (
		await service.mutate({
			action: "create-channel",
			name: "engineering",
			agentIds: ["codex"],
		})
	).channels[0];
	if (channel === undefined) throw new Error("Channel missing");
	return { root, service, channel, options, runAgent };
}

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
	vi.useRealTimers();
});

describe("scheduled Channel messages", () => {
	it("accepts a one-time message once and keeps the completed occurrence after restart", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
		const { root, service, channel, options, runAgent } = await workspace();
		const scheduled = await service.mutate({
			action: "create-schedule",
			title: "Morning check",
			channelId: channel.id,
			text: "@Codex Check the build.",
			timing: { kind: "once", runAt: "2026-09-24T10:05:00.000Z" },
		});
		expect(scheduled.schedules[0]?.nextRunAt).toBe("2026-09-24T10:05:00.000Z");
		await service.runDueSchedules();
		expect(service.snapshot().threads).toHaveLength(0);

		vi.setSystemTime(new Date("2026-09-24T10:05:00.000Z"));
		await service.runDueSchedules();
		await service.whenIdle();
		const delivered = service.snapshot();
		expect(delivered.schedules[0]).toMatchObject({
			nextRunAt: null,
			lastRunAt: "2026-09-24T10:05:00.000Z",
		});
		expect(delivered.threads).toHaveLength(1);
		expect(
			delivered.messages[`channel:${channel.id}`]?.filter(
				(message) => message.authorType === "user",
			),
		).toHaveLength(1);
		expect(runAgent).toHaveBeenCalledTimes(1);
		const completed = delivered.schedules[0];
		if (completed === undefined) throw new Error("Schedule missing");
		const renamed = await service.mutate({
			action: "update-schedule",
			id: completed.id,
			title: "Morning check completed",
			channelId: channel.id,
			text: completed.text,
			timing: completed.timing,
		});
		expect(renamed.schedules[0]).toMatchObject({
			title: "Morning check completed",
			nextRunAt: null,
		});

		const restarted = new CommonspaceHostService({}, { root }, options);
		services.push(restarted);
		await restarted.initialize();
		await restarted.runDueSchedules();
		expect(restarted.snapshot().threads).toHaveLength(1);
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("coalesces missed cron occurrences and honors pause, resume, and deletion", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T10:01:00.000Z"));
		const { service, channel, runAgent } = await workspace();
		const created = await service.mutate({
			action: "create-schedule",
			title: "Build check",
			channelId: channel.id,
			text: "@Codex Check the build.",
			timing: {
				kind: "cron",
				expression: "*/5 * * * *",
				timeZone: "UTC",
			},
		});
		const schedule = created.schedules[0];
		if (schedule === undefined) throw new Error("Schedule missing");
		expect(schedule.nextRunAt).toBe("2026-09-24T10:05:00.000Z");

		vi.setSystemTime(new Date("2026-09-24T10:26:00.000Z"));
		await service.runDueSchedules();
		await service.whenIdle();
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(service.snapshot().schedules[0]?.nextRunAt).toBe(
			"2026-09-24T10:30:00.000Z",
		);
		await service.mutate({
			action: "set-schedule-paused",
			id: schedule.id,
			paused: true,
		});
		vi.setSystemTime(new Date("2026-09-24T10:36:00.000Z"));
		await service.runDueSchedules();
		expect(runAgent).toHaveBeenCalledTimes(1);
		const resumed = await service.mutate({
			action: "set-schedule-paused",
			id: schedule.id,
			paused: false,
		});
		expect(resumed.schedules[0]?.nextRunAt).toBe("2026-09-24T10:40:00.000Z");
		const deleted = await service.mutate({
			action: "delete-schedule",
			id: schedule.id,
		});
		expect(deleted.schedules).toEqual([]);
	});

	it("keeps an unaccepted cron occurrence due when its title changes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T10:01:00.000Z"));
		let fail = true;
		const { service, channel, runAgent } = await workspace({
			beforeAcceptSend: async () => {
				if (fail) throw new Error("Synthetic acceptance failure");
			},
		});
		const timing = {
			kind: "cron" as const,
			expression: "*/5 * * * *",
			timeZone: "UTC",
		};
		const created = await service.mutate({
			action: "create-schedule",
			title: "Build check",
			channelId: channel.id,
			text: "@Codex Check the build.",
			timing,
		});
		const id = created.schedules[0]?.id;
		if (id === undefined) throw new Error("Schedule missing");
		vi.setSystemTime(new Date("2026-09-24T10:06:00.000Z"));
		await service.runDueSchedules();
		expect(service.snapshot().threads).toHaveLength(0);
		const edited = await service.mutate({
			action: "update-schedule",
			id,
			title: "Renamed build check",
			channelId: channel.id,
			text: "@Codex Check the build.",
			timing,
		});
		expect(edited.schedules[0]?.nextRunAt).toBe("2026-09-24T10:05:00.000Z");
		fail = false;
		await service.runDueSchedules();
		await service.whenIdle();
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(service.snapshot().schedules[0]?.nextRunAt).toBe(
			"2026-09-24T10:10:00.000Z",
		);
	});

	it("does not accept a scheduled send after its message changes during preparation", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
		let reached: (() => void) | undefined;
		let release: (() => void) | undefined;
		const prepared = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { service, channel, runAgent } = await workspace({
			beforeAcceptSend: async () => {
				reached?.();
				await gate;
			},
		});
		const runAt = "2026-09-24T10:05:00.000Z";
		const created = await service.mutate({
			action: "create-schedule",
			title: "Build check",
			channelId: channel.id,
			text: "@Codex Check the old build.",
			timing: { kind: "once", runAt },
		});
		const id = created.schedules[0]?.id;
		if (id === undefined) throw new Error("Schedule missing");
		vi.setSystemTime(new Date(runAt));
		const sending = service.runDueSchedules();
		await prepared;
		vi.setSystemTime(new Date("2026-09-24T10:04:00.000Z"));
		await service.mutate({
			action: "update-schedule",
			id,
			title: "Build check",
			channelId: channel.id,
			text: "@Codex Check the revised build.",
			timing: { kind: "once", runAt },
		});
		vi.setSystemTime(new Date(runAt));
		release?.();
		await sending;
		expect(service.snapshot().threads).toHaveLength(0);
		expect(runAgent).not.toHaveBeenCalled();
		await service.runDueSchedules();
		await service.whenIdle();
		expect(
			service.snapshot().messages[`channel:${channel.id}`]?.[0]?.text,
		).toBe("@Codex Check the revised build.");
	});

	it("starts a due message from the host timer", async () => {
		const { service, channel } = await workspace();
		await service.mutate({
			action: "create-schedule",
			title: "Timed check",
			channelId: channel.id,
			text: "@Codex Check the build.",
			timing: {
				kind: "once",
				runAt: new Date(Date.now() + 700).toISOString(),
			},
		});
		service.attachClientUrl("http://127.0.0.1:3100");
		await vi.waitFor(
			() => {
				expect(service.snapshot().threads).toHaveLength(1);
			},
			{ timeout: 3_000 },
		);
		await service.whenIdle();
		expect(service.snapshot().schedules[0]?.nextRunAt).toBeNull();
	});

	it("a failed due schedule does not delay another upcoming message", async () => {
		const { service, channel } = await workspace({
			beforeAcceptSend: async (prepared) => {
				if (prepared.request.text.includes("Fail this send"))
					throw new Error("Synthetic preparation failure");
			},
		});
		for (const [title, text, delay] of [
			["Failing", "@Codex Fail this send.", 200],
			["Working", "@Codex Send this message.", 600],
		] as const) {
			await service.mutate({
				action: "create-schedule",
				title,
				channelId: channel.id,
				text,
				timing: {
					kind: "once",
					runAt: new Date(Date.now() + delay).toISOString(),
				},
			});
		}
		service.attachClientUrl("http://127.0.0.1:3100");
		await vi.waitFor(
			() => {
				expect(
					service.snapshot().messages[`channel:${channel.id}`]?.[0]?.text,
				).toBe("@Codex Send this message.");
			},
			{ timeout: 3_000 },
		);
		expect(
			service.snapshot().schedules.find((item) => item.title === "Failing")
				?.nextRunAt,
		).not.toBeNull();
	});

	it("keeps schedules in exports and accepts older archives without them", async () => {
		const { service, channel } = await workspace();
		await service.mutate({
			action: "create-schedule",
			title: "Portable check",
			channelId: channel.id,
			text: "Check the build.",
			timing: {
				kind: "once",
				runAt: new Date(Date.now() + 3_600_000).toISOString(),
			},
		});
		const archive = await service.exportWorkspace();
		expect(archive.workspace.schedules).toHaveLength(1);
		const importedRoot = await mkdtemp(
			join(tmpdir(), "commonspace-schedule-import-"),
		);
		roots.push(importedRoot);
		const imported = new CommonspaceHostService({}, { root: importedRoot });
		services.push(imported);
		await imported.initialize();
		await imported.importWorkspace(archive, {});
		expect(imported.snapshot().schedules[0]?.title).toBe("Portable check");

		const legacy = structuredClone(archive);
		delete legacy.workspace.schedules;
		const legacyRoot = await mkdtemp(
			join(tmpdir(), "commonspace-schedule-legacy-"),
		);
		roots.push(legacyRoot);
		const older = new CommonspaceHostService({}, { root: legacyRoot });
		services.push(older);
		await older.initialize();
		await older.importWorkspace(legacy, {});
		expect(older.snapshot().schedules).toEqual([]);
	});

	it("rejects invalid timing and removes schedules with their Channel", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
		const { service, channel } = await workspace();
		const input = {
			action: "create-schedule" as const,
			title: "Check",
			channelId: channel.id,
			text: "Check the build.",
		};
		await expect(
			service.mutate({
				...input,
				timing: { kind: "once", runAt: "2026-09-24T09:59:00.000Z" },
			}),
		).rejects.toThrow("future");
		await expect(
			service.mutate({
				...input,
				timing: {
					kind: "cron",
					expression: "not cron",
					timeZone: "UTC",
				},
			}),
		).rejects.toThrow("five-field");
		await service.mutate({
			...input,
			timing: { kind: "once", runAt: "2026-09-24T11:00:00.000Z" },
		});
		const removed = await service.mutate({
			action: "remove-channel",
			channelId: channel.id,
		});
		expect(removed.schedules).toEqual([]);
	});
});
