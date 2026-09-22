import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import {
	expect,
	fireEvent,
	fn,
	userEvent,
	waitFor,
	within,
} from "storybook/test";
import { CommonspaceConversation } from "../CommonspaceConversation";
import type { CommonspaceStore } from "../commonspace-store";
import { COMMONSPACE_RESIZABLE_PANEL } from "../design-system/useResizablePanel";
import {
	createStoryStore,
	denseStoryBootstrap,
	hermesAgent,
	primaryProject,
	runtimeStoryBootstrap,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceConversation",
	component: CommonspaceConversation,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CommonspaceConversation>;

export default meta;
type Story = StoryObj<typeof meta>;

const channel = { kind: "channel" as const, id: "channel-design" };
const directMessage = { kind: "dm" as const, id: "agent-hermes" };

function ChannelSettingsPreview() {
	const [settingsOpen, setSettingsOpen] = useState(true);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const store = useMemo(
		() =>
			createStoryStore(storyBootstrap, {
				activeConversation: channel,
				activeProjectId: primaryProject.id,
				activeThreadId,
			}),
		[activeThreadId],
	);
	return (
		<CommonspaceConversation
			store={store}
			settingsRequest={
				settingsOpen
					? { kind: "channel", id: "channel-design", token: 1 }
					: null
			}
			onOpenSettings={() => {
				setSettingsOpen(true);
			}}
			onThreadChange={setActiveThreadId}
			onSettingsClosed={() => {
				setSettingsOpen(false);
			}}
		/>
	);
}

function FocusTransitionPreview() {
	const [conversationKind, setConversationKind] = useState<"channel" | "dm">(
		"channel",
	);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(
		"thread-review",
	);
	const [targetMessageId, setTargetMessageId] = useState<string | null>(
		"message-reply",
	);
	const store = useMemo(
		() =>
			createStoryStore(denseStoryBootstrap, {
				activeConversation:
					conversationKind === "channel" ? channel : directMessage,
				activeProjectId: primaryProject.id,
				activeThreadId,
			}),
		[activeThreadId, conversationKind],
	);
	return (
		<div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
			<div>
				<button
					type="button"
					disabled={targetMessageId !== null}
					onClick={() => {
						setActiveThreadId("thread-dense-1");
					}}
				>
					Switch to another thread
				</button>
				<button
					type="button"
					onClick={() => {
						setConversationKind((current) => {
							if (current === "channel") {
								setActiveThreadId(null);
								return "dm";
							}
							return "channel";
						});
					}}
				>
					{conversationKind === "channel"
						? "Open direct message"
						: "Return to channel"}
				</button>
			</div>
			<CommonspaceConversation
				store={store}
				targetMessageId={targetMessageId}
				onTargetMessageHandled={() => {
					setTargetMessageId(null);
				}}
			/>
		</div>
	);
}

const channelThreadViewsBootstrap = structuredClone(denseStoryBootstrap);
for (const messages of Object.values(
	channelThreadViewsBootstrap.state.messages,
)) {
	for (const message of messages) delete message.routing;
}
channelThreadViewsBootstrap.liveActivities = [
	{
		id: "activity-channel-thread",
		sourceMessageId: "message-dense-root-1",
		agentId: "agent-hermes",
		agentName: "Review Bot",
		adapter: "hermes",
		conversation: channel,
		threadId: "thread-dense-1",
		startedAt: "2026-09-03T10:00:00.000Z",
		entries: [],
	},
];

export const ChannelConversation: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText(
				"Review the visual baseline and document the next component states.",
			),
		).toBeVisible();
		const routingTrigger = canvas.getByLabelText(
			"Routing details: Routed to Review Bot · AI selected · Completed",
		);
		await expect(routingTrigger).toBeVisible();
		await expect(routingTrigger).toHaveTextContent("AI to Review Bot");
		await userEvent.click(routingTrigger);
		const details = within(
			await within(document.body).findByRole("dialog", {
				name: "Routing details",
			}),
		);
		await expect(
			details.getByText(/Design review matches Hermes\./u),
		).toBeVisible();
		await expect(details.getByText(/Original message/u)).toBeVisible();
		await expect(details.getByText("AI selected")).toBeVisible();
		await expect(details.getByText(/· Completed/u)).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await waitFor(async () => {
			await expect(routingTrigger).toHaveFocus();
		});
	},
};

export const ThreadIdentityAndScope: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			interactive: true,
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const thread = within(
			canvas.getByRole("complementary", { name: "Thread replies" }),
		);
		await expect(
			thread.getByRole("heading", {
				name: "Review the visual baseline and document the next component states.",
			}),
		).toBeVisible();
		await expect(
			thread.getByRole("button", {
				name: "Show source message in #design-review",
			}),
		).toBeVisible();
		await expect(
			thread.getByText(/Review Bot · Session preserved/u),
		).toBeVisible();
		await expect(
			thread.getByRole("button", { name: "Open thread context" }),
		).toHaveTextContent("Context ready");

		const channelComposer = canvas.getByRole("form", {
			name: "Start a new Thread in design-review",
		});
		const threadComposer = thread.getByRole("form", {
			name: "Reply in active Thread",
		});
		await expect(channelComposer).toHaveAttribute(
			"data-composer-emphasis",
			"active",
		);
		await expect(threadComposer).toHaveAttribute(
			"data-composer-emphasis",
			"receded",
		);
		const channelInput = canvas.getByRole("textbox", {
			name: "Post in design-review",
		});
		const threadInput = thread.getByRole("textbox", {
			name: "Reply in thread",
		});
		await userEvent.click(threadInput);
		await userEvent.type(threadInput, "Keep this reply scoped");
		await expect(thread.getByText("Thread · Reply")).toBeVisible();
		await expect(channelComposer).toHaveAttribute(
			"data-composer-emphasis",
			"receded",
		);
		await expect(threadComposer).toHaveAttribute(
			"data-composer-emphasis",
			"active",
		);
		await userEvent.keyboard("{F6}");
		await expect(channelInput).toHaveFocus();
		await userEvent.type(channelInput, "Keep this post scoped");
		await expect(canvas.getByText("#design-review · New Thread")).toBeVisible();
		await userEvent.keyboard("{F6}");
		await expect(threadInput).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await userEvent.click(channelInput);
		await userEvent.keyboard("{Enter}");
		await userEvent.type(channelInput, "/retry{Enter}");
		await expect(
			canvas.getByRole("status", { name: "Command result" }),
		).toHaveTextContent("Keep this post scoped");
		await userEvent.type(threadInput, "/retry{Enter}");
		await expect(
			canvas.getByRole("status", { name: "Command result" }),
		).toHaveTextContent("Keep this reply scoped");

		await userEvent.click(
			thread.getByRole("button", { name: "Open thread context" }),
		);
		await expect(
			thread.getByText(/Agents use this shared context/u),
		).toBeVisible();
		await expect(
			thread.getByRole("button", { name: "Update Thread context summary" }),
		).toBeVisible();
		await expect(
			thread.getByRole("button", { name: "Reset changes" }),
		).toBeDisabled();
	},
};

const threadPinsBootstrap = structuredClone(storyBootstrap);
const threadPinSource = threadPinsBootstrap.state.messages[
	"channel:channel-design"
]?.find((message) => message.id === "message-root");
if (threadPinSource === undefined)
	throw new Error("Story root message is missing");
threadPinSource.files = [
	{
		id: "file-review-plan",
		name: "review-plan.md",
		mimeType: "text/markdown",
		size: 128,
	},
];
threadPinsBootstrap.state.pins.push(
	{
		id: "pin-channel-message",
		scope: { kind: "channel", id: "channel-design" },
		kind: "message",
		messageId: threadPinSource.id,
		createdAt: "2026-09-18T00:00:00.000Z",
		removedAt: null,
	},
	{
		id: "pin-thread-note",
		scope: { kind: "thread", id: "thread-review" },
		kind: "note",
		note: "Keep the release checklist visible.",
		createdAt: "2026-09-18T00:01:00.000Z",
		removedAt: null,
	},
	{
		id: "pin-thread-file",
		scope: { kind: "thread", id: "thread-review" },
		kind: "attachment",
		messageId: threadPinSource.id,
		attachmentId: "file-review-plan",
		createdAt: "2026-09-18T00:02:00.000Z",
		removedAt: null,
	},
);

export const ThreadPinSummaries: Story = {
	args: {
		store: createStoryStore(threadPinsBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const thread = within(
			canvas.getByRole("complementary", { name: "Thread replies" }),
		);
		await userEvent.click(
			thread.getByRole("button", { name: "Open thread context" }),
		);
		const pins = within(thread.getByRole("region", { name: "Thread pins" }));
		await expect(pins.getByText("3")).toBeVisible();
		await expect(pins.getByText("Channel")).toBeVisible();
		await expect(pins.getByText("Note")).toBeVisible();
		await expect(pins.getByText("File")).toBeVisible();
		await expect(
			pins.getByText(
				"Review the visual baseline and document the next component states.",
			),
		).toBeVisible();
		await expect(
			pins.getByText("Keep the release checklist visible."),
		).toBeVisible();
		await expect(pins.getByText("review-plan.md")).toBeVisible();
		await expect(
			pins.getAllByRole("button", { name: /Remove pin/u }),
		).toHaveLength(3);
	},
};

export const ComposerKeyboardNavigation: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const rootComposer = canvas.getByRole("textbox", {
			name: "Post in design-review",
		});
		await userEvent.type(rootComposer, "@");
		const rootOptions = within(
			await canvas.findByRole("listbox", { name: "Tag suggestions" }),
		).getAllByRole("option");
		const lastRootOption = rootOptions.at(-1);
		if (rootOptions.length < 2 || lastRootOption === undefined)
			throw new Error("Expected at least two root composer suggestions");
		await userEvent.keyboard("{ArrowUp}");
		await expect(rootComposer).toHaveAttribute(
			"aria-activedescendant",
			lastRootOption.id,
		);
		await userEvent.keyboard("{Tab}");
		await expect(rootComposer).toHaveValue("@build-smith ");
		await userEvent.clear(rootComposer);
		await userEvent.type(rootComposer, "/");
		await userEvent.keyboard("{Enter}");
		await expect(rootComposer).toHaveValue("/help");
		await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
		await expect(rootComposer).toHaveValue("/help\n");

		const thread = within(
			canvas.getByRole("complementary", { name: "Thread replies" }),
		);
		const threadComposer = thread.getByRole("textbox", {
			name: "Reply in thread",
		});
		await userEvent.type(threadComposer, "@");
		const threadOptions = within(
			await thread.findByRole("listbox", { name: "Tag suggestions" }),
		).getAllByRole("option");
		const secondThreadOption = threadOptions.at(1);
		if (secondThreadOption === undefined)
			throw new Error("Expected at least two thread composer suggestions");
		await userEvent.keyboard("{ArrowDown}");
		await expect(threadComposer).toHaveAttribute(
			"aria-activedescendant",
			secondThreadOption.id,
		);
		await userEvent.keyboard("{Enter}");
		await expect(threadComposer).toHaveValue("@build-smith ");
	},
};

const historicalRoutingBootstrap = structuredClone(storyBootstrap);
for (const messages of Object.values(
	historicalRoutingBootstrap.state.messages,
)) {
	for (const message of messages) {
		const delivery = message.routing?.assignments[0];
		if (delivery !== undefined)
			delivery.legacySubRequest = "Inspect only the desktop UI boundary.";
	}
}

export const HistoricalRouting: Story = {
	args: {
		store: createStoryStore(historicalRoutingBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByLabelText(
				"Routing details: Routed to Review Bot · AI selected · Completed",
			),
		);
		await expect(
			within(document.body).getByText(
				/Historical request: Inspect only the desktop UI boundary\./u,
			),
		).toBeVisible();
	},
};

export const ChannelThreadViews: Story = {
	args: {
		store: createStoryStore(channelThreadViewsBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const followedThread =
			"Review the visual baseline and document the next component states.";
		const runningThread =
			"Audit the responsive workspace shell and record any clipping or focus issues.";
		const otherThread =
			"Compare the dense Inbox and Threads layouts against the current visual contract.";

		await userEvent.click(
			canvas.getByRole("button", { name: "Channel thread view" }),
		);
		await userEvent.click(
			await within(document.body).findByRole("menuitemradio", {
				name: "Show running threads",
			}),
		);
		await waitFor(() =>
			expect(within(document.body).queryByRole("menu")).not.toBeInTheDocument(),
		);
		await expect(canvas.getByText(runningThread)).toBeVisible();
		await expect(canvas.queryByText(followedThread)).not.toBeInTheDocument();
		await expect(canvas.queryByText(otherThread)).not.toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Channel thread view" }),
		);
		await userEvent.click(
			await within(document.body).findByRole("menuitemradio", {
				name: "Show followed threads",
			}),
		);
		await waitFor(() =>
			expect(within(document.body).queryByRole("menu")).not.toBeInTheDocument(),
		);
		await expect(canvas.getByText(followedThread)).toBeVisible();
		await expect(canvas.queryByText(runningThread)).not.toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Channel thread view" }),
		);
		await userEvent.click(
			await within(document.body).findByRole("menuitemradio", {
				name: "Show all threads",
			}),
		);
		await waitFor(() =>
			expect(within(document.body).queryByRole("menu")).not.toBeInTheDocument(),
		);
		await expect(canvas.getByText(runningThread)).toBeVisible();
		await expect(canvas.getByText(followedThread)).toBeVisible();
		await expect(canvas.getByText(otherThread)).toBeVisible();
	},
};

const cancelledRoutingBootstrap = structuredClone(storyBootstrap);
const cancelledRoutingMessage =
	cancelledRoutingBootstrap.state.messages["channel:channel-design"]?.[0];
if (cancelledRoutingMessage !== undefined) {
	cancelledRoutingMessage.replyStatus = "cancelled";
	cancelledRoutingMessage.replyError =
		"No destination agent was available for this routing attempt.";
	cancelledRoutingMessage.routing = {
		source: "explicit",
		status: "resolved",
		startedAt: "2026-09-03T09:58:00.000Z",
		agentIds: [],
		assignments: [],
		corrections: [],
		inferredProjectIds: [],
		reason: "The explicit destination could not be resolved.",
	};
}

export const CancelledRoutingOutcome: Story = {
	args: {
		store: createStoryStore(cancelledRoutingBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const receipt = canvas.getByText("Routing cancelled · No agent selected");
		await expect(receipt).toBeVisible();
		await userEvent.click(receipt);
		await expect(
			within(document.body).getByText(
				"No destination agent was available for this routing attempt.",
			),
		).toBeVisible();
	},
};

const recoveredRoutingBootstrap = structuredClone(storyBootstrap);
const recoveredMessages =
	recoveredRoutingBootstrap.state.messages["channel:channel-design"] ?? [];
const recoveredSource = recoveredMessages.find(
	(message) => message.id === "message-root",
);
if (recoveredSource?.routing !== undefined) {
	recoveredSource.routing.assignments.unshift({
		id: "failed-assignment",
		agentId: hermesAgent.id,
		projectIds: [],
	});
	recoveredSource.routing.corrections.push({
		id: "recovery",
		fromAssignmentId: "failed-assignment",
		toAssignmentId: "assignment-design-review",
		createdAt: "2026-09-03T09:59:00.000Z",
	});
	recoveredMessages.push({
		id: "failed-attempt",
		threadId: "thread-review",
		parentMessageId: "message-root",
		conversation: channel,
		authorType: "system",
		authorId: "system",
		authorName: "Commonspace",
		text: "The earlier run failed: runtime unavailable.",
		createdAt: "2026-09-03T09:58:30.000Z",
		sourceMessageId: "message-root",
		routingAssignmentId: "failed-assignment",
		replyStatus: "failed",
	});
}
export const RecoveredRoutingOutcome: Story = {
	args: {
		store: createStoryStore(recoveredRoutingBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(
			within(canvasElement).getByRole("log", { name: "Thread messages" }),
		);
		await expect(
			canvas.getByLabelText(
				"Routing details: Routed to Review Bot · manually corrected · Completed",
			),
		).toBeVisible();
		await expect(
			canvas.getByText("The earlier run failed: runtime unavailable."),
		).toBeVisible();
	},
};

const pendingRoutingBootstrap = structuredClone(storyBootstrap);
const pendingRoutingMessage =
	pendingRoutingBootstrap.state.messages["channel:channel-design"]?.[0];
if (pendingRoutingMessage !== undefined) {
	delete pendingRoutingMessage.replyStatus;
	pendingRoutingMessage.routing = {
		source: "ai",
		status: "pending",
		startedAt: "2026-09-03T09:58:00.000Z",
		agentIds: [],
		assignments: [],
		corrections: [],
		inferredProjectIds: [],
		reason: "Selecting an agent.",
	};
}
pendingRoutingBootstrap.state.messages["channel:channel-design"] =
	pendingRoutingMessage === undefined ? [] : [pendingRoutingMessage];
export const PendingRoutingOutcome: Story = {
	args: {
		store: createStoryStore(pendingRoutingBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Selecting an agent…")).toBeVisible();
		await expect(
			canvas.queryByText(/Routed to|AI selected/),
		).not.toBeInTheDocument();
	},
};

const failedRoutingBootstrap = structuredClone(storyBootstrap);
const failedRoutingMessage =
	failedRoutingBootstrap.state.messages["channel:channel-design"]?.[0];
if (failedRoutingMessage !== undefined) {
	failedRoutingMessage.routing = {
		source: "ai",
		status: "failed",
		startedAt: "2026-09-03T09:58:00.000Z",
		resolvedAt: "2026-09-03T09:58:29.810Z",
		durationMs: 29_810,
		agentIds: [],
		assignments: [],
		corrections: [],
		inferredProjectIds: [],
		reason: "Routing response did not match the required shape.",
	};
}
failedRoutingBootstrap.state.messages["channel:channel-design"] =
	failedRoutingMessage === undefined ? [] : [failedRoutingMessage];
const retryRouting = fn(async () => undefined);
const failedRoutingStore = createStoryStore(failedRoutingBootstrap, {
	activeConversation: channel,
	activeProjectId: primaryProject.id,
	retryRouting,
});

export const FailedRoutingRecovery: Story = {
	args: { store: failedRoutingStore },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByText("Routing failed · No agent selected"),
		);
		await userEvent.click(
			within(document.body).getByRole("button", {
				name: "Retry agent routing",
			}),
		);
		await expect(retryRouting).toHaveBeenCalledWith({
			sourceMessageId: "message-root",
			mode: "ai",
		});

		await userEvent.selectOptions(
			within(document.body).getByLabelText("Manual routing agent"),
			hermesAgent.id,
		);
		await userEvent.click(
			within(document.body).getByRole("button", { name: "Route" }),
		);
		await expect(retryRouting).toHaveBeenLastCalledWith({
			sourceMessageId: "message-root",
			mode: "manual",
			agentId: hermesAgent.id,
		});
	},
};

export const FocusClearsOnThreadChange: Story = {
	args: {
		store: createStoryStore(denseStoryBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	render: () => <FocusTransitionPreview />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const switchThread = canvas.getByRole("button", {
			name: "Switch to another thread",
		});
		await expect(switchThread).toBeEnabled();
		await expect(
			canvasElement.querySelector("#commonspace-message-message-root"),
		).toHaveAttribute("aria-current", "true");

		await userEvent.click(switchThread);

		await expect(
			canvasElement.querySelector("#commonspace-message-message-dense-root-1"),
		).toHaveAttribute("aria-current", "true");
		await expect(
			canvasElement.querySelector("#commonspace-message-message-root"),
		).not.toHaveAttribute("aria-current");
	},
};

export const FocusClearsOnConversationChange: Story = {
	args: {
		store: createStoryStore(denseStoryBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	render: () => <FocusTransitionPreview />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Switch to another thread" }),
		).toBeEnabled();
		await expect(
			canvasElement.querySelector("#commonspace-message-message-root"),
		).toHaveAttribute("aria-current", "true");

		await userEvent.click(
			canvas.getByRole("button", { name: "Open direct message" }),
		);
		await expect(
			canvas.getByRole("textbox", { name: "Message Review Bot" }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "Return to channel" }),
		);

		await expect(
			canvasElement.querySelector("#commonspace-message-message-root"),
		).not.toHaveAttribute("aria-current");
	},
};

export const DirectMessage: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByText(
				/Hermes · gpt-5\.6-sol · Session preserved/u,
			),
		).toBeVisible();
	},
};

export const PendingAdmissionRecovery: Story = {
	args: {
		store: createStoryStore(runtimeStoryBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
			pendingSubmissions: [
				{
					id: "submission-admitting",
					conversation: directMessage,
					text: "Queue this while the current run continues.",
					attachments: [],
					files: [],
					delivery: "queue",
					createdAt: "2026-09-03T10:00:10.000Z",
					status: "admitting",
				},
				{
					id: "submission-failed",
					conversation: directMessage,
					text: "Restore this failed direction.",
					attachments: [],
					files: [],
					delivery: "steer",
					createdAt: "2026-09-03T10:00:11.000Z",
					status: "failed",
					error: "Connection closed before admission",
				},
			],
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const composer = canvas.getByRole("textbox", {
			name: "Message Review Bot",
		});
		await expect(composer).toBeEnabled();
		await expect(canvas.getByText("Admitting · Queued")).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Restore" }));
		await expect(composer).toHaveValue("Restore this failed direction.");
		await expect(canvas.getByRole("button", { name: "Queue" })).toBeEnabled();
	},
};

const activeRunSend = fn<CommonspaceStore["send"]>();
const activeRunBaseStore = createStoryStore(runtimeStoryBootstrap, {
	activeConversation: directMessage,
	activeProjectId: primaryProject.id,
	send: activeRunSend,
});

export const NarrowActiveRunComposer: Story = {
	args: { store: activeRunBaseStore },
	decorators: [
		(Story) => (
			<div className="h-[720px] w-[320px] overflow-hidden border">
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		activeRunSend.mockClear();
		const canvas = within(canvasElement);
		const composer = canvas.getByRole("textbox", {
			name: "Message Review Bot",
		});
		await userEvent.type(composer, "Use the new direction instead.");
		await userEvent.click(
			canvas.getByRole("button", { name: "Interrupt and send" }),
		);
		await expect(activeRunSend).toHaveBeenNthCalledWith(1, {
			text: "Use the new direction instead.",
			attachments: [],
			delivery: "stop-and-send",
			files: [],
		});

		await userEvent.type(composer, "Wait for the current run.");
		await userEvent.click(canvas.getByRole("button", { name: "Queue" }));
		await expect(activeRunSend).toHaveBeenNthCalledWith(2, {
			text: "Wait for the current run.",
			attachments: [],
			delivery: "queue",
			files: [],
		});

		await expect(
			canvas.queryByRole("button", { name: "Steer" }),
		).not.toBeInTheDocument();
		await userEvent.type(composer, "Queue from the keyboard.");
		fireEvent.keyDown(composer, { key: "Enter", metaKey: true });
		fireEvent.keyUp(composer, { key: "Enter", metaKey: true });
		await expect(activeRunSend).toHaveBeenNthCalledWith(3, {
			text: "Queue from the keyboard.",
			attachments: [],
			delivery: "queue",
			files: [],
		});
	},
};

export const FocusedReply: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
		targetMessageId: "message-reply",
		onTargetMessageHandled: fn(),
	},
	play: async ({ canvasElement }) => {
		await waitFor(() =>
			expect(
				canvasElement.querySelector("#commonspace-message-message-reply"),
			).not.toBeNull(),
		);
		const target = canvasElement.querySelector<HTMLElement>(
			"#commonspace-message-message-reply",
		);
		if (target === null) throw new Error("Expected the focused reply message.");
		await waitFor(() => expect(target).toHaveFocus());
		await expect(target).toHaveAttribute("aria-current", "true");
	},
};

export const ChannelSettings: StoryObj<typeof ChannelSettingsPreview> = {
	render: () => <ChannelSettingsPreview />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const settings = await canvas.findByRole("complementary", {
			name: "Channel settings",
		});
		await expect(settings).toBeVisible();
		const resizer = canvas.queryByRole("separator", {
			name: "Resize settings",
		});
		if (resizer === null) {
			return;
		}
		const initial = Number(resizer.getAttribute("aria-valuenow"));
		resizer.focus();
		await userEvent.keyboard("{ArrowLeft}");
		await expect(resizer).toHaveAttribute(
			"aria-valuenow",
			String(
				Math.min(
					COMMONSPACE_RESIZABLE_PANEL.max,
					initial + COMMONSPACE_RESIZABLE_PANEL.step,
				),
			),
		);
		const resizedWidth = await resizer.getAttribute("aria-valuenow");
		await userEvent.click(
			canvas.getByRole("button", { name: "Close channel settings" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "1 reply, 1 unread" }),
		);
		const threadResizer = await canvas.findByRole("separator", {
			name: "Resize thread",
		});
		await expect(threadResizer).toHaveAttribute(
			"aria-valuenow",
			resizedWidth ?? String(COMMONSPACE_RESIZABLE_PANEL.defaultValue),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Close thread" }));
		await userEvent.click(
			canvas.getByRole("button", { name: "Open channel settings" }),
		);
		const reopenedSettingsResizer = await canvas.findByRole("separator", {
			name: "Resize settings",
		});
		await expect(reopenedSettingsResizer).toHaveAttribute(
			"aria-valuenow",
			resizedWidth ?? String(COMMONSPACE_RESIZABLE_PANEL.defaultValue),
		);
		await userEvent.dblClick(reopenedSettingsResizer);
		await expect(reopenedSettingsResizer).toHaveAttribute(
			"aria-valuenow",
			String(COMMONSPACE_RESIZABLE_PANEL.defaultValue),
		);
	},
};

export const AgentSettings: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
		settingsRequest: { kind: "agent", id: "agent-hermes", token: 1 },
	},
};

export const EditingDeliveredMessage: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const actions = canvas.getByRole("button", {
			name: "More actions for message from You",
		});
		actions.focus();
		await userEvent.click(actions);
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole("menuitem", {
				name: "Edit message",
			}),
		);
		await expect(
			canvas.getByRole("form", { name: "Edit delivered message" }),
		).toBeVisible();
		await waitFor(() =>
			expect(
				canvas.getByRole("textbox", { name: "Edited message" }),
			).toHaveFocus(),
		);
		await waitFor(() =>
			expect(
				canvasElement.ownerDocument.querySelector(
					'[data-slot="dropdown-menu-content"]',
				),
			).toBeNull(),
		);
		await expect(
			canvas.getByRole("textbox", { name: "Edited message" }),
		).toHaveValue(
			"Review the visual baseline and document the next component states.",
		);
	},
};
