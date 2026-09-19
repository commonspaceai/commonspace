import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { WorkspaceStory } from "./WorkspaceStory";
import { createWorkspaceMockApi } from "./workspace-mock-api";

const meta = {
	title: "Workspace",
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
		docs: {
			description: {
				component:
					"The live Commonspace components and client store, backed by a disposable MSW workspace. Navigate, send, search, create channels/projects, and save settings in one connected preview. Reload resets the data; no native agents run. Edit production components and see updates through hot reload.",
			},
		},
	},
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi());
		const previousWidth = localStorage.getItem("commonspace-panel-width");
		localStorage.setItem("commonspace-panel-width", "42");
		return () => {
			if (previousWidth === null)
				localStorage.removeItem("commonspace-panel-width");
			else localStorage.setItem("commonspace-panel-width", previousWidth);
		};
	},
} satisfies Meta<typeof WorkspaceStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
export const SearchWithProvenance: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await page.findByRole(
			"heading",
			{ name: "general", level: 1 },
			{ timeout: 5_000 },
		);
		await userEvent.click(
			await page.findByRole("button", {
				name: "Search messages, channels, and agents",
			}),
		);
		const dialog = await page.findByRole("dialog", {
			name: "Search Commonspace",
		});
		const search = within(dialog);
		await userEvent.type(
			search.getByRole("searchbox", { name: "Search Commonspace" }),
			"workflow",
		);
		const [receipt] = await search.findAllByText(/^#general · /u);
		if (receipt === undefined) throw new Error("Expected search provenance.");
		await expect(receipt).toBeVisible();
	},
};
export const WritingScopeShortcut: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await page.findByRole(
			"heading",
			{ name: "general", level: 1 },
			{ timeout: 5_000 },
		);
		const helpTrigger = page.getByRole("button", {
			name: "Help and shortcuts",
		});
		await userEvent.click(helpTrigger);
		await userEvent.click(page.getByRole("button", { name: "Close help" }));
		await expect(helpTrigger).toHaveFocus();

		const channelInput = page.getByRole("textbox", { name: "Post in general" });
		const threadInput = page.getByRole("textbox", { name: "Reply in thread" });
		await userEvent.keyboard("{F6}");
		await expect(threadInput).toHaveFocus();
		await userEvent.keyboard("{F6}");
		await expect(channelInput).toHaveFocus();

		const channelNavigation = page.getByLabelText(/Open channel general/iu);
		channelNavigation.focus();
		await expect(channelNavigation).toHaveFocus();
		await userEvent.keyboard("{F6}");
		await expect(threadInput).toHaveFocus();
	},
};
export const Inbox: Story = { args: { initialPath: "/" } };
export const Threads: Story = { args: { initialPath: "/threads" } };
export const DirectMessage: Story = {
	args: { initialPath: "/agents/agent-hermes" },
};
export const Projects: Story = { args: { initialPath: "/projects" } };
export const Channels: Story = { args: { initialPath: "/channels" } };
export const Agents: Story = { args: { initialPath: "/agents" } };
export const Project: Story = {
	args: { initialPath: "/projects/project-commonspace" },
};

export const EmptyWorkspace: Story = {
	args: { initialPath: "/" },
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi("empty"));
	},
};
export const RoutingFailed: Story = {
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi("routing-failed"));
	},
};
export const Offline: Story = {
	args: { initialPath: "/" },
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi("offline"));
	},
};

export const QueuedMessages: Story = {
	args: { initialPath: "/agents/agent-hermes" },
	beforeEach: ({ msw }) => {
		msw.use(...createWorkspaceMockApi("queued"));
	},
};
