import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MessageActionMenu } from "../design-system/MessageActionMenu";

const meta = {
	title: "Design System/MessageActionMenu",
	component: MessageActionMenu,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="group/message flex w-[560px] items-center justify-between gap-4 rounded-md border bg-background p-3 text-foreground">
				<div className="min-w-0">
					<strong className="block text-[13px] font-medium">Ralph</strong>
					<p className="truncate text-xs text-muted-foreground">
						Please review the current visual baseline.
					</p>
				</div>
				<Story />
			</div>
		),
	],
	args: {
		authorName: "Ralph",
		summary: "Please review the current visual baseline.",
		saved: false,
		onToggleSaved: fn(),
		onPin: fn(),
		onMarkUnread: fn(),
		onCopyLink: fn(),
	},
} satisfies Meta<typeof MessageActionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rest: Story = {
	args: { onReplyInThread: fn() },
};

export const Saved: Story = {
	args: { saved: true, onReplyInThread: fn() },
};

export const OpenMenu: Story = {
	args: { defaultOpen: true, onReplyInThread: fn() },
};

export const AttachmentOnly: Story = {
	args: {
		authorName: "Design Critic",
		summary: "",
	},
};

export const Pinned: Story = {
	args: { defaultOpen: true, pinned: true },
};
