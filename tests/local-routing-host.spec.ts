import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunningClassifier } from "../server/src/local-classifier.ts";
import {
	type AgentRunInput,
	CommonspaceHostService,
	type CommonspaceRouteInput,
	type CommonspaceRouteResult,
} from "../server/src/service.ts";
import { mustExist } from "./test-helpers.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];
afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("local routing host integration", () => {
	it.each(["relay", "uncertain", "unavailable"] as const)(
		"uses inference speaker order for an explicitly addressed relay after %s local classification",
		async (outcome) => {
			const root = await mkdtemp(
				join(tmpdir(), "commonspace-local-relay-order-"),
			);
			roots.push(root);
			const agents = [
				{
					id: "front",
					displayName: "Frontend",
					adapter: "hermes" as const,
					status: "stopped" as const,
				},
				{
					id: "back",
					displayName: "Backend",
					adapter: "hermes" as const,
					status: "stopped" as const,
				},
			];
			const classifyRouting = vi.fn<RunningClassifier["classify"]>(async () => {
				if (outcome === "unavailable")
					throw new Error("Private worker diagnostic");
				if (outcome === "uncertain") return null;
				return [
					{ id: "relay", score: 0.9 },
					{ id: "parallel", score: 0.06 },
					{ id: "uncertain", score: 0.04 },
				];
			});
			const routeAgents = vi.fn(
				async (
					input: CommonspaceRouteInput,
				): Promise<CommonspaceRouteResult> => {
					expect(input.fixedAgentIds).toEqual(["front", "back"]);
					return {
						mode: "relay",
						assignments: ["back", "front"].map((agentId) => ({
							agentId,
							projectIds: [],
						})),
						reason: "Backend speaks first, then Frontend reviews.",
					};
				},
			);
			const runAgent = vi.fn(
				async (input: AgentRunInput) => `Reviewed by ${input.agent.id}.`,
			);
			const service = new CommonspaceHostService(
				{},
				{ root },
				{
					discoverAgents: async () => agents,
					runAgent,
					routeAgents,
					classifyRouting,
				},
			);
			services.push(service);
			await service.initialize();
			for (const agent of agents)
				await service.mutate({
					action: "add-discovered-agent",
					agentId: agent.id,
				});
			const channel = mustExist(
				(
					await service.mutate({
						action: "create-channel",
						name: "engineering",
						agentIds: agents.map((agent) => agent.id),
					})
				).channels[0],
			);
			const sent = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text: "@Frontend @Backend: Backend speaks first, then Frontend reviews.",
			});
			await service.whenIdle();
			const saved = mustExist(
				service
					.snapshot()
					.messages[`channel:${channel.id}`]?.find(
						(message) => message.id === sent.accepted.id,
					),
			);
			expect(classifyRouting).toHaveBeenCalledTimes(1);
			expect(routeAgents).toHaveBeenCalledTimes(1);
			expect(saved.routing).toMatchObject({
				source: "explicit",
				mode: "relay",
				assignments: [{ agentId: "back" }, { agentId: "front" }],
			});
			expect(runAgent.mock.calls.map(([input]) => input.agent.id)).toEqual([
				"back",
				"front",
			]);
		},
	);

	it("defers inherited Thread Project access to the inference Agent", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-local-thread-scope-"),
		);
		roots.push(root);
		const projectRoot = join(root, "cairn");
		await mkdir(projectRoot);
		const agents = [
			{
				id: "front",
				displayName: "Frontend",
				adapter: "hermes" as const,
				status: "stopped" as const,
			},
			{
				id: "back",
				displayName: "Backend",
				adapter: "hermes" as const,
				status: "stopped" as const,
			},
		];
		const classifyRouting = vi
			.fn<RunningClassifier["classify"]>()
			.mockResolvedValue(null);
		let projectId = "";
		const routeAgents = vi.fn(
			async (
				input: CommonspaceRouteInput,
			): Promise<CommonspaceRouteResult> => ({
				mode: "parallel",
				assignments: input.text.startsWith("Start")
					? agents.map((agent) => ({
							agentId: agent.id,
							projectIds: [projectId],
						}))
					: [{ agentId: "back", projectIds: [] }],
				reason: "Relevant participant scope",
			}),
		);
		const runAgent = vi.fn(async (input: AgentRunInput) =>
			input.sessionName.startsWith("Commonspace Inference:")
				? JSON.stringify({
						summary: "Frontend and Backend own the active work.",
						decisions: [],
						openQuestions: [],
					})
				: "Done.",
		);
		const service = new CommonspaceHostService(
			{},
			{ root },
			{
				discoverAgents: async () => agents,
				runAgent,
				routeAgents,
				classifyRouting,
			},
		);
		services.push(service);
		await service.initialize();
		for (const agent of agents)
			await service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
			});
		const project = mustExist(
			(
				await service.mutate({
					action: "create-project",
					name: "Cairn",
					paths: [projectRoot],
				})
			).projects[0],
		);
		projectId = project.id;
		const channel = mustExist(
			(
				await service.mutate({
					action: "create-channel",
					name: "engineering",
					agentIds: agents.map((agent) => agent.id),
				})
			).channels[0],
		);
		const first = await service.send({
			conversation: { kind: "channel", id: channel.id },
			text: "Start work in @@cairn.",
		});
		await service.whenIdle();
		await service.updateRoutingConfiguration({
			provider: "harness",
			harnessAgentId: "front",
		});
		await service.compactChannelContext(channel.id);
		classifyRouting.mockClear();
		routeAgents.mockClear();
		const sent = await service.send({
			conversation: { kind: "channel", id: channel.id },
			threadId: mustExist(first.thread).id,
			text: "Thanks.",
		});
		await service.whenIdle();
		expect(classifyRouting).not.toHaveBeenCalled();
		expect(routeAgents).toHaveBeenCalledTimes(1);
		const saved = mustExist(
			service
				.snapshot()
				.messages[`channel:${channel.id}`]?.find(
					(message) => message.id === sent.accepted.id,
				),
		);
		expect(saved.routing?.assignments).toMatchObject([
			{ agentId: "back", projectIds: [] },
		]);
	});

	it.each([
		"multiple",
		"corrected",
		"corrected-long-message",
		"context",
		"stale",
		"greeting",
		"greeting-all",
		"stale-greeting",
		"stale-greeting-all",
	] as const)(
		"persists the request before %s routing and preserves its delivery",
		async (outcome) => {
			const root = await mkdtemp(join(tmpdir(), "commonspace-local-routing-"));
			roots.push(root);
			const greeting = outcome.includes("greeting");
			const greetingText = outcome.endsWith("-all")
				? "say hello all"
				: "hi frontend";
			let text =
				outcome === "multiple"
					? "Add the React export button, build the API that streams the archive, and update deployment instructions."
					: outcome === "corrected-long-message"
						? "Fix the login screen CSS. ".repeat(50).trim()
						: outcome.startsWith("greeting")
							? greetingText
							: "Fix the login screen CSS.";
			const corrected =
				outcome === "corrected" || outcome === "corrected-long-message";
			const brief = "Frontend owns the login layout; the API is complete.";
			const agents = [
				{
					id: "frontend",
					displayName: "Frontend",
					description: "React and CSS",
					adapter: "hermes" as const,
					status: "stopped" as const,
				},
				{
					id: "backend",
					displayName: "Backend",
					description: "APIs and persistence",
					adapter: "hermes" as const,
					status: "stopped" as const,
				},
			];
			if (outcome === "multiple")
				agents.push({
					id: "operations",
					displayName: "Operations",
					description: "Deployment and operations documentation",
					adapter: "hermes",
					status: "stopped",
				});
			const classifyRouting = vi.fn<RunningClassifier["classify"]>(
				async (request) => {
					expect(await readFile(join(root, "state.json"), "utf8")).toContain(
						text,
					);
					return request.options.map((option) => ({
						id: option.id,
						score: (
							text === "say hello all"
								? option.description === "all"
								: option.description.toLowerCase().startsWith("frontend")
						)
							? 0.94
							: 0.02,
					}));
				},
			);
			const routeAgents = vi.fn<
				(input: CommonspaceRouteInput) => Promise<CommonspaceRouteResult>
			>(async (input) => {
				expect(await readFile(join(root, "state.json"), "utf8")).toContain(
					text,
				);
				return {
					mode: "parallel",
					assignments: (outcome === "multiple"
						? ["frontend", "backend", "operations"]
						: [input.routingMemory === "" ? "frontend" : "backend"]
					).map((agentId) => ({ agentId, projectIds: [] })),
					reason: "Complete recipient set for the request",
				};
			});
			const runAgent = vi.fn(async (input: AgentRunInput) =>
				input.sessionName.startsWith("Commonspace Inference:")
					? JSON.stringify({ summary: brief, decisions: [], openQuestions: [] })
					: "Handled.",
			);
			const service = new CommonspaceHostService(
				{},
				{ root },
				{
					discoverAgents: async () => agents,
					runAgent,
					routeAgents,
					classifyRouting,
				},
			);
			services.push(service);
			await service.initialize();
			for (const agent of agents)
				await service.mutate({
					action: "add-discovered-agent",
					agentId: agent.id,
				});
			if (greeting) {
				const projectRoot = join(root, "cairn");
				await mkdir(projectRoot);
				await service.mutate({
					action: "create-project",
					name: "Cairn",
					paths: [projectRoot],
				});
			}
			const channel = mustExist(
				(
					await service.mutate({
						action: "create-channel",
						name: "engineering",
						agentIds: agents.map((agent) => agent.id),
					})
				).channels[0],
			);
			let sent = await service.send({
				conversation: { kind: "channel", id: channel.id },
				text,
			});
			const correctedSourceId = sent.accepted.id;
			await service.whenIdle();
			if (outcome.startsWith("context")) {
				await service.updateRoutingConfiguration({
					provider: "harness",
					harnessAgentId: "frontend",
				});
				expect(await service.compactChannelContext(channel.id)).toMatchObject({
					origin: "inference",
					summary: brief,
				});
				classifyRouting.mockClear();
				routeAgents.mockClear();
				runAgent.mockClear();
				text = "Make its spacing tighter.";
				sent = await service.send({
					conversation: { kind: "channel", id: channel.id },
					text,
				});
				await service.whenIdle();
				expect(routeAgents.mock.lastCall?.[0].context.join("\n")).toContain(
					brief,
				);
				expect(routeAgents.mock.lastCall?.[0].context.join("\n")).toContain(
					"Fix the login screen CSS.",
				);
			}
			if (outcome.startsWith("stale")) {
				classifyRouting.mockClear();
				routeAgents.mockClear();
				runAgent.mockClear();
				text = greeting ? greetingText : "Make its spacing tighter.";
				sent = await service.send({
					conversation: { kind: "channel", id: channel.id },
					text,
				});
				await service.whenIdle();
			}
			if (corrected) {
				const assignment = mustExist(
					service
						.snapshot()
						.messages[`channel:${channel.id}`]?.find(
							(message) => message.id === sent.accepted.id,
						)?.routing?.assignments?.[0],
				);
				await service.rerouteAssignment({
					sourceMessageId: sent.accepted.id,
					assignmentId: assignment.id,
					agentId: "backend",
					projectIds: [],
				});
				await service.whenIdle();
				expect(service.snapshot().channels[0]?.routingMemory).toMatchObject({
					summary: "",
					status: "failed",
					correctionCount: 1,
				});
				classifyRouting.mockClear();
				routeAgents.mockClear();
				runAgent.mockClear();
				sent = await service.send({
					conversation: { kind: "channel", id: channel.id },
					text,
				});
				await service.whenIdle();
			}
			const message = mustExist(
				service
					.snapshot()
					.messages[`channel:${channel.id}`]?.find(
						(message) => message.id === sent.accepted.id,
					),
			);
			expect(classifyRouting).toHaveBeenCalledTimes(Number(greeting));
			const local = greeting;
			const recipients = outcome.endsWith("-all")
				? ["frontend", "backend"]
				: outcome === "multiple"
					? ["frontend", "backend", "operations"]
					: [corrected ? "backend" : "frontend"];
			expect(routeAgents).toHaveBeenCalledTimes(local ? 0 : 1);
			if (outcome === "corrected") {
				expect(routeAgents.mock.calls[0]?.[0].routingMemory).toContain(
					`"message":"${text}","agentId":"backend"`,
				);
				expect(routeAgents.mock.calls[0]?.[0].routingMemory).toContain(
					'"agent":"Backend"',
				);
			}
			if (outcome === "corrected-long-message") {
				expect(routeAgents.mock.calls[0]?.[0].routingMemory).toContain(
					'"agentId":"backend"',
				);
				expect(routeAgents.mock.calls[0]?.[0].routingMemory).toContain(
					"[excerpt omitted]",
				);
			}
			expect(message.routing).toMatchObject({
				source: local ? "local" : "ai",
				status: "resolved",
				agentIds: recipients,
			});
			for (const recipient of recipients)
				expect(
					runAgent.mock.calls.filter(
						([input]) => input.message === text && input.agent.id === recipient,
					),
				).toHaveLength(1);
			if (outcome === "multiple") {
				const messages =
					service.snapshot().messages[`channel:${channel.id}`] ?? [];
				expect(
					messages.filter(
						(saved) => saved.authorType === "user" && saved.text === text,
					),
				).toHaveLength(1);
				expect(message.text).toBe(text);
				expect(message.routing?.mode).toBe("parallel");
				for (const recipient of recipients)
					expect(
						messages.filter(
							(reply) =>
								reply.sourceMessageId === sent.accepted.id &&
								reply.authorType === "agent" &&
								reply.authorId === recipient,
						),
					).toHaveLength(1);
			}
			if (greeting) {
				expect(message.routing?.assignments).toMatchObject(
					recipients.map((agentId) => ({ agentId, projectIds: [] })),
				);
				expect(
					runAgent.mock.calls.some(([input]) =>
						input.sessionName.startsWith("Commonspace Inference:"),
					),
				).toBe(false);
			}
			if (outcome === "corrected") {
				await service.editMessage({
					messageId: correctedSourceId,
					text: "Update the settings panel.",
				});
				await service.whenIdle();
				expect(service.snapshot().channels[0]?.routingMemory).toMatchObject({
					status: "empty",
					correctionCount: 0,
				});
				await expect(
					service.rerouteAssignment({
						sourceMessageId: correctedSourceId,
						assignmentId: mustExist(message.routing?.assignments[0]).id,
						agentId: "backend",
						projectIds: [],
					}),
				).rejects.toThrow("superseded or deleted messages cannot be corrected");
			}
			if (outcome === "corrected-long-message") {
				await service.deleteMessage(correctedSourceId);
				expect(service.snapshot().channels[0]?.routingMemory).toMatchObject({
					status: "empty",
					correctionCount: 0,
				});
			}
		},
	);
});
