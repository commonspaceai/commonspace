import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CommonspaceApp } from "../CommonspaceApp";
import {
	createStoryStore,
	storyBootstrap,
	storyProjectFetcher,
	storySearchFetcher,
} from "./story-fixtures";

function desktopReviewBootstrap() {
	const bootstrap = structuredClone(storyBootstrap);
	const messages = bootstrap.state.messages["channel:channel-design"];
	const root = messages?.find((message) => message.id === "message-root");
	const thread = bootstrap.state.threads.find(
		(candidate) => candidate.id === "thread-review",
	);
	if (root === undefined || thread === undefined || messages === undefined)
		throw new Error("Desktop review needs the channel fixture.");
	root.text = "Let’s simplify the workspace navigation.";
	const additions = [
		"Morning.",
		"Can you check the latest changes?",
		"Summarize what we changed.",
	].map((text, index) => ({
		...structuredClone(root),
		id: `desktop-message-${index}`,
		text,
		createdAt: `2026-09-03T09:${index === 2 ? "59" : String(55 + index)}:00.000Z`,
		replyStatus: index === 2 ? ("queued" as const) : ("complete" as const),
	}));
	bootstrap.state.messages["channel:channel-design"] = [
		...additions.slice(0, 2),
		...messages,
		...additions.slice(2),
	];
	bootstrap.state.threads.push(
		...additions.map((message, index) => ({
			...structuredClone(thread),
			id: `desktop-thread-${index}`,
			rootMessageId: message.id,
		})),
	);
	return bootstrap;
}

function ConversationFlow({
	width = "100%",
	desktopReview = false,
}: {
	width?: number | string;
	desktopReview?: boolean;
}) {
	const [store] = useState(() =>
		createStoryStore(
			desktopReview
				? desktopReviewBootstrap()
				: structuredClone(storyBootstrap),
			{
				interactive: true,
				activeConversation: { kind: "channel", id: "channel-design" },
			},
		),
	);
	return (
		<div style={{ width, height: "100dvh" }}>
			<CommonspaceApp
				store={store}
				initialPath={
					desktopReview
						? "/channels/channel-design/threads/thread-review"
						: "/channels/channel-design"
				}
				projectFetcher={storyProjectFetcher}
				searchFetcher={storySearchFetcher}
			/>
		</div>
	);
}

const meta = {
	title: "Review/Conversation Flow",
	component: ConversationFlow,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"Candidate conversation checkpoint using production components. Navigation and text sending use disposable local data; reload resets messages. No agents run. Attachments, settings writes, and persistence are outside this preview. Open a routing destination, open replies, switch Context and back, and compare docked versus right overlay layouts.",
			},
		},
	},
} satisfies Meta<typeof ConversationFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};
export const DesktopConversation: Story = {
	args: { width: 1440, desktopReview: true },
};
export const Docked: Story = { args: { width: 1440 } };
export const RightOverlay: Story = { args: { width: 1000 } };

async function verifyChannelComposer(canvasElement: HTMLElement) {
	const canvas = within(canvasElement);
	await userEvent.click(
		await canvas.findByRole("button", { name: "Channels" }),
	);
	await expect(
		await canvas.findByRole("heading", { name: "Channels" }),
	).toBeVisible();
	await userEvent.click(
		canvas.getByRole("button", { name: "Open channel design-review" }),
	);
	const rootComposer = canvas.getByRole("textbox", {
		name: "Post in design-review",
	});
	const rootComposerFrame = canvas.getByRole("form", {
		name: "Start a new Thread in design-review",
	});
	await expect(rootComposer).toHaveAttribute(
		"placeholder",
		"Start a new Thread in #design-review",
	);
	await expect(
		within(rootComposerFrame).queryByText(/AI selects/u),
	).not.toBeInTheDocument();
	await expect(
		within(rootComposerFrame).queryByText("Post to #design-review"),
	).not.toBeInTheDocument();
	await expect(
		within(rootComposerFrame).queryByText("Starts a new Thread"),
	).not.toBeInTheDocument();
	const rootAttachment = canvas.getByLabelText("Attach files");
	rootAttachment.focus();
	await expect(rootAttachment).toHaveFocus();
	await userEvent.type(rootComposer, "@");
	const namedAgentMenu = await canvas.findByRole("listbox", {
		name: "Tag suggestions",
	});
	const namedAgentOption = within(namedAgentMenu).getByRole("option", {
		name: /@review-bot/u,
	});
	await expect(
		within(namedAgentMenu).queryByRole("option", { name: /@all/u }),
	).not.toBeInTheDocument();
	const namedAgentRect = namedAgentOption.getBoundingClientRect();
	await expect(
		namedAgentOption.contains(
			canvasElement.ownerDocument.elementFromPoint(
				namedAgentRect.left + namedAgentRect.width / 2,
				namedAgentRect.top + namedAgentRect.height / 2,
			),
		),
	).toBe(true);
	await userEvent.clear(rootComposer);
	await userEvent.type(rootComposer, "@all");
	const broadcastOption = within(
		await canvas.findByRole("listbox", { name: "Tag suggestions" }),
	).getByRole("option", { name: /sends to everyone in this channel/u });
	const broadcastRect = broadcastOption.getBoundingClientRect();
	await expect(
		broadcastOption.contains(
			canvasElement.ownerDocument.elementFromPoint(
				broadcastRect.left + broadcastRect.width / 2,
				broadcastRect.top + broadcastRect.height / 2,
			),
		),
	).toBe(true);
	await userEvent.clear(rootComposer);
}

export const FlowVerification: Story = {
	args: { width: 1440 },
	play: async ({ canvasElement, step }) => {
		const canvas = within(canvasElement);
		await step("Channel composer mentions and attachment focus", () =>
			verifyChannelComposer(canvasElement),
		);
		await userEvent.click(
			await canvas.findByRole("button", { name: "1 reply, 1 unread" }),
		);
		const thread = within(
			await canvas.findByRole("complementary", { name: "Thread replies" }),
		);
		const reply = thread.getByRole("textbox", { name: "Reply in thread" });
		await step("Thread composer mentions and attachment focus", async () => {
			await expect(
				thread.getByRole("textbox", { name: "Reply in thread" }),
			).toHaveAttribute("placeholder", "Continue this Thread…");
			await expect(thread.queryByText(/AI selects/u)).not.toBeInTheDocument();
			await expect(
				thread.queryByText("Reply in this Thread"),
			).not.toBeInTheDocument();
			const attachment = thread.getByLabelText("Attach files to Thread");
			attachment.focus();
			await expect(attachment).toHaveFocus();
			await userEvent.type(reply, "@");
			const threadAgentMenu = await thread.findByRole("listbox", {
				name: "Tag suggestions",
			});
			await expect(
				within(threadAgentMenu).getByText("In this thread"),
			).toBeVisible();
			await userEvent.clear(reply);
			await userEvent.type(reply, "@all");
			await expect(
				within(
					await thread.findByRole("listbox", { name: "Tag suggestions" }),
				).getByRole("option", { name: /sends to everyone in this thread/u }),
			).toBeVisible();
			await userEvent.clear(reply);
			await userEvent.type(reply, "@build-smith @@platform");
			await expect(reply).toHaveValue("@build-smith @@platform");
			await userEvent.clear(reply);
		});
		await step(
			"Routing details and context preserve the reply draft",
			async () => {
				await userEvent.click(
					thread.getByRole("button", {
						name: /Routing details: Routed to Review Bot/u,
					}),
				);
				const page = within(canvasElement.ownerDocument.body);
				await expect(
					await page.findByRole("dialog", { name: "Routing details" }),
				).toBeVisible();
				await userEvent.keyboard("{Escape}");
				await expect(
					canvas.getByRole("complementary", { name: "Thread replies" }),
				).toBeVisible();
				await userEvent.type(reply, "A local preview reply.");
				await userEvent.click(
					thread.getByRole("button", { name: "Open thread context" }),
				);
				await expect(reply).not.toBeVisible();
				await userEvent.click(
					thread.getByRole("button", { name: "Back to replies" }),
				);
				await expect(reply).toHaveValue("A local preview reply.");
				await waitFor(() => expect(reply).toHaveFocus());
				await userEvent.keyboard("{Enter}");
				await expect(
					await thread.findByText("A local preview reply."),
				).toBeVisible();
				await expect(reply).toHaveValue("");
			},
		);
	},
};
