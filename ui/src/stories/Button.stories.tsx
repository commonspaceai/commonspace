import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { expect, fn } from "storybook/test";
import { Button } from "@/components/ui/button";

const meta = {
	title: "Foundations/Button",
	component: Button,
	tags: ["ai-generated"],
	parameters: { layout: "centered" },
	args: {
		children: "Add project",
		variant: "default",
		size: "default",
		onClick: fn(),
	},
	argTypes: {
		variant: {
			control: "select",
			options: [
				"default",
				"secondary",
				"outline",
				"ghost",
				"destructive",
				"link",
			],
		},
		size: {
			control: "select",
			options: [
				"xs",
				"sm",
				"default",
				"lg",
				"icon-xs",
				"icon-sm",
				"icon",
				"icon-lg",
			],
		},
		disabled: { control: "boolean" },
	},
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CssCheck: Story = {
	play: async ({ canvas }) => {
		const button = canvas.getByRole("button", { name: /add project/iu });
		await expect(getComputedStyle(button).backgroundColor).toBe(
			"rgb(36, 99, 173)",
		);
	},
};

export const WithIcon: Story = {
	args: {
		children: (
			<>
				<PlusIcon data-icon="inline-start" aria-hidden="true" />
				Add project
			</>
		),
	},
};
export const IconOnly: Story = {
	args: {
		children: <ArrowUpIcon aria-hidden="true" />,
		size: "icon",
		"aria-label": "Send message",
	},
};
export const Disabled: Story = { args: { disabled: true } };
export const Pending: Story = {
	args: {
		disabled: true,
		children: (
			<>
				<LoaderCircleIcon
					data-icon="inline-start"
					aria-hidden="true"
					className="motion-safe:animate-spin"
				/>
				Adding project…
			</>
		),
	},
};
export const Variants: Story = {
	render: () => (
		<div className="flex max-w-2xl flex-wrap items-center gap-3">
			{(
				[
					"default",
					"secondary",
					"outline",
					"ghost",
					"destructive",
					"link",
				] as const
			).map((variant) => (
				<Button key={variant} variant={variant}>
					{variant}
				</Button>
			))}
		</div>
	),
};
export const Sizes: Story = {
	render: () => (
		<div className="flex items-center gap-3">
			{(["xs", "sm", "default", "lg"] as const).map((size) => (
				<Button key={size} variant="outline" size={size}>
					{size}
				</Button>
			))}
		</div>
	),
};
