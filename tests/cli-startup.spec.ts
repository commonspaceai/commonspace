import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("stops the owned host when its parent quits during CLI startup", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-early-quit-"));
	const child = fork(
		fileURLToPath(new URL("../cli/src/index.ts", import.meta.url)),
		["--no-classifier"],
		{
			execArgv: [
				"--import",
				fileURLToPath(
					new URL(
						"../server/node_modules/tsx/dist/loader.mjs",
						import.meta.url,
					),
				),
			],
			env: {
				COMMONSPACE_HOME: root,
				COMMONSPACE_PORT: "0",
				COMMONSPACE_LOG_LEVEL: "error",
			},
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		},
	);
	const exited = new Promise<number | null>((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const kill = setTimeout(() => child.kill("SIGKILL"), 10_000);
	child.disconnect();
	try {
		expect(await exited).toBe(0);
		if (child.pid === undefined) throw new Error("Host did not start");
		expect(() => process.kill(child.pid, 0)).toThrow();
	} finally {
		clearTimeout(kill);
		child.kill("SIGKILL");
		await rm(root, { recursive: true, force: true });
	}
});
