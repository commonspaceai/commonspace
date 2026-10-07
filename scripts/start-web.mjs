import { fileURLToPath, URL } from "node:url";

process.env.COMMONSPACE_UI_ROOT ??= fileURLToPath(
	new URL("../ui/dist", import.meta.url),
);
await import("../cli/dist/index.js");
