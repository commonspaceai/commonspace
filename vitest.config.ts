import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@": path.join(dirname, "ui/src"),
			"@commonspace/shared": path.join(dirname, "packages/shared/src/index.ts"),
		},
	},
	test: {
		environment: "node",
		// jsdom owns browser storage; native Node storage can shadow its globals.
		execArgv: ["--no-experimental-webstorage"],
		setupFiles: ["./tests/test-setup.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.git/**",
			"**/.cache/**",
			"**/coverage/**",
			"**/storybook-static/**",
			"tests/e2e/**",
			"tests/storybook-visual.spec.ts",
			"tests/storybook-interactions.spec.ts",
		],
		maxWorkers: process.env.CI === "true" ? 2 : undefined,
		testTimeout: 30_000,
		hookTimeout: 30_000,
		clearMocks: true,
		restoreMocks: true,
	},
});
