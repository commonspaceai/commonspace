import { appendFile, readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const logPath = process.env.FAKE_DEVELOPMENT_SERVER_LOG;
const drainGate = process.env.FAKE_DEVELOPMENT_SERVER_DRAIN_GATE;
if (drainGate === undefined) throw new Error("A drain gate is required");

async function record(event) {
	if (logPath !== undefined)
		await appendFile(logPath, `${event}:${String(process.pid)}\n`);
}

await record("started");

let exiting = false;
async function exit(event) {
	if (exiting) return;
	exiting = true;
	await record(event);
	if (process.connected) process.disconnect();
	process.exit(0);
}

process.on("message", (message) => {
	if (
		typeof message !== "object" ||
		message === null ||
		message.type !== "commonspace:development-restart"
	)
		return;
	void record("restart-requested").then(async () => {
		while ((await readFile(drainGate, "utf8")) !== "released")
			await setTimeout(10);
		await exit("drained");
	});
});
process.once("SIGINT", () => {
	void exit("forced");
});
process.once("SIGTERM", () => {
	void exit("forced");
});
process.send?.({ type: "commonspace:development-ready" });
