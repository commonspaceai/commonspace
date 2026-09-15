import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "worker") {
	if (process.env.FAKE_ACP_LEAVE_CHILD === "1") {
		setInterval(() => undefined, 1_000);
		process.on("SIGTERM", () => undefined);
	}
	process.on("message", async () => {
		await writeFile(process.env.FAKE_ACP_FLUSH_FILE, "native session saved");
		process.exit(0);
	});
	process.send("ready");
} else {
	const worker = fork(fileURLToPath(import.meta.url), ["worker"], {
		stdio: ["ignore", "ignore", "ignore", "ipc"],
	});
	await once(worker, "message");
	if (process.env.FAKE_ACP_CHILD_PID_FILE !== undefined)
		await writeFile(process.env.FAKE_ACP_CHILD_PID_FILE, String(worker.pid));
	if (process.env.FAKE_ACP_BRIDGE_PID_FILE !== undefined)
		await writeFile(process.env.FAKE_ACP_BRIDGE_PID_FILE, String(process.pid));
	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		if (process.env.FAKE_ACP_LEAVE_CHILD === "1") process.exit(0);
		const stopped = once(worker, "exit");
		worker.send("flush");
		await stopped;
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	const lines = createInterface({ input: process.stdin });
	lines.on("close", shutdown);
	for await (const line of lines) {
		const request = JSON.parse(line);
		const result =
			request.method === "initialize"
				? { protocolVersion: 1, agentCapabilities: {} }
				: { sessionId: "shutdown-session" };
		if (request.method === "session/prompt") {
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "shutdown-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Ready to close." } } } })}\n`,
			);
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { stopReason: "end_turn" } })}\n`,
				() => {
					if (process.env.FAKE_ACP_EXIT_AFTER_PROMPT === "1") process.exit(0);
				},
			);
		} else {
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
			);
		}
	}
}
