import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { uiReviewCatalog } from "../ui/src/stories/review-catalog.ts";

// Capture fixtures from the running Storybook. This never approves baselines.
const baseUrl = "http://127.0.0.1:6006";
const artifactDir = resolve(
	"artifacts/ui-review",
	new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(artifactDir, { recursive: true });
const evidence = [];
const browser = await chromium.launch();
try {
	for (const viewport of [
		{ width: 1440, height: 960 },
		{ width: 1180, height: 820 },
	]) {
		for (const appearance of ["light", "dark"]) {
			for (const story of uiReviewCatalog) {
				const page = await browser.newPage({
					viewport,
					reducedMotion: "reduce",
				});
				const errors = [];
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") errors.push(message.text());
				});
				const filename = `${story.id}-${appearance}-${viewport.width}.png`;
				const entry = {
					story: story.id,
					appearance,
					viewport,
					question: story.question,
					screenshot: filename,
					capture: "pending",
					inspection: "pending",
					errors,
				};
				evidence.push(entry);
				try {
					await page.goto(
						`${baseUrl}/iframe.html?id=${story.id}&viewMode=story&globals=appearance:${appearance}`,
					);
					await page.locator(story.ready).first().waitFor({ timeout: 20_000 });
					await page
						.getByText("Formatting message…", { exact: true })
						.first()
						.waitFor({ state: "hidden", timeout: 20_000 });
					await page
						.locator("html")
						.evaluate((element) => element.ownerDocument.fonts.ready);
					await page.screenshot({
						path: resolve(artifactDir, filename),
						fullPage: true,
						animations: "disabled",
					});
					entry.capture = errors.length === 0 ? "captured" : "failed";
				} catch (error) {
					entry.capture = "failed";
					errors.push(String(error));
				} finally {
					await page.close();
				}
				process.stdout.write(`${entry.capture}: ${filename}\n`);
			}
		}
	}
} finally {
	await browser.close();
	await writeFile(
		resolve(artifactDir, "review.json"),
		`${JSON.stringify({ source: baseUrl, note: "Running Storybook source; capture readiness does not certify interaction tests or visual acceptance.", evidence }, null, 2)}\n`,
	);
}
process.stdout.write(`Visual inspection pending: ${artifactDir}\n`);
if (evidence.some((entry) => entry.capture === "failed")) process.exitCode = 1;
