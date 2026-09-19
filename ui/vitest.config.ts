import process from "node:process";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const useSystemChrome = process.env.COMMONSPACE_USE_SYSTEM_CHROME === "1";
const storyTag = process.env.COMMONSPACE_STORYBOOK_TAG ?? "test";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@commonspace/shared": fileURLToPath(
				new URL("../packages/shared/src/index.ts", import.meta.url),
			),
		},
	},
	plugins: [
		storybookTest({
			configDir: fileURLToPath(new URL("./.storybook", import.meta.url)),
			tags: { include: [storyTag], exclude: [], skip: [] },
		}),
	],
	test: {
		name: "storybook",
		fileParallelism: true,
		maxWorkers: process.env.CI === "true" ? 2 : undefined,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(
				useSystemChrome ? { launchOptions: { channel: "chrome" } } : {},
			),
			instances: [{ browser: "chromium" }],
		},
	},
});
