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

test("shows completed routing receipts and expandable details", async ({
	page,
}) => {
	await openStory(page, {
		id: "pages-commonspaceconversation--channel-conversation",
		title: "Pages/CommonspaceConversation",
		name: "Channel Conversation",
	});
	const receipt = page.getByText(
		"Routed to Review Bot · AI selected · Completed",
	);
	await expect(receipt).toBeVisible();
	const reason = page.getByText("Design review matches Hermes.");
	if (!(await reason.isVisible())) await receipt.click();
	await expect(reason).toBeVisible();
	await expect(
		page.getByRole("list", { name: "Routing assignments" }),
	).toContainText("Inspect only the desktop UI boundary.");
});

test("shows unresolved cancellation locally on its source message", async ({
	page,
}) => {
	await openStory(page, {
		id: "pages-commonspaceconversation--cancelled-routing-outcome",
		title: "Pages/CommonspaceConversation",
		name: "Cancelled Routing Outcome",
	});
	const receipt = page.getByText(
		"Routed to No agent selected · explicit mention · Cancelled",
	);
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
	await expect(composer).toHaveValue("Restore this failed direction.");
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
