import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type DevelopmentSupervisor,
	startDevelopmentSupervisor,
} from "../server/src/dev-supervisor.ts";

const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"fake-development-server.mjs",
);
const roots: string[] = [];
const supervisors: DevelopmentSupervisor[] = [];

async function logLines(path: string): Promise<string[]> {
	try {
		return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

afterEach(async () => {
	await Promise.all(
		supervisors.splice(0).map((supervisor) => supervisor.close()),
	);
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("development server supervisor", () => {
	it("coalesces restart requests while the old server generation drains before starting the next one", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-dev-supervisor-"));
		roots.push(root);
		const sourceRoot = join(root, "src");
		const watchedPath = join(sourceRoot, "watched.ts");
		const logPath = join(root, "server.log");
		const drainGate = join(root, "drain-gate");
		await mkdir(sourceRoot);
		await writeFile(watchedPath, "initial");
		await writeFile(drainGate, "blocked");

		const supervisor = startDevelopmentSupervisor({
			command: process.execPath,
			args: [fixturePath],
			cwd: root,
			env: {
				...process.env,
				FAKE_DEVELOPMENT_SERVER_LOG: logPath,
				FAKE_DEVELOPMENT_SERVER_DRAIN_GATE: drainGate,
			},
			watchPaths: [sourceRoot],
			debounceMs: 10,
			logger: { info: () => undefined, error: () => undefined },
		});
		supervisors.push(supervisor);

		await vi.waitFor(async () => {
			expect(
				(await logLines(logPath)).filter((line) => line.startsWith("started:")),
			).toHaveLength(1);
		});
		await writeFile(watchedPath, "first edit");
		await vi.waitFor(async () => {
			expect(
				(await logLines(logPath)).some((line) =>
					line.startsWith("restart-requested:"),
				),
			).toBe(true);
		});
		supervisor.requestRestart("second edit while draining");

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(
			(await logLines(logPath)).filter((line) => line.startsWith("started:")),
		).toHaveLength(1);
		expect(
			(await logLines(logPath)).some((line) => line.startsWith("forced:")),
		).toBe(false);
		await writeFile(drainGate, "released");

		await vi.waitFor(
			async () => {
				expect(
					(await logLines(logPath)).filter((line) =>
						line.startsWith("started:"),
					),
				).toHaveLength(2);
			},
			{ timeout: 1_500 },
		);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(
			(await logLines(logPath)).filter((line) => line.startsWith("started:")),
		).toHaveLength(2);
	});
});
