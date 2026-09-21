import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommonspaceThreads } from "../CommonspaceThreads";
import {
	createStoryStore,
	emptyBootstrap,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceThreads",
	component: CommonspaceThreads,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
	args: {
		bootstrap: storyBootstrap,
		store: createStoryStore(storyBootstrap),
		onOpenThread: fn(),
	},
} satisfies Meta<typeof CommonspaceThreads>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllThreads: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const unread = canvas.getByRole("button", { name: "Unread 1" });
		const following = canvas.getByRole("button", { name: "Following" });

		await userEvent.click(unread);
		await expect(unread).toHaveAttribute("aria-pressed", "true");
		await expect(
			canvas.getByRole("button", { name: /Open thread .+, unread/ }),
		).toBeVisible();

		await userEvent.click(following);
		await expect(following).toHaveAttribute("aria-pressed", "true");
		await expect(
			canvas.getByRole("button", { name: /Open thread .+, unread/ }),
		).toBeVisible();

		await userEvent.click(canvas.getByRole("button", { name: "All" }));
		await expect(canvas.getByRole("button", { name: "All" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	},
};
export const Empty: Story = {
	args: {
		bootstrap: emptyBootstrap,
		store: createStoryStore(emptyBootstrap),
	},
};

export const Loading: Story = {
	args: { bootstrap: null, store: createStoryStore(null, { loading: true }) },
};
