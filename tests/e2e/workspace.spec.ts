import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { z } from "zod";

const VERIFICATION_PROJECT = "Select project Verification Project";
const VERIFICATION_CHANNEL = "Open channel verification";
const GENERAL_CHANNEL = "Open channel general";
const VERIFICATION_MESSAGE_SNIPPET =
	"Review the workspace hierarchy and report a concise checkpoint.";
const desktopNotificationSchema = z.object({
	title: z.string(),
	body: z.string(),
	url: z.string(),
});
const bootstrapSchema = z.object({
	state: z.object({
		channels: z.array(z.object({ id: z.string(), name: z.string() })),
		inboxReadMessageIds: z.array(z.string()),
	}),
});

test("persists Jev settings without returning its credential and can disable routing judgments", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.getByRole("checkbox", { name: "Use Jev for routing" }).focus();
	await page.keyboard.press("Space");
	await expect(
		page.getByRole("checkbox", { name: "Use Jev for routing" }),
	).toBeChecked();
	await page
		.getByLabel("TypeSafe API key", { exact: true })
		.fill("synthetic-typesafe-key");
	await page.screenshot({
		path: "artifacts/jev-settings-light.png",
		animations: "disabled",
	});
	await page.getByRole("radio", { name: /^Dark/ }).focus();
	await page.keyboard.press("Space");
	await page.getByLabel("Jev model").scrollIntoViewIfNeeded();
	await page.screenshot({
		path: "artifacts/jev-settings-dark.png",
		animations: "disabled",
	});
	await page.getByRole("radio", { name: /^Light/ }).focus();
	await page.keyboard.press("Space");
	await page.getByRole("button", { name: "Save inference settings" }).click();
	await expect(
		page.getByRole("form", { name: "Workspace settings" }),
	).toHaveCount(0);
	const configuration = await page.request.get("/api/bootstrap", {
		headers: { origin: new URL(page.url()).origin },
	});
	const body = await configuration.text();
	expect(body).toContain("jev-1.13.0");
	expect(body).not.toContain("synthetic-typesafe-key");
	await page.reload();
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await expect(
		page.getByRole("checkbox", { name: "Use Jev for routing" }),
	).toBeChecked();
	await expect(
		page.getByLabel("TypeSafe API key", { exact: true }),
	).toHaveValue("");
	await page.getByRole("checkbox", { name: "Use Jev for routing" }).focus();
	await page.keyboard.press("Space");
	await page.getByRole("button", { name: "Save inference settings" }).click();
	await expect(
		page.getByRole("form", { name: "Workspace settings" }),
	).toHaveCount(0);
});

test("keeps Workspace settings keyboard focus above the covered conversation", async ({
	page,
}) => {
	await openVerificationChannel(page);
	const trigger = page.getByRole("button", { name: "Commonspace settings" });
	await trigger.focus();
	await page.keyboard.press("Enter");
	const settings = page.getByRole("form", { name: "Workspace settings" });
	await expect(
		settings.getByRole("button", { name: "Close settings" }).first(),
	).toBeFocused();
	await expect(
		page.getByRole("textbox", { name: "Post in verification" }),
	).toHaveCount(0);
	await page.keyboard.press("Tab");
	await expect(settings.getByRole("radio", { name: /^Light/ })).toBeFocused();
	await page.keyboard.press("Control+k");
	await expect(
		page.getByRole("searchbox", { name: "Search Commonspace" }),
	).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(settings).toBeVisible();
	await expect(settings.getByRole("radio", { name: /^Light/ })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(settings).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await expect(
		page.getByRole("textbox", { name: "Post in verification" }),
	).toBeVisible();
});

test("persists appearance and follows live System changes including native controls", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.getByRole("radio", { name: /^Dark/ }).focus();
	await page.keyboard.press("Space");
	await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.getByRole("radio", { name: /^System/ }).focus();
	await page.keyboard.press("Space");
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
	await page.emulateMedia({ colorScheme: "light" });
	await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/system/);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.getByRole("radio", { name: /^Light/ }).focus();
	await page.keyboard.press("Space");
	await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

test("keeps failed inference settings editable and allows retry without page errors", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto("/");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.getByRole("spinbutton", { name: "Default max agents" }).fill("3");
	await page.route(
		"**/api/settings",
		(route) =>
			route.fulfill({
				status: 503,
				json: { error: "Settings temporarily unavailable" },
			}),
		{ times: 1 },
	);
	await page.getByRole("button", { name: "Save inference settings" }).click();
	const settings = page.getByRole("form", { name: "Workspace settings" });
	await expect(settings.getByRole("alert")).toHaveText(
		"Settings temporarily unavailable",
	);
	await expect(
		settings.getByRole("spinbutton", { name: "Default max agents" }),
	).toHaveValue("3");
	await settings
		.getByRole("button", { name: "Save inference settings" })
		.click();
	await expect(settings).toHaveCount(0);
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await page.route(
		"**/api/mutate",
		(route) =>
			route.fulfill({
				status: 503,
				json: { error: "Notification settings temporarily unavailable" },
			}),
		{ times: 1 },
	);
	await settings
		.getByRole("button", { name: "Save notification settings" })
		.click();
	await expect(settings.getByRole("alert")).toHaveText(
		"Notification settings temporarily unavailable",
	);
	await settings
		.getByRole("button", { name: "Save notification settings" })
		.click();
	await expect(
		settings.getByText("Notification settings saved."),
	).toBeVisible();
	expect(pageErrors).toEqual([]);
});

async function readCapturedNotification(capturePath: string) {
	return desktopNotificationSchema.parse(
		JSON.parse(await readFile(capturePath, "utf8")),
	);
}

test("finds and opens a Project by name from global search", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("button", { name: "Search messages, channels, and agents" })
		.click();
	const input = page.getByRole("searchbox", { name: "Search Commonspace" });
	await input.fill("Verification Project");
	await page
		.getByRole("button", { name: "Filter result types: All types" })
		.click();
	await page
		.getByRole("menuitemcheckbox", { name: "Projects", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("option", { name: "Open Project: Verification Project" }),
	).toBeVisible();
	await input.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("main", { name: "Project Verification Project" }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/[^/?#]+$/u);
});

test("returns to Inbox when the selected Channel is removed during a live refresh", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByRole("main", { name: "Inbox" })).toBeVisible();
	const headers = { origin: new URL(page.url()).origin };
	const created = await page.request.post("/api/mutate", {
		headers,
		data: {
			action: "create-channel",
			name: "navigation-removal",
			agentIds: [],
		},
	});
	await expect(created).toBeOK();
	const bootstrap = bootstrapSchema.parse(await created.json());
	const channel = bootstrap.state.channels.find(
		(candidate) => candidate.name === "navigation-removal",
	);
	if (channel === undefined) throw new Error("Missing temporary Channel");
	await page
		.getByRole("button", { name: "Open channel navigation-removal" })
		.click();
	await expect(page).toHaveURL(new RegExp(`/channels/${channel.id}$`));
	const removed = await page.request.post("/api/mutate", {
		headers,
		data: { action: "remove-channel", channelId: channel.id },
	});
	await expect(removed).toBeOK();
	await expect(page.getByRole("main", { name: "Inbox" })).toBeVisible();
	await expect(page).toHaveURL(`${new URL(page.url()).origin}/`);
});

test("opens the exact matching agent reply from search", async ({ page }) => {
	await openVerificationChannel(page);
	await openRootVerificationThread(page);
	const replyText = "Review Bot completed the seeded workspace checkpoint.";
	const replies = page
		.getByLabel("Thread replies")
		.locator("article")
		.filter({ hasText: replyText });
	await expect(replies.first()).toBeVisible();
	const replyIds = await replies.evaluateAll((elements) =>
		elements.map((element) => element.id),
	);
	await page.getByRole("button", { name: /Open Inbox/iu }).click();
	await page.keyboard.press("Control+k");
	await page
		.getByRole("searchbox", { name: "Search Commonspace" })
		.fill(replyText);
	await page
		.getByRole("button", { name: "Filter by project: All projects" })
		.click();
	await page
		.getByRole("menuitemradio", { name: "Verification Project", exact: true })
		.click();
	const result = page
		.getByRole("option", { name: "Open Message: Review Bot", exact: true })
		.filter({ hasText: replyText });
	await result.first().click();
	const target = page
		.getByLabel("Thread replies")
		.locator('article[aria-current="true"]');
	await expect(target).toBeVisible();
	expect(replyIds).toContain(await target.getAttribute("id"));
	await expect(target).toContainText(replyText);
	await expect(page).toHaveURL(/\/threads\/[^/?#]+\?message=/u);
});

function verificationPosts(page: Page) {
	return page.getByRole("region", { name: "verification posts" });
}

function postRowByText(page: Page, text: string): Locator {
	return verificationPosts(page)
		.locator("article")
		.filter({ hasText: text })
		.first();
}

async function openVerificationProject(page: Page): Promise<void> {
	await page.goto("/");
	await page.getByRole("button", { name: VERIFICATION_PROJECT }).click();
}

async function openVerificationChannel(page: Page): Promise<void> {
	await openVerificationProject(page);
	await page.getByRole("button", { name: VERIFICATION_CHANNEL }).click();
	await expect(verificationPosts(page)).toBeVisible();
}

async function postVerificationMessage(
	page: Page,
	text: string,
): Promise<Locator> {
	await openVerificationChannel(page);
	const composer = page.getByLabel("Post in verification");
	await composer.fill(text);
	await page.getByRole("button", { name: "Post message" }).click();
	const messageRow = postRowByText(page, text);
	await expect(messageRow).toBeVisible();
	await expect(composer).toHaveValue("");
	return messageRow;
}

async function openRootVerificationThread(page: Page): Promise<void> {
	const replyButton = verificationPosts(page).getByRole("button", {
		name: /\d+ replies?/i,
	});
	await expect(replyButton).toBeVisible();
	await replyButton.first().click();

	await expect(page.getByLabel("Thread replies")).toBeVisible();
}

test("boots with the seeded projects, channels, agents, and messages", async ({
	page,
}) => {
	await page.goto("/");

	await expect(
		page.getByRole("button", { name: VERIFICATION_PROJECT }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Select project Reference Notes" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: VERIFICATION_CHANNEL }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Message agent Review Bot" }),
	).toBeVisible();

	await openVerificationChannel(page);
	await expect(
		verificationPosts(page).getByText(VERIFICATION_MESSAGE_SNIPPET, {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByLabel("Post in verification")).toBeVisible();
});

test("opens project settings and closes it", async ({ page }) => {
	await openVerificationProject(page);
	const projectSettingsButton = page.getByRole("button", {
		name: "Open project settings",
	});
	await expect(projectSettingsButton).toBeVisible();
	await projectSettingsButton.click();
	const projectSettings = page.getByRole("complementary", {
		name: "Project settings",
	});
	await expect(projectSettings).toBeVisible();
	await projectSettings
		.getByRole("button", { name: "Close project settings" })
		.click();
	await expect(projectSettings).toBeHidden();
});

test("routes Settings transitions and restores detail deep links", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	const workspaceSettings = page.getByRole("form", {
		name: "Workspace settings",
	});
	await expect(workspaceSettings).toBeVisible();

	await page.getByRole("button", { name: VERIFICATION_PROJECT }).click();
	await expect(workspaceSettings).toBeHidden();
	await expect(
		page.getByRole("main", { name: "Project Verification Project" }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/[^/?#]+$/u);
	const projectUrl = page.url();

	await page.getByRole("button", { name: "Open project settings" }).click();
	const projectSettings = page.getByRole("complementary", {
		name: "Project settings",
	});
	await expect(projectSettings).toBeVisible();
	await page.getByRole("button", { name: VERIFICATION_CHANNEL }).click();
	await expect(projectSettings).toBeHidden();
	await expect(verificationPosts(page)).toBeVisible();
	await expect(page).toHaveURL(/\/channels\/[^/?#]+$/u);
	const channelUrl = page.url();

	await page.reload();
	await expect(page).toHaveURL(channelUrl);
	await expect(verificationPosts(page)).toBeVisible();
	await openRootVerificationThread(page);
	await expect(page).toHaveURL(/\/channels\/[^/?#]+\/threads\/[^/?#]+$/u);
	const threadUrl = page.url();
	await page.reload();
	await expect(page).toHaveURL(threadUrl);
	await expect(page.getByLabel("Thread replies")).toBeVisible();

	await page.goto(projectUrl);
	await expect(page).toHaveURL(projectUrl);
	await expect(
		page.getByRole("main", { name: "Project Verification Project" }),
	).toBeVisible();

	await page.reload();
	await expect(page).toHaveURL(projectUrl);
	await expect(
		page.getByRole("main", { name: "Project Verification Project" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Commonspace settings" }).click();
	await expect(workspaceSettings).toBeVisible();
	await page.getByRole("button", { name: "Message agent Review Bot" }).click();
	await expect(workspaceSettings).toBeHidden();
	await expect(page).toHaveURL(/\/agents\/[^/?#]+$/u);
	const agentUrl = page.url();
	await expect(page.getByLabel("Message Review Bot")).toBeVisible();
	await page.reload();
	await expect(page).toHaveURL(agentUrl);
	await expect(page.getByLabel("Message Review Bot")).toBeVisible();

	await page.goBack();
	await expect(page).toHaveURL(projectUrl);
	await expect(
		page.getByRole("main", { name: "Project Verification Project" }),
	).toBeVisible();

	await page.goto("/projects");
	await expect(
		page.getByRole("main", { name: "Projects directory" }),
	).toBeVisible();
	await page.goto("/projects/not-a-real-project");
	await expect(page).toHaveURL(/\/$/u);
	await expect(page.getByRole("main", { name: "Inbox" })).toBeVisible();
});

test("opens channel settings and closes it", async ({ page }) => {
	await openVerificationChannel(page);
	await page.getByRole("button", { name: "Open channel settings" }).click();
	const channelSettings = page.getByRole("complementary", {
		name: "Channel settings",
	});
	await expect(channelSettings).toBeVisible();
	await channelSettings
		.getByRole("button", { name: "Close channel settings" })
		.click();
	await expect(channelSettings).toBeHidden();
});

test("returns mentions to the selected Channel and Thread", async ({
	page,
}) => {
	await openVerificationChannel(page);
	const channelUrl = page.url();
	await openRootVerificationThread(page);
	const threadUrl = page.url();
	const threadComposer = page.getByLabel("Reply in thread", { exact: true });
	const rootComposer = page.getByLabel("Post in verification");
	for (const destination of [
		/Open Inbox/iu,
		/Open Threads/iu,
		VERIFICATION_PROJECT,
	]) {
		await page.getByRole("button", { name: destination }).click();
		await expect(page).not.toHaveURL(threadUrl);
		await page
			.getByRole("button", { name: "More actions for Review Bot" })
			.click();
		await page
			.getByRole("menuitem", { name: /^Mention in #verification/u })
			.click();
		await expect(page).toHaveURL(threadUrl);
		await expect(threadComposer).toHaveValue("@Review Bot ");
		await expect(rootComposer).toHaveValue("");
		await threadComposer.fill("");
	}
	await page.getByRole("button", { name: "Close thread" }).click();
	await page.getByRole("button", { name: /Open Inbox/iu }).click();
	await page
		.getByRole("button", { name: "More actions for Review Bot" })
		.click();
	await page
		.getByRole("menuitem", { name: /^Mention in #verification/u })
		.click();
	await expect(page).toHaveURL(channelUrl);
	await expect(rootComposer).toHaveValue("@Review Bot ");
	await expect(page.getByLabel("Thread replies")).toBeHidden();
	await rootComposer.fill("");
	await page.goBack();
	await expect(page.getByRole("main", { name: "Inbox" })).toBeVisible();
	await page.goForward();
	await expect(page).toHaveURL(channelUrl);
	await expect(rootComposer).toHaveValue("");
});

test("opens Channel header Settings from an active Thread", async ({
	page,
}) => {
	await openVerificationChannel(page);
	const channelUrl = page.url();
	await openRootVerificationThread(page);
	await page.getByRole("button", { name: "Open channel settings" }).click();
	await expect(page).toHaveURL(channelUrl);
	await expect(page.getByLabel("Thread replies")).toBeHidden();
	const settings = page.getByRole("complementary", {
		name: "Channel settings",
	});
	await expect(settings).toBeVisible();
	await page.getByRole("button", { name: "Open channel settings" }).click();
	await expect(settings).toBeHidden();
});

test("dismisses Settings when navigating to the same destination", async ({
	page,
}) => {
	await page.goto("/");
	for (const destination of [
		{
			label: "Verification Project",
			menu: /^Project settings/u,
			pane: "Project settings",
			row: VERIFICATION_PROJECT,
			header: "Open project settings",
		},
		{
			label: "verification",
			menu: /^Channel settings/u,
			pane: "Channel settings",
			row: VERIFICATION_CHANNEL,
			header: "Open channel settings",
		},
		{
			label: "Review Bot",
			menu: /^Profile & capabilities/u,
			pane: "Agent profile",
			row: "Message agent Review Bot",
			header: "Open agent profile",
		},
	]) {
		await page
			.getByRole("button", {
				name: `More actions for ${destination.label}`,
				exact: true,
			})
			.click();
		await page.getByRole("menuitem", { name: destination.menu }).click();
		const settings = page.getByRole("complementary", {
			name: destination.pane,
		});
		await expect(settings).toBeVisible();
		const destinationUrl = page.url();
		await page.getByRole("button", { name: destination.row }).click();
		await expect(page).toHaveURL(destinationUrl);
		await expect(settings).toBeHidden();
		await page.getByRole("button", { name: destination.header }).click();
		await expect(settings).toBeVisible();
		await page.getByRole("button", { name: destination.row }).click();
		await expect(settings).toBeHidden();
	}
});

test("sends a channel message and keeps composer state correct", async ({
	page,
}) => {
	const messageText = `E2E channel post: ${Math.floor(
		Math.random() * 1_000_000,
	)}.`;
	await postVerificationMessage(page, messageText);
});

test("refreshes the Inbox, captures native delivery, and opens the exact notification target", async ({
	page,
}) => {
	const e2ePort = process.env.COMMONSPACE_E2E_PORT ?? "3199";
	const capturePath =
		process.env.COMMONSPACE_E2E_NOTIFICATION_CAPTURE ??
		join(tmpdir(), `commonspace-e2e-notification-${e2ePort}.json`);
	await page.goto("/");
	await page.getByRole("button", { name: "Commonspace settings" }).click();
	const settings = page.getByRole("form", { name: "Workspace settings" });
	const masterSwitch = settings.getByRole("switch", {
		name: "Allow native notifications",
	});
	if ((await masterSwitch.getAttribute("aria-checked")) !== "true")
		await masterSwitch.click();
	await settings
		.getByRole("button", { name: "Save notification settings" })
		.click();
	await expect(settings.getByRole("status")).toContainText(
		"Notification settings saved.",
	);
	await settings
		.getByRole("button", { name: "Send test notification" })
		.click();
	await expect(settings.getByRole("status")).toContainText(
		"Test notification delivered.",
	);
	await expect
		.poll(async () => {
			try {
				const notification = await readCapturedNotification(capturePath);
				return notification.title;
			} catch {
				return null;
			}
		})
		.toBe("Commonspace notifications are working");
	await settings
		.getByRole("button", { name: "Close settings" })
		.first()
		.click();

	await page.getByRole("button", { name: /Open Inbox/iu }).click();
	await page.getByRole("button", { name: /^Activity/iu }).click();
	const bootstrap = await page.request
		.get("/api/bootstrap", { headers: { origin: page.url() } })
		.then(async (response) => bootstrapSchema.parse(await response.json()));
	const channel = bootstrap.state.channels.find(
		(candidate) => candidate.name === "verification",
	);
	if (channel === undefined)
		throw new Error("verification channel fixture missing");
	const responseText = "Review Bot completed the seeded workspace checkpoint.";
	const previousReplies = await page
		.getByText(responseText, { exact: true })
		.count();

	const send = await page.request.post("/api/send", {
		headers: { origin: page.url() },
		data: {
			conversation: { kind: "channel", id: channel.id },
			text: "@review-bot Verify the complete notification path.",
		},
	});
	expect(send.ok()).toBe(true);
	await expect(page.getByText(responseText, { exact: true })).toHaveCount(
		previousReplies + 1,
	);

	await expect
		.poll(async () => {
			try {
				const notification = await readCapturedNotification(capturePath);
				return notification.body;
			} catch {
				return null;
			}
		})
		.toBe(responseText);
	const notification = await readCapturedNotification(capturePath);
	const target = new URL(notification.url);
	const messageId = target.searchParams.get("messageId");
	if (messageId === null)
		throw new Error("notification message target missing");

	await page.goto(notification.url);
	const targetMessage = page.locator(`[id="commonspace-message-${messageId}"]`);
	await expect(targetMessage).toBeVisible();
	await expect(targetMessage).toHaveAttribute("aria-current", "true");
	await expect
		.poll(async () => {
			const current = await page.request
				.get("/api/bootstrap", { headers: { origin: page.url() } })
				.then(async (response) => bootstrapSchema.parse(await response.json()));
			return current.state.inboxReadMessageIds.includes(messageId);
		})
		.toBe(true);
});

test("opens a seeded thread, replies, and uses thread context", async ({
	page,
}) => {
	const threadReply = `E2E thread reply: ${Math.floor(
		Math.random() * 1_000_000,
	)}.`;

	await openVerificationChannel(page);
	await openRootVerificationThread(page);

	const threadPanel = page.getByLabel("Thread replies");
	const threadComposer = threadPanel.getByLabel("Reply in thread");
	await threadComposer.fill(threadReply);
	await threadPanel
		.locator("form")
		.getByRole("button", { name: "Reply" })
		.click();
	await expect(
		threadPanel.getByText(threadReply, { exact: true }),
	).toBeVisible();

	await threadPanel
		.getByRole("button", { name: "Open thread context" })
		.click();
	const threadContext = page.getByRole("region", {
		name: "Thread context",
	});
	await expect(threadContext).toBeVisible();
	await expect(threadContext.getByText("Current Thread context")).toBeVisible();
	await threadPanel
		.getByRole("button", { name: "Open thread context" })
		.click();
	await expect(threadContext).toBeHidden();

	await threadPanel.getByRole("button", { name: "Close thread" }).click();
	await expect(threadPanel).toBeHidden();
});

test("edits a user message and creates an edited branch", async ({ page }) => {
	const original = `E2E editable message: ${Math.floor(
		Math.random() * 1_000_000,
	)}.`;
	const edited = `${original} edited`;
	const messageRow = await postVerificationMessage(page, original);

	await messageRow.hover();
	await messageRow.getByRole("button", { name: /^Edit message from / }).click();

	const editForm = messageRow.getByLabel("Edit delivered message");
	await expect(editForm).toBeVisible();
	await editForm.getByLabel("Edited message").fill(edited);
	const editRequest = page.waitForResponse((response) => {
		return (
			response.url().includes("/api/messages/") &&
			response.url().includes("/edit") &&
			response.request().method() === "POST" &&
			response.status() === 202
		);
	});
	await editForm.getByRole("button", { name: "Create branch" }).click();
	const response = await editRequest;
	expect(response.status()).toBe(202);
	await expect(editForm).toBeHidden();
	await expect(messageRow).toBeVisible();
});

test("opens the message action menu and closes it", async ({ page }) => {
	const toSave = `E2E saved message: ${Math.floor(Math.random() * 1_000_000)}.`;
	const messageRow = await postVerificationMessage(page, toSave);

	await messageRow.hover();
	const actionMenu = messageRow.getByRole("button", {
		name: /^More actions for message from /,
	});
	await actionMenu.click();
	await expect(
		page.getByRole("menuitem", { name: "Save for later" }),
	).toBeVisible();
	await actionMenu.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("menuitem", { name: "Save for later" }),
	).toBeHidden();
	await expect(messageRow).toBeVisible();
});

test("copies a message link from action menu", async ({ page }) => {
	const toCopy = `E2E copy link message: ${Math.floor(
		Math.random() * 1_000_000,
	)}.`;
	const messageRow = await postVerificationMessage(page, toCopy);
	const origin = new URL(page.url()).origin;
	await page
		.context()
		.grantPermissions(["clipboard-read", "clipboard-write"], { origin });

	await messageRow.hover();
	const actionMenu = messageRow.getByRole("button", {
		name: /^More actions for message from /,
	});
	await actionMenu.click();
	await page.getByRole("menuitem", { name: "Copy link" }).click();

	const copiedText = await page.evaluate(() => navigator.clipboard.readText());
	expect(typeof copiedText).toBe("string");
	const copiedUrl = new URL(copiedText);
	expect(copiedUrl.origin).toBe(origin);
	expect(copiedUrl.pathname).toMatch(
		/^\/channels\/[^/?#]+\/threads\/[^/?#]+$/u,
	);
	const messageId = await messageRow.getAttribute("id");
	expect(messageId).toBeTruthy();
	expect(copiedUrl.searchParams.get("message")).toBe(
		messageId?.replace(/^commonspace-message-/u, ""),
	);

	await page.goto(copiedText);
	await expect(
		page.locator(`#${messageId ?? "missing-message"}`),
	).toHaveAttribute("aria-current", "true");
});

test("opens thread from the message action menu", async ({ page }) => {
	await openVerificationChannel(page);
	await openRootVerificationThread(page);

	const messageRoot = verificationPosts(page).locator("article").first();
	await messageRoot.hover();
	await messageRoot
		.getByRole("button", { name: /^More actions for message from / })
		.click();
	await page.getByRole("menuitem", { name: "Reply in thread" }).click();

	await expect(page.getByLabel("Thread replies")).toBeVisible();
});

test("preserves unsent Channel attachments when opening and closing a Thread", async ({
	page,
}) => {
	await openVerificationChannel(page);
	await page.getByLabel("Attach files", { exact: true }).setInputFiles({
		name: "release-notes.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("Unsent release notes"),
	});
	const attachment = page.getByRole("button", {
		name: "Remove release-notes.txt",
	});
	await expect(attachment).toBeVisible();
	await openRootVerificationThread(page);
	await expect(attachment).toBeVisible();
	await page.getByRole("button", { name: "Close thread", exact: true }).click();
	await expect(page.getByLabel("Thread replies")).toBeHidden();
	await expect(attachment).toBeVisible();
});

test("deletes a user message and preserves the deleted tombstone", async ({
	page,
}) => {
	const toDelete = `E2E delete message: ${Math.floor(
		Math.random() * 1_000_000,
	)}.`;
	const messageRow = await postVerificationMessage(page, toDelete);

	await messageRow.hover();
	await page.once("dialog", (dialog) => dialog.accept());
	await messageRow
		.getByRole("button", { name: /^Delete message from / })
		.click();
	await expect(messageRow).toBeHidden();
	await expect(
		verificationPosts(page).getByText("Message deleted"),
	).toBeVisible();
});

test("switches between channels with focused composer target", async ({
	page,
}) => {
	await openVerificationChannel(page);
	await page.getByRole("button", { name: GENERAL_CHANNEL }).click();

	await expect(page.getByLabel("Post in general")).toBeVisible();
	await expect(page.getByLabel("Thread replies")).toBeHidden();
});
