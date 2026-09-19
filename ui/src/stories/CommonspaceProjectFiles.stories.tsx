import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CommonspaceProjectFiles } from "../CommonspaceProjectFiles";
import {
	emptyProjectFetcher,
	errorProjectFetcher,
	mediaErrorProjectFetcher,
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

export const OpenImageFile: Story = {
	args: { targetFile: { rootIndex: 0, path: "commonspace-logo.png" } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const image = await canvas.findByRole(
			"img",
			{ name: "Preview commonspace-logo.png" },
			{ timeout: 5_000 },
		);
		if (!(image instanceof HTMLImageElement))
			throw new TypeError("Expected an image preview element.");
		await waitFor(() => expect(image.naturalWidth).toBeGreaterThan(0), {
			timeout: 5_000,
		});
		const fit = canvas.getByRole("button", { name: "Fit" });
		const actual = canvas.getByRole("button", { name: "Actual size" });
		await expect(fit).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(actual);
		await expect(actual).toHaveAttribute("aria-pressed", "true");
	},
};

export const OpenVideoFile: Story = {
	args: {
		targetFile: { rootIndex: 0, path: "agent-workflow-preview.mp4" },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const video = await canvas.findByLabelText(
			"Preview agent-workflow-preview.mp4",
			{},
			{ timeout: 5_000 },
		);
		if (!(video instanceof HTMLVideoElement))
			throw new TypeError("Expected a video preview element.");
		await waitFor(() => expect(video.readyState).toBeGreaterThanOrEqual(1), {
			timeout: 5_000,
		});
	},
};

export const MediaPreviewFailed: Story = {
	args: {
		fetcher: mediaErrorProjectFetcher,
		targetFile: { rootIndex: 0, path: "commonspace-logo.png" },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const alert = await canvas.findByRole("alert");
		await expect(alert).toHaveTextContent("Preview data could not be read.");
		await userEvent.click(
			within(alert).getByRole("button", { name: "Retry preview" }),
		);
		await userEvent.click(
			await canvas.findByRole("button", { name: /Open file README\.md/iu }),
		);
		await expect(
			await canvas.findByText(/export const story = 'verified'/u),
		).toBeVisible();
	},
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
