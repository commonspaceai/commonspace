import path from "node:path";
import { fileURLToPath } from "node:url";
import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [codspeedPlugin()],
	resolve: {
		alias: {
			"@commonspace/shared": path.join(dirname, "packages/shared/src/index.ts"),
		},
	},
	test: {
		environment: "node",
		benchmark: {
			include: ["benchmarks/**/*.bench.ts"],
		},
	},
});
