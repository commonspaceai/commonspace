import type { ConversationRef } from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	type CommonspaceRoute,
	commonspaceRouteHref,
	createCommonspaceRouter,
	createMemoryHistory,
} from "../app-shell/commonspace-router";
import { CommonspaceApp } from "../CommonspaceApp";
import type { CommonspaceDirectoryKind } from "../CommonspaceDirectory";
import type { CommonspaceStore } from "../commonspace-store";
import {
	createStoryStore,
	denseStoryBootstrap,
	discoveryStoryBootstrap,
	emptyBootstrap,
	emptySearchFetcher,
	errorSearchFetcher,
	failedStoryBootstrap,
	pendingSearchFetcher,
	primaryProject,
	runtimeStoryBootstrap,
	storyBootstrap,
	storyProjectFetcher,
	storySearchFetcher,
} from "./story-fixtures";

type ScreenDestination =
	| "conversation"
	| "directory"
	| "inbox"
	| "project"
	| "threads";

interface CommonspaceScreenProps {
	destination: ScreenDestination;
	store: CommonspaceStore;
	directoryKind?: CommonspaceDirectoryKind;
	projectId?: string;
	conversation?: ConversationRef;
	threadId?: string;
	projectFetcher?: typeof globalThis.fetch;
	searchFetcher?: typeof globalThis.fetch;
}

const storyRouter = createCommonspaceRouter({
	history: createMemoryHistory({ initialEntries: ["/"] }),
});

function screenRoute({
	destination,
	directoryKind,
	projectId,
	conversation,
	threadId,
}: Pick<
	CommonspaceScreenProps,
	"destination" | "directoryKind" | "projectId" | "conversation" | "threadId"
>): CommonspaceRoute {
	if (destination === "directory")
		return { kind: "directory", directory: directoryKind ?? "projects" };
	if (destination === "project" && projectId !== undefined)
		return { kind: "project", projectId };
	if (destination === "threads") return { kind: "threads" };
	if (destination === "conversation" && conversation !== undefined) {
		const route: CommonspaceRoute = {
			kind: "conversation",
			conversation,
		};
		if (threadId !== undefined && route.kind === "conversation")
			route.threadId = threadId;
		return route;
	}
	return { kind: "inbox", view: "attention" };
}

function CommonspaceScreen({
	destination,
	store,
	directoryKind = "projects",
	projectId,
	conversation,
	threadId,
	projectFetcher,
	searchFetcher,
}: CommonspaceScreenProps) {
	const routeInput: Pick<
		CommonspaceScreenProps,
		"destination" | "directoryKind" | "projectId" | "conversation" | "threadId"
	> = { destination, directoryKind };
	if (projectId !== undefined) routeInput.projectId = projectId;
	if (conversation !== undefined) routeInput.conversation = conversation;
	if (threadId !== undefined) routeInput.threadId = threadId;
	const initialPath = commonspaceRouteHref(
		storyRouter,
		screenRoute(routeInput),
	);
	return (
		<CommonspaceApp
			store={store}
			initialPath={initialPath}
			{...(projectFetcher === undefined ? {} : { projectFetcher })}
			{...(searchFetcher === undefined ? {} : { searchFetcher })}
		/>
	);
}

const meta = {
	title: "Screens/Workspace",
	component: CommonspaceScreen,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-dvh w-full">
				<Story />
			</div>
		),
	],
	args: {
		destination: "inbox",
		store: createStoryStore(storyBootstrap),
		searchFetcher: storySearchFetcher,
	},
} satisfies Meta<typeof CommonspaceScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const channel = { kind: "channel" as const, id: "channel-design" };
const directMessage = { kind: "dm" as const, id: "agent-hermes" };

export const InboxAttention: Story = {};

export const SearchTypeFilter: Story = {
	tags: ["smoke"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			canvas.getByRole("button", {
				name: "Search messages, channels, and agents",
			}),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Search Commonspace" }),
		);
		await userEvent.click(
			dialog.getByRole("button", { name: "Filter result types: All types" }),
		);
		await userEvent.click(
			await page.findByRole("menuitemcheckbox", { name: "Messages" }),
		);
		await userEvent.keyboard("{Escape}");
		const list = within(
			await dialog.findByRole("listbox", {
				name: "Commonspace search results",
			}),
		);
		await expect(list.getAllByRole("option")).toHaveLength(1);
		await expect(
			list.getByRole("option", { name: /Open Message:/u }),
		).toBeVisible();
	},
};

export const InboxActivity: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const activity = canvas.getByRole("button", { name: /^Activity/iu });
		await userEvent.click(activity);
		await expect(activity).toHaveAttribute("aria-pressed", "true");
	},
};

export const InboxSessions: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const sessions = canvas.getByRole("button", { name: /Sessions/iu });
		await userEvent.click(sessions);
		await expect(sessions).toHaveAttribute("aria-pressed", "true");
		const filters = canvas.getByRole("group", {
			name: "Session status filter",
		});
		await userEvent.click(
			within(filters).getByRole("button", { name: "Completed" }),
		);
		await expect(
			canvas.getAllByRole("button", { name: /session for/iu }),
		).toHaveLength(2);
		await userEvent.click(
			within(filters).getByRole("button", { name: "Running" }),
		);
		await expect(canvas.getByText("No matching sessions.")).toBeVisible();
	},
};

export const FailedSession: Story = {
	args: { store: createStoryStore(failedStoryBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /Sessions/iu }));
		await expect(
			canvas.getByText(/local agent process exited/iu),
		).toBeVisible();
		await expect(canvas.getByText("Failed", { exact: true })).toBeVisible();
	},
};

export const DenseInboxActivity: Story = {
	args: { store: createStoryStore(denseStoryBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Activity/iu }));
		await expect(
			canvas.getAllByRole("button", { name: /Open/iu }).length,
		).toBeGreaterThan(4);
	},
};

export const DenseInboxUnread: Story = {
	args: { store: createStoryStore(denseStoryBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Activity/iu }));
		const filters = canvas.getByRole("group", { name: "Inbox filter" });
		const unread = within(filters).getByRole("button", { name: /Unread/iu });
		await userEvent.click(unread);
		await expect(unread).toHaveAttribute("aria-pressed", "true");
		await expect(unread).toHaveAccessibleName("Unread 9");
		await expect(
			within(canvas.getByRole("list")).getAllByRole("button", {
				name: /^Open /u,
			}),
		).toHaveLength(9);
	},
};

export const InboxSaved: Story = {
	args: { store: createStoryStore(denseStoryBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: /^Activity/iu }));
		const filters = canvas.getByRole("group", { name: "Inbox filter" });
		const saved = within(filters).getByRole("button", { name: /Saved/iu });
		await userEvent.click(saved);
		await expect(saved).toHaveAttribute("aria-pressed", "true");
		const savedItems = within(canvas.getByRole("list")).getAllByRole("button", {
			name: /^Open /u,
		});
		await expect(savedItems).toHaveLength(1);
		await expect(savedItems[0]).toHaveTextContent(
			"I found the current visual baseline.",
		);
	},
};

export const Threads: Story = {
	args: { destination: "threads" },
};

export const DenseThreads: Story = {
	args: {
		destination: "threads",
		store: createStoryStore(denseStoryBootstrap),
	},
};

export const UnreadThreads: Story = {
	args: {
		destination: "threads",
		store: createStoryStore(denseStoryBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const filters = canvas.getByRole("group", { name: "Thread filter" });
		const unread = within(filters).getByRole("button", { name: /Unread/iu });
		await userEvent.click(unread);
		await expect(unread).toHaveAttribute("aria-pressed", "true");
	},
};

export const FollowingThreads: Story = {
	args: {
		destination: "threads",
		store: createStoryStore(denseStoryBootstrap),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const following = canvas.getByRole("button", { name: /Following/iu });
		await userEvent.click(following);
		await expect(following).toHaveAttribute("aria-pressed", "true");
	},
};

export const ProjectsDirectory: Story = {
	args: { destination: "directory", directoryKind: "projects" },
};

export const ChannelsDirectory: Story = {
	args: { destination: "directory", directoryKind: "channels" },
};

export const AgentsDirectory: Story = {
	args: { destination: "directory", directoryKind: "agents" },
};

export const ChannelConversation: Story = {
	args: {
		destination: "conversation",
		conversation: channel,
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
};

export const ThreadConversation: Story = {
	args: {
		destination: "conversation",
		conversation: channel,
		threadId: "thread-review",
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
};

function ThreadPresentationPreview({ width }: { width: number }) {
	const [store] = useState(() =>
		createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeThreadId: "thread-review",
		}),
	);
	return (
		<div style={{ width, height: "100vh" }}>
			<CommonspaceScreen
				destination="conversation"
				conversation={channel}
				threadId="thread-review"
				store={store}
			/>
		</div>
	);
}

export const ThreadRightOverlay: Story = {
	...ThreadConversation,
	render: () => <ThreadPresentationPreview width={1000} />,
	tags: ["smoke"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const thread = await canvas.findByRole("complementary", {
			name: "Thread replies",
		});
		const primary = canvasElement.querySelector(
			".commonspace-conversation-primary",
		);
		await waitFor(() => {
			expect(primary).toBeVisible();
			expect(primary).toHaveAttribute("inert");
			const bounds = primary?.getBoundingClientRect();
			if (bounds === undefined) throw new Error("Conversation missing");
			expect(thread.getBoundingClientRect().left).toBeLessThan(bounds.right);
			expect(
				Math.abs(thread.getBoundingClientRect().right - bounds.right),
			).toBeLessThan(2);
		});
		await userEvent.click(canvas.getByRole("button", { name: "Close thread" }));
		await waitFor(() => {
			expect(
				canvasElement.querySelector(".commonspace-thread-panel"),
			).toBeNull();
			expect(
				canvasElement.querySelector(".commonspace-conversation-primary"),
			).not.toHaveAttribute("inert");
			expect(
				canvas.getByPlaceholderText("Start a new Thread in #design-review"),
			).toHaveFocus();
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "1 reply, 1 unread" }),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Close thread" }),
			).toHaveFocus(),
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(
				canvasElement.querySelector(".commonspace-thread-panel"),
			).toBeNull(),
		);
	},
};

export const ThreadDocked: Story = {
	...ThreadConversation,
	render: () => <ThreadPresentationPreview width={1440} />,
	tags: ["smoke"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const thread = await canvas.findByRole("complementary", {
			name: "Thread replies",
		});
		await waitFor(() => {
			const primary = canvasElement.querySelector(
				".commonspace-conversation-primary",
			);
			expect(primary).toBeVisible();
			expect(primary).not.toHaveAttribute("inert");
			const bounds = primary?.getBoundingClientRect();
			if (bounds === undefined) throw new Error("Conversation missing");
			expect(thread.getBoundingClientRect().left).toBeGreaterThanOrEqual(
				bounds.right,
			);
			expect(
				Math.abs(thread.getBoundingClientRect().top - bounds.top),
			).toBeLessThan(2);
		});
		await expect(
			canvas.getByRole("separator", { name: "Resize thread" }),
		).toBeVisible();
	},
};

export const DirectMessage: Story = {
	args: {
		destination: "conversation",
		conversation: directMessage,
		store: createStoryStore(storyBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
};

export const DirectMessageRuntime: Story = {
	args: {
		destination: "conversation",
		conversation: directMessage,
		store: createStoryStore(runtimeStoryBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("region", {
				name: "Permission request from Review Bot",
			}),
		).toBeVisible();
		await expect(
			canvas.getByRole("region", { name: "Queued follow-ups" }),
		).toBeVisible();
	},
};

export const DirectMessageFailure: Story = {
	args: {
		destination: "conversation",
		conversation: directMessage,
		store: createStoryStore(failedStoryBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
};

export const SlashCommandSuggestions: Story = {
	args: {
		destination: "conversation",
		conversation: directMessage,
		store: createStoryStore(storyBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "Message Review Bot" }),
			"/",
		);
		await expect(
			canvas.getByRole("listbox", { name: "Slash commands" }),
		).toBeVisible();
	},
};

export const ProjectReferenceSuggestions: Story = {
	args: {
		destination: "conversation",
		conversation: channel,
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "Post in design-review" }),
			"@@",
		);
		await expect(
			canvas.getByRole("listbox", { name: "Tag suggestions" }),
		).toBeVisible();
	},
};

export const DirectMessageNewChatConfirmation: Story = {
	args: {
		destination: "conversation",
		conversation: directMessage,
		store: createStoryStore(storyBootstrap, {
			activeConversation: directMessage,
			activeProjectId: primaryProject.id,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const composer = canvas.getByRole("textbox", {
			name: "Message Review Bot",
		});
		await userEvent.type(composer, "/new");
		await userEvent.keyboard("{Enter}");
		await expect(
			canvas.getByRole("status", { name: "Command result" }),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Start new chat" }),
		).toBeVisible();
	},
};

export const ThreadContextOpen: Story = {
	args: {
		destination: "conversation",
		conversation: channel,
		threadId: "thread-review",
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const reply = canvas.getByRole("textbox", { name: "Reply in thread" });
		await userEvent.type(reply, "Keep this draft");
		await userEvent.click(
			canvas.getByRole("button", { name: "Open thread context" }),
		);
		await expect(
			canvas.getByRole("region", { name: "Thread context" }),
		).toBeVisible();
		await expect(reply).not.toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "Back to replies" }),
		);
		await expect(reply).toHaveValue("Keep this draft");
		await expect(reply).toBeVisible();
		await waitFor(() => expect(reply).toHaveFocus());
		await userEvent.click(
			canvas.getByRole("button", { name: "Open thread context" }),
		);
		await expect(
			canvas.getByRole("region", { name: "Thread context" }),
		).toBeVisible();
		await expect(reply).not.toBeVisible();
	},
};

export const ProjectFiles: Story = {
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
};

export const ProjectConversations: Story = {
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Conversations" }));
		await expect(
			canvas.getByRole("tab", { name: "Conversations" }),
		).toHaveAttribute("aria-selected", "true");
		const project = within(
			canvas.getByRole("main", { name: "Project Commonspace" }),
		);
		const conversations = project.getAllByRole("button", {
			name: /^Open (?:channel|direct message)/u,
		});
		await expect(
			conversations.map((button) => button.getAttribute("aria-label")),
		).toEqual([
			"Open channel design-review",
			"Open channel builds",
			"Open direct message Review Bot",
		]);
		await expect(conversations[0]).toHaveTextContent(
			"I found the current visual baseline.",
		);
		await expect(conversations[1]).toHaveTextContent(
			"Run the focused Storybook checks.",
		);
		await expect(conversations[2]).toHaveTextContent(
			"The shell and project panes are the remaining high-value surfaces.",
		);
	},
};

export const ProjectChanges: Story = {
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Changes" }));
		await expect(canvas.getByRole("tab", { name: "Changes" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	},
};

export const ProjectSettings: Story = {
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open project settings" }),
		);
		await expect(
			canvas.getByRole("complementary", { name: "Project settings" }),
		).toBeVisible();
	},
};

export const GlobalSearch: Story = {
	args: { store: createStoryStore(storyBootstrap, { interactive: true }) },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		const dialog = page.getByRole("dialog", { name: "Search Commonspace" });
		await waitFor(() => expect(dialog).toBeVisible());
		const result = page.getByRole("option", {
			name: /Open Channel: #design-review/iu,
		});
		await waitFor(() => expect(result).toBeVisible());
	},
};

export const SearchOpensConversation: Story = {
	args: { store: createStoryStore(storyBootstrap, { interactive: true }) },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		await userEvent.click(
			await page.findByRole("option", {
				name: /Open Message: Review the visual baseline/iu,
			}),
		);
		await expect(
			await page.findByRole("region", { name: "design-review posts" }),
		).toBeVisible();
		await expect(
			page.queryByRole("dialog", { name: "Search Commonspace" }),
		).not.toBeInTheDocument();
		const target = canvasElement.querySelector<HTMLElement>(
			"#commonspace-message-message-root",
		);
		if (target === null) throw new Error("Expected the recovered message.");
		await waitFor(() => expect(target).toHaveFocus());
		await expect(target).toHaveAttribute("aria-current", "true");
	},
};

export const GlobalSearchNoResults: Story = {
	args: { searchFetcher: emptySearchFetcher },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		await userEvent.type(
			page.getByRole("searchbox", { name: "Search Commonspace" }),
			"missing result",
		);
		await expect(
			page.getByText("No results for “missing result”."),
		).toBeVisible();
	},
};

export const GlobalSearchFailure: Story = {
	args: { searchFetcher: errorSearchFetcher },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		await expect(page.getByRole("alert")).toHaveTextContent(
			"Search is temporarily unavailable.",
		);
	},
};

export const GlobalSearchPending: Story = {
	args: { searchFetcher: pendingSearchFetcher },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		const status = page.getByText("Searching…");
		await waitFor(() => expect(status).toBeVisible());
	},
};

export const WorkspaceSettings: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			page.getByRole("button", { name: "Commonspace settings" }),
		);
		await expect(
			page.getByRole("region", { name: "Workspace settings" }),
		).toBeVisible();
	},
};

export const AddProject: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(page.getByRole("button", { name: "Add project" }));
		const dialog = page.getByRole("dialog", { name: "Add a project" });
		await waitFor(() => expect(dialog).toBeVisible());
	},
};

export const AddChannel: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(page.getByRole("button", { name: "Add channel" }));
		const dialog = page.getByRole("dialog", { name: "Add a channel" });
		await waitFor(() => expect(dialog).toBeVisible());
	},
};

export const AddAgent: Story = {
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(page.getByRole("button", { name: "Add agent" }));
		const dialog = within(
			await page.findByRole("dialog", { name: "Add an agent" }),
		);
		const choices = dialog.getByRole("group", { name: "Coding agents" });
		for (const label of [
			"Codex",
			"Hermes",
			"Claude Code",
			"Gemini CLI",
			"OpenCode",
		]) {
			await expect(
				within(choices).getByRole("button", { name: `Choose ${label}` }),
			).toHaveAttribute("aria-pressed", "false");
		}
		await expect(dialog.queryByRole("region")).toBeNull();
	},
};

export const AddAgentDiscoveredResults: Story = {
	args: { store: createStoryStore(discoveryStoryBootstrap) },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.click(page.getByRole("button", { name: "Add agent" }));
		await userEvent.click(page.getByRole("button", { name: "Choose Hermes" }));
		await waitFor(() =>
			expect(
				page.getByRole("button", {
					name: "Add discovered agent Hermes Reviewer",
				}),
			).toBeVisible(),
		);
		const dialog = within(page.getByRole("dialog", { name: "Add an agent" }));
		await expect(
			dialog.getByRole("region", { name: "Hermes agent discovery" }),
		).toBeVisible();
		await expect(
			dialog.getByRole("heading", { name: "Found agents" }),
		).toBeVisible();
		await expect(
			dialog.getByRole("checkbox", { name: /Full access/u }),
		).toBeVisible();
	},
};

function discoveredHarnessStory(label: string): Story {
	return {
		args: { store: createStoryStore(discoveryStoryBootstrap) },
		play: async ({ canvasElement }) => {
			const page = within(canvasElement.ownerDocument.body);
			await userEvent.click(page.getByRole("button", { name: "Add agent" }));
			await userEvent.click(
				page.getByRole("button", { name: `Choose ${label}` }),
			);
			await waitFor(() =>
				expect(
					page.getByRole("button", { name: `Add discovered agent ${label}` }),
				).toBeVisible(),
			);
			await expect(
				page.queryByRole("button", {
					name: "Add discovered agent Hermes Reviewer",
				}),
			).not.toBeInTheDocument();
		},
	};
}

export const AddClaudeCode = discoveredHarnessStory("Claude Code");
export const AddGemini = discoveredHarnessStory("Gemini CLI");
export const AddOpenCode = discoveredHarnessStory("OpenCode");

export const EmptyWorkspace: Story = {
	args: { store: createStoryStore(emptyBootstrap) },
};

export const LoadingWorkspace: Story = {
	args: { store: createStoryStore(null, { loading: true }) },
};

export const DisconnectedWorkspace: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			error: "Live updates disconnected; retrying…",
		}),
	},
};

export const NarrowInbox: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
};

export const NarrowNavigation: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open navigation" }),
		);
		await expect(
			canvas.getAllByRole("button", { name: "Close navigation" })[0],
		).toBeVisible();
	},
};

export const NarrowChannelConversation: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	args: {
		destination: "conversation",
		conversation: channel,
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
		}),
	},
};

export const NarrowThreadConversation: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	args: {
		destination: "conversation",
		conversation: channel,
		threadId: "thread-review",
		store: createStoryStore(storyBootstrap, {
			activeConversation: channel,
			activeProjectId: primaryProject.id,
			activeThreadId: "thread-review",
		}),
	},
};

export const NarrowProjectFiles: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
};

export const NarrowProjectSettings: Story = {
	args: {
		destination: "project",
		projectId: primaryProject.id,
		projectFetcher: storyProjectFetcher,
	},
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Open project settings" }),
		);
		await expect(
			canvas.getByRole("complementary", { name: "Project settings" }),
		).toBeVisible();
	},
};

export const NarrowSearch: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	play: async ({ canvasElement }) => {
		const page = within(canvasElement.ownerDocument.body);
		await userEvent.keyboard("{Control>}k{/Control}");
		const dialog = page.getByRole("dialog", { name: "Search Commonspace" });
		await waitFor(() => expect(dialog).toBeVisible());
	},
};

export const CaughtUpNextAction: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "View activity" }),
		);
		await expect(
			canvas.getByRole("button", { name: /^Activity/ }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			canvas.getAllByRole("button", { name: /^Open completed/ }).length,
		).toBeGreaterThan(0);
	},
};

function settingsCategoryStory(category: string): Story {
	return {
		...WorkspaceSettings,
		play: async ({ canvasElement }) => {
			const page = within(canvasElement.ownerDocument.body);
			await userEvent.click(
				within(canvasElement).getByRole("button", {
					name: "Commonspace settings",
				}),
			);
			await userEvent.click(page.getByRole("tab", { name: category }));
			await expect(page.getByRole("tab", { name: category })).toHaveAttribute(
				"aria-selected",
				"true",
			);
		},
	};
}
export const SettingsIntelligence = settingsCategoryStory("Intelligence");
export const SettingsAgentRuns = settingsCategoryStory("Agent runs");
export const SettingsNotifications = settingsCategoryStory("Notifications");
export const SettingsDiagnostics = settingsCategoryStory("Diagnostics");
export const SettingsData = settingsCategoryStory("Data");
