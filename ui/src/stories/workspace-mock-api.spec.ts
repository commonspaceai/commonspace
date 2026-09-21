// @vitest-environment jsdom

import { setupServer } from "msw/node";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createWorkspaceMockApi } from "./workspace-mock-api.ts";

const bootstrapProjectionSchema = z.object({
	state: z.object({
		channels: z.array(
			z.object({
				id: z.string(),
				agentIds: z.array(z.string()),
			}),
		),
		threads: z.array(
			z.object({
				agentIds: z.array(z.string()),
			}),
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

	expect(response.status).toBe(500);
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
	expect(
		updated.state.channels.every(
			(channel) => !channel.agentIds.includes(agentId),
		),
	).toBe(true);
	expect(
		updated.state.threads.every((thread) => !thread.agentIds.includes(agentId)),
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
