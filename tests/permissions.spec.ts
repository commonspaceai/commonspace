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
});
