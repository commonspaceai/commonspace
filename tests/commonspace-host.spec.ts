import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	COMMONSPACE_STATE_VERSION,
	CommonspaceRoutingProvider,
	deriveCommonspaceInboxItems,
	type UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { requestIsLoopback, requestIsSameOrigin } from "../server/src/app.ts";
import {
	type AgentRunInput,
	type CommonspaceHostDependencies,
	CommonspaceHostService,
	type CommonspaceRouteInput,
	type CommonspaceRouteResult,
	unsafeModeForAdapter,
} from "../server/src/service.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const fakeAcpAgentPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"fake-acp-agent.mjs",
);
const candidateSchema = z.array(
	z.object({ id: z.string(), routingScore: z.number() }),
);
const projectSchema = z.array(z.object({ id: z.string() }));
const persistedStateSchema = z.object({
	version: z.number().optional(),
	defaults: z
		.strictObject({
			maxAgentsPerTurn: z.number(),
			memoryThreads: z.number(),
		})
		.optional(),
});
const acpFrameSchema = z
	.object({ method: z.string().optional(), params: z.unknown().optional() })
	.passthrough();
function withHarnessUtilities(
	run: (input: AgentRunInput) => Promise<string | { text: string }>,
): (input: AgentRunInput) => Promise<string | { text: string }> {
	return async (input) => {
		if (input.sessionName.startsWith("Commonspace Inference:"))
			return JSON.stringify({
				summary: "Test workspace context.",
				decisions: [],
				openQuestions: [],
			});
		if (!input.sessionName.startsWith("Commonspace Routing:"))
			return run(input);

		const candidatesJson =
			/Candidates: (\[[^\n]+\])/u.exec(input.message)?.[1] ?? "[]";
		const candidates = candidateSchema.parse(JSON.parse(candidatesJson));
		const projectsJson =
			/Available Projects: (\[[^\n]+\])/u.exec(input.message)?.[1] ?? "[]";
		const projects = projectSchema.parse(JSON.parse(projectsJson));
		const selected = candidates.toSorted(
			(left, right) => right.routingScore - left.routingScore,
		)[0];
		return JSON.stringify({
			mode: "parallel",
			assignments:
				selected === undefined
					? []
					: [
							{
								agentId: selected.id,
								projectIds: projects.map((project) => project.id),
							},
						],
			confidence: 0.9,
			reason: "Test inference selected the strongest candidate.",
		});
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function addDiscoveredAgents(
	service: CommonspaceHostService,
	...agentIds: string[]
): Promise<void> {
	for (const agentId of agentIds) {
		await service.mutate({ action: "add-discovered-agent", agentId });
	}
}

async function explicitRoutingFixture(
	dependencies: Pick<CommonspaceHostDependencies, "routeAgents" | "runAgent">,
) {
	const root = await mkdtemp(join(tmpdir(), "commonspace-explicit-routing-"));
	roots.push(root);
	const agentIds = ["backend", "frontend", "outside"];
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			...dependencies,
			discoverAgents: async () =>
				agentIds.map((id) => ({
					id,
					displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
					adapter: "hermes" as const,
					model: null,
					status: "stopped" as const,
				})),
		},
	);
	services.push(service);
	await service.initialize();
	await addDiscoveredAgents(service, ...agentIds);
	const channel = mustExist(
		(
			await service.mutate({
				action: "create-channel",
				name: "engineering",
				agentIds,
			})
		).channels[0],
	);
	return { service, channel, root };
}

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Commonspace host authority", () => {
	it("refuses to overwrite unreadable persisted state during startup", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-invalid-state-"));
		roots.push(root);
		const statePath = join(root, "state.json");
		const invalidState = '{"version":';
		await writeFile(statePath, invalidState);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await expect(service.initialize()).rejects.toThrow();
		expect(await readFile(statePath, "utf8")).toBe(invalidState);
	});

	it("keeps the previous persisted state as a rollback backup", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-state-backup-"));
		roots.push(root);
		const statePath = join(root, "state.json");
		const original = JSON.stringify({
			version: COMMONSPACE_STATE_VERSION,
			revision: 7,
			inboxReadAt: null,
			inboxReadMessageIds: [],
			defaults: {
				maxAgentsPerTurn: 4,
				memoryThreads: 12,
			},
			agents: [],
			dmSessions: {},
			agentSessions: {},
			projects: [],
			channels: [],
			threads: [],
			messages: {},
		});
		await writeFile(statePath, original);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		expect(await readFile(join(root, "state.backup.json"), "utf8")).toBe(
			original,
		);
	});

	it("recovers an unreadable primary state from a valid rollback backup", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-state-recovery-"));
		roots.push(root);
		const recovered = JSON.stringify({
			version: COMMONSPACE_STATE_VERSION,
			revision: 9,
			inboxReadAt: null,
			inboxReadMessageIds: [],
			defaults: {
				maxAgentsPerTurn: 4,
				memoryThreads: 12,
			},
			agents: [],
			dmSessions: {},
			agentSessions: {},
			projects: [],
			channels: [],
			threads: [],
			messages: {},
		});
		await writeFile(join(root, "state.json"), '{"version":');
		await writeFile(join(root, "state.backup.json"), recovered);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		expect(service.snapshot().revision).toBe(9);
		expect(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		).toMatchObject({ revision: 9 });
		expect(await readFile(join(root, "state.corrupt.json"), "utf8")).toBe(
			'{"version":',
		);
	});

	it("tightens an existing Commonspace state directory to owner-only access", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-private-root-"));
		roots.push(root);
		await chmod(root, 0o755);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();

		expect((await stat(root)).mode & 0o777).toBe(0o700);
		expect((await stat(join(root, "state.json"))).mode & 0o777).toBe(0o600);
	});

	it("requires loopback and strict browser same-origin metadata", () => {
		const request = (
			headers: Record<string, string>,
			remoteAddress = "127.0.0.1",
		) => ({ headers, socket: { remoteAddress } });
		expect(requestIsLoopback(request({ host: "127.0.0.1:3080" }))).toBe(true);
		expect(
			requestIsLoopback(request({ host: "127.0.0.1:3080" }, "192.168.1.20")),
		).toBe(false);
		expect(
			requestIsSameOrigin(
				request({ host: "127.0.0.1:3080", origin: "http://127.0.0.1:3080" }),
			),
		).toBe(true);
		expect(
			requestIsSameOrigin(
				request({
					host: "attacker.example:3080",
					origin: "http://attacker.example:3080",
				}),
			),
		).toBe(false);
		expect(
			requestIsSameOrigin(
				request({ host: "127.0.0.1:3080", origin: "https://127.0.0.1:3080" }),
			),
		).toBe(false);
		expect(
			requestIsSameOrigin(
				request({ host: "127.0.0.1:3080", "sec-fetch-site": "same-origin" }),
			),
		).toBe(true);
		expect(requestIsSameOrigin(request({ host: "127.0.0.1:3080" }))).toBe(
			false,
		);
		expect(
			requestIsSameOrigin(
				request({
					host: "127.0.0.1:3100",
					"x-forwarded-host": "127.0.0.1:5173",
					referer: "http://127.0.0.1:5173/",
				}),
			),
		).toBe(true);
		expect(
			requestIsSameOrigin(
				request({
					host: "127.0.0.1:3100",
					"x-forwarded-host": "127.0.0.1:5173",
					origin: "http://127.0.0.1:5173",
				}),
			),
		).toBe(true);
		expect(
			requestIsSameOrigin(
				request({
					host: "127.0.0.1:3100",
					"x-forwarded-host": "127.0.0.1:5173",
					referer: "http://127.0.0.1:9999/",
				}),
			),
		).toBe(false);
	});

	it("keeps Hermes and Codex safety modes independent", () => {
		expect(unsafeModeForAdapter({ hermesYolo: true }, "hermes")).toBe(true);
		expect(unsafeModeForAdapter({ hermesYolo: true }, "codex")).toBe(false);
		expect(unsafeModeForAdapter({ externalAgentYolo: true }, "codex")).toBe(
			true,
		);
	});

	it("uses the configured default cwd for an unprojected direct message", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-default-cwd-"));
		roots.push(root);
		const defaultCwd = join(root, "workspace");
		await mkdir(defaultCwd);
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			void input;
			return { text: "Done." };
		});
		const service = new CommonspaceHostService(
			{},
			{ root, defaultCwd },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent,
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Run.",
		});
		await service.whenIdle();

		expect(runAgent).toHaveBeenCalledOnce();
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			cwd: await realpath(defaultCwd),
			additionalCwds: [],
		});
	});

	it("uses an explicit project tag as the message project context", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-tagged-project-"));
		roots.push(root);
		const fallback = join(root, "fallback");
		const workspace = join(root, "workspace");
		await Promise.all([mkdir(fallback), mkdir(workspace)]);
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			void input;
			return { text: "Done." };
		});
		const service = new CommonspaceHostService(
			{},
			{ root, defaultCwd: fallback },
			{ discoverAgents: discoverTestHarnesses, runAgent },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Tagged Workspace",
					paths: [workspace],
				})
			).projects[0],
		);

		const sent = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Review @@tagged-workspace.",
		});
		await service.whenIdle();

		expect(sent.accepted.projectId).toBe(project.id);
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			cwd: await realpath(workspace),
			additionalCwds: [],
		});
	});

	it("keeps an accepted turn running across cosmetic Agent profile edits", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-profile-edit-"));
		roots.push(root);
		const started = deferred<void>();
		const completed = deferred<{ text: string }>();
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					started.resolve();
					return completed.promise;
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");

		const sent = await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Keep working.",
		});
		await started.promise;
		await service.mutate({
			action: "update-agent-profile",
			agentId: "codex",
			displayName: "Reviewer",
			avatarEmoji: "🔎",
		});
		completed.resolve({ text: "Finished after the edit." });
		await service.whenIdle();

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				replyStatus: "complete",
			}),
			expect.objectContaining({
				authorType: "agent",
				text: "Finished after the edit.",
			}),
		]);
	});

	it("terminalizes active and queued turns when their Project is removed", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-project-removal-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const started = deferred<void>();
		const completed = deferred<{ text: string }>();
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					started.resolve();
					return completed.promise;
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Removable",
					paths: [workspace],
				})
			).projects[0],
		);

		const sent = await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Work in this Project.",
		});
		await started.promise;
		const queued = await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			delivery: "queue",
			text: "Continue in this Project.",
		});
		await service.mutate({ action: "remove-project", projectId: project.id });
		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				replyStatus: "cancelled",
			}),
			expect.objectContaining({
				id: queued.accepted.id,
				replyStatus: "cancelled",
			}),
		]);
		completed.resolve({ text: "This result is no longer authoritative." });
		await service.whenIdle();

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				replyStatus: "cancelled",
				replyError:
					"Interrupted because a Project used by this run was removed.",
			}),
			expect.objectContaining({
				id: queued.accepted.id,
				replyStatus: "cancelled",
				replyError:
					"Interrupted because a Project used by this run was removed.",
			}),
		]);
	});

	it.each(["inferred", "explicit"])(
		"terminalizes queued %s routing when its selected Project is removed",
		async (addressing) => {
			const root = await mkdtemp(
				join(tmpdir(), "commonspace-pending-routing-project-removal-"),
			);
			roots.push(root);
			const workspace = join(root, "workspace");
			await mkdir(workspace);
			const firstStarted = deferred<void>();
			const firstCompleted = deferred<{ text: string }>();
			const runAgent = vi.fn(async () => {
				if (runAgent.mock.calls.length === 1) {
					firstStarted.resolve();
					return firstCompleted.promise;
				}
				return { text: "The queued request ran without its selected Project." };
			});
			const routeAgents = vi.fn(
				async (): Promise<CommonspaceRouteResult> => ({
					mode: "parallel",
					assignments: [{ agentId: "codex", projectIds: [] }],
					reason: "Route the queued request after the active turn.",
				}),
			);
			const service = new CommonspaceHostService(
				{},
				{ root },
				{
					discoverAgents: discoverTestHarnesses,
					runAgent: withHarnessUtilities(runAgent),
					routeAgents,
				},
			);
			await service.initialize();
			await addTestHarness(service, "codex", "Review Bot");
			await addTestHarness(service, "hermes", "UI Bot");
			const project = mustExist(
				(
					await service.mutate({
						action: "create-project",
						name: "Removable",
						paths: [workspace],
					})
				).projects[0],
			);
			const channel = mustExist(
				(
					await service.mutate({
						action: "create-channel",
						name: "review",
						agentIds: ["codex", "hermes"],
					})
				).channels[0],
			);

			const first = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "@review-bot Start the review.",
			});
			await firstStarted.promise;
			const queued = await service.send({
				conversation: { kind: "channel", id: channel.id },
				threadId: mustExist(first.thread).id,
				projectId: project.id,
				delivery: "queue",
				text:
					addressing === "explicit"
						? "@review-bot @ui-bot reconcile the review in the selected Project."
						: "Continue the review in the selected Project.",
			});
			await service.mutate({ action: "remove-project", projectId: project.id });
			const afterRemoval = service.snapshot();
			firstCompleted.resolve({ text: "The active request completed." });
			await service.whenIdle();

			const reason =
				"Interrupted because a Project used by this run was removed.";
			expect(afterRemoval.messages[`channel:${channel.id}`]).toContainEqual(
				expect.objectContaining({
					id: queued.accepted.id,
					replyStatus: "failed",
					replyError: reason,
					routing: expect.objectContaining({
						status: "failed",
						reason,
						source: addressing === "explicit" ? "explicit" : "ai",
						agentIds: addressing === "explicit" ? ["codex", "hermes"] : [],
					}),
				}),
			);
			expect(routeAgents).not.toHaveBeenCalled();
			expect(runAgent).toHaveBeenCalledOnce();
		},
	);

	it("keeps an active Project turn running when another path is added", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-project-path-add-"));
		roots.push(root);
		const firstWorkspace = join(root, "workspace-a");
		const secondWorkspace = join(root, "workspace-b");
		await Promise.all([mkdir(firstWorkspace), mkdir(secondWorkspace)]);
		const started = deferred<void>();
		const completed = deferred<{ text: string }>();
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					started.resolve();
					return completed.promise;
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Expandable",
					paths: [firstWorkspace],
				})
			).projects[0],
		);

		const sent = await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Keep using the admitted roots.",
		});
		await started.promise;
		await service.mutate({
			action: "add-project-path",
			projectId: project.id,
			path: secondWorkspace,
		});
		completed.resolve({ text: "Completed with the original roots." });
		await service.whenIdle();

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				replyStatus: "complete",
			}),
			expect.objectContaining({
				authorType: "agent",
				text: "Completed with the original roots.",
			}),
		]);
	});

	it("invalidates a run while its attribution is still being collected", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-attribution-race-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		const bin = join(root, "bin");
		const fakeGit = join(bin, "git");
		const block = join(root, "block-git");
		const reached = join(root, "git-reached");
		const release = join(root, "release-git");
		await Promise.all([mkdir(workspace), mkdir(bin)]);
		await writeFile(
			fakeGit,
			`#!/bin/sh
if [ -f "$FAKE_GIT_BLOCK" ]; then
  : > "$FAKE_GIT_REACHED"
  while [ ! -f "$FAKE_GIT_RELEASE" ]; do sleep 0.01; done
fi
case "$*" in
  *"rev-parse --show-toplevel"*) printf '%s\\n' "$FAKE_GIT_ROOT" ;;
  *"symbolic-ref"*) printf 'main\\n' ;;
  *"rev-parse HEAD"*) printf '0123456789012345678901234567890123456789\\n' ;;
esac
`,
		);
		await chmod(fakeGit, 0o755);
		vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
		vi.stubEnv("FAKE_GIT_ROOT", workspace);
		vi.stubEnv("FAKE_GIT_BLOCK", block);
		vi.stubEnv("FAKE_GIT_REACHED", reached);
		vi.stubEnv("FAKE_GIT_RELEASE", release);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					await writeFile(block, "block");
					return { text: "This reply became stale during attribution." };
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Attribution",
					paths: [workspace],
				})
			).projects[0],
		);

		const sent = await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Inspect this Project.",
		});
		await vi.waitFor(
			async () => {
				expect(await stat(reached)).toBeDefined();
			},
			{ timeout: 5_000 },
		);
		await service.mutate({ action: "remove-project", projectId: project.id });
		await writeFile(release, "release");
		await service.whenIdle();

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				replyStatus: "cancelled",
				replyError:
					"Interrupted because a Project used by this run was removed.",
			}),
		]);
	});

	it("records a terminal Channel failure when an active Agent is removed", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agent-removal-"));
		roots.push(root);
		const started = deferred<void>();
		const completed = deferred<{ text: string }>();
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					started.resolve();
					return completed.promise;
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					agentIds: ["codex"],
				})
			).channels[0],
		);

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot Review this change.",
		});
		await started.promise;
		await service.mutate({ action: "remove-agent", agentId: "codex" });
		expect(service.snapshot().messages[`channel:${channel.id}`]).toContainEqual(
			expect.objectContaining({
				authorType: "system",
				sourceMessageId: sent.accepted.id,
				text: "@codex run failed: Interrupted because the Agent was removed.",
			}),
		);
		completed.resolve({ text: "This stale response must be discarded." });
		await service.whenIdle();

		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.filter(
					(message) =>
						message.authorType === "system" &&
						message.sourceMessageId === sent.accepted.id,
				),
		).toHaveLength(1);
		expect(
			service.snapshot().threads.find((thread) => thread.id === sent.thread?.id)
				?.agentIds,
		).toEqual([]);
	});

	it("does not run a queued Channel turn after its Agent authority is replaced", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-queued-authority-"));
		roots.push(root);
		const firstStarted = deferred<void>();
		const firstCompleted = deferred<{ text: string }>();
		const runAgent = vi.fn(async () => {
			if (runAgent.mock.calls.length === 1) {
				firstStarted.resolve();
				return firstCompleted.promise;
			}
			return { text: "A queued request ran with replacement authority." };
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
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
			text: "@review-bot Start the review.",
		});
		await firstStarted.promise;
		const queued = await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: first.thread?.id,
			targetAgentId: "codex",
			delivery: "queue",
			text: "Review the follow-up too.",
		});
		await service.mutate({ action: "remove-agent", agentId: "codex" });
		expect(service.snapshot().messages[`channel:${channel.id}`]).toContainEqual(
			expect.objectContaining({
				authorType: "system",
				sourceMessageId: queued.accepted.id,
				text: "@codex run failed: Interrupted because the Agent was removed.",
			}),
		);
		await addTestHarness(service, "codex", "Review Bot");
		firstCompleted.resolve({ text: "The first response is also stale." });
		await service.whenIdle();

		expect(runAgent).toHaveBeenCalledOnce();
		expect(service.snapshot().messages[`channel:${channel.id}`]).toContainEqual(
			expect.objectContaining({
				authorType: "system",
				sourceMessageId: queued.accepted.id,
				text: "@codex run failed: Interrupted because the Agent was removed.",
			}),
		);
	});

	it("does not run a queued Channel turn after Agent access changes", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-queued-access-"));
		roots.push(root);
		const firstStarted = deferred<void>();
		const firstCompleted = deferred<{ text: string }>();
		const runAgent = vi.fn(async () => {
			firstStarted.resolve();
			return firstCompleted.promise;
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
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
			text: "@review-bot Start the review.",
		});
		await firstStarted.promise;
		const queued = await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: first.thread?.id,
			targetAgentId: "codex",
			delivery: "queue",
			text: "Continue with the admitted access policy.",
		});
		await service.mutate({
			action: "update-agent-profile",
			agentId: "codex",
			displayName: "Review Bot",
			fullAccess: true,
		});
		expect(service.snapshot().messages[`channel:${channel.id}`]).toContainEqual(
			expect.objectContaining({
				authorType: "system",
				sourceMessageId: queued.accepted.id,
				text: "@codex run failed: Interrupted because agent permissions changed.",
			}),
		);
		firstCompleted.resolve({ text: "This response used stale access." });
		await service.whenIdle();

		expect(runAgent).toHaveBeenCalledOnce();
		expect(service.snapshot().messages[`channel:${channel.id}`]).toContainEqual(
			expect.objectContaining({
				authorType: "system",
				sourceMessageId: queued.accepted.id,
				text: "@codex run failed: Interrupted because agent permissions changed.",
			}),
		);
	});

	it("redacts host paths from agent failures before publishing them", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-private-error-"));
		roots.push(root);
		const workspace = join(root, "private-workspace");
		await mkdir(workspace);
		const canonicalWorkspace = await realpath(workspace);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: async () => {
					throw new Error(
						`provider failed inside ${canonicalWorkspace}/secret.txt`,
					);
				},
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Private",
					paths: [workspace],
				})
			).projects[0],
		);
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Run.",
		});
		await service.whenIdle();

		const failure = service.snapshot().messages["dm:codex"]?.at(-1)?.text ?? "";
		expect(failure).toContain("[host path]/secret.txt");
		expect(failure).not.toContain(canonicalWorkspace);
	});

	it("loads only valid native sessions owned by managed agents and known scopes", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-sanitize-"));
		roots.push(root);
		const sessionId = "123e4567-e89b-42d3-a456-426614174000";
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 5,
				revision: 1,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "codex-review-bot",
						displayName: "Review Bot",
						adapter: "codex",
						model: null,
						createdAt: "now",
					},
				],
				agentSessions: {
					"codex-review-bot": {
						"Bot Chat": sessionId,
						Other: sessionId,
						"Commonspace Thread: invalid": sessionId,
					},
					rogue: { "Bot Chat": sessionId },
				},
				projects: [],
				channels: [],
				threads: [],
				messages: {},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();

		expect(service.snapshot().agentSessions).toEqual({
			"codex-review-bot": { "Bot Chat": sessionId },
		});
	});

	it("sanitizes malformed legacy state, canonicalizes paths, and durably writes the current version", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-migration-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const canonicalWorkspace = await realpath(workspace);
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 4,
				revision: -10,
				defaults: {
					maxAgentsPerTurn: 99,
					memoryThreads: 0,
				},
				projects: [
					{
						id: "project-1",
						name: "Project",
						paths: [workspace, join(root, "missing")],
						createdAt: "now",
					},
					{ broken: true },
				],
				channels: [
					{
						id: "channel-1",
						name: "general",
						projectId: "project-1",
						agentIds: ["frontend", 42],
						instructions: 42,
						memory: { summary: 42 },
						createdAt: "now",
					},
				],
				threads: [{ broken: true }],
				messages: { "channel:channel-1": "not-an-array" },
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();

		const state = service.snapshot();
		expect(state.channels[0]).not.toHaveProperty("settings");
		expect(state).toMatchObject({
			version: COMMONSPACE_STATE_VERSION,
			revision: 0,
			defaults: {
				maxAgentsPerTurn: 8,
				memoryThreads: 1,
			},
			projects: [{ id: "project-1", paths: [canonicalWorkspace] }],
			channels: [
				{
					id: "channel-1",
					agentIds: [],
					instructions: "",
				},
			],
			threads: [],
			messages: {},
		});
		const persisted = persistedStateSchema.parse(
			JSON.parse(await readFile(join(root, "state.json"), "utf8")),
		);
		expect(persisted).toMatchObject({
			version: COMMONSPACE_STATE_VERSION,
			defaults: { maxAgentsPerTurn: 8, memoryThreads: 1 },
		});
	});

	it("skips an untaggable saved agent without discarding later valid agents", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agent-recovery-"));
		roots.push(root);
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: COMMONSPACE_STATE_VERSION,
				revision: 1,
				inboxReadAt: null,
				inboxReadMessageIds: [],
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "broken",
						displayName: "!!!",
						adapter: "hermes",
						model: null,
						createdAt: "before",
					},
					{
						id: "hermes",
						displayName: "Hermes",
						adapter: "hermes",
						model: null,
						createdAt: "after",
					},
				],
				dmSessions: {},
				agentSessions: {},
				projects: [],
				channels: [],
				threads: [],
				messages: {},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		expect(service.snapshot().agents).toEqual([
			{
				id: "hermes",
				displayName: "Hermes",
				adapter: "hermes",
				model: null,
				createdAt: "after",
			},
		]);
	});

	it("migrates v7 state to the Hermes and Codex roster", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-v7-roster-"));
		roots.push(root);
		const codexScope = "Commonspace DM: 123e4567-e89b-42d3-a456-426614174000";
		const retiredScope = "Commonspace DM: 223e4567-e89b-42d3-a456-426614174000";
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 7,
				revision: 5,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "codex-review-bot",
						displayName: "Review Bot",
						adapter: "codex",
						model: null,
						createdAt: "now",
					},
					{
						id: "retired-agent-writer",
						displayName: "Writer",
						adapter: "retired-runtime",
						model: null,
						createdAt: "now",
					},
				],
				dmSessions: {
					"codex-review-bot": codexScope,
					"retired-agent-writer": retiredScope,
				},
				agentSessions: {
					"codex-review-bot": { [codexScope]: "codex-native-session" },
					"retired-agent-writer": { [retiredScope]: "retired-native-session" },
				},
				projects: [],
				channels: [
					{
						id: "general",
						name: "general",
						projectId: null,
						agentIds: ["codex-review-bot", "retired-agent-writer"],
						instructions: "",
						memory: {
							summary: "",
							decisions: [],
							openQuestions: [],
							threadIds: [],
							updatedAt: null,
						},
						createdAt: "now",
					},
				],
				threads: [],
				messages: {
					"dm:codex-review-bot": [],
					"dm:retired-agent-writer": [],
				},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();

		expect(service.snapshot()).toMatchObject({
			version: COMMONSPACE_STATE_VERSION,
			agents: [{ id: "codex-review-bot", adapter: "codex" }],
			dmSessions: { "codex-review-bot": codexScope },
			agentSessions: {
				"codex-review-bot": { [codexScope]: "codex-native-session" },
			},
			channels: [{ id: "general", agentIds: ["codex-review-bot"] }],
			messages: { "dm:codex-review-bot": [] },
		});
		expect(
			service.snapshot().messages["dm:retired-agent-writer"],
		).toBeUndefined();
	});

	it("redacts host-private details from loaded activity traces before repersisting them", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-trace-redaction-"));
		roots.push(root);
		const nativeSessionId = "codex:private-native-session";
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 9,
				revision: 2,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "codex-review-bot",
						displayName: "Review Bot",
						adapter: "codex",
						model: null,
						createdAt: "now",
					},
				],
				dmSessions: {},
				agentSessions: { "codex-review-bot": { "Bot Chat": nativeSessionId } },
				projects: [],
				channels: [],
				threads: [],
				messages: {
					"dm:codex-review-bot": [
						{
							id: "message-1",
							conversation: { kind: "dm", id: "codex-review-bot" },
							authorType: "agent",
							authorId: "codex-review-bot",
							authorName: "Review Bot",
							text: "Done.",
							createdAt: "2026-08-26T00:00:02.000Z",
							trace: {
								adapter: "codex",
								startedAt: "2026-08-26T00:00:00.000Z",
								completedAt: "2026-08-26T00:00:02.000Z",
								entries: [
									{
										type: "tool",
										id: "call-1",
										title: `Read ${root}/secret.txt`,
										status: "completed",
										input: `{"path":"${root}/secret.txt"}`,
										output: `session=${nativeSessionId}`,
										createdAt: "2026-08-26T00:00:00.500Z",
										updatedAt: "2026-08-26T00:00:01.500Z",
									},
								],
							},
						},
					],
				},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);

		await service.initialize();

		const trace =
			service.snapshot().messages["dm:codex-review-bot"]?.[0]?.trace;
		expect(JSON.stringify(trace)).toContain("[host path]/secret.txt");
		expect(JSON.stringify(trace)).toContain("[native session]");
		expect(JSON.stringify(trace)).not.toContain(root);
		expect(JSON.stringify(trace)).not.toContain(nativeSessionId);
		const persisted = JSON.parse(
			await readFile(join(root, "state.json"), "utf8"),
		);
		expect(
			JSON.stringify(persisted.messages["dm:codex-review-bot"][0].trace),
		).toEqual(JSON.stringify(trace));
	});

	it("marks work left running by a previous host process as interrupted", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-interrupted-recovery-"),
		);
		roots.push(root);
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				version: 8,
				revision: 4,
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [
					{
						id: "codex-review-bot",
						displayName: "Review Bot",
						adapter: "codex",
						model: null,
						createdAt: "now",
					},
				],
				dmSessions: {},
				agentSessions: {},
				projects: [],
				channels: [],
				threads: [],
				messages: {
					"dm:codex-review-bot": [
						{
							id: "message-1",
							conversation: { kind: "dm", id: "codex-review-bot" },
							authorType: "user",
							authorId: "user",
							authorName: "Ralph",
							text: "Interrupted work.",
							createdAt: "now",
							replyStatus: "running",
						},
					],
				},
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();

		expect(
			service.snapshot().messages["dm:codex-review-bot"]?.[0],
		).toMatchObject({
			replyStatus: "error",
			replyError:
				"The previous Commonspace process ended before the agent completed.",
		});
	});

	it("drains active agent work before closing for a development restart", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-development-restart-"),
		);
		roots.push(root);
		const firstResult = deferred<{ text: string; sessionId: string }>();
		const secondResult = deferred<{ text: string; sessionId: string }>();
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.agent.id === "codex" ? firstResult.promise : secondResult.promise,
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses, runAgent },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await addTestHarness(service, "hermes", "Second Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Keep working through reload.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});

		const drain = service.drainAndClose();
		await expect(
			Promise.race([
				drain.then(() => "closed"),
				new Promise((resolve) =>
					setTimeout(() => resolve("still-running"), 25),
				),
			]),
		).resolves.toBe("still-running");
		await service.send({
			conversation: { kind: "dm", id: "hermes" },
			text: "Join before the swap.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledTimes(2);
		});

		firstResult.resolve({
			text: "Finished safely.",
			sessionId: "codex:thread/reload-safe",
		});
		await expect(
			Promise.race([
				drain.then(() => "closed"),
				new Promise((resolve) =>
					setTimeout(() => resolve("still-running"), 25),
				),
			]),
		).resolves.toBe("still-running");
		secondResult.resolve({
			text: "Also finished safely.",
			sessionId: "codex:thread/second-reload-safe",
		});
		await drain;

		expect(service.snapshot().messages["dm:codex"]).toEqual([
			expect.objectContaining({
				authorType: "user",
				replyStatus: "complete",
				text: "Keep working through reload.",
			}),
			expect.objectContaining({
				authorType: "agent",
				text: "Finished safely.",
			}),
		]);
		expect(service.snapshot().agentSessions.codex?.["Bot Chat"]).toBe(
			"codex:thread/reload-safe",
		);
		expect(service.snapshot().messages["dm:hermes"]?.at(-1)?.text).toBe(
			"Also finished safely.",
		);

		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => [] },
		);
		await restarted.initialize();
		expect(
			restarted.snapshot().messages["dm:codex"]?.[0]?.replyError,
		).toBeUndefined();
		await restarted.close();
	});

	it("discards an in-flight reply when a harness is removed and re-added", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-remove-race-"));
		roots.push(root);
		const result = deferred<{ text: string; sessionId: string }>();
		const runAgent = vi.fn(async () => result.promise);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: discoverTestHarnesses, runAgent },
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.send({
			conversation: { kind: "dm", id: "codex" },
			text: "Review this.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});

		await service.mutate({ action: "remove-agent", agentId: "codex" });
		await addTestHarness(service, "codex", "Review Bot");
		result.resolve({
			text: "Stale response.",
			sessionId: "123e4567-e89b-42d3-a456-426614174000",
		});
		await service.whenIdle();

		expect(service.snapshot().agents).toHaveLength(1);
		expect(service.snapshot().agentSessions.codex).toBeUndefined();
		expect(service.snapshot().messages["dm:codex"]).toBeUndefined();
	});

	it("does not resurrect a channel, thread, or native session after deletion", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-channel-delete-race-"),
		);
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const result = deferred<{ text: string; sessionId: string }>();
		const runAgent = vi.fn(async () => result.promise);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "codex", "Review Bot");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "codex",
		});
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					projectId: project.id,
					agentIds: ["codex"],
				})
			).channels[0],
		);
		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Review.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});

		await service.mutate({ action: "remove-channel", channelId: channel.id });
		result.resolve({
			text: "Stale response.",
			sessionId: "123e4567-e89b-42d3-a456-426614174000",
		});
		await service.whenIdle();

		const state = service.snapshot();
		expect(state.channels).toEqual([]);
		expect(state.threads).toEqual([]);
		expect(state.messages[`channel:${channel.id}`]).toBeUndefined();
		expect(state.agentSessions.codex).toBeUndefined();
	});

	it("does not block independent room deliveries on overlapping workspace paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-workspace-lock-"));
		roots.push(root);
		const firstWorkspace = join(root, "first-workspace");
		const secondWorkspace = join(firstWorkspace, "nested-workspace");
		await mkdir(firstWorkspace);
		await mkdir(secondWorkspace);
		const first = deferred<string>();
		const second = deferred<string>();
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.sessionName.includes(firstChannelId)
				? first.promise
				: second.promise,
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "hermes", "Frontend");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});
		const firstProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "First",
					paths: [firstWorkspace],
				})
			).projects.at(-1),
		);
		const secondProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Second",
					paths: [secondWorkspace],
				})
			).projects.at(-1),
		);
		const firstChannel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "first",
					projectId: firstProject.id,
					agentIds: ["hermes"],
				})
			).channels.at(-1),
		);
		const secondChannel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "second",
					projectId: secondProject.id,
					agentIds: ["hermes"],
				})
			).channels.at(-1),
		);
		const firstChannelId = firstChannel.id;

		await service.send({
			conversation: { kind: "channel", id: firstChannel.id },
			text: "First task.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});
		await service.send({
			conversation: { kind: "channel", id: secondChannel.id },
			text: "Second task.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledTimes(2);
		});

		first.resolve("First response.");
		second.resolve("Second response.");
		await service.whenIdle();
		expect(runAgent).toHaveBeenCalledTimes(2);
	});

	it.each([
		[
			"relay",
			"@backend @frontend review this together and reconcile one answer.",
		],
		[
			"parallel",
			"@backend inspect the API independently and @frontend inspect the UI independently.",
		],
	] as const)(
		"delivers explicit %s work without capping named participants",
		async (mode, text) => {
			const backend = deferred<string>();
			const frontend = deferred<string>();
			const execution: string[] = [];
			const runAgent = vi.fn((input: AgentRunInput) => {
				execution.push(`${input.agent.id}:started`);
				if (input.agent.id === "backend") {
					return backend.promise.then((reply) => {
						execution.push("backend:completed");
						return reply;
					});
				}
				return frontend.promise;
			});
			const routeAgents = vi.fn<
				(input: CommonspaceRouteInput) => Promise<CommonspaceRouteResult>
			>(async () => {
				return {
					mode,
					assignments: [
						{ agentId: "backend", projectIds: [] },
						{ agentId: "frontend", projectIds: [] },
					],
					reason: "Collaboration shape classified for the fixed participants.",
				};
			});
			const { service, channel } = await explicitRoutingFixture({
				runAgent,
				routeAgents,
			});
			await service.mutate({ action: "set-defaults", maxAgentsPerTurn: 1 });
			try {
				const response = await service.send({
					conversation: { kind: "channel", id: channel.id },
					text,
				});
				expect(response.accepted.routing?.status).toBe("pending");
				await vi.waitFor(() =>
					expect(runAgent).toHaveBeenCalledTimes(mode === "parallel" ? 2 : 1),
				);
				backend.resolve("Backend owns API contracts.");
				frontend.resolve("Frontend accepts the API contract.");
				await service.whenIdle();
				const accepted = mustExist(
					service
						.snapshot()
						.messages[`channel:${channel.id}`]?.find(
							(message) => message.id === response.accepted.id,
						),
				);
				expect(routeAgents).toHaveBeenCalledExactlyOnceWith(
					expect.objectContaining({
						fixedAgentIds: ["backend", "frontend"],
						inferProjects: false,
					}),
				);
				expect(accepted.text).toBe(text);
				expect(accepted.routing?.source).toBe("explicit");
				expect(accepted.routing?.agentIds).toEqual(["backend", "frontend"]);
				expect(
					accepted.routing?.assignments.map((assignment) => assignment.agentId),
				).toEqual(["backend", "frontend"]);
				expect(execution).toEqual(
					mode === "relay"
						? ["backend:started", "backend:completed", "frontend:started"]
						: ["backend:started", "frontend:started", "backend:completed"],
				);
				expect(accepted.routing?.mode).toBe(mode);
				expect(runAgent.mock.calls[1]?.[0].message).toBe(
					mode === "relay"
						? `Original user message:\n\n${text}\n\nFrom Backend:\n\nBackend owns API contracts.`
						: text,
				);
			} finally {
				backend.resolve("Backend owns API contracts.");
				frontend.resolve("Frontend accepts the API contract.");
				await service.whenIdle();
			}
		},
	);

	it("bypasses classification for one explicitly named participant", async () => {
		const runAgent = vi.fn(async () => "Reviewed.");
		const routeAgents = vi.fn(async (): Promise<CommonspaceRouteResult> => {
			throw new Error("Direct addressing must not invoke classification.");
		});
		const { service, channel } = await explicitRoutingFixture({
			runAgent,
			routeAgents,
		});
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend review the API.",
		});
		await service.whenIdle();
		expect(routeAgents).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				agent: expect.objectContaining({ id: "backend" }),
				message: sent.accepted.text,
			}),
		);
	});

	it("retains earlier thread participants after an explicit relay", async () => {
		const { service, channel } = await explicitRoutingFixture({
			runAgent: async () => "Reviewed.",
			routeAgents: async () => ({
				mode: "relay",
				assignments: ["backend", "frontend"].map((agentId) => ({
					agentId,
					projectIds: [],
				})),
				reason: "The named participants discuss the request.",
			}),
		});
		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@outside add context.",
		});
		await service.whenIdle();
		const threadId = mustExist(first.thread).id;
		await service.send({
			conversation: first.accepted.conversation,
			threadId,
			text: "@backend @frontend discuss the context.",
		});
		await service.whenIdle();
		expect(
			service.snapshot().threads.find((thread) => thread.id === threadId)
				?.agentIds,
		).toEqual(["outside", "backend", "frontend"]);
	});

	it.each([
		["added participant", ["backend", "frontend", "outside"], "relay"],
		["omitted participant", ["backend"], "parallel"],
		["substituted participant", ["backend", "outside"], "relay"],
		["duplicate participant", ["backend", "backend"], "relay"],
		["changed Project scope", ["backend", "frontend"], "relay"],
	] as const)(
		"preserves the explicit request without dispatch after %s",
		async (failure, agentIds, mode) => {
			const runAgent = vi.fn(async () => "Reviewed the request.");
			const routeAgents = vi.fn(
				async (
					input: CommonspaceRouteInput,
				): Promise<CommonspaceRouteResult> => {
					return {
						mode,
						assignments: agentIds.map((agentId) => ({
							agentId,
							projectIds:
								failure === "changed Project scope"
									? []
									: input.projects.map((project) => project.id),
						})),
						reason: "Invalid explicit shape result.",
					};
				},
			);
			const { service, channel, root } = await explicitRoutingFixture({
				runAgent,
				routeAgents,
			});
			const workspace = join(root, "app");
			await mkdir(workspace);
			const project = mustExist(
				(
					await service.mutate({
						action: "create-project",
						name: "App",
						paths: [workspace],
					})
				).projects[0],
			);
			const text =
				"@backend @frontend review this together and reconcile one answer.";
			const response = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text,
				projectIds: [project.id],
			});
			await service.whenIdle();
			expect(runAgent).not.toHaveBeenCalled();
			expect(
				routeAgents.mock.calls[0]?.[0].candidates
					.map((candidate) => candidate.id)
					.sort(),
			).toEqual(["backend", "frontend"]);
			const persisted: unknown = JSON.parse(
				await readFile(join(root, "state.json"), "utf8"),
			);
			expect(persisted).toMatchObject({
				messages: {
					[`channel:${channel.id}`]: [
						expect.objectContaining({
							id: response.accepted.id,
							text,
							replyStatus: "failed",
							projectIds: [project.id],
							routing: expect.objectContaining({
								source: "explicit",
								status: "failed",
								agentIds: ["backend", "frontend"],
								assignments: [],
							}),
						}),
					],
				},
			});
		},
	);

	it("retries explicit inference with the accepted participants and scope after a rename", async () => {
		const routeAgents = vi
			.fn<(input: CommonspaceRouteInput) => Promise<CommonspaceRouteResult>>()
			.mockRejectedValueOnce(new Error("Classifier unavailable."));
		const runAgent = vi.fn(async () => "Reviewed.");
		const { service, channel, root } = await explicitRoutingFixture({
			runAgent,
			routeAgents,
		});
		const workspace = join(root, "app");
		await mkdir(workspace);
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend @frontend review this together.",
			projectIds: [project.id],
		});
		await service.whenIdle();
		expect(runAgent).not.toHaveBeenCalled();
		await service.mutate({
			action: "update-agent-profile",
			agentId: "backend",
			displayName: "Renamed Backend",
		});
		routeAgents.mockResolvedValueOnce({
			mode: "relay",
			assignments: ["backend", "frontend"].map((agentId) => ({
				agentId,
				projectIds: [project.id],
			})),
			reason: "Recovered collaboration classification.",
		});
		await service.retryRouting({
			sourceMessageId: sent.accepted.id,
			mode: "ai",
		});
		await service.whenIdle();
		const messages = mustExist(
			service.snapshot().messages[`channel:${channel.id}`],
		);
		expect(messages.filter((message) => message.authorType === "user")).toEqual(
			[
				expect.objectContaining({
					id: sent.accepted.id,
					text: sent.accepted.text,
					projectIds: [project.id],
					routing: expect.objectContaining({
						source: "explicit",
						status: "resolved",
						mode: "relay",
						agentIds: ["backend", "frontend"],
						assignments: [
							expect.objectContaining({
								agentId: "backend",
								projectIds: [project.id],
							}),
							expect.objectContaining({
								agentId: "frontend",
								projectIds: [project.id],
							}),
						],
					}),
				}),
			],
		);
		expect(
			messages
				.filter((message) => message.authorType === "agent")
				.map((message) => message.authorId),
		).toEqual(["backend", "frontend"]);
	});

	it("makes interrupted explicit classification retryable after restart", async () => {
		const restartedRoot = await mkdtemp(
			join(tmpdir(), "commonspace-explicit-restart-"),
		);
		roots.push(restartedRoot);
		const route = deferred<CommonspaceRouteResult>();
		const result: CommonspaceRouteResult = {
			mode: "relay",
			assignments: ["backend", "frontend"].map((agentId) => ({
				agentId,
				projectIds: [],
			})),
			reason: "The user requested a shared conclusion.",
		};
		const { service, channel, root } = await explicitRoutingFixture({
			runAgent: async () => "Reviewed.",
			routeAgents: async () => route.promise,
		});
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend @frontend discuss and reconcile one answer.",
		});
		const pendingState = await readFile(
			join(root, "state.json"),
			"utf8",
		).finally(() => route.resolve(result));
		await service.whenIdle();
		await writeFile(join(restartedRoot, "state.json"), pendingState);
		const restarted = new CommonspaceHostService(
			{},
			{ root: restartedRoot },
			{
				discoverAgents: async () =>
					service
						.snapshot()
						.agents.map((agent) => ({ ...agent, status: "stopped" as const })),
				runAgent: async () => "Reviewed.",
				routeAgents: async () => result,
			},
		);
		services.push(restarted);
		await restarted.initialize();
		expect(restarted.snapshot().messages[`channel:${channel.id}`]).toEqual([
			expect.objectContaining({
				id: sent.accepted.id,
				text: sent.accepted.text,
				replyStatus: "failed",
				routing: expect.objectContaining({
					source: "explicit",
					status: "failed",
					agentIds: ["backend", "frontend"],
				}),
			}),
		]);
		await restarted.retryRouting({
			sourceMessageId: sent.accepted.id,
			mode: "ai",
		});
		await restarted.whenIdle();
		const messages =
			restarted.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(messages.filter((message) => message.authorType === "user")).toEqual(
			[
				expect.objectContaining({
					id: sent.accepted.id,
					routing: expect.objectContaining({
						source: "explicit",
						status: "resolved",
						mode: "relay",
					}),
				}),
			],
		);
		expect(
			messages
				.filter((message) => message.authorType === "agent")
				.map((message) => message.authorId),
		).toEqual(["backend", "frontend"]);
	});

	it("starts one speaker and passes each peer response through an inferred relay", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-relay-room-"));
		roots.push(root);
		const backend = deferred<string>();
		const frontend = deferred<string>();
		const infrastructure = deferred<string>();
		const runAgent = vi.fn((input: AgentRunInput) => {
			switch (input.agent.id) {
				case "backend":
					return backend.promise;
				case "frontend":
					return frontend.promise;
				case "infrastructure":
					return infrastructure.promise;
				default:
					throw new Error("unexpected relay agent");
			}
		});
		const agents = ["backend", "frontend", "infrastructure"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "relay" as const,
					assignments: [
						{
							agentId: "backend",
							projectIds: [],
						},
						{
							agentId: "frontend",
							projectIds: [],
						},
						{
							agentId: "infrastructure",
							projectIds: [],
						},
					],
					reason: "The user requested a sequential peer discussion.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend", "infrastructure");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Talk to each other and agree on the ownership boundary.",
		});
		await vi.waitFor(() => {
			expect(
				runAgent.mock.calls
					.filter(
						([input]) =>
							!input.sessionName.startsWith("Commonspace Inference:"),
					)
					.map((call) => call[0].agent.id),
			).toEqual(["backend"]);
		});

		backend.resolve("Backend owns API contracts.");
		await vi.waitFor(() => {
			expect(
				runAgent.mock.calls
					.filter(
						([input]) =>
							!input.sessionName.startsWith("Commonspace Inference:"),
					)
					.map((call) => call[0].agent.id),
			).toEqual(["backend", "frontend"]);
		});
		expect(runAgent.mock.calls[1]?.[0].message).toBe(
			"Original user message:\n\nTalk to each other and agree on the ownership boundary.\n\nFrom Backend:\n\nBackend owns API contracts.",
		);

		frontend.resolve("Frontend accepts the API contract.");
		await vi.waitFor(() => {
			expect(
				runAgent.mock.calls
					.filter(
						([input]) =>
							!input.sessionName.startsWith("Commonspace Inference:"),
					)
					.map((call) => call[0].agent.id),
			).toEqual(["backend", "frontend", "infrastructure"]);
		});
		expect(runAgent.mock.calls[2]?.[0].message).toBe(
			"Original user message:\n\nTalk to each other and agree on the ownership boundary.\n\nFrom Frontend:\n\nFrontend accepts the API contract.",
		);

		infrastructure.resolve("Ownership boundary agreed.");
		await service.whenIdle();
		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(
			messages
				.filter((message) => message.authorType === "agent")
				.map((message) => message.authorId),
		).toEqual(["backend", "frontend", "infrastructure"]);
		expect(
			messages.find((message) => message.authorType === "user")?.routing?.mode,
		).toBe("relay");

		await service.close();
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => agents, runAgent },
		);
		await restarted.initialize();
		expect(
			restarted
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.authorType === "user",
				)?.routing?.mode,
		).toBe("relay");
		await restarted.close();
	});

	it("bounds relayed peer text while preserving the original request", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-relay-bounds-"));
		roots.push(root);
		const agents = ["backend", "frontend"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.agent.id === "backend"
				? `${"x".repeat(2_500)}PEER_MIDDLE${"y".repeat(2_500)}`
				: "Frontend reviewed it.",
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "relay" as const,
					assignments: [
						{
							agentId: "backend",
							projectIds: [],
						},
						{
							agentId: "frontend",
							projectIds: [],
						},
					],
					reason: "Bounded relay test.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Discuss this without replaying oversized context.",
			attachments: [
				{
					name: "boundary.png",
					mimeType: "image/png",
					data: "iVBORw==",
				},
			],
		});
		await service.whenIdle();

		const relayed = mustExist(runAgent.mock.calls[1]?.[0].message);
		expect(relayed.length).toBeLessThan(4_200);
		expect(relayed).not.toContain("PEER_MIDDLE");
		expect(relayed).toContain(
			"Peer response truncated; use commonspace_get_context for the full reply.",
		);
		expect(relayed).toContain(
			"Discuss this without replaying oversized context.",
		);
		expect(runAgent.mock.calls[1]?.[0].images).toEqual([
			{
				name: "boundary.png",
				mimeType: "image/png",
				data: "iVBORw==",
			},
		]);
	});

	it("delivers a structured peer handoff and one bounded return", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-structured-handoff-"),
		);
		roots.push(root);
		const serviceRef: { current?: CommonspaceHostService } = {};
		let backendRuns = 0;
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.commonspaceScope === undefined)
				throw new Error("expected Commonspace MCP scope");
			if (input.agent.id === "backend") {
				backendRuns += 1;
				if (backendRuns === 1) {
					await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
						targetAgentId: "frontend",
						request: "Review the API boundary.",
					});
					return "Backend API boundary ready.";
				}
				return "Backend accepted the review.";
			}
			await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
				targetAgentId: "backend",
				request: "Frontend accepts the API boundary.",
			});
			return "Frontend review complete.";
		});
		const agents = ["backend", "frontend"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
			},
		);
		serviceRef.current = service;
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend define the API boundary and ask Frontend to review it.",
		});
		await service.whenIdle();
		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend", "frontend", "backend"]);
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			message:
				"@backend define the API boundary and ask Frontend to review it.",
			commonspaceScope: {
				peers: [{ id: "frontend", displayName: "Frontend" }],
			},
		});
		expect(runAgent.mock.calls[1]?.[0].message).toBe(
			"From Backend:\n\nReview the API boundary.",
		);
		expect(runAgent.mock.calls[2]?.[0].message).toBe(
			"From Frontend:\n\nFrontend accepts the API boundary.",
		);
		const replies = (service.snapshot().messages[`channel:${channel.id}`] ?? [])
			.filter((message) => message.authorType === "agent")
			.map((message) => ({ authorId: message.authorId, text: message.text }));
		expect(replies).toEqual([
			{
				authorId: "backend",
				text: "Backend API boundary ready.\n\n@frontend Review the API boundary.",
			},
			{
				authorId: "frontend",
				text: "Frontend review complete.\n\n@backend Frontend accepts the API boundary.",
			},
			{ authorId: "backend", text: "Backend accepted the review." },
		]);
		expect(
			service
				.snapshot()
				.threads.find((thread) => thread.channelId === channel.id)?.agentIds,
		).toEqual(["backend", "frontend"]);
	});

	it("preserves a planned relay assignment and Project scope through a structured handoff", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-relay-scope-"));
		roots.push(root);
		const backendRoot = join(root, "backend");
		const frontendRoot = join(root, "frontend");
		await mkdir(backendRoot);
		await mkdir(frontendRoot);
		const serviceRef: { current?: CommonspaceHostService } = {};
		const agents = ["backend", "frontend"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		let backendProjectId = "";
		let frontendProjectId = "";
		let backendRuns = 0;
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.commonspaceScope === undefined)
				throw new Error("expected Commonspace MCP scope");
			if (input.agent.id === "backend") {
				backendRuns += 1;
				if (backendRuns === 1) {
					await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
						targetAgentId: "frontend",
						request: "Review the client contract.",
					});
					return "Backend contract ready.";
				}
				return "Backend accepted the client review.";
			}
			return "Frontend contract reviewed.\n\n@backend Accept the client review.";
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "relay" as const,
					assignments: [
						{
							agentId: "backend",
							projectIds: [backendProjectId],
						},
						{
							agentId: "frontend",
							projectIds: [frontendProjectId],
						},
					],
					reason: "Backend defines the contract before frontend review.",
				}),
			},
		);
		serviceRef.current = service;
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const backendProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Backend",
					paths: [backendRoot],
				})
			).projects.find((project) => project.name === "Backend"),
		);
		const frontendProject = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Frontend",
					paths: [frontendRoot],
				})
			).projects.find((project) => project.name === "Frontend"),
		);
		backendProjectId = backendProject.id;
		frontendProjectId = frontendProject.id;
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectIds: [backendProject.id, frontendProject.id],
			text: "Discuss the API and client contract. Preserve ORIGINAL_CONSTRAINT.",
		});
		await service.whenIdle();

		expect(runAgent.mock.calls[1]?.[0].cwd).toBe(await realpath(frontendRoot));
		expect(runAgent.mock.calls[1]?.[0].message).toContain(
			"Discuss the API and client contract. Preserve ORIGINAL_CONSTRAINT.",
		);
		expect(runAgent.mock.calls[1]?.[0].message).toContain(
			"From Backend:\n\nBackend contract ready.",
		);
		expect(runAgent.mock.calls[1]?.[0].message).toContain(
			"Review the client contract.",
		);
		expect(runAgent.mock.calls[2]?.[0].cwd).toBe(await realpath(backendRoot));
		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		const source = mustExist(
			messages.find((message) => message.authorType === "user"),
		);
		const frontendAssignment = mustExist(
			source.routing?.assignments.find(
				(assignment) => assignment.agentId === "frontend",
			),
		);
		const backendAssignment = mustExist(
			source.routing?.assignments.find(
				(assignment) => assignment.agentId === "backend",
			),
		);
		expect(
			messages.find(
				(message) =>
					message.authorType === "agent" && message.authorId === "frontend",
			)?.routingAssignmentId,
		).toBe(frontendAssignment.id);
		expect(
			messages.findLast(
				(message) =>
					message.authorType === "agent" && message.authorId === "backend",
			)?.routingAssignmentId,
		).toBe(backendAssignment.id);
	});

	it("restricts each active turn to one current Channel peer handoff", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-handoff-scope-"));
		roots.push(root);
		const serviceRef: { current?: CommonspaceHostService } = {};
		const agents = ["backend", "frontend", "outsider"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.commonspaceScope === undefined)
				throw new Error("expected Commonspace MCP scope");
			if (input.agent.id === "frontend") return "Frontend completed review.";
			await expect(
				mustExist(serviceRef.current).handoff(input.commonspaceScope, {
					targetAgentId: "backend",
					request: "Self handoff.",
				}),
			).rejects.toThrow("an agent cannot hand work to itself");
			await expect(
				mustExist(serviceRef.current).handoff(input.commonspaceScope, {
					targetAgentId: "outsider",
					request: "Outside handoff.",
				}),
			).rejects.toThrow("peer handoff target is not in this Channel");
			await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
				targetAgentId: "frontend",
				request: "Review this boundary.",
			});
			await expect(
				mustExist(serviceRef.current).handoff(input.commonspaceScope, {
					targetAgentId: "frontend",
					request: "Duplicate handoff.",
				}),
			).rejects.toThrow("this agent turn already requested a peer handoff");
			return "Backend requested review.";
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
			},
		);
		serviceRef.current = service;
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend", "outsider");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend ask Frontend to review this.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend", "frontend"]);
	});

	it("stops a repeated structured handoff edge with a visible outcome", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-handoff-loop-"));
		roots.push(root);
		const serviceRef: { current?: CommonspaceHostService } = {};
		const agents = ["backend", "frontend"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.commonspaceScope === undefined)
				throw new Error("expected Commonspace MCP scope");
			const targetAgentId =
				input.agent.id === "backend" ? "frontend" : "backend";
			await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
				targetAgentId,
				request: `Continue with ${targetAgentId}.`,
			});
			return `${input.agent.displayName} replied.`;
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
			},
		);
		serviceRef.current = service;
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend start a bounded discussion.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend", "frontend", "backend"]);
		expect(
			(service.snapshot().messages[`channel:${channel.id}`] ?? []).some(
				(message) =>
					message.authorType === "system" &&
					message.text ===
						"Commonspace stopped the @backend to @frontend handoff because that relay edge already ran.",
			),
		).toBe(true);
	});

	it("stops a peer relay at the visible workspace agent limit", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-relay-turn-limit-"));
		roots.push(root);
		const agents = Array.from({ length: 5 }, (_, index) => ({
			id: `agent-${String(index + 1)}`,
			displayName: `Agent ${String(index + 1)}`,
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const serviceRef: { current?: CommonspaceHostService } = {};
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.commonspaceScope === undefined)
				throw new Error("expected Commonspace MCP scope");
			const index = agents.findIndex((agent) => agent.id === input.agent.id);
			const next = agents[index + 1];
			if (next !== undefined)
				await mustExist(serviceRef.current).handoff(input.commonspaceScope, {
					targetAgentId: next.id,
					request: `Continue with ${next.displayName}.`,
				});
			return `${input.agent.displayName} replied.`;
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
			},
		);
		serviceRef.current = service;
		await service.initialize();
		await addDiscoveredAgents(service, ...agents.map((agent) => agent.id));
		await service.mutate({ action: "set-defaults", maxAgentsPerTurn: 3 });
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@agent-1 start a bounded peer relay.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(agents.slice(0, 3).map((agent) => agent.id));
		expect(
			(service.snapshot().messages[`channel:${channel.id}`] ?? []).some(
				(message) =>
					message.authorType === "system" &&
					message.text ===
						"Commonspace stopped the agent relay after 3 turns to prevent a loop.",
			),
		).toBe(true);
	});

	it("lets a relay speaker choose the next Channel peer with a visible mention", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-relay-choice-"));
		roots.push(root);
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			switch (input.agent.id) {
				case "backend":
					return "Need runtime input first.\n\n@infrastructure inspect the boundary.";
				case "infrastructure":
					return "Runtime boundary is safe.";
				case "frontend":
					return "Client boundary reconciled.";
				default:
					throw new Error("unexpected relay agent");
			}
		});
		const agents = ["backend", "frontend", "infrastructure"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "relay" as const,
					assignments: [
						{
							agentId: "backend",
							projectIds: [],
						},
						{
							agentId: "frontend",
							projectIds: [],
						},
						{
							agentId: "infrastructure",
							projectIds: [],
						},
					],
					reason: "Sequential specialist discussion.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend", "infrastructure");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Talk together and agree on the boundary.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend", "infrastructure", "frontend"]);
		expect(runAgent.mock.calls[1]?.[0].message).toBe(
			"Original user message:\n\nTalk together and agree on the boundary.\n\nFrom Backend:\n\nNeed runtime input first.\n\n@infrastructure inspect the boundary.",
		);
	});

	it("allows one final-mention return and stops a repeated edge visibly", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-a2a-room-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.agent.id === "backend"
				? "API is ready.\n\n@frontend connect the configuration view."
				: "@backend UI connected and verified.",
		);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
		];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					projectId: project.id,
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend expose the provider configuration.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend", "frontend", "backend"]);
		expect(runAgent.mock.calls[1]?.[0].message).toBe(
			"From Backend:\n\nAPI is ready.\n\n@frontend connect the configuration view.",
		);
		expect(runAgent.mock.calls[2]?.[0].message).toBe(
			"From Frontend:\n\n@backend UI connected and verified.",
		);
		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(
			messages
				.filter((message) => message.authorType === "agent")
				.map((message) => message.authorId),
		).toEqual(["backend", "frontend", "backend"]);
		expect(
			messages.some(
				(message) =>
					message.authorType === "system" &&
					message.text ===
						"Commonspace stopped the @backend to @frontend handoff because that relay edge already ran.",
			),
		).toBe(true);
	});

	it("exposes peer responsibilities and handoff guidance in channel context", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agent-directory-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns APIs, persistence, and migrations.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns React UI and browser interactions.",
			},
		];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: async () => "Done.",
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);
		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@backend start.",
		});
		await service.whenIdle();

		const context = await service.readContext({
			agentId: "backend",
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(accepted.thread).id,
			sessionName: `Commonspace Thread: ${mustExist(accepted.thread).id}`,
		});

		expect(context.participants).toEqual([
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes",
				description: "Owns APIs, persistence, and migrations.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes",
				description: "Owns React UI and browser interactions.",
			},
		]);
		expect(context.collaboration).toMatchObject({
			handoff: expect.stringContaining("commonspace_handoff"),
			limits: expect.stringContaining("one peer"),
		});
	});

	it("rehydrates persisted agent responsibilities before routing after restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-restart-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns persistence, validation, APIs, and services.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns React UI, styling, and browser interactions.",
			},
		];
		const first = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: withHarnessUtilities(async () => "Done."),
			},
		);
		await first.initialize();
		await addDiscoveredAgents(first, "backend", "frontend");
		await first.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});
		const channel = mustExist(
			(
				await first.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);
		await first.close();

		const runAgent = vi.fn(async (input: AgentRunInput) => {
			void input;
			return "Done.";
		});
		const restarted = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await restarted.initialize();
		await restarted.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Please fix persisted message validation.",
		});
		await restarted.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["backend"]);
		await restarted.close();
	});

	it("uses the configured Commonspace router for an unmentioned channel message", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-ai-routing-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns APIs and persistence.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns browser UI, React, and CSS.",
			},
			{
				id: "security",
				displayName: "Security",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns threat modeling and security review.",
			},
		];
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} handled it.`,
		);
		const routeAgents = vi.fn(
			async (
				input: CommonspaceRouteInput,
			): Promise<CommonspaceRouteResult> => ({
				mode: "parallel",
				assignments: [
					{
						agentId: "frontend",
						projectIds: input.projects.map((project) => project.id),
					},
				],
				confidence: 0.97,
				reason: "The request is browser UI work.",
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: withHarnessUtilities(runAgent),
				routeAgents,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend", "security");
		const projectRoot = join(root, "billing-api");
		await mkdir(projectRoot);
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Billing API",
					paths: [projectRoot],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: project.id,
			text: "Fix the login screen CSS.",
		});
		await service.whenIdle();

		expect(routeAgents).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Fix the login screen CSS.",
				candidates: [
					expect.objectContaining({
						id: "frontend",
						routingScore: 1,
						matchedTerms: ["css"],
					}),
					expect.objectContaining({
						id: "backend",
						routingScore: 0,
						matchedTerms: [],
					}),
					expect.objectContaining({
						id: "security",
						routingScore: 0,
						matchedTerms: [],
					}),
				],
				context: expect.arrayContaining(["Referenced Project: Billing API"]),
				projects: [{ id: project.id, name: "Billing API" }],
				inferProjects: false,
				maxAgents: 3,
			}),
		);
		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["frontend"]);
		expect(runAgent.mock.calls[0]?.[0]?.message).toBe(
			"Fix the login screen CSS.",
		);
		expect(
			(await service.bootstrap()).state.messages[`channel:${channel.id}`]?.find(
				(message) => message.id === sent.accepted.id,
			)?.routing,
		).toMatchObject({
			source: "ai",
			status: "resolved",
			agentIds: ["frontend"],
			assignments: [
				{
					id: expect.any(String),
					agentId: "frontend",
					projectIds: [project.id],
				},
			],
			confidence: 0.97,
			reason: "The request is browser UI work.",
		});
	});

	it("uses the visible workspace fan-out limit without a hidden host cap", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-fanout-"));
		roots.push(root);
		const agents = Array.from({ length: 7 }, (_, index) => ({
			id: `harness-${String(index + 1)}`,
			displayName: `Harness ${String(index + 1)}`,
			adapter: "hermes" as const,
			model: null,
			status: "stopped" as const,
		}));
		const routeAgents = vi.fn(
			async (
				input: CommonspaceRouteInput,
			): Promise<CommonspaceRouteResult> => ({
				mode: "parallel",
				assignments: [
					{
						agentId: mustExist(input.candidates[0]).id,
						projectIds: [],
					},
				],
				reason: "One harness is sufficient.",
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: async () => "Done.",
				routeAgents,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, ...agents.map((agent) => agent.id));
		await service.mutate({ action: "set-defaults", maxAgentsPerTurn: 8 });
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "fanout",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Handle this.",
		});
		await service.whenIdle();

		expect(routeAgents).toHaveBeenCalledWith(
			expect.objectContaining({ maxAgents: 7 }),
		);
	});

	it("infers Project references for an unreferenced new Channel thread", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-routing-project-inference-"),
		);
		roots.push(root);
		const firstRoot = join(root, "first");
		const secondRoot = join(root, "second");
		await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
		const agent = {
			id: "backend",
			displayName: "Backend",
			adapter: "hermes" as const,
			model: null,
			status: "stopped" as const,
		};
		const runAgent = vi.fn(async () => "Done.");
		const routeAgents = vi.fn(
			async (input: CommonspaceRouteInput): Promise<CommonspaceRouteResult> => {
				const project = mustExist(
					input.projects.find((candidate) => candidate.name === "Second"),
				);
				return {
					mode: "parallel",
					assignments: [
						{
							agentId: agent.id,
							projectIds: [project.id],
						},
					],
					confidence: 0.88,
					reason: "The request concerns Second.",
				};
			},
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [agent],
				runAgent,
				routeAgents,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, agent.id);
		await service.mutate({
			action: "create-project",
			name: "First",
			paths: [firstRoot],
		});
		const second = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Second",
					paths: [secondRoot],
				})
			).projects.at(-1),
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "routing",
					agentIds: [agent.id],
				})
			).channels[0],
		);

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Handle the second workspace.",
		});
		await service.whenIdle();

		expect(routeAgents).toHaveBeenCalledWith(
			expect.objectContaining({
				inferProjects: true,
				projects: expect.arrayContaining([
					expect.objectContaining({ name: "First" }),
					expect.objectContaining({ id: second.id, name: "Second" }),
				]),
			}),
		);
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			message: "Handle the second workspace.",
			cwd: await realpath(secondRoot),
			additionalCwds: [],
		});
		const state = service.snapshot();
		expect(
			state.messages[`channel:${channel.id}`]?.find(
				(message) => message.id === sent.accepted.id,
			),
		).toMatchObject({
			projectIds: [second.id],
			projectId: second.id,
			routing: {
				inferredProjectIds: [second.id],
				assignments: [{ projectIds: [second.id] }],
			},
		});
		expect(
			state.threads.find((thread) => thread.id === sent.thread?.id),
		).toMatchObject({
			projectIds: [second.id],
			projectId: second.id,
		});
	});

	it("excludes deterministic routing from configuration contracts", () => {
		expectTypeOf<{
			provider: "deterministic";
		}>().not.toMatchTypeOf<UpdateRoutingConfigurationRequest>();
	});

	it("retries invalid harness routing before dispatching one validated assignment", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-harness-router-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns APIs.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns UI and CSS.",
			},
		];
		let routingAttempts = 0;
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.sessionName.startsWith("Commonspace Routing: ")) {
				routingAttempts += 1;
				return routingAttempts === 1
					? '{"assignments":['
					: '{"mode":"parallel","assignments":[{"agentId":"frontend","projectIds":[]}],"confidence":0.93,"reason":"CSS work"}';
			}
			return "Handled.";
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => agents, runAgent },
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the CSS layout.",
		});
		await service.whenIdle();

		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			agent: expect.objectContaining({ id: "backend" }),
		});
		expect(runAgent.mock.calls[0]?.[0].sessionName).toMatch(
			new RegExp(`^Commonspace Routing: ${channel.id}: `, "u"),
		);
		expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("model");
		expect(runAgent.mock.calls[1]?.[0].sessionName).toMatch(
			new RegExp(`^Commonspace Routing: ${channel.id}: `, "u"),
		);
		expect(runAgent.mock.calls[1]?.[0].sessionName).not.toBe(
			runAgent.mock.calls[0]?.[0].sessionName,
		);
		expect(runAgent.mock.calls[0]?.[0].message).toContain(
			"Output token budget: at most 768 tokens.",
		);
		expect(runAgent.mock.calls[0]?.[0].maxResponseChars).toBe(6_144);
		expect(runAgent.mock.calls[1]?.[0].message).toContain(
			"Output token budget: at most 1536 tokens.",
		);
		expect(runAgent.mock.calls[1]?.[0].maxResponseChars).toBe(12_288);
		expect(
			runAgent.mock.calls
				.filter(
					([input]) =>
						!input.sessionName.startsWith("Commonspace Routing: ") &&
						!input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map(([input]) => input.agent.id),
		).toEqual(["frontend"]);
	});

	it("fails after one routing retry without dispatching agent work", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-harness-router-retry-exhausted-"),
		);
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns APIs.",
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
				description: "Owns UI and CSS.",
			},
		];
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.sessionName.startsWith("Commonspace Routing: ")
				? '{"assignments":['
				: "Agent work must not run.",
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => agents, runAgent },
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the API and UI.",
		});
		await service.whenIdle();

		const routingCalls = runAgent.mock.calls.filter(([input]) =>
			input.sessionName.startsWith("Commonspace Routing: "),
		);
		const executionCalls = runAgent.mock.calls.filter(
			([input]) => !input.sessionName.startsWith("Commonspace Routing: "),
		);
		expect(routingCalls).toHaveLength(2);
		expect(executionCalls).toHaveLength(0);
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				),
		).toMatchObject({
			replyStatus: "failed",
			routing: { status: "failed", assignments: [] },
		});
	});

	it("rejects an in-flight routing decision after its inference Agent is removed", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-removed-inference-agent-"),
		);
		roots.push(root);
		const agents = [
			{
				id: "router",
				displayName: "Router",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
			{
				id: "worker",
				displayName: "Worker",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
		];
		const routingResult = deferred<string>();
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.sessionName.startsWith("Commonspace Routing: "))
				return routingResult.promise;
			return "Stale routing was accepted.";
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{ discoverAgents: async () => agents, runAgent },
		);
		await service.initialize();
		await addDiscoveredAgents(service, "router", "worker");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["worker"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "router",
		});

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Handle this request.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});
		await service.mutate({ action: "remove-agent", agentId: "router" });
		routingResult.resolve(
			'{"mode":"parallel","assignments":[{"agentId":"worker","projectIds":[]}],"confidence":0.9,"reason":"Worker owns it."}',
		);
		await service.whenIdle();

		expect(service.routing().provider).toBe(
			CommonspaceRoutingProvider.Unconfigured,
		);
		expect(runAgent).toHaveBeenCalledOnce();
		expect(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				),
		).toMatchObject({
			replyStatus: "failed",
			routing: { status: "failed", assignments: [] },
		});
	});

	it("isolates each harness routing decision from native session history", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-shared-router-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		vi.stubEnv("FAKE_ACP_SESSION_ID", "123e4567-e89b-42d3-a456-426614174000");
		vi.stubEnv(
			"FAKE_ACP_INFERENCE_RESPONSE",
			'{"mode":"parallel","assignments":[{"agentId":"hermes","projectIds":[]}],"confidence":0.9,"reason":"Hermes owns the request."}',
		);
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fakeAcpAgentPath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "hermes");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});
		let restarted: CommonspaceHostService | undefined;

		try {
			const first = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "First request.",
			});
			await service.whenIdle();
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				threadId: mustExist(first.thread).id,
				text: "Second request in the same thread.",
			});
			await service.whenIdle();
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "Third request in another thread.",
			});
			await service.whenIdle();

			expect(
				Object.keys(service.snapshot().agentSessions.hermes ?? {}).filter(
					(name) => name.startsWith("Commonspace Routing: "),
				),
			).toEqual([]);
			const frames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(frames.filter((frame) => frame.method === "session/load")).toEqual(
				[],
			);
			expect(
				frames.filter((frame) => frame.method === "session/new"),
			).toHaveLength(8);
			expect(
				frames.filter((frame) => frame.method === "initialize"),
			).toHaveLength(4);
			const routingPrompts = frames.filter((frame) => {
				if (frame.method !== "session/prompt") return false;
				return JSON.stringify(frame.params).includes(
					"bounded routing classifier",
				);
			});
			expect(JSON.stringify(routingPrompts[1]?.params)).toContain(
				"First request.",
			);
			// A fresh native classifier session can still receive explicit Channel retrieval evidence.
			expect(JSON.stringify(routingPrompts[2]?.params)).toContain(
				"First request.",
			);
			expect(JSON.stringify(routingPrompts[2]?.params)).toContain(
				"Retrieved message",
			);

			await service.close();
			restarted = new CommonspaceHostService(
				{},
				{
					root,
					hermesAcpCommand: process.execPath,
					hermesAcpArgs: [fakeAcpAgentPath],
				},
				{ discoverAgents: discoverTestHarnesses },
			);
			await restarted.initialize();
			expect(
				Object.keys(restarted.snapshot().agentSessions.hermes ?? {}).filter(
					(name) => name.startsWith("Commonspace Routing: "),
				),
			).toEqual([]);
			await restarted.send({
				conversation: { kind: "channel", id: channel.id },
				threadId: mustExist(first.thread).id,
				text: "Fourth request after restart.",
			});
			await restarted.whenIdle();
			const resumedFrames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(
				resumedFrames.filter((frame) => frame.method === "session/load"),
			).toHaveLength(1);
			expect(
				resumedFrames.filter((frame) => frame.method === "session/new"),
			).toHaveLength(10);

			await restarted.mutate({
				action: "remove-channel",
				channelId: channel.id,
			});
			expect(restarted.snapshot().agentSessions.hermes).toBeUndefined();
		} finally {
			await restarted?.close();
			await service.close();
		}
	});

	it("reuses scoped inference processes while keeping compaction sessions fresh", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-isolated-router-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		vi.stubEnv("FAKE_ACP_SHUTDOWN_DELAY_MS", "0");
		vi.stubEnv("FAKE_ACP_SESSION_ID", "123e4567-e89b-42d3-a456-426614174000");
		vi.stubEnv(
			"FAKE_ACP_INFERENCE_RESPONSE",
			'{"mode":"parallel","assignments":[{"agentId":"hermes","projectIds":[]}],"confidence":0.9,"reason":"Hermes owns the request."}',
		);
		vi.stubEnv(
			"FAKE_ACP_COMPACTION_RESPONSE",
			'{"summary":"Compacted Channel context.","decisions":[],"openQuestions":[]}',
		);
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fakeAcpAgentPath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "hermes");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		try {
			const sent = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "Create context to compact.",
			});
			await service.whenIdle();
			const thread = mustExist(sent.thread);

			await expect(
				service.compactChannelContext(channel.id),
			).resolves.toMatchObject({
				summary: "Compacted Channel context.",
			});
			await service.compactChannelContext(channel.id);
			await expect(
				service.compactThreadContext(thread.id),
			).resolves.toMatchObject({
				memory: { summary: "Compacted Channel context." },
			});
			await service.compactThreadContext(thread.id);

			const frames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(frames.filter((frame) => frame.method === "session/load")).toEqual(
				[],
			);
			expect(
				frames.filter((frame) => frame.method === "session/new"),
			).toHaveLength(7);
			// One process each owns delivery, Channel routing, Channel context, and
			// Thread context. Repeated judgments create sessions, not processes.
			expect(
				frames.filter((frame) => frame.method === "initialize"),
			).toHaveLength(4);

			const preview = service.previewRetention({
				kind: "channel",
				id: channel.id,
			});
			await service.applyRetention({
				conversation: { kind: "channel", id: channel.id },
				expectedRevision: preview.revision,
			});
			const retainedFrames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(
				retainedFrames.filter((frame) => frame.event === "native-flushed"),
			).toHaveLength(4);
		} finally {
			await service.close();
		}
	});

	it("closes reusable inference processes when the inference Agent changes", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-inference-change-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		vi.stubEnv("FAKE_ACP_SHUTDOWN_DELAY_MS", "0");
		vi.stubEnv(
			"FAKE_ACP_INFERENCE_RESPONSE",
			'{"mode":"parallel","assignments":[{"agentId":"hermes","projectIds":[]}],"confidence":0.9,"reason":"Hermes owns the request."}',
		);
		vi.stubEnv(
			"FAKE_ACP_COMPACTION_RESPONSE",
			'{"summary":"Compacted Channel context.","decisions":[],"openQuestions":[]}',
		);
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fakeAcpAgentPath],
				codexAcpCommand: process.execPath,
				codexAcpArgs: [fakeAcpAgentPath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "hermes");
		await addTestHarness(service, "codex");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		try {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "Create reusable inference lanes.",
			});
			await service.whenIdle();
			await service.updateRoutingConfiguration({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "codex",
			});

			const frames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(
				frames.filter((frame) => frame.event === "native-flushed"),
			).toHaveLength(2);
		} finally {
			await service.close();
		}
	});

	it("rotates a busy inference lane after its bounded fresh-session budget", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-bounded-router-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		vi.stubEnv("FAKE_ACP_SHUTDOWN_DELAY_MS", "0");
		vi.stubEnv(
			"FAKE_ACP_INFERENCE_RESPONSE",
			'{"mode":"parallel","assignments":[{"agentId":"hermes","projectIds":[]}],"confidence":0.9,"reason":"Hermes owns the request."}',
		);
		vi.stubEnv(
			"FAKE_ACP_COMPACTION_RESPONSE",
			'{"summary":"Bounded context.","decisions":[],"openQuestions":[]}',
		);
		const service = new CommonspaceHostService(
			{},
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fakeAcpAgentPath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "hermes");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "bounded-lane",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		try {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "Give the Channel context to compact.",
			});
			await service.whenIdle();
			for (let attempt = 0; attempt < 64; attempt += 1)
				await service.compactChannelContext(channel.id);

			const frames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(
				frames.filter((frame) => frame.event === "native-flushed"),
			).toHaveLength(1);
			expect(
				frames.filter((frame) => frame.method === "initialize"),
			).toHaveLength(4);
		} finally {
			await service.close();
		}
	});

	it("does not recreate a queued routing session after Channel removal", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-removed-router-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		vi.stubEnv("FAKE_ACP_HANG_PROMPT", "1");
		vi.stubEnv("FAKE_ACP_SESSION_ID", "123e4567-e89b-42d3-a456-426614174000");
		vi.stubEnv(
			"FAKE_ACP_INFERENCE_RESPONSE",
			'{"mode":"parallel","assignments":[{"agentId":"hermes","projectIds":[]}],"confidence":0.9,"reason":"Hermes owns the request."}',
		);
		const service = new CommonspaceHostService(
			{ warn: () => undefined },
			{
				root,
				hermesAcpCommand: process.execPath,
				hermesAcpArgs: [fakeAcpAgentPath],
			},
			{ discoverAgents: discoverTestHarnesses },
		);
		await service.initialize();
		await addTestHarness(service, "hermes");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["hermes"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		try {
			await Promise.all([
				service.send({
					conversation: { kind: "channel", id: channel.id },
					text: "First request.",
				}),
				service.send({
					conversation: { kind: "channel", id: channel.id },
					text: "Second request.",
				}),
			]);
			await vi.waitFor(async () => {
				const frames = await readFile(frameLog, "utf8");
				expect(frames.match(/"method":"session\/prompt"/gu)).toHaveLength(1);
			});
			vi.stubEnv("FAKE_ACP_HANG_PROMPT", "0");

			await service.mutate({ action: "remove-channel", channelId: channel.id });
			await service.whenIdle();

			const frames = (await readFile(frameLog, "utf8"))
				.trim()
				.split("\n")
				.map((line) => acpFrameSchema.parse(JSON.parse(line)));
			expect(
				frames.filter((frame) => frame.method === "initialize"),
			).toHaveLength(1);
			expect(service.snapshot().agentSessions.hermes).toBeUndefined();
		} finally {
			await service.close();
		}
	});

	it("does not cache a routing process whose Channel is removed during launch", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-launch-router-"));
		roots.push(root);
		const frameLog = join(root, "acp-frames.ndjson");
		const launchStartedPath = join(root, "launch-started");
		const launchReleasePath = join(root, "launch-release");
		const versionPath = join(root, "gemini-version.mjs");
		await writeFile(
			versionPath,
			`#!${process.execPath}\nimport { access, writeFile } from "node:fs/promises";\nimport { setTimeout as delay } from "node:timers/promises";\nawait writeFile(${JSON.stringify(launchStartedPath)}, "started");\nwhile (true) {\n  try { await access(${JSON.stringify(launchReleasePath)}); break; } catch { await delay(10); }\n}\nconsole.log("0.43.0");\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("FAKE_ACP_LOG", frameLog);
		const service = new CommonspaceHostService(
			{ warn: () => undefined },
			{
				root,
				geminiPath: versionPath,
				geminiAcpCommand: process.execPath,
				geminiAcpArgs: [fakeAcpAgentPath],
			},
			{
				discoverAgents: async () => [
					{
						id: "gemini",
						displayName: "Gemini CLI",
						adapter: "gemini",
						model: null,
						status: "stopped",
					},
				],
			},
		);
		await service.initialize();
		await service.discoverAgents("gemini");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "gemini",
			adapter: "gemini",
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "launch-race",
					agentIds: ["gemini"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "gemini",
		});

		try {
			await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "Route while the native launch is pending.",
			});
			await vi.waitFor(() =>
				expect(stat(launchStartedPath)).resolves.toBeDefined(),
			);
			await service.mutate({ action: "remove-channel", channelId: channel.id });
			await writeFile(launchReleasePath, "release");
			await service.whenIdle();

			await expect(readFile(frameLog, "utf8")).rejects.toThrow();
		} finally {
			await writeFile(launchReleasePath, "release").catch(() => undefined);
			await service.close();
		}
	});

	it("rejects an invalid partial routing result before any assignment dispatch", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-fallback-"));
		roots.push(root);
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
		];
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} handled it.`,
		);
		const service = new CommonspaceHostService(
			{ warn: () => undefined },
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "parallel",
					assignments: [
						{
							agentId: "backend",
							projectIds: [],
						},
						{
							agentId: "not-a-channel-agent",
							projectIds: [],
						},
					],
					reason: "Two assignments.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "backend",
		});

		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Please take a look.",
		});
		await service.whenIdle();

		expect(runAgent).not.toHaveBeenCalled();
		const failed = (await service.bootstrap()).state.messages[
			`channel:${channel.id}`
		]?.find((message) => message.id === sent.accepted.id);
		expect(failed?.routing).toMatchObject({
			source: "ai",
			status: "failed",
			startedAt: expect.any(String),
			resolvedAt: expect.any(String),
			durationMs: expect.any(Number),
			agentIds: [],
			assignments: [],
			corrections: [],
			inferredProjectIds: [],
			reason:
				"inference routing failed: inference routing returned an invalid assignment",
		});
		expect(failed).toMatchObject({
			replyStatus: "failed",
			replyError:
				"inference routing failed: inference routing returned an invalid assignment",
		});
		expect(deriveCommonspaceInboxItems(service.snapshot())).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					messageId: sent.accepted.id,
					kind: "failure",
				}),
			]),
		);
	});

	it("persists an unaddressed message as routing before inference resolves", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-routing-pending-"));
		roots.push(root);
		const route = deferred<CommonspaceRouteResult>();
		const agents = [
			{
				id: "backend",
				displayName: "Backend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
		];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: async (input) => `${input.agent.displayName} handled it.`,
				routeAgents: async () => route.promise,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);

		const sending = service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Fix the API.",
		});
		const immediate = await Promise.race([
			sending.then((response) => ({ status: "accepted" as const, response })),
			new Promise<{ status: "blocked" }>((resolve) => {
				setTimeout(() => {
					resolve({ status: "blocked" });
				}, 50);
			}),
		]);
		route.resolve({
			mode: "parallel",
			assignments: [{ agentId: "backend", projectIds: [] }],
			confidence: 0.95,
			reason: "API work belongs to Backend.",
		});

		expect(immediate.status).toBe("accepted");
		if (immediate.status !== "accepted") return;
		expect(immediate.response.accepted.routing).toMatchObject({
			source: "ai",
			status: "pending",
			startedAt: expect.any(String),
			agentIds: [],
			assignments: [],
			corrections: [],
			inferredProjectIds: [],
			reason: "Routing with inference.",
		});
		expect(
			immediate.response.state.messages[`channel:${channel.id}`]?.at(-1)?.text,
		).toBe("Fix the API.");
		await service.whenIdle();
		expect(
			(await service.bootstrap()).state.messages[`channel:${channel.id}`]?.find(
				(message) => message.id === immediate.response.accepted.id,
			)?.routing,
		).toMatchObject({
			source: "ai",
			status: "resolved",
			startedAt: expect.any(String),
			resolvedAt: expect.any(String),
			durationMs: expect.any(Number),
			agentIds: ["backend"],
			assignments: [
				{
					id: expect.any(String),
					agentId: "backend",
					projectIds: [],
				},
			],
			confidence: 0.95,
			reason: "API work belongs to Backend.",
		});
	});

	it("adds an explicitly tagged outside agent to the channel and active thread", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-tag-join-"));
		roots.push(root);
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} joined.`,
		);
		const agents = [
			{
				id: "frontend",
				displayName: "Frontend",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
			{
				id: "reviewer",
				displayName: "Reviewer",
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			},
		];
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "frontend", "reviewer");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "frontend",
		});
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["frontend"],
				})
			).channels[0],
		);
		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Start.",
		});
		await service.whenIdle();
		runAgent.mockClear();

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(accepted.thread).id,
			text: "@reviewer please join this review.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["reviewer"]);
		expect(
			service
				.snapshot()
				.channels.find((candidate) => candidate.id === channel.id)?.agentIds,
		).toEqual(["frontend", "reviewer"]);
		expect(
			service
				.snapshot()
				.threads.find(
					(candidate) => candidate.id === mustExist(accepted.thread).id,
				)?.agentIds,
		).toEqual(["frontend", "reviewer"]);
	});

	it("delivers @all to every channel agent even when the normal turn limit is lower", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-tag-all-"));
		roots.push(root);
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} replied.`,
		);
		const agents = ["frontend", "backend", "reviewer"].map((id) => ({
			id,
			displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
			adapter: "hermes" as const,
			model: "test",
			status: "stopped" as const,
		}));
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents: async () => ({
					mode: "parallel",
					assignments: agents.map((agent) => ({
						agentId: agent.id,
						projectIds: [],
					})),
					reason: "All explicitly addressed participants work independently.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, ...agents.map((agent) => agent.id));
		await service.mutate({ action: "set-defaults", maxAgentsPerTurn: 2 });
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@all please check.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["frontend", "backend", "reviewer"]);
	});

	it("keeps a channel tag as context without onboarding or routing its agents", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-tag-channel-"));
		roots.push(root);
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} replied.`,
		);
		const agents = ["facilitator", "frontend", "backend", "reviewer"].map(
			(id) => ({
				id,
				displayName: id.slice(0, 1).toLocaleUpperCase() + id.slice(1),
				adapter: "hermes" as const,
				model: "test",
				status: "stopped" as const,
			}),
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, ...agents.map((agent) => agent.id));
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "facilitator",
		});
		await service.mutate({ action: "set-defaults", maxAgentsPerTurn: 2 });
		const general = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "general",
					agentIds: ["facilitator"],
				})
			).channels.find((channel) => channel.name === "general"),
		);
		await service.mutate({
			action: "create-channel",
			name: "engineering",
			agentIds: ["frontend", "backend", "reviewer"],
		});

		const accepted = await service.send({
			conversation: { kind: "channel", id: general.id },
			text: "#engineering please check.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["facilitator"]);
		expect(runAgent.mock.calls[0]?.[0].message).toBe(
			"#engineering please check.",
		);
		expect(
			service.snapshot().channels.find((channel) => channel.id === general.id)
				?.agentIds,
		).toEqual(["facilitator"]);
		expect(
			service
				.snapshot()
				.threads.find((thread) => thread.id === accepted.thread?.id)?.agentIds,
		).toEqual(["facilitator"]);
	});

	it("delivers a direct channel reply only to the selected agent", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-direct-reply-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const runAgent = vi.fn(
			async (input: AgentRunInput) => `${input.agent.displayName} replied.`,
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "backend",
						displayName: "Backend",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
				],
				runAgent,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					projectId: project.id,
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);
		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Share findings.",
		});
		await service.whenIdle();
		runAgent.mockClear();

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(accepted.thread).id,
			targetAgentId: "frontend",
			text: "Check the boundary again.",
		});
		await service.whenIdle();

		expect(
			runAgent.mock.calls
				.filter(
					([input]) => !input.sessionName.startsWith("Commonspace Inference:"),
				)
				.map((call) => call[0].agent.id),
		).toEqual(["frontend"]);
	});

	it("rejects invalid direct channel reply targets before appending a message", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-direct-reply-validation-"),
		);
		roots.push(root);
		const runAgent = vi.fn(async () => "Done.");
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
					{
						id: "outside",
						displayName: "Outside",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
				],
				runAgent,
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "frontend", "outside");
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: ["frontend"],
				})
			).channels[0],
		);
		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Start.",
		});
		await service.whenIdle();
		const messageCount = mustExist(
			service.snapshot().messages[`channel:${channel.id}`],
		).length;

		await expect(
			service.send({
				conversation: { kind: "channel", id: channel.id },
				targetAgentId: "frontend",
				text: "No thread.",
			}),
		).rejects.toThrow("direct channel replies require a thread");
		await expect(
			service.send({
				conversation: { kind: "channel", id: channel.id },
				threadId: mustExist(accepted.thread).id,
				targetAgentId: "outside",
				text: "Wrong agent.",
			}),
		).rejects.toThrow("direct reply target is not a channel member");
		await expect(
			service.send({
				conversation: { kind: "dm", id: "frontend" },
				targetAgentId: "outside",
				text: "Wrong conversation kind.",
			}),
		).rejects.toThrow("direct messages do not accept a reply target");

		expect(service.snapshot().messages[`channel:${channel.id}`]).toHaveLength(
			messageCount,
		);
	});

	it("continues room delivery when one agent invocation fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-room-failure-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			if (input.agent.id === "backend") throw new Error("backend unavailable");
			return "Frontend still replied.";
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "backend",
						displayName: "Backend",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
					{
						id: "frontend",
						displayName: "Frontend",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
				],
				runAgent,
				routeAgents: async () => ({
					mode: "parallel",
					assignments: ["backend", "frontend"].map((agentId) => ({
						agentId,
						projectIds: [],
					})),
					reason: "All explicitly addressed participants work independently.",
				}),
			},
		);
		await service.initialize();
		await addDiscoveredAgents(service, "backend", "frontend");
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					projectId: project.id,
					agentIds: ["backend", "frontend"],
				})
			).channels[0],
		);

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "@all share your current findings.",
		});
		await service.whenIdle();

		expect(runAgent).toHaveBeenCalledTimes(2);
		const messages = service.snapshot().messages[`channel:${channel.id}`] ?? [];
		expect(
			messages.some(
				(message) =>
					message.authorType === "system" && message.text.includes("@backend"),
			),
		).toBe(true);
		expect(
			messages.some(
				(message) =>
					message.authorType === "agent" && message.authorId === "frontend",
			),
		).toBe(true);
	});

	it("rejects a native Codex profile ID that collides with a selected Hermes profile", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agent-collision-"));
		roots.push(root);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => [
					{
						id: "codex-review-bot",
						displayName: "Collision",
						adapter: "hermes",
						model: "test",
						status: "stopped",
					},
				],
			},
		);
		await service.initialize();
		await service.discoverAgents("hermes");
		await service.mutate({
			action: "add-discovered-agent",
			agentId: "codex-review-bot",
		});
		await service.discoverAgents("codex");

		await expect(
			service.mutate({
				action: "add-discovered-agent",
				agentId: "codex-review-bot",
			}),
		).rejects.toThrow("already exists");
	});

	it("rejects unknown conversations and attaches project context to channel threads", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-host-"));
		roots.push(root);
		const projectAPath = join(root, "a");
		const projectBPath = join(root, "b");
		await mkdir(projectAPath);
		await mkdir(projectBPath);
		const runAgent = vi.fn(async () => "ok");
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "hermes", "Frontend");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		await expect(
			service.send({
				conversation: { kind: "channel", id: "missing" },
				text: "hello",
			}),
		).rejects.toThrow("unknown channel");
		await expect(
			service.send({
				conversation: { kind: "dm", id: "missing" },
				text: "hello",
			}),
		).rejects.toThrow("unknown agent");
		expect((await service.bootstrap()).state.messages).toEqual({});

		await service.mutate({
			action: "create-project",
			name: "A",
			paths: [projectAPath],
		});
		const second = await service.mutate({
			action: "create-project",
			name: "B",
			paths: [projectBPath],
		});
		const projectB = mustExist(
			second.projects.find((project) => project.name === "B"),
		);
		const channelState = await service.mutate({
			action: "create-channel",
			name: "general",
			agentIds: ["hermes"],
		});
		const channel = mustExist(channelState.channels[0]);

		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: projectB.id,
			text: "work in project B",
		});
		expect(channel).not.toHaveProperty("projectId");
		expect(accepted.thread).toMatchObject({ projectId: projectB.id });
		expect(accepted.thread).not.toHaveProperty("status");
		expect(accepted.accepted).toMatchObject({ projectId: projectB.id });
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});
		expect(runAgent.mock.calls[0]?.[0]?.cwd).toBe(await realpath(projectBPath));
		await service.whenIdle();
	});

	it("accepts a channel root immediately and appends agent replies inside its thread", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-thread-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		let release: ((value: string) => void) | undefined;
		const runAgent = vi.fn((input: AgentRunInput) => {
			void input;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "hermes", "Frontend");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "general",
					projectId: project.id,
					agentIds: ["hermes"],
				})
			).channels[0],
		);

		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: project.id,
			text: "Investigate checkout.",
		});
		expect(accepted.thread).not.toHaveProperty("status");
		expect(accepted.accepted.parentMessageId).toBeUndefined();
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledOnce();
		});

		release?.("Found the issue.");
		await vi.waitFor(async () => {
			const state = (await service.bootstrap()).state;
			expect(
				state.threads.find((thread) => thread.id === accepted.thread?.id),
			).not.toHaveProperty("status");
			const messages = state.messages[`channel:${channel.id}`] ?? [];
			expect(
				messages.some(
					(message) =>
						message.text === "Found the issue." &&
						message.parentMessageId === accepted.accepted.id,
				),
			).toBe(true);
		});
		expect(runAgent.mock.calls[0]?.[0]?.sessionName).toBe(
			`Commonspace Thread: ${accepted.thread?.id ?? ""}`,
		);
	});

	it("merges Hermes and Codex agents and resumes the exact native session for thread replies", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agents-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		const sibling = join(root, "sibling");
		await mkdir(workspace);
		await mkdir(sibling);
		const resolvedWorkspace = await realpath(workspace);
		const resolvedSibling = await realpath(sibling);
		const sessionId = "123e4567-e89b-42d3-a456-426614174000";
		const runAgent = vi.fn(async (input: AgentRunInput) => {
			void input;
			return { text: "Codex response.", sessionId };
		});
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: discoverTestHarnesses,
				runAgent: withHarnessUtilities(runAgent),
			},
		);
		await service.initialize();
		await addTestHarness(service, "hermes", "Frontend");
		await addTestHarness(service, "codex", "Review Bot");
		await service.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "hermes",
		});

		expect((await service.bootstrap()).agents).toEqual([
			{
				id: "hermes",
				displayName: "Frontend",
				adapter: "hermes",
				model: null,
				status: "stopped",
				description: "Installed Hermes harness.",
				permissionPolicy: { source: "agent", fullAccess: false },
			},
			{
				id: "codex",
				displayName: "Review Bot",
				adapter: "codex",
				model: null,
				status: "stopped",
				description: "Installed Codex harness.",
				permissionPolicy: { source: "agent", fullAccess: false },
			},
		]);

		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "App",
					paths: [workspace, sibling],
				})
			).projects[0],
		);
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "review",
					projectId: project.id,
					agentIds: ["codex"],
				})
			).channels[0],
		);
		const accepted = await service.send({
			conversation: { kind: "channel", id: channel.id },
			projectId: project.id,
			text: "Review this.",
		});
		const thread = accepted.thread;
		if (thread === undefined) throw new Error("expected a channel thread");

		await service.whenIdle();
		const sessionName = `Commonspace Thread: ${thread.id}`;
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			agent: { id: "codex", adapter: "codex" },
			cwd: resolvedWorkspace,
			additionalCwds: [resolvedSibling],
			sessionName,
		});
		expect(service.snapshot().agentSessions.codex?.[sessionName]).toBe(
			sessionId,
		);
		expect((await service.bootstrap()).state.agentSessions).toEqual({});

		await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: thread.id,
			text: "Continue the review.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledTimes(2);
		});
		expect(runAgent.mock.calls[1]?.[0]).toMatchObject({
			sessionName,
			sessionId,
		});

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Start a DM.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledTimes(3);
		});
		expect(runAgent.mock.calls[2]?.[0]).toMatchObject({
			sessionName: "Bot Chat",
		});
		expect(runAgent.mock.calls[2]?.[0]?.sessionId).toBeUndefined();

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectId: project.id,
			text: "Continue the DM.",
		});
		await vi.waitFor(() => {
			expect(runAgent).toHaveBeenCalledTimes(4);
		});
		expect(runAgent.mock.calls[3]?.[0]).toMatchObject({
			sessionName: "Bot Chat",
			sessionId,
		});
		await service.whenIdle();
	});
});
