// @vitest-environment jsdom

import { setupServer } from "msw/node";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createWorkspaceMockApi } from "./workspace-mock-api.ts";

const bootstrapProjectionSchema = z.object({
	state: z.object({
		agents: z.array(z.object({ id: z.string() })),
		dmSessions: z.record(z.string(), z.string()),
		agentSessions: z.record(z.string(), z.record(z.string(), z.string())),
		projects: z.array(z.object({ id: z.string() })),
		channels: z.array(
			z.object({
				id: z.string(),
				agentIds: z.array(z.string()),
			}),
		),
		threads: z.array(
			z.object({
				agentIds: z.array(z.string()),
				projectId: z.string().nullable(),
				projectIds: z.array(z.string()).optional(),
			}),
		),
		messages: z.record(
			z.string(),
			z.array(
				z.object({
					projectId: z.string().optional(),
					projectIds: z.array(z.string()).optional(),
					runAttribution: z
						.object({
							roots: z.array(z.object({ projectId: z.string() })),
						})
						.optional(),
				}),
			),
		),
		pins: z.array(
			z.object({
				kind: z.string(),
				note: z.string().optional(),
			}),
		),
	}),
});

const retentionPreviewSchema = z.object({
	revision: z.number(),
	pins: z.number(),
});

const mutationErrorSchema = z.object({
	code: z.literal("invalid_mutation"),
	error: z.string(),
});

type BootstrapProjection = z.infer<typeof bootstrapProjectionSchema>;
type RetentionPreview = z.infer<typeof retentionPreviewSchema>;

const servers: ReturnType<typeof setupServer>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

function readyServer(): ReturnType<typeof setupServer> {
	const server = setupServer(...createWorkspaceMockApi("ready"));
	server.listen({ onUnhandledRequest: "error" });
	servers.push(server);
	return server;
}

async function bootstrap(): Promise<BootstrapProjection> {
	const response = await fetch(new URL("/api/bootstrap", window.location.href));
	expect(response.ok).toBe(true);
	return bootstrapProjectionSchema.parse(await response.json());
}

it("rejects unknown Agents at the Storybook Channel mutation boundary", async () => {
	readyServer();
	const initial = await bootstrap();
	const channel = initial.state.channels[0];
	if (channel === undefined) throw new Error("Story Channel is missing");

	const response = await fetch(new URL("/api/mutate", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			action: "set-channel-agents",
			channelId: channel.id,
			agentIds: ["unknown-agent"],
		}),
	});

	expect(response.status).toBe(400);
	expect(mutationErrorSchema.parse(await response.json()).code).toBe(
		"invalid_mutation",
	);
});

it("rejects unknown mutation fields like the production boundary", async () => {
	readyServer();
	const response = await fetch(new URL("/api/mutate", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "mark-inbox-read", unexpected: true }),
	});

	expect(response.status).toBe(400);
	expect(mutationErrorSchema.parse(await response.json()).code).toBe(
		"invalid_mutation",
	);
});

it("prunes a removed Agent from Storybook Channels and Threads", async () => {
	readyServer();
	const initial = await bootstrap();
	const agentId = initial.state.threads.flatMap((thread) => thread.agentIds)[0];
	if (agentId === undefined) throw new Error("Story Thread Agent is missing");

	const response = await fetch(new URL("/api/mutate", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "remove-agent", agentId }),
	});
	const updated = bootstrapProjectionSchema.parse(await response.json());

	expect(response.ok).toBe(true);
	expect(updated.state.channels).toEqual(
		initial.state.channels.map((channel) => ({
			...channel,
			agentIds: channel.agentIds.filter((candidate) => candidate !== agentId),
		})),
	);
	expect(updated.state.threads).toEqual(
		initial.state.threads.map((thread) => ({
			...thread,
			agentIds: thread.agentIds.filter((candidate) => candidate !== agentId),
		})),
	);
});

it("removes an Agent's Storybook DM and native session references", async () => {
	readyServer();
	const initial = await bootstrap();
	const agentId = Object.keys(initial.state.dmSessions)[0];
	if (agentId === undefined) throw new Error("Story DM Agent is missing");
	expect(initial.state.messages[`dm:${agentId}`]).toBeDefined();
	expect(initial.state.agentSessions[agentId]).toBeDefined();

	const response = await fetch(new URL("/api/mutate", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "remove-agent", agentId }),
	});
	const updated = bootstrapProjectionSchema.parse(await response.json());

	expect(response.ok).toBe(true);
	expect(updated.state.agents.some((agent) => agent.id === agentId)).toBe(
		false,
	);
	expect(updated.state.dmSessions[agentId]).toBeUndefined();
	expect(updated.state.agentSessions[agentId]).toBeUndefined();
	expect(updated.state.messages[`dm:${agentId}`]).toBeUndefined();
});

it("prunes removed Project references from Storybook conversations", async () => {
	readyServer();
	const initial = await bootstrap();
	const project = initial.state.projects[0];
	if (project === undefined) throw new Error("Story Project is missing");

	const response = await fetch(new URL("/api/mutate", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "remove-project", projectId: project.id }),
	});
	const updated = bootstrapProjectionSchema.parse(await response.json());

	expect(response.ok).toBe(true);
	expect(updated.state.projects.some((item) => item.id === project.id)).toBe(
		false,
	);
	expect(
		updated.state.threads.every(
			(thread) =>
				thread.projectId !== project.id &&
				thread.projectIds?.includes(project.id) !== true,
		),
	).toBe(true);
	expect(
		Object.values(updated.state.messages)
			.flat()
			.every(
				(message) =>
					message.projectId !== project.id &&
					message.projectIds?.includes(project.id) !== true &&
					message.runAttribution?.roots.some(
						(root) => root.projectId === project.id,
					) !== true,
			),
	).toBe(true);
});

it("includes Channel note pins in Storybook retention preview and removal", async () => {
	readyServer();
	const initial = await bootstrap();
	const channel = initial.state.channels[0];
	if (channel === undefined) throw new Error("Story Channel is missing");
	const conversation = { kind: "channel" as const, id: channel.id };
	const preview = async (): Promise<RetentionPreview> => {
		const response = await fetch(
			new URL("/api/retention/preview", window.location.href),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ conversation }),
			},
		);
		expect(response.ok).toBe(true);
		return retentionPreviewSchema.parse(await response.json());
	};
	const before = await preview();
	await fetch(new URL("/api/pins", window.location.href), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			scope: { kind: "channel", id: channel.id },
			kind: "note",
			note: "Retain this Channel note.",
		}),
	});
	const withNote = await preview();

	expect(withNote.pins).toBe(before.pins + 1);
	const applied = await fetch(
		new URL("/api/retention/apply", window.location.href),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				conversation,
				expectedRevision: withNote.revision,
			}),
		},
	);
	expect(applied.ok).toBe(true);
	expect((await bootstrap()).state.pins).not.toContainEqual(
		expect.objectContaining({
			kind: "note",
			note: "Retain this Channel note.",
		}),
	);
});
