import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CollectionActionMenu } from "../design-system/CollectionActionMenu";

const meta = {
	title: "Design System/CollectionActionMenu",
	component: CollectionActionMenu,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="group flex w-[420px] items-center justify-between rounded-sm border bg-sidebar p-2 text-sidebar-foreground">
				<div className="grid min-w-0 gap-0.5">
					<strong className="truncate text-[13px] font-medium">
						verification
					</strong>
					<span className="font-mono text-xs text-muted-foreground">
						2 agents
					</span>
				</div>
				<Story />
			</div>
		),
	],
	args: {
		kind: "channel",
		label: "verification",
		meta: "2 agents",
		onOpen: fn(),
		onTogglePinned: fn(),
		onSettings: fn(),
		onMarkUnread: fn(),
		onCopy: fn(),
		copyLabel: "Copy channel name",
		onRemove: fn(),
	},
} satisfies Meta<typeof CollectionActionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rest: Story = {};

export const Pinned: Story = {
	args: { pinned: true },
};

export const OpenMenu: Story = {
	render: (args) => (
		<div className="[&_[data-slot=dropdown-menu-trigger]]:opacity-100">
			<CollectionActionMenu {...args} />
		</div>
	),
	args: { defaultOpen: true },
	play: async () => {
		const menu = within(document.body).getByRole("menu");
		const labels = within(menu)
			.getAllByRole("menuitem")
			.map(
				(item) =>
					item.querySelector("strong")?.textContent ?? item.textContent?.trim(),
			);
		await expect(labels).toEqual([
			"Open channel",
			"Mark unread",
			"Pin to sidebar",
			"Copy channel name",
			"Channel settings",
			"Remove channel",
		]);
	},
};

export const AgentOpenMenu: Story = {
	render: (args) => (
		<div className="[&_[data-slot=dropdown-menu-trigger]]:opacity-100">
			<CollectionActionMenu {...args} />
		</div>
	),
	args: {
		defaultOpen: true,
		kind: "agent",
		label: "Review Bot",
		meta: "Claude Code · Opus",
		mentionLabel: "Mention @review-bot",
		onStartFreshChat: fn(),
		onMention: fn(),
		onViewSessions: fn(),
		copyLabel: "Copy agent mention",
	},
	play: async ({ args }) => {
		const page = within(document.body);
		const menu = page.getByRole("menu");
		const labels = within(menu)
			.getAllByRole("menuitem")
			.map(
				(item) =>
					item.querySelector("strong")?.textContent ?? item.textContent?.trim(),
			);
		await expect(labels).toEqual([
			"Message agent",
			"Start fresh chat",
			"Mention @review-bot",
			"View sessions",
			"Pin to sidebar",
			"Copy agent mention",
			"Profile & capabilities",
			"Remove from Commonspace",
		]);

		await userEvent.click(
			within(menu).getByRole("menuitem", { name: /Start fresh chat/u }),
		);
		const dialog = within(
			await page.findByRole("alertdialog", {
				name: "Start a new chat with Review Bot?",
			}),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Start fresh" }));
		await expect(args.onStartFreshChat).toHaveBeenCalledOnce();
	},
};

export const LongMetadata: Story = {
	args: {
		label: "verification-with-a-long-channel-name",
		meta: "12 agents · local workspace · active review",
	},
};
