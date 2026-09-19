import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommonspaceInbox } from "../CommonspaceInbox";
import {
	createStoryStore,
	emptyBootstrap,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceInbox",
	component: CommonspaceInbox,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
	args: {
		store: createStoryStore(storyBootstrap),
		onOpenItem: fn(),
	},
} satisfies Meta<typeof CommonspaceInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Attention: Story = {};

export const AgentIdentityAcrossViews: Story = {
	tags: ["smoke"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Activity/u }));
		const reply = canvas.getAllByRole("button", {
			name: /from Review Bot in/u,
		})[0];
		if (reply === undefined) throw new Error("Expected Review Bot activity");
		await expect(within(reply).getByText("🔎")).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: /^Sessions/u }));
		const session = canvas.getAllByRole("button", {
			name: /session for Review Bot in/u,
		})[0];
		if (session === undefined) throw new Error("Expected Review Bot session");
		await expect(within(session).getByText("🔎")).toBeVisible();
	},
};

export const Sessions: Story = {
	args: { viewRequest: { view: "sessions", token: 1 } },
};

export const Empty: Story = {
	args: {
		store: createStoryStore(emptyBootstrap),
	},
};

export const Loading: Story = {
	args: {
		store: createStoryStore(null, { loading: true }),
	},
};
