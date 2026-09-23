import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const send = (reply) => process.stdout.write(`${JSON.stringify(reply)}\n`);
const directory = process.argv[2];
if (process.env.COMMONSPACE_TEST_SECRET) throw new Error("Credential leaked");
if (
	(await readFile(join(directory, "model.onnx"), "utf8")) !== "synthetic model"
)
	throw new Error("Missing model");
await writeFile(join(directory, "pid"), String(process.pid));
try {
	await access(join(directory, "slow-ready"));
	await sleep(60_000);
} catch {
	// The optional marker only delays the startup-cancellation fixture.
}
send({ type: "ready" });
for await (const line of createInterface({
	input: process.stdin,
	crlfDelay: Infinity,
})) {
	const request = JSON.parse(line);
	if (request.state === "wait") continue;
	if (request.state === "unsupported") {
		send({ type: "unsupported", id: request.id, reason: "token_limit" });
		continue;
	}
	if (request.state === "late") await sleep(100);
	const scores = request.options.map((o) => ({
		id: o.id,
		score: 1 / request.options.length,
	}));
	if (request.state === "wrong-option") scores[0].id = "unrequested-agent";
	send({ type: "result", id: request.id, scores });
}
await writeFile(join(directory, "stopped"), "clean EOF shutdown");
