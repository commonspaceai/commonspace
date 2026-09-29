import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCommonspaceInboxItems } from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("native permission requests", () => {
	it("rejects a late permission request after its Agent is removed", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-late-permission-"));
		roots.push(root);
		let requestPermission: AgentRunInput["onPermissionRequest"];
		let runStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			runStarted = resolve;
		});
		let finishRun!: () => void;
		const finished = new Promise<void>((resolve) => {
			finishRun = resolve;
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					requestPermission = input.onPermissionRequest;
					runStarted();
					await finished;
					return { text: "Late result." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Codex");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Run work that may ask for permission.",
		});
		await started;
		await service.mutate({ action: "remove-agent", agentId: "codex" });
		const outcome = await mustExist(requestPermission)({
			toolCallId: "late-call",
			title: "Obsolete operation",
			options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
		});
		expect(outcome).toEqual({});
		expect(service.snapshot().permissions).toEqual([]);
		finishRun();
		await service.whenIdle();
		await service.close();
	});

	it("blocks only the affected native session and returns an exact advertised choice", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-permission-"));
		roots.push(root);
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.agent.id === "hermes")
				return { text: "Unrelated work completed." };
			const outcome = await mustExist(input.onPermissionRequest)({
				toolCallId: "sensitive-call",
				title: "Sensitive operation",
				kind: "execute",
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject", name: "Reject once", kind: "reject_once" },
				],
			});
			return { text: `Permission outcome: ${outcome.optionId ?? "cancelled"}` };
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent,
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Codex");
		await addTestHarness(service, "hermes", "Hermes");

		const codex = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Run sensitive work.",
		});
		await vi.waitFor(() => {
			expect(service.snapshot().permissions).toEqual([
				expect.objectContaining({
					id: expect.any(String),
					sourceMessageId: codex.accepted.id,
					agentId: "codex",
					status: "pending",
					title: "Sensitive operation",
					options: [
						{ optionId: "allow", name: "Allow once", kind: "allow_once" },
						{ optionId: "reject", name: "Reject once", kind: "reject_once" },
					],
				}),
			]);
		});
		const permission = mustExist(service.snapshot().permissions[0]);
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.find(
					(message) => message.id === codex.accepted.id,
				)?.replyStatus,
		).toBe("needs_input");
		const permissionAttention = deriveCommonspaceInboxItems(
			service.snapshot(),
		).filter((item) => item.messageId === codex.accepted.id);
		expect(permissionAttention).toHaveLength(1);
		expect(permissionAttention[0]).toMatchObject({
			kind: "permission-request",
			messageId: codex.accepted.id,
		});

		await service.send({
			conversation: { kind: "dm", id: "hermes" },
			text: "Run unrelated work.",
		});
		await vi.waitFor(() => {
			expect(
				service
					.snapshot()
					.messages["dm:hermes"]?.some(
						(message) => message.text === "Unrelated work completed.",
					),
			).toBe(true);
		});
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.some(
					(message) => message.authorType === "agent",
				),
		).toBe(false);
		await expect(
			service.respondPermission(permission.id, "invented"),
		).rejects.toThrow("permission option was not advertised");
		const statePath = join(root, "state.json");
		await rm(statePath);
		await mkdir(statePath);
		await expect(
			service.respondPermission(permission.id, "allow"),
		).rejects.toThrow();
		expect(service.snapshot().permissions[0]?.status).toBe("pending");
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.find(
					(message) => message.id === codex.accepted.id,
				)?.replyStatus,
		).toBe("needs_input");
		await rm(statePath, { recursive: true });

		await service.respondPermission(permission.id, "allow");
		await service.whenIdle();

		expect(service.snapshot().permissions[0]).toMatchObject({
			status: "resolved",
			selectedOptionId: "allow",
			resolvedAt: expect.any(String),
		});
		expect(
			service
				.snapshot()
				.messages["dm:codex"]?.some(
					(message) => message.text === "Permission outcome: allow",
				),
		).toBe(true);
		await service.close();
	});

	it("interrupts a pending permission without hanging shutdown", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-permission-shutdown-"),
		);
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					await mustExist(input.onPermissionRequest)({
						toolCallId: "call-1",
						title: "Waiting operation",
						options: [
							{ optionId: "reject", name: "Reject", kind: "reject_once" },
						],
					});
					return { text: "Stopped." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Codex");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Wait for permission.",
		});
		await vi.waitFor(() => {
			expect(service.snapshot().permissions[0]?.status).toBe("pending");
		});

		const closing = service.close();
		await expect(
			Promise.race([
				closing,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("service close timed out")), 500),
				),
			]),
		).resolves.toBeUndefined();
		expect(service.snapshot().permissions[0]?.status).toBe("interrupted");
	});

	it("revokes native access when saving permission interruption fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-access-revoke-"));
		roots.push(root);
		let permissionSettled = false;
		let runSignal: AbortSignal | undefined;
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					runSignal = input.signal;
					await mustExist(input.onPermissionRequest)({
						toolCallId: "call-1",
						title: "Waiting operation",
						options: [
							{ optionId: "reject", name: "Reject", kind: "reject_once" },
						],
					});
					permissionSettled = true;
					return { text: "Stopped." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Codex");
		await service.mutate({
			action: "update-agent-profile",
			agentId: "codex",
			displayName: "Codex",
			fullAccess: true,
		});
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Wait for permission.",
		});
		await vi.waitFor(() => {
			expect(service.snapshot().permissions[0]?.status).toBe("pending");
		});
		const processes: unknown = Object.getOwnPropertyDescriptor(
			service,
			"acpProcesses",
		)?.value;
		const launchAccess: unknown = Object.getOwnPropertyDescriptor(
			service,
			"acpLaunchAccess",
		)?.value;
		const persist: unknown = Object.getOwnPropertyDescriptor(
			CommonspaceHostService.prototype,
			"persist",
		)?.value;
		if (
			!(processes instanceof Map) ||
			!(launchAccess instanceof WeakMap) ||
			typeof persist !== "function"
		)
			throw new Error("access revocation test hooks are unavailable");
		const closeProcess = vi.fn(async () => undefined);
		const processClient = { close: closeProcess };
		processes.set("codex\u0000Bot Chat", processClient);
		launchAccess.set(processClient, true);
		let writes = 0;
		Object.defineProperty(service, "persist", {
			value: async (scope?: "acceptance") => {
				writes += 1;
				if (writes === 2)
					throw new Error("simulated permission status write failure");
				await persist.call(service, scope);
			},
		});
		await expect(
			service.mutate({
				action: "update-agent-profile",
				agentId: "codex",
				displayName: "Codex",
				fullAccess: false,
			}),
		).rejects.toThrow("simulated permission status write failure");
		expect(permissionSettled).toBe(true);
		expect(runSignal?.aborted).toBe(true);
		expect(closeProcess).toHaveBeenCalledOnce();
		expect(service.snapshot().permissions[0]?.status).toBe("interrupted");
		expect(service.snapshot().agents[0]?.fullAccess).toBe(false);
		await service.whenIdle();
		await service.close();
	});

	it("closes native processes when permission status cannot be saved", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-permission-close-"));
		roots.push(root);
		let permissionSettled = false;
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async (input) => {
					await mustExist(input.onPermissionRequest)({
						toolCallId: "call-1",
						title: "Waiting operation",
						options: [
							{ optionId: "reject", name: "Reject", kind: "reject_once" },
						],
					});
					permissionSettled = true;
					return { text: "Stopped." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Codex");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Wait for permission.",
		});
		await vi.waitFor(() => {
			expect(service.snapshot().permissions[0]?.status).toBe("pending");
		});
		const processes: unknown = Object.getOwnPropertyDescriptor(
			service,
			"acpProcesses",
		)?.value;
		const persist: unknown = Object.getOwnPropertyDescriptor(
			CommonspaceHostService.prototype,
			"persist",
		)?.value;
		if (!(processes instanceof Map) || typeof persist !== "function")
			throw new Error("native shutdown test hooks are unavailable");
		const closeProcess = vi.fn(async () => undefined);
		processes.set("test", { close: closeProcess });
		let failNextWrite = true;
		Object.defineProperty(service, "persist", {
			value: async (scope?: "acceptance") => {
				if (failNextWrite) {
					failNextWrite = false;
					throw new Error("simulated status write failure");
				}
				await persist.call(service, scope);
			},
		});
		await expect(service.close()).rejects.toThrow(
			"simulated status write failure",
		);
		expect(permissionSettled).toBe(true);
		expect(closeProcess).toHaveBeenCalledOnce();
		expect(service.snapshot().permissions[0]?.status).toBe("interrupted");
	});
});
