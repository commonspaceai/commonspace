import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import {
	PendingAdmissions,
	QueuedFollowups,
	RunDeliveryControls,
} from "../design-system/RunDelivery";
import { runtimeStoryBootstrap } from "./story-fixtures";

const followups = runtimeStoryBootstrap.queuedFollowups ?? [];
const meta = {
	title: "Design System/RunDelivery",
	component: QueuedFollowups,
	parameters: { layout: "centered" },
	args: { followups, onMove: fn(), onRemove: fn() },
	decorators: [
		(Story) => (
			<div className="w-[640px] max-w-full">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof QueuedFollowups>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QueuedMessages: Story = {};
export const CompactThread: Story = {
	args: { thread: true },
	render: (args) => (
		<div className="w-[336px]">
			<QueuedFollowups {...args} />
			<div className="mt-3 flex">
				<RunDeliveryControls thread disabled={false} />
			</div>
		</div>
	),
};
export const LongMessage: Story = {
	args: {
		followups: followups.map((followup, index) => ({
			...followup,
			text:
				index === 0
					? "Review the conversation layout, check the keyboard flow, and record any remaining issues.\n\nKeep the project context and current agent session intact. Then verify the full desktop flow in light and dark appearances before wrapping up."
					: followup.text,
		})),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Expand queued follow-up 1" }),
		);
		await expect(
			canvas.getByRole("button", { name: "Collapse queued follow-up 1" }),
		).toHaveAttribute("aria-expanded", "true");
	},
};
export const AttachmentOnly: Story = {
	args: { followups: followups.map((followup) => ({ ...followup, text: "" })) },
};
export const StopAndSend: Story = {
	args: {
		followups: followups.map((followup) => ({
			...followup,
			delivery: "stop-and-send",
		})),
	},
};
export const DeliveryActions: Story = {
	render: () => (
		<div className="flex">
			<RunDeliveryControls disabled={false} steeringAvailable onStop={fn()} />
		</div>
	),
};
export const DisabledActions: Story = {
	render: () => (
		<div className="flex">
			<RunDeliveryControls disabled />
		</div>
	),
};
export const ThreadInterruptionSafety: Story = {
	render: () => (
		<div className="flex">
			<RunDeliveryControls thread disabled={false} />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Queue" })).toBeEnabled();
		await expect(
			canvas.queryByRole("button", { name: "Steer" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", {
				name: "Interrupt and send thread follow-up",
			}),
		).not.toBeInTheDocument();
	},
};
export const QueueActions: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const rows = canvas.getAllByRole("listitem");
		const firstRow = rows[0];
		if (firstRow === undefined) throw new Error("Queued message is missing");
		const first = within(firstRow);
		await expect(
			first.getByRole("button", { name: "Move queued follow-up up" }),
		).toBeDisabled();
		await userEvent.click(
			first.getByRole("button", { name: "Move queued follow-up down" }),
		);
		await expect(args.onMove).toHaveBeenCalledWith(
			"followup-responsive",
			"down",
		);
		await userEvent.click(
			first.getByRole("button", { name: "Remove queued follow-up" }),
		);
		await expect(args.onRemove).toHaveBeenCalledWith("followup-responsive");
	},
};

export const KeyboardQueueUpdates: Story = {
	render: (args) => {
		const [items, setItems] = useState(args.followups);
		return (
			<QueuedFollowups
				{...args}
				followups={items}
				onMove={() => setItems((current) => [...current].reverse())}
				onRemove={(id) =>
					setItems((current) => current.filter((item) => item.messageId !== id))
				}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const firstRow = canvas.getAllByRole("listitem")[0];
		if (firstRow === undefined) throw new Error("Missing first follow-up");
		const first = within(firstRow);
		first.getByRole("button", { name: "Move queued follow-up down" }).focus();
		await userEvent.keyboard("{Enter}");
		await expect(
			canvas.getByRole("button", { name: "Expand queued follow-up 2" }),
		).toHaveFocus();
		const lastRow = canvas.getAllByRole("listitem")[1];
		if (lastRow === undefined) throw new Error("Missing last follow-up");
		const last = within(lastRow);
		last.getByRole("button", { name: "Remove queued follow-up" }).focus();
		await userEvent.keyboard("{Enter}");
		await expect(
			canvas.getByRole("button", { name: "Expand queued follow-up 1" }),
		).toHaveFocus();
	},
};

const restoreAdmission = fn();
const dismissAdmission = fn();

export const OptimisticAdmissions: Story = {
	render: () => (
		<PendingAdmissions
			items={[
				{
					id: "admitting-message",
					text: "Check the focused message flow next.",
					status: "admitting",
					delivery: "queue",
				},
				{
					id: "failed-message",
					text: "Preserve this draft and its attachment.",
					status: "failed",
					delivery: "steer",
					error: "Connection closed before admission",
					attachmentCount: 1,
				},
			]}
			onRestore={restoreAdmission}
			onDismiss={dismissAdmission}
		/>
	),
	play: async ({ canvasElement }) => {
		restoreAdmission.mockClear();
		dismissAdmission.mockClear();
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Admitting · Queued")).toBeVisible();
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Send failed · Connection closed before admission",
		);
		await userEvent.click(canvas.getByRole("button", { name: "Restore" }));
		await expect(restoreAdmission).toHaveBeenCalledWith("failed-message");
		await userEvent.click(
			canvas.getByRole("button", { name: "Dismiss failed message" }),
		);
		await expect(dismissAdmission).toHaveBeenCalledWith("failed-message");
	},
};
