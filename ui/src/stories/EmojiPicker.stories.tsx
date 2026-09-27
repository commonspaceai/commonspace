import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { EmojiPicker } from "../design-system/EmojiPicker";

function PickerStory() {
	const [emoji, setEmoji] = useState("");
	return (
		<div className="w-[360px] p-6">
			<p className="mb-2 text-xs font-semibold">Channel emoji</p>
			<EmojiPicker
				value={emoji}
				label="Choose channel emoji"
				onChange={setEmoji}
			/>
		</div>
	);
}

const meta = {
	title: "Design System/EmojiPicker",
	component: EmojiPicker,
	parameters: { layout: "fullscreen" },
	args: { value: "", label: "Choose channel emoji", onChange: fn() },
	render: () => <PickerStory />,
} satisfies Meta<typeof EmojiPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenPicker: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		const dialogElement = await page.findByRole("dialog", {
			name: "Choose emoji",
		});
		const dialog = within(dialogElement);
		await waitFor(() => expect(dialogElement).toBeVisible());
		await expect(
			dialog.getByRole("button", { name: "All emojis" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(await dialog.findByText("1914 emojis")).toBeVisible();
		await expect(
			await dialog.findByRole("button", { name: "grinning face" }),
		).toBeVisible();
		const emojiButtons = Array.from(
			dialogElement.querySelectorAll<HTMLButtonElement>(
				"button[data-emoji-index]",
			),
		);
		await expect(
			emojiButtons.filter((button) => button.tabIndex === 0),
		).toHaveLength(1);
		emojiButtons[0]?.focus();
		await userEvent.keyboard("{ArrowRight}{ArrowDown}");
		await expect(emojiButtons[10]).toHaveFocus();
		await userEvent.keyboard("{End}");
		await expect(emojiButtons.at(-1)).toHaveFocus();
		await userEvent.click(
			dialog.getByRole("button", { name: "Smileys & people" }),
		);
		await expect(emojiButtons[0]?.parentElement?.parentElement?.scrollTop).toBe(
			0,
		);
		await expect(await dialog.findByText("559 emojis")).toBeVisible();
	},
};

export const SearchAndSelect: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Choose emoji" }),
		);
		const search = dialog.getByRole("searchbox", { name: "Search emojis" });
		await userEvent.type(search, "distorted face");
		await expect(
			await dialog.findByRole("button", { name: "distorted face" }),
		).toHaveTextContent("🫪");
		await userEvent.clear(search);
		await userEvent.type(search, "rocket");
		await userEvent.click(
			await dialog.findByRole("button", { name: "rocket" }),
		);
		await expect(
			page.getByRole("button", { name: "Choose channel emoji" }),
		).toHaveTextContent("🚀");
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		await userEvent.click(
			within(page.getByRole("dialog", { name: "Choose emoji" })).getByRole(
				"button",
				{ name: "Use default icon" },
			),
		);
		await expect(
			page.getByRole("button", { name: "Choose channel emoji" }),
		).toHaveTextContent("Choose emoji");
	},
};

export const SkinTone: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Choose emoji" }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Skin tone: Default" }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Dark skin tone" }),
		);
		await userEvent.type(
			dialog.getByRole("searchbox", { name: "Search emojis" }),
			"thumbs up",
		);
		await userEvent.click(
			await dialog.findByRole("button", {
				name: "thumbs up: dark skin tone",
			}),
		);
		await expect(
			page.getByRole("button", { name: "Choose channel emoji" }),
		).toHaveTextContent("👍🏿");
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		const reopenedDialog = within(
			page.getByRole("dialog", { name: "Choose emoji" }),
		);
		await userEvent.click(
			reopenedDialog.getByRole("button", { name: "Skin tone: Dark" }),
		);
		await userEvent.click(
			reopenedDialog.getByRole("button", { name: "Light skin tone" }),
		);
		await userEvent.type(
			reopenedDialog.getByRole("searchbox", { name: "Search emojis" }),
			"thumbs up",
		);
		await userEvent.click(
			await reopenedDialog.findByRole("button", {
				name: "thumbs up: light skin tone",
			}),
		);
		await userEvent.click(
			page.getByRole("button", { name: "Choose channel emoji" }),
		);
		const recentDialog = within(
			page.getByRole("dialog", { name: "Choose emoji" }),
		);
		await userEvent.click(recentDialog.getByRole("button", { name: "Recent" }));
		await expect(
			recentDialog.getByRole("button", { name: "thumbs up: light skin tone" }),
		).toBeVisible();
		await expect(
			recentDialog.getByRole("button", { name: "thumbs up: dark skin tone" }),
		).toBeVisible();
	},
};
