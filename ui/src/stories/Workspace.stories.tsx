import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { storyBootstrap } from "./story-fixtures";
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

export const AgentDiscoveryFailure = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.get("/api/bootstrap", () =>
				HttpResponse.json({ ...storyBootstrap, discoveredAgents: [] }),
			),
			http.post(
				"/api/discover-agents",
				() =>
					HttpResponse.json(
						{ error: "Agent discovery temporarily unavailable" },
						{ status: 503 },
					),
				{ once: true },
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await page.findByRole("button", { name: "Add agent" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Add an agent" }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Choose Hermes" }),
		);
		await expect(await dialog.findByRole("alert")).toHaveTextContent(
			"Agent discovery temporarily unavailable",
		);
		await expect(
			dialog.queryByText(
				"No Hermes agents found. Make sure it is installed and signed in.",
			),
		).not.toBeInTheDocument();
		await expect(
			dialog.getByRole("button", { name: "Retry Hermes search" }),
		).toBeEnabled();
	},
} satisfies Story;

export const AgentDiscoveryRetry: Story = {
	beforeEach: AgentDiscoveryFailure.beforeEach,
	play: async (context) => {
		await AgentDiscoveryFailure.play(context);
		const page = within(context.canvasElement.ownerDocument.body);
		const dialog = within(page.getByRole("dialog", { name: "Add an agent" }));
		await userEvent.click(
			dialog.getByRole("button", { name: "Retry Hermes search" }),
		);
		await expect(
			await dialog.findByRole("button", {
				name: "Add discovered agent Hermes Reviewer",
			}),
		).toBeVisible();
		await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
	},
};

export const AgentDiscoveryEmpty: Story = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post("/api/discover-agents", () =>
				HttpResponse.json({ ...storyBootstrap, discoveredAgents: [] }),
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await page.findByRole("button", { name: "Add agent" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Add an agent" }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Choose Hermes" }),
		);
		await expect(
			await dialog.findByText(
				"No Hermes agents found. Make sure it is installed and signed in.",
			),
		).toBeVisible();
		await expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
		await expect(
			dialog.getByRole("button", { name: "Retry Hermes search" }),
		).toBeEnabled();
	},
};

export const AgentProfileDiscoveryFailure = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post(
				"/api/discover-agents",
				() =>
					HttpResponse.json(
						{ error: "Native profile refresh temporarily unavailable" },
						{ status: 503 },
					),
				{ once: true },
			),
			http.post("/api/discover-agents", () =>
				HttpResponse.json({
					...storyBootstrap,
					agents: storyBootstrap.agents.map((agent) =>
						agent.id === "agent-hermes"
							? { ...agent, model: "refreshed-native-model" }
							: agent,
					),
				}),
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			await page.findByRole("button", { name: "Message agent Agentops" }),
		);
		await userEvent.click(
			await page.findByRole("button", { name: "Open agent profile" }),
		);
		await expect(await page.findByRole("alert")).toHaveTextContent(
			"Native profile refresh temporarily unavailable",
		);
		const name = page.getByLabelText("Workspace name");
		await userEvent.clear(name);
		await userEvent.type(name, "My profile draft");
	},
} satisfies Story;

export const AgentProfileDiscoveryRetry: Story = {
	beforeEach: AgentProfileDiscoveryFailure.beforeEach,
	play: async (context) => {
		await AgentProfileDiscoveryFailure.play(context);
		const page = within(context.canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Retry Hermes discovery" }),
		);
		await waitFor(() =>
			expect(page.getByLabelText("Native model")).toHaveValue(
				"refreshed-native-model",
			),
		);
		await expect(page.queryByRole("alert")).not.toBeInTheDocument();
		await expect(page.getByLabelText("Workspace name")).toHaveValue(
			"My profile draft",
		);
	},
};

export const RoutingCorrection: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const receipts = await page.findAllByRole("button", {
			name: /^Routing details:/u,
		});
		const receipt = receipts[0];
		if (receipt === undefined) throw new Error("Routing receipt is missing.");
		await userEvent.click(receipt);
		await userEvent.click(await page.findByText("Wrong recipient?"));
		const select = page.getByRole("combobox", {
			name: "Correct routing agent",
		});
		await expect(
			page.getByRole("button", { name: "Reroute and remember" }),
		).toBeDisabled();
		await userEvent.selectOptions(select, "agent-codex");
		await userEvent.click(
			page.getByRole("button", { name: "Reroute and remember" }),
		);
		await expect(
			await page.findByText("Rerouted Agentops → Codex"),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", { name: "Correct routing agent" }),
		).toHaveValue("agent-codex");
		await expect(
			page.getByRole("button", { name: "Reroute and remember" }),
		).toBeDisabled();
	},
};
export const RoutingCorrectionFailure: Story = {
	beforeEach: ({ msw }) => {
		msw.use(
			http.post(
				"/api/reroute",
				() =>
					HttpResponse.json(
						{ error: "Unable to save correction." },
						{ status: 503 },
					),
				{ once: true },
			),
		);
	},
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		const [receipt] = await page.findAllByRole("button", {
			name: /^Routing details:/u,
		});
		if (receipt === undefined) throw new Error("Routing receipt is missing.");
		await userEvent.click(receipt);
		await userEvent.click(await page.findByText("Wrong recipient?"));
		const select = page.getByRole("combobox", {
			name: "Correct routing agent",
		});
		await userEvent.selectOptions(select, "agent-codex");
		await userEvent.click(
			page.getByRole("button", { name: "Reroute and remember" }),
		);
		await expect(
			await page.findByText("Could not save the correction. Try again."),
		).toBeVisible();
		await expect(select).toHaveValue("agent-codex");
		await expect(
			page.getByRole("button", { name: "Reroute and remember" }),
		).toBeEnabled();
		await userEvent.click(
			page.getByRole("button", { name: "Reroute and remember" }),
		);
		await expect(
			await page.findByText("Rerouted Agentops → Codex"),
		).toBeVisible();
		await expect(page.getByText("Wrong recipient?")).toHaveFocus();
	},
};
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
		await waitFor(() => expect(helpTrigger).toHaveFocus());

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
