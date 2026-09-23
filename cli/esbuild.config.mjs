import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const cliRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliRoot, "..");
const output = resolve(cliRoot, "dist/index.js");

await rm(resolve(cliRoot, "dist"), { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });
await build({
	entryPoints: [resolve(cliRoot, "src/index.ts")],
	outfile: output,
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	packages: "external",
	alias: {
		"@commonspace/shared": resolve(repoRoot, "packages/shared/src/index.ts"),
	},
	banner: { js: "#!/usr/bin/env node" },
	sourcemap: true,
});
await chmod(output, 0o755);

await mkdir(resolve(cliRoot, "dist/classifier"), { recursive: true });
await build({
	entryPoints: [resolve(repoRoot, "server/src/classifier-worker.ts")],
	outfile: resolve(cliRoot, "dist/classifier/worker.js"),
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	packages: "external",
	sourcemap: true,
});
for (const name of ["model.json", "LICENSE", "NOTICE"]) {
	await cp(
		resolve(cliRoot, "classifier", name),
		resolve(cliRoot, "dist/classifier", name),
	);
}
