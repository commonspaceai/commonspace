import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommonspaceHostService } from "../server/src/service.ts";
import { addTestHarness } from "./test-harnesses.ts";

const live = process.env.COMMONSPACE_LIVE_ACP === "1";
const roots: string[] = [];

async function waitForAgentText(
	service: CommonspaceHostService,
	agentId: string,
	text: string,
): Promise<void> {
	await service.whenIdle();
	const messages =
		(await service.bootstrap()).state.messages[`dm:${agentId}`] ?? [];
	const failure = messages.find((message) => message.authorType === "system");
	if (failure !== undefined) throw new Error(failure.text);
	const replies = messages
		.filter((message) => message.authorType === "agent")
		.map((message) => message.text);
	expect(replies, JSON.stringify(replies)).toEqual(
		expect.arrayContaining([expect.stringContaining(text)]),
	);
}

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe.skipIf(!live).sequential("installed Commonspace ACP agents", () => {
	it("starts and resumes Claude Code sessions after service restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-claude-code-"));
		roots.push(root);
		const config = {
			root,
			claudeCodePath: process.env.COMMONSPACE_CLAUDE_CODE_PATH ?? "claude",
			runBudgetSeconds: 120,
		};
		const service = new CommonspaceHostService({}, config);
		let restarted: CommonspaceHostService | undefined;
		try {
			await service.initialize();
			const agent = await addTestHarness(service, "claude-code");
			await service.send({
				conversation: { kind: "dm", id: agent.id },
				text: "Remember this verification token: CLAUDE_ORANGE_KITE. Reply with exactly CLAUDE_ACP_OK. Do not use tools.",
			});
			await waitForAgentText(service, agent.id, "CLAUDE_ACP_OK");
			const sessionId =
				service.snapshot().agentSessions[agent.id]?.["Bot Chat"];
			expect(sessionId).toEqual(expect.any(String));
			await service.close();
			restarted = new CommonspaceHostService({}, config);
			await restarted.initialize();
			await restarted.send({
				conversation: { kind: "dm", id: agent.id },
				text: "Reply with exactly the verification token I asked you to remember. Do not use tools.",
			});
			await waitForAgentText(restarted, agent.id, "CLAUDE_ORANGE_KITE");
			expect(restarted.snapshot().agentSessions[agent.id]?.["Bot Chat"]).toBe(
				sessionId,
			);
		} finally {
			await service.close();
			await restarted?.close();
		}
	}, 240_000);

	it("starts and resumes Codex sessions", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-codex-"));
		roots.push(root);
		const config: ConstructorParameters<typeof CommonspaceHostService>[1] = {
			root,
			runBudgetSeconds: 120,
		};
		if (process.env.COMMONSPACE_CODEX_PATH !== undefined)
			config.codexPath = process.env.COMMONSPACE_CODEX_PATH;
		const service = new CommonspaceHostService({}, config);
		try {
			await service.initialize();
			const agent = await addTestHarness(service, "codex", "Live Codex");

			await service.send({
				conversation: { kind: "dm", id: agent.id },
				text: "Reply with exactly CODEX_ACP_OK and nothing else. Do not use tools.",
			});
			await waitForAgentText(service, agent.id, "CODEX_ACP_OK");
			const firstSession =
				service.snapshot().agentSessions[agent.id]?.["Bot Chat"];
			expect(firstSession).toEqual(expect.any(String));

			await service.send({
				conversation: { kind: "dm", id: agent.id },
				text: "Reply with exactly CODEX_RESUME_OK and nothing else. Do not use tools.",
			});
			await waitForAgentText(service, agent.id, "CODEX_RESUME_OK");
			expect(service.snapshot().agentSessions[agent.id]?.["Bot Chat"]).toBe(
				firstSession,
			);
		} finally {
			await service.close();
		}
	}, 240_000);

	it("starts and resumes Hermes sessions", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-hermes-"));
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{
				root,
				runBudgetSeconds: 120,
			},
		);
		try {
			await service.initialize();
			const discovered = await addTestHarness(service, "hermes", "Live Hermes");

			await service.send({
				conversation: { kind: "dm", id: discovered.id },
				text: "Reply with exactly HERMES_ACP_OK and nothing else. Do not use tools.",
			});
			await waitForAgentText(service, discovered.id, "HERMES_ACP_OK");
			const firstSession =
				service.snapshot().agentSessions[discovered.id]?.["Bot Chat"];
			expect(firstSession).toEqual(expect.any(String));

			await service.send({
				conversation: { kind: "dm", id: discovered.id },
				text: "Reply with exactly HERMES_RESUME_OK and nothing else. Do not use tools.",
			});
			await waitForAgentText(service, discovered.id, "HERMES_RESUME_OK");
			expect(
				service.snapshot().agentSessions[discovered.id]?.["Bot Chat"],
			).toBe(firstSession);
		} finally {
			await service.close();
		}
	}, 240_000);
});
