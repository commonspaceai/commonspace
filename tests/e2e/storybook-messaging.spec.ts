import { expect, type Page, test } from "@playwright/test";

async function openStory(
	page: Page,
	target: { id: string; title: string; name: string },
): Promise<void> {
	const response = await page.request.get("/index.json");
	await expect(response).toBeOK();
	const index: unknown = await response.json();
	expect(index).toMatchObject({
		entries: {
			[target.id]: {
				...target,
				type: "story",
			},
		},
	});
	await page.goto(`/iframe.html?id=${target.id}&viewMode=story`, {
		waitUntil: "domcontentloaded",
	});
}

test.use({ viewport: { width: 1180, height: 820 } });

test("compact navigation remains usable above an open thread", async ({
	page,
}) => {
	await page.setViewportSize({ width: 480, height: 820 });
	await openStory(page, {
		id: "review-conversation-flow--interactive",
		title: "Review/Conversation Flow",
		name: "Interactive",
	});
	await page
		.getByRole("button", { name: "1 reply, 1 unread", exact: true })
		.click();
	await expect(
		page.getByRole("complementary", { name: "Thread replies" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Open navigation", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Commonspace settings", exact: true })
		.click({ timeout: 5000 });
	await expect(
		page.getByRole("combobox", { name: "Settings category" }),
	).toBeVisible();
});

test("compact settings preserve drafts across category and viewport changes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 480, height: 820 });
	await openStory(page, {
		id: "review-conversation-flow--interactive",
		title: "Review/Conversation Flow",
		name: "Interactive",
	});
	await page
		.getByRole("button", { name: "Open navigation", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Commonspace settings", exact: true })
		.click();
	const category = page.getByRole("combobox", { name: "Settings category" });
	await expect(category).toBeVisible();
	await category.selectOption("intelligence");
	const inferenceSettings = page.getByRole("form", {
		name: "Inference agent settings",
	});
	const inferenceAgent = inferenceSettings.getByRole("radio", {
		name: /Build Smith/iu,
	});
	await inferenceSettings.getByText("Build Smith", { exact: true }).click();
	await category.selectOption("appearance");
	await category.selectOption("intelligence");
	await expect(inferenceAgent).toBeChecked();
	await page.setViewportSize({ width: 1440, height: 960 });
	await expect(category).toBeHidden();
	await expect(
		page.getByRole("tab", { name: "Intelligence", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await expect(inferenceAgent).toBeChecked();
});

test("keeps completed routing outcomes inside the popover", async ({
	page,
}) => {
	await openStory(page, {
		id: "pages-commonspaceconversation--channel-conversation",
		title: "Pages/CommonspaceConversation",
		name: "Channel Conversation",
	});
	const receipt = page.getByLabel(
		"Routing details: Routed to Review Bot · AI selected · Completed",
	);
	await expect(receipt).toBeVisible();
	await expect(receipt).toHaveText("🔎");
	await expect(receipt).toBeFocused();
	await receipt.click();
	const details = page.getByRole("dialog", { name: "Routing details" });
	await expect(details).toContainText("AI selected · Completed");
	await expect(
		details.getByText("Design review matches Hermes."),
	).toBeVisible();
	const assignments = details.getByRole("list", {
		name: "Routing assignments",
	});
	await expect(assignments).toContainText("Original message");
});

test("shows unresolved cancellation locally on its source message", async ({
	page,
}) => {
	await openStory(page, {
		id: "pages-commonspaceconversation--cancelled-routing-outcome",
		title: "Pages/CommonspaceConversation",
		name: "Cancelled Routing Outcome",
	});
	const receipt = page.getByText("Routing cancelled · No agent selected");
	await expect(receipt).toBeVisible();
	await expect(
		page.getByText(
			"No destination agent was available for this routing attempt.",
		),
	).toBeVisible();
});

test("keeps optimistic admission recoverable without locking the composer", async ({
	page,
}) => {
	await openStory(page, {
		id: "pages-commonspaceconversation--pending-admission-recovery",
		title: "Pages/CommonspaceConversation",
		name: "Pending Admission Recovery",
	});
	const composer = page.getByRole("textbox", { name: "Message Review Bot" });
	await expect(composer).toBeEnabled();
	await expect(page.getByText("Admitting · Queued")).toBeVisible();
	await expect(composer).toHaveValue(
		"Restore this failed direction.\n\nNewer direction.",
	);
	await expect(
		page.getByRole("button", { name: "Queue", exact: true }),
	).toBeEnabled();
});

test("omits unsupported thread-wide steering and interruption", async ({
	page,
}) => {
	await openStory(page, {
		id: "design-system-rundelivery--thread-interruption-safety",
		title: "Design System/RunDelivery",
		name: "Thread Interruption Safety",
	});
	await expect(page.getByRole("button", { name: "Queue" })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Steer" })).toHaveCount(0);
	await expect(
		page.getByRole("button", {
			name: "Interrupt and send thread follow-up",
		}),
	).toHaveCount(0);
});

test("hover reveals message actions without selecting the message or another destination", async ({
	page,
}) => {
	await openStory(page, {
		id: "review-conversation-flow--interactive",
		title: "Review/Conversation Flow",
		name: "Interactive",
	});
	const posts = page.getByRole("region", { name: "design-review posts" });
	const root = posts
		.locator("article")
		.filter({
			hasText:
				"Review the visual baseline and document the next component states.",
		})
		.first();
	const inbox = page.getByRole("button", {
		name: "Open Inbox, 2 unread",
		exact: true,
	});
	const channel = page.getByRole("button", {
		name: "Open channel design-review, 1 unread",
		exact: true,
	});
	await expect(channel).toHaveAttribute("aria-pressed", "true");
	await inbox.hover();
	await expect(inbox).toHaveAttribute("aria-pressed", "false");
	await expect(inbox).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(channel).toHaveAttribute("aria-pressed", "true");
	await root.hover();
	await expect(root).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	const message = root.locator("article");
	await expect(message).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await root
		.getByRole("button", { name: "More actions for message from You" })
		.click();
	await page
		.getByRole("menuitem", { name: "Edit message", exact: true })
		.click();
	await expect(
		page.getByRole("textbox", { name: "Edited message" }),
	).toBeFocused();
	await expect(
		page.getByRole("textbox", { name: "Edited message" }),
	).toHaveValue(
		"Review the visual baseline and document the next component states.",
	);
});
