import type { Meta, StoryObj } from "@storybook/react-vite";
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
