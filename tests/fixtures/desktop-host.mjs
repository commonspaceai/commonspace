import { randomBytes, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { clearInterval, setInterval, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const [mode, marker] = process.argv.slice(2);
if (mode === "exit-before-ready") process.exit(7);
if (mode === "slow-start") await delay(200);
if (process.env.COMMONSPACE_HOME === undefined)
	throw new Error("Fixture workspace is required");
const root = await realpath(process.env.COMMONSPACE_HOME);
const locatorPath = join(root, "host/host-control-token.json");
const id = randomUUID();
const token = randomBytes(32).toString("base64url");
const server = createServer((request, response) => {
	if (request.headers.authorization !== `Bearer ${token}`) {
		response.writeHead(401).end();
		return;
	}
	if (request.url === "/api/host/control") {
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				id,
				pid: process.pid,
			}),
		);
		return;
	}
	if (request.url === "/api/host/control/stop" && request.method === "POST") {
		response.writeHead(202, { "content-type": "application/json" });
		response.end(JSON.stringify({ status: "stopping" }));
		void stop();
		return;
	}
	response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url =
	mode === "invalid-url"
		? "https://example.com"
		: `http://127.0.0.1:${server.address().port}`;
await mkdir(join(root, "host"), { recursive: true, mode: 0o700 });
await writeFile(
	`${locatorPath}.${id}.tmp`,
	`${JSON.stringify({ version: 1, root, id, token, pid: process.pid, url })}\n`,
	{ mode: 0o600 },
);
await rename(`${locatorPath}.${id}.tmp`, locatorPath);
if (process.connected)
	throw new Error("The independent host must not inherit IPC");
const heartbeat = setInterval(
	() => process.stdout.write("host still running\n"),
	50,
);
if (mode === "crash") setTimeout(() => process.exit(8), 250);
async function stop() {
	clearInterval(heartbeat);
	await delay(50);
	if (marker !== undefined) await writeFile(marker, "host stopped");
	await new Promise((resolve) => server.close(resolve));
	const saved = JSON.parse(await readFile(locatorPath, "utf8"));
	if (saved.id === id) await rm(locatorPath);
}
process.once("SIGTERM", () => void stop());
