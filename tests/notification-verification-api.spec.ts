// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("notification verification API", () => {
	it("delivers a native test alert through the server boundary", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-notification-verification-api-"),
		);
		roots.push(root);
		const notify = vi.fn(async () => undefined);
		const running = await startCommonspaceServer({
			root,
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
			dependencies: { notify },
		});
		servers.push(running);

		const response = await fetch(
			new URL("/api/notifications/verify", running.url),
			{
				method: "POST",
				headers: { origin: running.url },
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "delivered",
			message:
				"Test notification delivered. Click it to verify Commonspace opens.",
		});
		expect(notify).toHaveBeenCalledOnce();

		for (let attempt = 2; attempt <= 5; attempt++) {
			const repeated = await fetch(
				new URL("/api/notifications/verify", running.url),
				{
					method: "POST",
					headers: { origin: running.url },
				},
			);
			expect(repeated.status).toBe(200);
		}
		const limited = await fetch(
			new URL("/api/notifications/verify", running.url),
			{
				method: "POST",
				headers: { origin: running.url },
			},
		);
		expect(limited.status).toBe(429);
		await expect(limited.json()).resolves.toMatchObject({
			code: "notification_verification_rate_limited",
		});
		expect(notify).toHaveBeenCalledTimes(5);
	});
});
