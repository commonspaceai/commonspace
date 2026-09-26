import {
	CommonspaceRoutingProvider,
	RoutingConfigurationIssue,
	type UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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

const onboardingRouting = {
	provider: CommonspaceRoutingProvider.Unconfigured,
	reason: RoutingConfigurationIssue.Missing,
	message: "Choose a workspace inference agent.",
} as const;
const onboardingWithoutAgent = structuredClone(emptyBootstrap);
onboardingWithoutAgent.agents = [];
onboardingWithoutAgent.discoveredAgents = [];
onboardingWithoutAgent.state.agents = [];
onboardingWithoutAgent.routing = onboardingRouting;
const onboardingWithAgents = structuredClone(emptyBootstrap);
onboardingWithAgents.routing = onboardingRouting;
const saveInferenceAgent = fn(
	async (request: UpdateRoutingConfigurationRequest) => {
		void request;
	},
);
const pendingInferenceSave = fn(
	(request: UpdateRoutingConfigurationRequest) => {
		void request;
		return new Promise<void>(() => undefined);
	},
);

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

export const OnboardingAddAgent: Story = {
	args: { store: createStoryStore(onboardingWithoutAgent) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			await canvas.findByRole("main", { name: "Workspace setup" }),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", {
				name: "Search messages, channels, and agents",
			}),
		).not.toBeInTheDocument();
		await expect(canvas.queryByRole("complementary")).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("heading", {
				name: "Bring an agent. Give the workspace a mind.",
			}),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Add an agent" }),
		).toBeEnabled();
		await expect(
			canvas.getByRole("button", { name: "Use selected agent" }),
		).toBeDisabled();
		await userEvent.click(canvas.getByRole("button", { name: "Add an agent" }));
		await waitFor(() => {
			expect(page.getByRole("dialog", { name: "Add an agent" })).toBeVisible();
		});
		await userEvent.click(page.getByRole("button", { name: "Cancel" }));
		await waitFor(() => {
			expect(
				page.queryByRole("dialog", { name: "Add an agent" }),
			).not.toBeInTheDocument();
		});
		await expect(
			canvas.getByRole("button", { name: "Add an agent" }),
		).toHaveFocus();
		await userEvent.keyboard("{Meta>}k{/Meta}");
		await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
	},
};

export const OnboardingChooseInferenceAgentUnselected: Story = {
	args: { store: createStoryStore(onboardingWithAgents) },
};

export const OnboardingChooseInferenceAgent: Story = {
	args: {
		store: createStoryStore(onboardingWithAgents, {
			updateRoutingConfiguration: saveInferenceAgent,
		}),
	},
	play: async ({ canvasElement }) => {
		saveInferenceAgent.mockClear();
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("heading", {
				name: "Choose the workspace inference agent",
			}),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", {
				name: "Search messages, channels, and agents",
			}),
		).not.toBeInTheDocument();
		await expect(canvas.queryByRole("complementary")).not.toBeInTheDocument();
		const submit = canvas.getByRole("button", { name: "Use selected agent" });
		await expect(submit).toBeDisabled();
		const codex = canvas.getByRole("radio", { name: /Build Smith/iu });
		await userEvent.click(codex);
		await expect(submit).toBeEnabled();
		await userEvent.click(submit);
		await expect(saveInferenceAgent).toHaveBeenCalledWith({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "agent-codex",
		});
	},
};

export const OnboardingInferenceSavePending: Story = {
	args: {
		store: createStoryStore(onboardingWithAgents, {
			updateRoutingConfiguration: pendingInferenceSave,
		}),
	},
	play: async ({ canvasElement }) => {
		pendingInferenceSave.mockClear();
		const canvas = within(canvasElement);
		const codex = canvas.getByRole("radio", { name: /Build Smith/iu });
		await userEvent.click(codex);
		await userEvent.click(
			canvas.getByRole("button", { name: "Use selected agent" }),
		);
		await expect(
			canvas.getByRole("button", { name: "Finishing setup…" }),
		).toBeDisabled();
		for (const option of canvas.getAllByRole("radio"))
			await expect(option).toBeDisabled();
	},
};

export const Loading: Story = {
	args: { store: createStoryStore(null, { loading: true }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("main", { name: "Workspace connection" }),
		).toBeVisible();
		await expect(canvas.queryByRole("complementary")).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", {
				name: "Search messages, channels, and agents",
			}),
		).not.toBeInTheDocument();
	},
};

export const ErrorBanner: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			error: "Live updates disconnected; retrying…",
		}),
	},
};
