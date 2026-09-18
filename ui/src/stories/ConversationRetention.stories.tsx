import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ConversationRetention } from "../ConversationRetention";
import { buildChannel, codexAgent, designChannel } from "./story-fixtures";

const meta = {
	title: "Patterns/ConversationRetention",
	component: ConversationRetention,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[720px] max-w-full bg-background p-6 text-foreground">
				<Story />
			</div>
		),
	],
	args: {
		channels: [buildChannel, designChannel],
		agents: [codexAgent],
		store: {
			previewRetention: fn(async (conversation) => ({
				revision: 42,
				conversation,
				messages: 17,
				threads: 5,
				attachments: 3,
				pins: 2,
				permissions: 1,
			})),
			applyRetention: fn(async () => undefined),
		},
	},
} satisfies Meta<typeof ConversationRetention>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SettingsRow: Story = {};

export const ReviewDeletion: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Choose conversation…",
			}),
		);
		const page = within(document.body);
		await userEvent.selectOptions(
			page.getByRole("combobox", { name: "Conversation" }),
			`channel:${buildChannel.id}`,
		);
		await userEvent.click(
			page.getByRole("button", { name: "Review deletion" }),
		);
		await expect(
			await page.findByRole("region", { name: "Deletion preview" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Delete history permanently" }),
		).toBeEnabled();
	},
};

export const PreviewUnavailable: Story = {
	args: {
		store: {
			previewRetention: fn(async () => {
				throw new Error(
					"This conversation has an active agent. Wait for it to finish and try again.",
				);
			}),
			applyRetention: fn(async () => undefined),
		},
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Choose conversation…",
			}),
		);
		const page = within(document.body);
		await userEvent.selectOptions(
			page.getByRole("combobox", { name: "Conversation" }),
			`channel:${buildChannel.id}`,
		);
		await userEvent.click(
			page.getByRole("button", { name: "Review deletion" }),
		);
		await expect(await page.findByRole("alert")).toHaveTextContent(
			"active agent",
		);
		await expect(
			page.queryByRole("button", { name: "Delete history permanently" }),
		).not.toBeInTheDocument();
	},
};
