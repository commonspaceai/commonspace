import { fileURLToPath, URL } from "node:url";
import { startDesktopHost } from "../../packages/desktop/src/host.ts";

const host = startDesktopHost({
	entry: fileURLToPath(new URL("./desktop-host.mjs", import.meta.url)),
	args: [],
	env: process.env,
});
await host.ready;
await host.detach();
process.stdout.write(`${JSON.stringify({ pid: host.pid })}\n`);
