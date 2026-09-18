import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CommonspaceProjectFiles } from "../CommonspaceProjectFiles";
import {
	emptyProjectFetcher,
	errorProjectFetcher,
	primaryProject,
	storyProjectFetcher,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceProjectFiles",
	component: CommonspaceProjectFiles,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
	args: {
		projectId: primaryProject.id,
		roots: primaryProject.paths,
		fetcher: storyProjectFetcher,
	},
} satisfies Meta<typeof CommonspaceProjectFiles>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowseWorkspace: Story = {};

export const OpenTextFile: Story = {
	args: { targetFile: { rootIndex: 0, path: "README.md" } },
};

export const SensitiveFileBlocked: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /Open file \.env/iu }),
		);
		await expect(canvas.getByText("Sensitive file")).toBeVisible();
	},
};

export const NestedFolder: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /Open folder ui/iu }),
		);
		await expect(
			await canvas.findByRole("button", { name: /Open folder src/iu }),
		).toBeVisible();
	},
};

export const EmptyFolder: Story = {
	args: { fetcher: emptyProjectFetcher },
};

export const NoProjectFolder: Story = {
	args: { roots: [] },
};

export const RequestFailed: Story = {
	args: { fetcher: errorProjectFetcher },
};

export const PublicFolderLabels: Story = {
	args: { roots: ["Working folder", "Reference folder 1"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const picker = canvas.getByRole("combobox", { name: "Project folder" });
		await expect(
			within(picker).getByRole("option", {
				name: "Working folder",
			}),
		).toBeInTheDocument();
		await userEvent.selectOptions(picker, "1");
		await expect(picker).toHaveValue("1");
	},
};
