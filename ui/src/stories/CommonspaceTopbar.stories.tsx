import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommonspaceTopbar } from "../CommonspaceTopbar";

const meta = {
	title: "Pages/CommonspaceTopbar",
	component: CommonspaceTopbar,
	parameters: { layout: "fullscreen" },
	args: { onOpenSearch: fn() },
} satisfies Meta<typeof CommonspaceTopbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const HelpOpen: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Help and shortcuts" }),
		);
		const help = page.getByRole("dialog", { name: "Work stays connected" });
		await expect(help).toBeVisible();
		await expect(within(help).getByText("Work stays connected")).toBeVisible();
		await expect(within(help).getByText("F6")).toBeVisible();
	},
};
export const NarrowViewport: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
};
