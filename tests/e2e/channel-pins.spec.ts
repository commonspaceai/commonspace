import { expect, test } from "@playwright/test";
import { z } from "zod";

const pinnedState = z.object({
	state: z.object({
		pins: z.array(
			z.object({
				kind: z.string(),
				messageId: z.string().optional(),
				removedAt: z.string().nullable(),
				scope: z.object({ kind: z.string(), id: z.string() }),
			}),
		),
	}),
});

test("pins from the Channel menu, keeps Thread pins separate, and restores readable pins after reload", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("button", { name: /^Open channel verification(?:,|$)/ })
		.click();
	const posts = page.getByRole("region", { name: "verification posts" });
	const root = posts
		.locator("article")
		.filter({
			hasText:
				"Review the workspace hierarchy and report a concise checkpoint.",
		})
		.first();
	const rootId = (await root.getAttribute("id"))?.replace(
		"commonspace-message-",
		"",
	);
	if (rootId === undefined) throw new Error("Missing root message ID");
	const channelId = new URL(page.url()).pathname.split("/")[2];
	await root.hover();
	const rootActions = root.getByRole("button", {
		name: /^More actions for message from/,
	});
	await rootActions.click();
	await page
		.getByRole("menuitem", { name: "Pin message", exact: true })
		.click();
	await rootActions.click();
	const unpinRoot = page.getByRole("menuitem", {
		name: "Unpin message",
		exact: true,
	});
	await expect(unpinRoot).toBeVisible();
	await rootActions.click();
	await expect(unpinRoot).toBeHidden();
	await root.getByRole("button", { name: /\d+ repl/ }).click();
	const thread = page.getByRole("log", { name: "Thread messages" });
	await thread.locator("article").first().hover();
	const threadActions = thread
		.getByRole("button", { name: /^More actions for message from/ })
		.first();
	await threadActions.click();
	const pinThread = page.getByRole("menuitem", {
		name: "Pin message",
		exact: true,
	});
	await expect(pinThread).toBeVisible();
	await threadActions.click();
	await expect(pinThread).toBeHidden();
	const response = await page.request.get("/api/bootstrap", {
		headers: { origin: new URL(page.url()).origin },
	});
	await expect(response).toBeOK();
	const state = pinnedState.parse(await response.json());
	expect(
		state.state.pins.filter(
			(pin) => pin.removedAt === null && pin.messageId === rootId,
		),
	).toEqual([
		expect.objectContaining({
			kind: "message",
			scope: { kind: "channel", id: channelId },
		}),
	]);
	await page.getByRole("button", { name: "Close thread", exact: true }).click();
	await page.reload();
	await page.getByRole("button", { name: "Open channel settings" }).click();
	const settings = page.getByRole("complementary", {
		name: "Channel settings",
	});
	await expect(settings.getByText("Pinned messages & notes")).toBeVisible();
	await expect(
		settings
			.getByRole("region", { name: "Pinned messages & notes" })
			.getByText(
				/Review the workspace hierarchy and report a concise checkpoint\./,
			),
	).toBeVisible();
	await expect(settings.getByLabel("Channel instructions")).toBeHidden();
	await expect(settings.getByLabel("Channel summary")).toBeHidden();
	await settings
		.getByRole("region", { name: "Context brief" })
		.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: "artifacts/channel-pins-light.png",
		animations: "disabled",
	});
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.screenshot({
		path: "artifacts/channel-pins-dark.png",
		animations: "disabled",
	});
	await page.evaluate(() => document.documentElement.classList.remove("dark"));
	await settings.getByRole("button", { name: "Edit context" }).click();
	await expect(settings.getByLabel("Channel summary")).toBeVisible();
	await settings.getByRole("button", { name: "Cancel edit" }).click();
	await settings.getByRole("button", { name: /^Remove channel pin/ }).click();
	await expect(settings.getByText(/No pins yet/)).toBeVisible();
	await page.getByRole("button", { name: "Close channel settings" }).click();
	await root.hover();
	await root
		.getByRole("button", { name: /^More actions for message from/ })
		.click();
	await expect(
		page.getByRole("menuitem", { name: "Pin message", exact: true }),
	).toBeVisible();
});
