import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { WorkspaceStory } from "./WorkspaceStory";
import { createWorkspaceMockApi } from "./workspace-mock-api";

const importFailure =
	"GitHub import failed. Check repository access and branch, then try again.";

const meta = {
	title: "Workspace/Project import",
	component: WorkspaceStory,
	globals: { viewport: { value: "desktop", isRotated: false } },
	parameters: {
		layout: "fullscreen",
		viewport: {
			options: {
				desktop: {
					name: "Desktop · 1440 × 960",
					styles: { width: "1440px", height: "960px" },
				},
			},
		},
	},
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi());
	},
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openGitHubDraft(page: ReturnType<typeof within>, branch = "") {
	await userEvent.click(
		await page.findByRole("button", { name: "Add project" }),
	);
	const dialog = within(
		await page.findByRole("dialog", { name: "Add a project" }),
	);
	await userEvent.click(
		dialog.getByRole("button", { name: "GitHub repository" }),
	);
	await userEvent.type(
		dialog.getByRole("textbox", { name: "Project name" }),
		"Imported workspace",
	);
	await userEvent.type(
		dialog.getByRole("textbox", { name: "GitHub repository URL" }),
		"https://github.com/example/workspace",
	);
	if (branch !== "")
		await userEvent.type(
			dialog.getByRole("textbox", { name: "GitHub branch" }),
			branch,
		);
	return dialog;
}

export const GitHubDraft: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = await openGitHubDraft(page, "release");
		await expect(
			dialog.getByRole("button", { name: "GitHub repository" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			dialog.queryByRole("textbox", { name: "Project path" }),
		).not.toBeInTheDocument();
		await userEvent.click(dialog.getByRole("button", { name: "Local folder" }));
		await expect(
			dialog.getByRole("button", { name: "Choose project folder" }),
		).toBeEnabled();
		await expect(
			dialog.getByRole("button", { name: "Create project" }),
		).toBeDisabled();
		await userEvent.click(
			dialog.getByRole("button", { name: "GitHub repository" }),
		);
		await expect(
			dialog.getByRole("textbox", { name: "Project name" }),
		).toHaveValue("Imported workspace");
		await expect(
			dialog.getByRole("textbox", { name: "GitHub repository URL" }),
		).toHaveValue("https://github.com/example/workspace");
		await expect(
			dialog.getByRole("textbox", { name: "GitHub branch" }),
		).toHaveValue("release");
	},
};

export const ImportPending: Story = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post("/api/projects/import-github", async () => {
				await delay("infinite");
				return HttpResponse.json({});
			}),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = await openGitHubDraft(page);
		await userEvent.click(
			dialog.getByRole("button", { name: "Import repository" }),
		);
		await expect(await dialog.findByRole("status")).toHaveTextContent(
			"Cloning repository on the host…",
		);
		await expect(
			dialog.getByRole("textbox", { name: "Project name" }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("textbox", { name: "GitHub repository URL" }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("textbox", { name: "GitHub branch" }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("button", { name: "GitHub repository" }),
		).toBeDisabled();
		await expect(
			dialog.getByRole("button", { name: "Importing…" }),
		).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "Close" })).toBeEnabled();
	},
};

export const ImportFailed: Story = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post("/api/projects/import-github", () =>
				HttpResponse.json({ error: importFailure }, { status: 422 }),
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = await openGitHubDraft(page, "release");
		await userEvent.click(
			dialog.getByRole("button", { name: "Import repository" }),
		);
		await expect(await dialog.findByRole("alert")).toHaveTextContent(
			importFailure,
		);
		await expect(
			dialog.getByRole("textbox", { name: "Project name" }),
		).toHaveValue("Imported workspace");
		await expect(
			dialog.getByRole("textbox", { name: "GitHub repository URL" }),
		).toHaveValue("https://github.com/example/workspace");
		await expect(
			dialog.getByRole("textbox", { name: "GitHub branch" }),
		).toHaveValue("release");
		await expect(
			dialog.getByRole("button", { name: "Import repository" }),
		).toBeEnabled();
	},
};

export const ImportAndBrowse: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = await openGitHubDraft(page);
		await userEvent.click(
			dialog.getByRole("button", { name: "Import repository" }),
		);
		await expect(
			await page.findByRole("heading", {
				name: "Imported workspace",
			}),
		).toBeVisible();
		await expect(
			page.queryByRole("dialog", { name: "Add a project" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			await page.findByRole("button", { name: "Open file README.md" }),
		);
		await expect(
			await page.findByRole("heading", {
				name: "Imported workspace",
				level: 1,
			}),
		).toBeVisible();
	},
};

export const RetryWithBranch: Story = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post(
				"/api/projects/import-github",
				() => HttpResponse.json({ error: importFailure }, { status: 422 }),
				{ once: true },
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const dialog = await openGitHubDraft(page, "release");
		await userEvent.click(
			dialog.getByRole("button", { name: "Import repository" }),
		);
		await expect(await dialog.findByRole("alert")).toHaveTextContent(
			importFailure,
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Import repository" }),
		);
		await expect(
			await page.findByRole("heading", {
				name: "Imported workspace",
			}),
		).toBeVisible();
		await userEvent.click(page.getByRole("button", { name: "Add project" }));
		const fresh = within(
			await page.findByRole("dialog", { name: "Add a project" }),
		);
		await expect(
			fresh.getByRole("textbox", { name: "Project name" }),
		).toHaveValue("");
		await expect(
			fresh.getByRole("button", { name: "Local folder" }),
		).toHaveAttribute("aria-pressed", "true");
		await userEvent.click(
			fresh.getByRole("button", { name: "GitHub repository" }),
		);
		await expect(
			fresh.getByRole("textbox", { name: "GitHub repository URL" }),
		).toHaveValue("");
		await expect(
			fresh.getByRole("textbox", { name: "GitHub branch" }),
		).toHaveValue("");
		await expect(fresh.queryByRole("alert")).not.toBeInTheDocument();
	},
};

export const LocalFolder: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await page.findByRole("button", { name: "Add project" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Add a project" }),
		);
		await userEvent.type(
			dialog.getByRole("textbox", { name: "Project name" }),
			"Existing folder",
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Choose project folder" }),
		);
		await expect(
			dialog.getByRole("textbox", { name: "Project path" }),
		).toHaveValue("/mock/workspace/new-project");
		await userEvent.click(
			dialog.getByRole("button", { name: "Create project" }),
		);
		await waitFor(() =>
			expect(
				page.queryByRole("dialog", { name: "Add a project" }),
			).not.toBeInTheDocument(),
		);
		await expect(
			page.getByRole("button", { name: "Select project Existing folder" }),
		).toBeVisible();
	},
};
