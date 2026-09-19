import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommonspaceDirectory } from "../CommonspaceDirectory";
import {
	createStoryStore,
	emptyBootstrap,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceDirectory",
	component: CommonspaceDirectory,
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
		onAdd: fn(),
		onOpenProject: fn(),
		onOpenConversation: fn(),
		onOpenSettings: fn(),
		onOpenSessions: fn(),
	},
} satisfies Meta<typeof CommonspaceDirectory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Projects: Story = { args: { kind: "projects" } };
export const Channels: Story = { args: { kind: "channels" } };
export const Agents: Story = { args: { kind: "agents" } };

export const Empty: Story = {
	args: {
		kind: "projects",
		bootstrap: emptyBootstrap,
		store: createStoryStore(emptyBootstrap),
	},
};

export const FilterRecovery: Story = {
	args: { kind: "projects" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("searchbox", { name: "Filter projects" }),
			"no such project",
		);
		await expect(
			canvas.queryByRole("button", { name: "Open project Commonspace" }),
		).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Clear filter" }));
		await expect(
			canvas.getByRole("button", { name: "Open project Commonspace" }),
		).toBeVisible();
	},
};
