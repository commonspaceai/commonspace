import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CommonspaceApp } from "../CommonspaceApp";
import {
	createStoryStore,
	emptyBootstrap,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceApp",
	component: CommonspaceApp,
	args: { initialPath: "/" },
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CommonspaceApp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceInbox: Story = {
	args: { store: createStoryStore(storyBootstrap) },
};

export const WorkspaceNavigationFlow: Story = {
	args: { store: createStoryStore(storyBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(canvas.getByRole("button", { name: /Open Inbox/iu }));
		await expect(
			await canvas.findByRole("main", { name: "Inbox" }),
		).toBeVisible();

		await userEvent.click(
			canvas.getByRole("button", { name: /Open Threads/iu }),
		);
		await expect(
			await canvas.findByRole("main", { name: "Threads" }),
		).toBeVisible();

		await userEvent.click(
			canvas.getByRole("button", { name: "Select project Commonspace" }),
		);
		await expect(
			await canvas.findByRole("main", { name: "Project Commonspace" }),
		).toBeVisible();

		await userEvent.click(canvas.getByRole("button", { name: "Workspace" }));
		await expect(
			await canvas.findByRole("main", { name: "Inbox" }),
		).toBeVisible();
	},
};

export const WorkspaceColorModes: Story = {
	args: { store: createStoryStore(storyBootstrap) },
	decorators: [
		(Story) => {
			window.localStorage.removeItem("commonspace-color-mode");
			document.documentElement.classList.remove("dark", "light", "system");
			return <Story />;
		},
	],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(canvasElement.ownerDocument.documentElement).toHaveClass(
			"light",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);

		const system = page.getByRole("radio", { name: /^System/u });
		await userEvent.click(system);
		await expect(system).toBeChecked();
		await expect(canvasElement.ownerDocument.documentElement).toHaveClass(
			"system",
		);
		await expect(window.localStorage.getItem("commonspace-color-mode")).toBe(
			"system",
		);

		const light = page.getByRole("radio", { name: /^Light/u });
		await userEvent.click(light);
		await expect(light).toBeChecked();
		await expect(canvasElement.ownerDocument.documentElement).toHaveClass(
			"light",
		);
	},
};

export const ProjectSettingsNavigation: Story = {
	args: { store: createStoryStore(storyBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("main", { name: "Inbox" }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "More actions for Platform" }),
		);
		await userEvent.click(
			await page.findByRole("menuitem", { name: "Project settings" }),
		);
		await expect(
			await canvas.findByRole("main", { name: "Project Platform" }),
		).toBeVisible();
		const settings = await canvas.findByRole("complementary", {
			name: "Project settings",
		});
		await expect(
			within(settings).getByRole("heading", { name: "Platform" }),
		).toBeVisible();
		await waitFor(() => {
			expect(
				page.queryByRole("menuitem", { name: "Project settings" }),
			).not.toBeInTheDocument();
		});

		await userEvent.click(
			canvas.getByRole("button", { name: "Close project settings" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "More actions for Platform" }),
		);
		await userEvent.click(
			await page.findByRole("menuitem", { name: "Project settings" }),
		);
		await expect(
			await canvas.findByRole("complementary", { name: "Project settings" }),
		).toBeVisible();

		await userEvent.click(
			canvas.getByRole("button", { name: "Select project Commonspace" }),
		);
		await expect(
			await canvas.findByRole("main", { name: "Project Commonspace" }),
		).toBeVisible();
		await expect(
			canvas.queryByRole("complementary", { name: "Project settings" }),
		).not.toBeInTheDocument();

		await userEvent.click(
			canvas.getByRole("button", { name: "Open project settings" }),
		);
		await expect(
			await canvas.findByRole("complementary", { name: "Project settings" }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "Select project Platform" }),
		);
		await expect(
			await canvas.findByRole("main", { name: "Project Platform" }),
		).toBeVisible();
		await expect(
			canvas.queryByRole("complementary", { name: "Project settings" }),
		).not.toBeInTheDocument();
	},
};

export const KeyboardSearchFlow: Story = {
	args: { store: createStoryStore(storyBootstrap) },
	play: async ({ canvasElement }) => {
		const document = within(canvasElement.ownerDocument.body);

		await userEvent.keyboard("{Control>}k{/Control}");
		const search = document.getByRole("searchbox", {
			name: "Search Commonspace",
		});
		await waitFor(() => expect(search).toBeVisible());
	},
};

export const EmptyWorkspace: Story = {
	args: { store: createStoryStore(emptyBootstrap) },
};

export const Loading: Story = {
	args: { store: createStoryStore(null, { loading: true }) },
};

export const ErrorBanner: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			error: "Live updates disconnected; retrying…",
		}),
	},
};
