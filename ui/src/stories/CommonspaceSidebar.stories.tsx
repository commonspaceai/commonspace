import {
	CommonspaceRoutingProvider,
	CredentialSource,
	RoutingConfigurationIssue,
} from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { CommonspaceSidebar } from "../CommonspaceSidebar";
import { collectionKey, sidebarPreferencesStore } from "../sidebar-preferences";
import {
	buildChannel,
	codexAgent,
	createStoryBootstrap,
	createStoryStore,
	designChannel,
	hermesAgent,
	primaryProject,
	secondaryProject,
	storyBootstrap,
} from "./story-fixtures";

const apiRoutingBootstrap = createStoryBootstrap({
	routing: {
		provider: CommonspaceRoutingProvider.OpenAiCompatible,
		model: "gpt-5.6-sol",
		baseUrl: "https://api.openai.com/v1",
		apiKeyConfigured: true,
		apiKeySource: CredentialSource.Saved,
	},
});

const meta = {
	title: "Pages/CommonspaceSidebar",
	component: CommonspaceSidebar,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-[260px]">
				<Story />
			</div>
		),
	],
	args: {
		wide: true,
		expandSidebar: fn(),
		store: createStoryStore(storyBootstrap),
		colorMode: "light",
		onSetColorMode: fn(),
		inboxActive: true,
		onOpenSearch: fn(),
		onOpenInbox: fn(),
		onOpenThreads: fn(),
		onOpenDirectory: fn(),
		onOpenContextSettings: fn(),
		onMentionAgent: fn(),
		onOpenAgentSessions: fn(),
		onOpenProject: fn(),
		onOpenConversation: fn(),
	},
} satisfies Meta<typeof CommonspaceSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const sortingChannels = [
	{
		...designChannel,
		createdAt: "2026-09-04T10:00:00.000Z",
	},
	{
		...buildChannel,
		createdAt: "2026-09-01T10:00:00.000Z",
	},
	{
		...designChannel,
		id: "channel-announcements",
		name: "announcements",
		createdAt: "2026-09-02T10:00:00.000Z",
	},
	{
		...buildChannel,
		id: "channel-triage",
		name: "triage",
		createdAt: "2026-09-03T10:00:00.000Z",
	},
];

const channelSortingBootstrap = createStoryBootstrap({
	state: {
		...storyBootstrap.state,
		channels: sortingChannels,
		messages: {
			...storyBootstrap.state.messages,
			[`channel:${designChannel.id}`]: [],
			[`channel:${buildChannel.id}`]: [],
			"channel:channel-announcements": [],
			"channel:channel-triage": [],
		},
	},
});

const alphabeticalProject = {
	...secondaryProject,
	id: "project-alpha",
	name: "Alpha",
};
const alphabeticalAgent = {
	...codexAgent,
	id: "agent-alpha",
	displayName: "Alpha Agent",
};
const allCollectionSortingBootstrap = createStoryBootstrap({
	agents: [hermesAgent, codexAgent, alphabeticalAgent],
	state: {
		...storyBootstrap.state,
		projects: [primaryProject, secondaryProject, alphabeticalProject],
		agents: [
			...storyBootstrap.state.agents,
			{ ...alphabeticalAgent, createdAt: "2026-09-04T10:00:00.000Z" },
		],
	},
});

const configuredModelBootstrap = createStoryBootstrap({
	agents: [hermesAgent, { ...codexAgent, model: null }],
});

function channelNames(canvasElement: HTMLElement): string[] {
	return within(canvasElement)
		.getAllByRole("button", { name: /^Open channel /u })
		.map((button) =>
			(button.getAttribute("aria-label") ?? "")
				.replace(/^Open channel /u, "")
				.replace(/, \d+ unread$/u, ""),
		);
}

function clearStoryFocus(canvasElement: HTMLElement) {
	const activeElement = canvasElement.ownerDocument.activeElement;
	if (activeElement instanceof HTMLElement) activeElement.blur();
}

async function selectSort(
	canvasElement: HTMLElement,
	kind: "project" | "channel" | "agent",
	label: string,
) {
	const canvas = within(canvasElement);
	const page = within(canvasElement.ownerDocument.body);
	await userEvent.click(
		canvas.getByRole("button", { name: new RegExp(`^Sort ${kind}s:`) }),
	);
	await userEvent.click(
		await page.findByRole("menuitemradio", {
			name: label,
		}),
	);
	await waitFor(() => expect(page.queryAllByRole("menu")).toHaveLength(0));
}

function resetStoryPins() {
	window.localStorage.setItem(
		"commonspace-pins",
		JSON.stringify([
			collectionKey("project", primaryProject.id),
			collectionKey("channel", designChannel.id),
			collectionKey("agent", hermesAgent.id),
		]),
	);
	sidebarPreferencesStore.reload();
}

async function prepareChannelSorting(canvasElement: HTMLElement) {
	resetStoryPins();
	await selectSort(canvasElement, "channel", "Recent activity");
	sidebarPreferencesStore.setCustomOrder("channel", []);
	if (
		!sidebarPreferencesStore
			.getSnapshot()
			.pinnedKeys.includes(collectionKey("channel", buildChannel.id))
	)
		sidebarPreferencesStore.togglePin("channel", buildChannel.id);
}

export const Expanded: Story = {};

export const AgentModelsAccessible: Story = {
	args: {
		...meta.args,
		store: createStoryStore(configuredModelBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const configuredAgent = canvas.getByRole("button", {
			name: "Message agent Review Bot",
		});
		const defaultAgent = canvas.getByRole("button", {
			name: "Message agent Build Smith",
		});

		await expect(configuredAgent).toHaveAccessibleDescription("gpt-5.6-sol");
		await expect(defaultAgent).toHaveAccessibleDescription("Profile default");
	},
};

export const ChannelsByRecentActivity: Story = {
	args: {
		...meta.args,
		store: createStoryStore(channelSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await prepareChannelSorting(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Sort channels: Recent activity" }),
		).toBeVisible();
		await expect(channelNames(canvasElement)).toEqual([
			"design-review",
			"builds",
			"triage",
			"announcements",
		]);
		clearStoryFocus(canvasElement);
	},
};

export const ChannelsAlphabetically: Story = {
	args: {
		...meta.args,
		store: createStoryStore(channelSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await prepareChannelSorting(canvasElement);
		await selectSort(canvasElement, "channel", "Alphabetical");
		await expect(
			canvas.getByRole("button", { name: "Sort channels: Alphabetical" }),
		).toBeVisible();
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"announcements",
			"triage",
		]);
		clearStoryFocus(canvasElement);
	},
};

export const ChannelsInCustomOrder: Story = {
	args: {
		...meta.args,
		store: createStoryStore(channelSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await prepareChannelSorting(canvasElement);
		await selectSort(canvasElement, "channel", "Custom order");
		await expect(
			canvas.getByRole("button", { name: "Sort channels: Custom order" }),
		).toBeVisible();
		const design = canvas.getByRole("button", {
			name: "Open channel design-review",
		});
		await userEvent.click(design);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"triage",
			"announcements",
		]);
		await expect(design).toHaveFocus();
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"triage",
			"announcements",
		]);
		const triage = canvas.getByRole("button", { name: "Open channel triage" });
		await userEvent.click(triage);
		await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"triage",
			"announcements",
		]);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"announcements",
			"triage",
		]);
		await expect(triage).toHaveFocus();
		await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"triage",
			"announcements",
		]);
		await expect(triage).toHaveFocus();
		clearStoryFocus(canvasElement);
	},
};

export const ChannelsRestoreCustomOrder: Story = {
	args: {
		...meta.args,
		store: createStoryStore(channelSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await prepareChannelSorting(canvasElement);
		await selectSort(canvasElement, "channel", "Custom order");
		await expect(channelNames(canvasElement)).toEqual([
			"design-review",
			"builds",
			"triage",
			"announcements",
		]);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open channel design-review" }),
		);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await selectSort(canvasElement, "channel", "Recent activity");
		sidebarPreferencesStore.reload();
		await selectSort(canvasElement, "channel", "Custom order");
		await expect(channelNames(canvasElement)).toEqual([
			"builds",
			"design-review",
			"triage",
			"announcements",
		]);
		clearStoryFocus(canvasElement);
	},
};

export const AllCollectionsAlphabetical: Story = {
	args: {
		...meta.args,
		store: createStoryStore(allCollectionSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		resetStoryPins();
		await selectSort(canvasElement, "project", "Alphabetical");
		await selectSort(canvasElement, "channel", "Alphabetical");
		await selectSort(canvasElement, "agent", "Alphabetical");

		await expect(
			canvas
				.getAllByRole("button", { name: /^Select project /u })
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Select project Commonspace",
			"Select project Alpha",
			"Select project Platform",
		]);
		await expect(
			canvas
				.getAllByRole("button", { name: /^Message agent /u })
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Message agent Review Bot",
			"Message agent Alpha Agent",
			"Message agent Build Smith",
		]);
	},
};

export const ProjectsAndAgentsInCustomOrder: Story = {
	args: {
		...meta.args,
		store: createStoryStore(allCollectionSortingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const kind of ["project", "agent"] as const) {
			sidebarPreferencesStore.setSortMode(kind, "recent");
			sidebarPreferencesStore.setCustomOrder(kind, []);
			await selectSort(canvasElement, kind, "Custom order");
		}

		const platform = canvas.getByRole("button", {
			name: "Select project Platform",
		});
		const buildSmith = canvas.getByRole("button", {
			name: "Message agent Build Smith",
		});
		await expect(platform).toHaveAttribute("draggable", "true");
		await expect(buildSmith).toHaveAttribute("draggable", "true");

		await userEvent.click(platform);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await expect(
			canvas
				.getAllByRole("button", { name: /^Select project /u })
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Select project Commonspace",
			"Select project Alpha",
			"Select project Platform",
		]);

		await userEvent.click(buildSmith);
		await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
		await expect(
			canvas
				.getAllByRole("button", { name: /^Message agent /u })
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Message agent Review Bot",
			"Message agent Alpha Agent",
			"Message agent Build Smith",
		]);
	},
};

export const Collapsed: Story = {
	args: { wide: false },
};

export const ThreadsActive: Story = {
	args: {
		inboxActive: false,
		threadsActive: true,
	},
};

export const DirectoryActive: Story = {
	args: {
		inboxActive: false,
		directoryActive: true,
	},
};

export const WorkspaceSettings: Story = {
	args: {
		store: createStoryStore(storyBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);

		await expect(
			within(document.body).getByRole("region", { name: "Workspace settings" }),
		).toBeVisible();
	},
};

export const WorkspaceSettingsChannelTransition: Story = {
	args: {
		store: createStoryStore(storyBootstrap),
		onOpenConversation: fn(),
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);
		const settings = within(document.body).getByRole("region", {
			name: "Workspace settings",
		});
		await expect(settings).toBeVisible();

		await userEvent.click(
			canvas.getByRole("button", { name: /^Open channel design-review/ }),
		);

		await expect(args.onOpenConversation).toHaveBeenCalledOnce();
		await expect(settings).not.toBeInTheDocument();
	},
};

export const WorkspaceSettingsApiInference: Story = {
	args: {
		store: createStoryStore(apiRoutingBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);

		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		const connectionHeading = page.getByRole("heading", { name: "Connection" });
		connectionHeading.scrollIntoView({ block: "start" });

		await expect(page.getByLabelText("Routing model")).toHaveValue(
			"gpt-5.6-sol",
		);
		const clearApiKey = page.getByRole("checkbox", {
			name: "Clear routing API key",
		});
		await expect(clearApiKey).not.toBeChecked();
		await userEvent.click(clearApiKey);
		await expect(clearApiKey).toBeChecked();
	},
};

export const WorkspaceSettingsJevSetup: Story = {
	args: {
		store: createStoryStore(apiRoutingBootstrap, {
			diagnostics: async () => ({
				service: {
					status: "ready",
					stateVersion: 30,
					storage: "ready",
					projectlessWorkspace: "ready",
				},
				inference: {
					provider: CommonspaceRoutingProvider.OpenAiCompatible,
					location: "remote",
					configured: true,
					sends: [],
				},
				harnesses: [],
			}),
		}),
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(
			page.queryByText("Configured", { exact: true }),
		).not.toBeInTheDocument();
		await expect(
			page.getByText("Saved router: OpenAI-compatible API"),
		).toBeVisible();
		await expect(page.getByLabelText("TypeSafe API key")).toBeDisabled();
		await expect(page.getByLabelText("TypeSafe API key")).not.toBeVisible();
		await userEvent.click(
			page.getByRole("checkbox", { name: "Use Jev for routing" }),
		);
		await expect(page.getByLabelText("TypeSafe API key")).toBeEnabled();
		await expect(page.getByLabelText("TypeSafe API key")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Context compaction provider" }),
		).toBeVisible();
		// Unsaved edits must not claim that the active router has changed.
		await expect(
			page.getByText("Saved router: OpenAI-compatible API"),
		).toBeVisible();
		await userEvent.click(
			page.getByRole("button", { name: "Check saved configuration" }),
		);
		await expect(
			page.getByLabelText("Inference configuration status"),
		).toHaveTextContent("Provider connectivity has not been tested");
	},
};

export const WorkspaceSettingsJev: Story = {
	args: {
		store: createStoryStore({
			...apiRoutingBootstrap,
			routing: {
				provider: CommonspaceRoutingProvider.OpenAiCompatible,
				model: "gpt-5.6-sol",
				baseUrl: "https://api.openai.com/v1",
				apiKeyConfigured: true,
				apiKeySource: CredentialSource.Saved,
				jev: {
					enabled: true,
					model: "jev-1.13.0",
					apiKeyConfigured: true,
					apiKeySource: CredentialSource.Saved,
				},
			},
		}),
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(
			page.getByRole("checkbox", { name: "Use Jev for routing" }),
		).toBeChecked();
		await expect(page.getByLabelText("Jev model")).toHaveValue("jev-1.13.0");
		await expect(page.getByLabelText("TypeSafe API key")).toHaveValue("");
		await userEvent.click(
			page.getByRole("checkbox", { name: "Clear saved TypeSafe API key" }),
		);
		await expect(
			page.getByRole("checkbox", { name: "Clear saved TypeSafe API key" }),
		).toBeChecked();
		await userEvent.click(
			page.getByRole("checkbox", { name: "Use Jev for routing" }),
		);
		await expect(page.getByLabelText("Jev model")).toBeDisabled();
		await expect(page.getByLabelText("TypeSafe API key")).toBeDisabled();
		await expect(page.getByLabelText("TypeSafe API key")).not.toBeVisible();
	},
};

export const WorkspaceSettingsNotifications: Story = {
	args: {
		store: createStoryStore(storyBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);

		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Notifications" }));
		const notificationsHeading = page.getByRole("heading", {
			name: "OS notifications",
		});
		notificationsHeading.scrollIntoView({ block: "start" });

		const masterSwitch = page.getByRole("switch", {
			name: "Allow native notifications",
		});
		const soundSwitch = page.getByRole("switch", {
			name: "Notification sound",
		});
		await expect(masterSwitch).not.toBeChecked();
		await expect(soundSwitch).toBeDisabled();

		await userEvent.click(masterSwitch);
		await expect(masterSwitch).toBeChecked();
		await expect(soundSwitch).toBeEnabled();
		await userEvent.click(soundSwitch);
		await expect(soundSwitch).toBeChecked();

		await userEvent.click(
			page.getByRole("button", { name: "Save notification settings" }),
		);
		await expect(page.getByRole("status")).toHaveTextContent(
			"Notification settings saved.",
		);
		await userEvent.click(
			page.getByRole("button", { name: "Send test notification" }),
		);
		await expect(
			page.getByText(
				"Test notification delivered. Click it to verify Commonspace opens.",
			),
		).toBeVisible();
	},
};

export const WorkspaceSettingsNotificationFallback: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			notificationVerification: {
				status: "failed",
				message:
					"Native alert delivery failed. Inbox notifications remain available; check System Settings > Notifications for Commonspace.",
			},
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Notifications" }));
		await userEvent.click(
			page.getByRole("button", { name: "Send test notification" }),
		);
		await expect(
			page.getByText(/Inbox notifications remain available/iu),
		).toBeVisible();
	},
};

export const WorkspaceSettingsOperations: Story = {
	args: {
		store: createStoryStore(storyBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);

		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Diagnostics" }));
		const diagnostics = page.getByRole("region", {
			name: "Runtime diagnostics",
		});
		diagnostics.scrollIntoView({ block: "start" });

		await expect(diagnostics).toBeVisible();
		await userEvent.click(page.getByRole("tab", { name: "Data" }));
		await expect(
			page.getByRole("region", { name: "Workspace data management" }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Conversation retention" }),
		).toBeVisible();
	},
};

export const CreateChannelRequest: Story = {
	args: {
		createRequest: { kind: "channel", token: 1 },
	},
};

export const CompactCollections: Story = {
	args: {
		store: createStoryStore(
			createStoryBootstrap({
				agents: [codexAgent],
				state: {
					...storyBootstrap.state,
					projects: [primaryProject],
					channels: [buildChannel],
					agents: storyBootstrap.state.agents.filter(
						(agent) => agent.id === codexAgent.id,
					),
				},
			}),
		),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Channels" }),
		).toBeVisible();
		await expect(
			canvas.queryByText("Pinned", { exact: true }),
		).not.toBeInTheDocument();
	},
};

export const ConversationDeletion: Story = {
	args: { store: createStoryStore(storyBootstrap) },
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Data" }));
		await expect(
			page.queryByRole("combobox", { name: "Conversation" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			page.getByRole("button", { name: "Choose conversation…" }),
		);
		const dialog = within(
			page.getByRole("dialog", { name: "Delete conversation history" }),
		);
		await expect(
			dialog.getByRole("button", { name: "Review deletion" }),
		).toBeDisabled();
		await userEvent.selectOptions(
			dialog.getByRole("combobox", { name: "Conversation" }),
			`channel:${buildChannel.id}`,
		);
		await expect(
			dialog.getByRole("button", { name: "Review deletion" }),
		).toBeEnabled();
	},
};

const saveRunDefaults = fn(async () => undefined);
const saveInference = fn(async () => undefined);
export const IndependentSettingsSaves: Story = {
	args: {
		store: createStoryStore(
			createStoryBootstrap({
				routing: {
					provider: CommonspaceRoutingProvider.Unconfigured,
					reason: RoutingConfigurationIssue.Invalid,
					message: "Saved inference configuration is invalid.",
				},
			}),
			{ mutate: saveRunDefaults, updateRoutingConfiguration: saveInference },
		),
	},
	play: async ({ canvasElement }) => {
		saveRunDefaults.mockClear();
		saveInference.mockClear();
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(page.getByRole("alert")).toHaveTextContent(
			"Saved inference configuration is invalid",
		);
		await userEvent.click(page.getByRole("tab", { name: "Agent runs" }));
		await userEvent.selectOptions(
			page.getByLabelText("Workspace reasoning"),
			"native",
		);
		await userEvent.click(
			page.getByRole("button", { name: "Save agent run settings" }),
		);
		await waitFor(() => expect(saveRunDefaults).toHaveBeenCalledOnce());
		await expect(saveInference).not.toHaveBeenCalled();
		await expect(page.getByText("Agent run settings saved.")).toBeVisible();
		await userEvent.clear(page.getByLabelText("Default max agents"));
		await userEvent.type(page.getByLabelText("Default max agents"), "9");
		await expect(
			page.queryByText("Agent run settings saved."),
		).not.toBeInTheDocument();
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await userEvent.type(
			page.getByLabelText("Routing model"),
			"synthetic-router",
		);
		await userEvent.click(
			page.getByRole("button", { name: "Save inference settings" }),
		);
		await waitFor(() => expect(saveInference).toHaveBeenCalledOnce());
		await expect(saveRunDefaults).toHaveBeenCalledOnce();
	},
};
export const EnvironmentCredentials: Story = {
	args: {
		store: createStoryStore(
			createStoryBootstrap({
				routing: {
					provider: CommonspaceRoutingProvider.OpenAiCompatible,
					model: "router",
					baseUrl: "https://api.openai.com/v1",
					apiKeyConfigured: true,
					apiKeySource: CredentialSource.Environment,
					jev: {
						enabled: true,
						model: "jev-1.13.0",
						apiKeyConfigured: true,
						apiKeySource: CredentialSource.Environment,
					},
				},
			}),
		),
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(page.getByLabelText("TypeSafe API key")).toHaveAttribute(
			"placeholder",
			"Using TYPESAFE_API_KEY from the server",
		);
		await expect(page.getByLabelText("Routing API key")).toHaveAttribute(
			"placeholder",
			"Using OPENAI_API_KEY from the server",
		);
		await userEvent.clear(page.getByLabelText("Routing API base URL"));
		await userEvent.type(
			page.getByLabelText("Routing API base URL"),
			"https://another-provider.test/v1",
		);
		await expect(page.getByLabelText("Routing API key")).toHaveAttribute(
			"placeholder",
			"Optional for providers without authentication",
		);
		await expect(
			page.queryByRole("checkbox", { name: "Clear saved TypeSafe API key" }),
		).not.toBeInTheDocument();
		await expect(
			page.queryByRole("checkbox", { name: "Clear routing API key" }),
		).not.toBeInTheDocument();
	},
};

export const SettingsCategoriesPreserveDrafts: Story = {
	args: { store: createStoryStore(apiRoutingBootstrap) },
	play: async ({ canvasElement }) => {
		const page = within(document.body);
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Commonspace settings",
			}),
		);
		await expect(page.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await waitFor(() =>
			expect(
				page.queryByRole("button", { name: "Save inference settings" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await userEvent.clear(page.getByLabelText("Routing model"));
		await userEvent.type(page.getByLabelText("Routing model"), "draft-router");
		await userEvent.click(page.getByRole("tab", { name: "Agent runs" }));
		await expect(
			page.getByRole("button", { name: "Save agent run settings" }),
		).toBeVisible();
		await waitFor(() =>
			expect(
				page.queryByRole("button", { name: "Save inference settings" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(page.getByLabelText("Routing model")).toHaveValue(
			"draft-router",
		);
		await userEvent.click(page.getByRole("tab", { name: "Data" }));
		await expect(
			page.getByRole("button", { name: "Export workspace data" }),
		).toBeVisible();
	},
};

const pendingNotificationSave = fn(async (): Promise<void> => undefined);
export const PendingNotificationSave: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			mutate: pendingNotificationSave,
		}),
	},
	play: async ({ canvasElement }) => {
		let finishSave: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			finishSave = resolve;
		});
		if (finishSave === undefined)
			throw new Error("Save resolver was not initialized");
		pendingNotificationSave.mockImplementation(() => pending);
		const canvas = within(canvasElement);
		const page = within(document.body);
		try {
			await userEvent.click(
				canvas.getByRole("button", { name: "Commonspace settings" }),
			);
			await userEvent.click(page.getByRole("tab", { name: "Notifications" }));
			await userEvent.click(
				page.getByRole("switch", { name: "Allow native notifications" }),
			);
			await userEvent.click(
				page.getByRole("button", { name: "Save notification settings" }),
			);
			await expect(
				page.getByRole("switch", { name: "Allow native notifications" }),
			).toBeDisabled();
			await expect(
				page.getByRole("switch", { name: "Notification sound" }),
			).toBeDisabled();
			await userEvent.click(
				page.getByRole("button", { name: "Close settings" }),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "Commonspace settings" }),
			);
			await userEvent.click(page.getByRole("tab", { name: "Notifications" }));
			await expect(
				page.getByRole("button", { name: "Save notification settings" }),
			).toBeDisabled();
			await expect(
				page.getByRole("switch", { name: "Allow native notifications" }),
			).toBeChecked();
		} finally {
			finishSave();
		}
		await waitFor(() =>
			expect(
				page.getByRole("button", { name: "Save notification settings" }),
			).toBeEnabled(),
		);
		await expect(page.getByText("Notification settings saved.")).toBeVisible();
	},
};
