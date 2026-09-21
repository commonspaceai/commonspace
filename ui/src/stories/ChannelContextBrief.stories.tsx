import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChannelContextBrief } from "../ChannelContextBrief";
import { createStoryStore, storyBootstrap } from "./story-fixtures";

const source = storyBootstrap.state.channels[0];
if (source === undefined) throw new Error("Missing Channel fixture");
const channel = {
	...source,
	memory: {
		...source.memory,
		origin: "inference" as const,
		status: "current" as const,
		summary:
			"The login recovery flow now preserves the existing authentication protocol. Focused tests pass; rollout is waiting on a date.",
		decisions: [
			"Use WebSockets on port 3100.",
			"Keep AUTH_PROTOCOL compatible with existing clients.",
		],
		openQuestions: ["When should the rollout begin?"],
		sourceMessageCount: 12,
	},
};

const meta = {
	title: "Components/ChannelContextBrief",
	component: ChannelContextBrief,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[420px] max-w-[calc(100vw-32px)] bg-card p-5">
				<Story />
			</div>
		),
	],
	args: { channel, store: createStoryStore(storyBootstrap) },
} satisfies Meta<typeof ChannelContextBrief>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};
export const Empty: Story = {
	args: {
		channel: {
			...channel,
			memory: {
				...channel.memory,
				origin: "automatic",
				status: "empty",
				summary: "",
				decisions: [],
				openQuestions: [],
				sourceMessageCount: 0,
			},
		},
	},
};
export const Updating: Story = {
	args: {
		channel: {
			...channel,
			memory: { ...channel.memory, status: "compacting" },
		},
	},
};
export const Failed: Story = {
	args: {
		channel: { ...channel, memory: { ...channel.memory, status: "failed" } },
	},
};
export const Corrected: Story = {
	args: {
		channel: {
			...channel,
			memory: { ...channel.memory, origin: "user", status: "stale" },
		},
	},
};

export const RefreshFailure: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			compactChannelContext: fn(async () => {
				throw new Error("Inference is unavailable. Try again.");
			}),
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Refresh brief" }),
		);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"Inference is unavailable",
		);
		await expect(canvas.getByText(channel.memory.summary)).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Refresh brief" }),
		).toBeEnabled();
		await userEvent.click(canvas.getByRole("button", { name: "Edit context" }));
		await expect(canvas.getByLabelText("Channel summary")).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Cancel edit" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Inference is unavailable",
		);
	},
};

export const CorrectionFailure: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			mutate: fn(async () => {
				throw new Error("The correction could not be saved.");
			}),
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Edit context" }));
		await userEvent.clear(canvas.getByLabelText("Channel summary"));
		await userEvent.type(
			canvas.getByLabelText("Channel summary"),
			"Keep my corrected context.",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Save corrections" }),
		);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"could not be saved",
		);
		await expect(canvas.getByLabelText("Channel summary")).toHaveValue(
			"Keep my corrected context.",
		);
		await expect(
			canvas.getByRole("button", { name: "Save corrections" }),
		).toBeEnabled();
	},
};
