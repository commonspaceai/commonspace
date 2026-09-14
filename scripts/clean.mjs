import { rm } from "node:fs/promises";

for (const directory of process.argv.slice(2)) {
	if (!["dist", "ui-dist"].includes(directory))
		throw new Error(`Unknown build directory: ${directory}`);
	await rm(directory, { recursive: true, force: true });
}
