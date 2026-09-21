import {
	CommonspaceRoutingProvider,
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

const channelPinsBootstrap = createStoryBootstrap({
	state: {
		...storyBootstrap.state,
		pins: [
			{
				id: "pin-design-note",
				scope: { kind: "channel", id: designChannel.id },
				kind: "note",
				note: "First design note",
				createdAt: "2026-09-04T10:00:00.000Z",
				removedAt: null,
			},
			{
				id: "pin-build-note",
				scope: { kind: "channel", id: buildChannel.id },
				kind: "note",
				note: "Build-only note",
				createdAt: "2026-09-04T10:01:00.000Z",
				removedAt: null,
			},
			{
				id: "pin-design-message",
				scope: { kind: "channel", id: designChannel.id },
				kind: "message",
				messageId: "message-root",
				createdAt: "2026-09-04T10:02:00.000Z",
				removedAt: null,
			},
			{
				id: "pin-design-removed",
				scope: { kind: "channel", id: designChannel.id },
				kind: "note",
				note: "Removed design note",
				createdAt: "2026-09-04T10:03:00.000Z",
				removedAt: "2026-09-04T10:04:00.000Z",
			},
		],
	},
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

export const InlineChannelPinsIndexed: Story = {
	args: {
		...meta.args,
		store: createStoryStore(channelPinsBootstrap),
	},
	render: (args) => {
		const inlineArgs = { ...args };
		delete inlineArgs.onOpenContextSettings;
		return <CommonspaceSidebar {...inlineArgs} />;
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", {
				name: "Manage agents in channel design-review",
			}),
		);
		const pins = within(
			canvas.getByRole("region", {
				name: "Channel pins for design-review",
			}),
		);
		await expect(
			pins
				.getAllByRole("button", { name: /^Remove Channel pin /u })
				.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Remove Channel pin First design note",
			"Remove Channel pin message-root",
		]);
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

export const WorkspaceSettingsDiagnostics: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			diagnostics: async () => ({
				service: {
					status: "ready",
					stateVersion: storyBootstrap.state.version,
					storage: "ready",
					projectlessWorkspace: "ready",
				},
				inference: {
					provider: CommonspaceRoutingProvider.Harness,
					location: "runtime-managed",
					configured: true,
					sends: [
						"message text",
						"Agent labels",
						"Project labels",
						"shared context",
						"routing corrections",
					],
				},
				harnesses: [
					{
						adapter: "codex",
						installed: true,
						rostered: true,
						recordedRunStatus: "has-replies",
						recovery: "Open the Agent and retry the request.",
					},
				],
			}),
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Commonspace settings" }),
		);
		const page = within(document.body);
		await userEvent.click(page.getByRole("tab", { name: "Diagnostics" }));
		await userEvent.click(
			page.getByRole("button", { name: "Run runtime diagnostics" }),
		);
		await expect(
			await page.findByText("Selected harness controls model traffic"),
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
		await userEvent.click(page.getByRole("radio", { name: /Build Smith/u }));
		await userEvent.click(
			page.getByRole("button", { name: "Save inference agent" }),
		);
		await waitFor(() => expect(saveInference).toHaveBeenCalledOnce());
		await expect(saveRunDefaults).toHaveBeenCalledOnce();
	},
};

export const SettingsCategoriesPreserveDrafts: Story = {
	args: { store: createStoryStore(storyBootstrap) },
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
				page.queryByRole("button", { name: "Save inference agent" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		const codex = page.getByRole("radio", { name: /Build Smith/u });
		await userEvent.click(codex);
		await userEvent.click(page.getByRole("tab", { name: "Agent runs" }));
		await expect(
			page.getByRole("button", { name: "Save agent run settings" }),
		).toBeVisible();
		await waitFor(() =>
			expect(
				page.queryByRole("button", { name: "Save inference agent" }),
			).not.toBeInTheDocument(),
		);
		await userEvent.click(page.getByRole("tab", { name: "Intelligence" }));
		await expect(codex).toBeChecked();
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
