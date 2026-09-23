import { defineConfig } from "@playwright/test";

const USE_SYSTEM_CHROME = process.env.COMMONSPACE_USE_SYSTEM_CHROME === "1";
const STORYBOOK_PORT = Number(process.env.COMMONSPACE_STORYBOOK_PORT ?? 6006);
const STORYBOOK_URL = `http://127.0.0.1:${STORYBOOK_PORT}`;

export default defineConfig({
	testDir: "./tests",
	testMatch: ["storybook-visual.spec.ts", "storybook-interactions.spec.ts"],
	timeout: 30_000,
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: 1,
	reporter: [
		["list"],
		[
			"html",
			{
				outputFolder: "artifacts/playwright-visual-report",
				open: "never",
			},
		],
	],
	outputDir: "artifacts/playwright-visual-results",
	expect: {
		toHaveScreenshot: {
			animations: "disabled",
			caret: "hide",
			scale: "css",
			threshold: 0.01,
		},
	},
	use: {
		baseURL: STORYBOOK_URL,
		channel: USE_SYSTEM_CHROME ? "chrome" : undefined,
		colorScheme: "light",
		trace: "retain-on-failure",
		deviceScaleFactor: 1,
		locale: "en-US",
		timezoneId: "Asia/Manila",
		viewport: { width: 1180, height: 820 },
	},
	webServer: {
		command: `pnpm --filter @commonspace/ui exec vite preview --host 127.0.0.1 --port ${STORYBOOK_PORT} --strictPort --outDir storybook-static`,
		url: `${STORYBOOK_URL}/index.json`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
