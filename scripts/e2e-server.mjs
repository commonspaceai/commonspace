import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { startCommonspaceServer } from "../server/src/index.ts";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const uiRoot = join(repoRoot, "ui", "dist");
const port = Number(process.env.COMMONSPACE_E2E_PORT ?? "3199");
const stateRoot =
	process.env.COMMONSPACE_E2E_HOME ??
	(await mkdtemp(join(tmpdir(), "commonspace-e2e-home-")));
const projectRoot = join(stateRoot, "verification-project");
const referenceRoot = join(stateRoot, "reference-project");
const notificationCapturePath =
	process.env.COMMONSPACE_E2E_NOTIFICATION_CAPTURE ??
	join(tmpdir(), `commonspace-e2e-notification-${String(port)}.json`);
await mkdir(projectRoot, { recursive: true });
await mkdir(referenceRoot, { recursive: true });

const fixtureAgents = [
	{
		id: "codex",
		displayName: "Review Bot",
		adapter: "codex",
		model: "fixture-model",
		status: "stopped",
		description: "Deterministic review agent for browser verification.",
	},
	{
		id: "hermes",
		displayName: "Design Critic",
		adapter: "hermes",
		model: "fixture-model",
		status: "stopped",
		description: "Deterministic visual review agent for browser verification.",
	},
];

async function seed(service) {
	for (const agent of fixtureAgents) {
		await service.discoverAgents(agent.adapter);
		await service.mutate({ action: "add-discovered-agent", agentId: agent.id });
		await service.mutate({
			action: "update-agent-profile",
			agentId: agent.id,
			displayName: agent.displayName,
			avatarEmoji: agent.id === "hermes" ? "D" : "R",
			accentColor: agent.id === "hermes" ? "#e879f9" : "#60a5fa",
		});
	}
	await service.updateRoutingConfiguration({
		provider: "harness",
		harnessAgentId: "codex",
	});

	let state = await service.mutate({
		action: "create-project",
		name: "Verification Project",
		paths: [projectRoot],
	});
	const verificationProject = state.projects.at(-1);
	if (verificationProject === undefined)
		throw new Error("E2E verification project was not created");

	state = await service.mutate({
		action: "create-project",
		name: "Reference Notes",
		paths: [referenceRoot],
	});
	const referenceProject = state.projects.at(-1);
	if (referenceProject === undefined)
		throw new Error("E2E reference project was not created");

	state = await service.mutate({
		action: "create-channel",
		name: "verification",
		agentIds: ["codex", "hermes"],
	});
	const verificationChannel = state.channels.at(-1);
	if (verificationChannel === undefined)
		throw new Error("E2E verification channel was not created");

	await service.mutate({
		action: "create-channel",
		name: "general",
		agentIds: [],
	});

	const rootResponse = await service.send({
		conversation: { kind: "channel", id: verificationChannel.id },
		projectIds: [verificationProject.id, referenceProject.id],
		text: "@review-bot Review the workspace hierarchy and report a concise checkpoint.",
	});
	await service.whenIdle();
	const threadId = rootResponse.thread?.id;
	if (threadId === undefined)
		throw new Error("E2E root message did not create a thread");

	await service.send({
		conversation: { kind: "channel", id: verificationChannel.id },
		threadId,
		targetAgentId: "hermes",
		projectIds: [verificationProject.id],
		text: "@design-critic Compare the visual hierarchy against the review notes.",
	});
	await service.whenIdle();

	await service.send({
		conversation: { kind: "channel", id: verificationChannel.id },
		threadId,
		targetAgentId: "codex",
		projectIds: [verificationProject.id],
		text: "Evidence bundle attached for the next checkpoint.",
	});
	await service.whenIdle();

	await service.send({
		conversation: { kind: "channel", id: verificationChannel.id },
		projectIds: [referenceProject.id],
		text: "The selected row should remain visible, timestamps should stay readable, and the composer should remain clear of the thread rail.",
	});
	await service.whenIdle();
}

let running;
let stopping = false;

function cleanupStateSync() {
	rmSync(stateRoot, { recursive: true, force: true });
}

async function shutdown(code = 0) {
	if (stopping) return;
	stopping = true;
	await running?.close().catch(() => undefined);
	await rm(notificationCapturePath, { force: true });
	await rm(stateRoot, { recursive: true, force: true });
	cleanupStateSync();
	process.exitCode = code;
}

process.once("exit", cleanupStateSync);

try {
	running = await startCommonspaceServer({
		root: stateRoot,
		port,
		defaultCwd: repoRoot,
		uiRoot,
		dependencies: {
			notify: async (notification) => {
				await writeFile(
					notificationCapturePath,
					JSON.stringify(notification),
					"utf8",
				);
			},
			discoverAgents: async (adapter) =>
				fixtureAgents.filter((agent) => agent.adapter === adapter),
			routeAgents: async (input) => {
				const candidate = input.candidates[0];
				if (candidate === undefined)
					throw new Error("E2E routing has no candidate");
				return {
					mode: "parallel",
					assignments: [
						{
							agentId: candidate.id,
							projectIds: input.projects.map((project) => project.id),
						},
					],
					confidence: 0.99,
					reason: "Deterministic E2E routing.",
				};
			},
			runAgent: async (input) => ({
				text: input.sessionName.startsWith("Commonspace Inference:")
					? JSON.stringify({
							summary: "The E2E workspace is ready for verification.",
							decisions: [],
							openQuestions: [],
						})
					: input.agent.id === "hermes"
						? "## Visual checkpoint\n\n- Hierarchy reviewed\n- Thread context preserved\n- Composer remains available\n\nThe E2E fixture is ready for inspection."
						: "Review Bot completed the seeded workspace checkpoint.",
			}),
		},
	});
	await seed(running.service);
	process.stdout.write(`Commonspace E2E server ready at ${running.url}\n`);
	process.stdout.write(
		"E2E state is isolated in a temporary directory and removed on exit.\n",
	);

	await new Promise((resolveLifetime) => {
		const stop = () => {
			void shutdown().finally(resolveLifetime);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
} catch (error) {
	await shutdown(1);
	throw error;
}
