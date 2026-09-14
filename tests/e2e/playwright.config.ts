import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.COMMONSPACE_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;
const USE_SYSTEM_CHROME = process.env.COMMONSPACE_USE_SYSTEM_CHROME === "1";
const E2E_HOME = mkdtempSync(join(tmpdir(), "commonspace-e2e-home-"));
process.env.COMMONSPACE_E2E_HOME = E2E_HOME;
const inheritedEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	),
);

export default defineConfig({
	testDir: ".",
	testMatch: "**/*.spec.ts",
	// Storybook fixtures use playwright.messaging.config.ts and its own server.
	testIgnore: ["**/storybook-messaging.spec.ts"],
	globalTeardown: "./global-teardown.mjs",
	timeout: 60_000,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	use: {
		baseURL: BASE_URL,
		headless: true,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
		colorScheme: "light",
		locale: "en-US",
		viewport: { width: 1180, height: 820 },
	},
	projects: [
		{
			name: "chromium",
			use: {
				browserName: "chromium",
				channel: USE_SYSTEM_CHROME ? "chrome" : undefined,
			},
		},
	],
	webServer: {
		command: `${process.platform === "win32" ? "" : "exec "}node ../../server/node_modules/tsx/dist/cli.mjs ../../scripts/e2e-server.mjs`,
		url: `${BASE_URL}/api/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...inheritedEnv,
			COMMONSPACE_E2E_PORT: String(PORT),
			COMMONSPACE_E2E_HOME: E2E_HOME,
			COMMONSPACE_HOME: E2E_HOME,
		},
	},
	outputDir: "./artifacts/e2e-results",
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "./artifacts/e2e-report" }],
	],
});
