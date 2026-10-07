import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseSendMessageResponse,
	type SendMessageRequest,
} from "@commonspace/shared";
import { afterEach, expect, it } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import { addTestHarness, discoverTestHarnesses } from "./test-harnesses.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

it("requires a retry identity and returns acceptance, conflict, and gone through HTTP", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-submission-http-"));
	roots.push(root);
	let runs = 0;
	const server = await startCommonspaceServer({
		root,
		port: 0,
		dependencies: {
			discoverAgents: discoverTestHarnesses,
			runAgent: async () => `Synthetic HTTP reply ${String(++runs)}`,
			notify: async () => undefined,
		},
		logger: { warn: () => undefined, info: () => undefined },
	});
	servers.push(server);
	await addTestHarness(server.service, "codex", "Review Bot");
	const post = (
		path: string,
		body: SendMessageRequest | Record<string, never>,
	) =>
		fetch(`${server.url}${path}`, {
			method: "POST",
			headers: { origin: server.url, "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const message: SendMessageRequest = {
		conversation: { kind: "dm", id: "codex" },
		text: "One HTTP request",
	};
	expect((await post("/api/send", message)).status).toBe(400);
	const submission = {
		...message,
		submissionId: "submission-http-response-lost",
	};
	const original = await post("/api/send", submission);
	expect(original.status).toBe(202);
	const accepted = parseSendMessageResponse(await original.json());
	await server.service.whenIdle();

	const retry = await post("/api/send", submission);
	expect(retry.status).toBe(202);
	expect(parseSendMessageResponse(await retry.json()).accepted.id).toBe(
		accepted.accepted.id,
	);
	const conflict = await post("/api/send", {
		...submission,
		text: "Different HTTP request",
	});
	expect(conflict.status).toBe(409);
	expect(await conflict.json()).toMatchObject({
		code: "message_submission_conflict",
	});
	expect(runs).toBe(1);
	const deleted = await post(
		`/api/messages/${accepted.accepted.id}/delete`,
		{},
	);
	expect(deleted.ok).toBe(true);
	const gone = await post("/api/send", submission);
	expect(gone.status).toBe(410);
	expect(await gone.json()).toMatchObject({ code: "message_submission_gone" });
	expect(runs).toBe(1);
});
