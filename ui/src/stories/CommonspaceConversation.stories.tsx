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
		await expect(
			canvas.getByText("Routed to Review Bot · AI selected · Completed"),
		).toBeVisible();
		await userEvent.click(
			canvas.getByText("Routed to Review Bot · AI selected · Completed"),
		);
		await expect(
			canvas.getByText(/Design review matches Hermes\./u),
		).toBeVisible();
		await expect(
			canvas.getByText(/Inspect only the desktop UI boundary\./u),
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
			canvas.getByRole("button", { name: "Show running threads" }),
		);
		await expect(canvas.getByText(runningThread)).toBeVisible();
		await expect(canvas.queryByText(followedThread)).not.toBeInTheDocument();
		await expect(canvas.queryByText(otherThread)).not.toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Show followed threads" }),
		);
		await expect(canvas.getByText(followedThread)).toBeVisible();
		await expect(canvas.queryByText(runningThread)).not.toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Show all threads" }),
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
		const receipt = canvas.getByText(
			"Routed to No agent selected · explicit mention · Cancelled",
		);
		await expect(receipt).toBeVisible();
		await userEvent.click(receipt);
		await expect(
			canvas.getByText(
				"No destination agent was available for this routing attempt.",
			),
		).toBeVisible();
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
			canvas.getByText("Routed to No agent selected · AI selected · Failed"),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Retry AI routing" }),
		);
		await expect(retryRouting).toHaveBeenCalledWith({
			sourceMessageId: "message-root",
			mode: "ai",
		});

		await userEvent.selectOptions(
			canvas.getByLabelText("Manual routing agent"),
			hermesAgent.id,
		);
		await userEvent.click(canvas.getByRole("button", { name: "Route" }));
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
		await expect(activeRunSend).toHaveBeenNthCalledWith(
			1,
			"Use the new direction instead.",
			undefined,
			[],
			"stop-and-send",
		);

		await userEvent.type(composer, "Wait for the current run.");
		await userEvent.click(canvas.getByRole("button", { name: "Queue" }));
		await expect(activeRunSend).toHaveBeenNthCalledWith(
			2,
			"Wait for the current run.",
			undefined,
			[],
			"queue",
		);

		await expect(
			canvas.queryByRole("button", { name: "Steer" }),
		).not.toBeInTheDocument();
		await userEvent.type(composer, "Queue from the keyboard.");
		fireEvent.keyDown(composer, { key: "Enter", metaKey: true });
		fireEvent.keyUp(composer, { key: "Enter", metaKey: true });
		await expect(activeRunSend).toHaveBeenNthCalledWith(
			3,
			"Queue from the keyboard.",
			undefined,
			[],
			"queue",
		);
	},
};

export const FocusedReply: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
		targetMessageId: "message-reply",
		onTargetMessageHandled: fn(),
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
		const editButton = canvas.getByRole("button", {
			name: "Edit message from Ralph",
		});
		editButton.focus();
		await waitFor(() => expect(editButton).toBeVisible());
		await userEvent.click(editButton);
		await expect(
			canvas.getByRole("form", { name: "Edit delivered message" }),
		).toBeVisible();
		await expect(
			canvas.getByRole("textbox", { name: "Edited message" }),
		).toHaveValue(
			"Review the visual baseline and document the next component states.",
		);
	},
};
