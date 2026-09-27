import type { Meta, StoryObj } from "@storybook/react-vite";
import { RouterProvider } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { expect, within } from "storybook/test";
import { CommonspaceWorkspace } from "../app-shell/CommonspaceWorkspace";
import {
	createCommonspaceRouter,
	createMemoryHistory,
} from "../app-shell/commonspace-router";
import { useCommonspaceNavigation } from "../app-shell/useCommonspaceNavigation";
import type { CommonspaceStore } from "../commonspace-store";
import {
	createStoryStore,
	emptyBootstrap,
	storyBootstrap,
	storyProjectFetcher,
} from "./story-fixtures";

function WorkspaceCanvas({ store }: { store: CommonspaceStore }) {
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const navigation = useCommonspaceNavigation(store, snapshot);
	return (
		<div className="h-dvh bg-background text-foreground">
			<CommonspaceWorkspace
				store={store}
				snapshot={snapshot}
				navigation={navigation}
				onboarding={false}
				projectFetcher={storyProjectFetcher}
			/>
		</div>
	);
}

function WorkspacePreview({
	store,
	initialPath,
}: {
	store: CommonspaceStore;
	initialPath: string;
}) {
	const router = useMemo(
		() =>
			createCommonspaceRouter({
				history: createMemoryHistory({ initialEntries: [initialPath] }),
			}),
		[initialPath],
	);
	return (
		<RouterProvider
			router={router}
			context={{ app: <WorkspaceCanvas store={store} /> }}
		/>
	);
}

const meta = {
	title: "Shell/Workspace",
	component: WorkspacePreview,
	parameters: { layout: "fullscreen" },
	args: { store: createStoryStore(storyBootstrap), initialPath: "/" },
} satisfies Meta<typeof WorkspacePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};
export const Empty: Story = {
	args: { store: createStoryStore(emptyBootstrap) },
};
export const Loading: Story = {
	tags: ["smoke"],
	args: { store: createStoryStore(null, { loading: true }) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole("status")).toHaveTextContent(
			"Opening workspace",
		);
		await expect(
			canvas.queryByText("You’re all caught up."),
		).not.toBeInTheDocument();
	},
};
export const ConnectionFailed: Story = {
	args: {
		store: createStoryStore(null, {
			error: "Could not reach the local Commonspace service.",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"Workspace unavailable",
		);
		await expect(
			canvas.getByRole("button", { name: "Try again" }),
		).toBeEnabled();
		await expect(
			canvas.queryByText("You’re all caught up."),
		).not.toBeInTheDocument();
	},
};
export const RefreshingExistingWorkspace: Story = {
	args: { store: createStoryStore(storyBootstrap, { loading: true }) },
};
export const Projects: Story = {
	render: (args) => (
		<WorkspacePreview store={args.store} initialPath="/projects" />
	),
};
export const Threads: Story = {
	render: (args) => (
		<WorkspacePreview store={args.store} initialPath="/threads" />
	),
};
export const Project: Story = {
	render: (args) => (
		<WorkspacePreview
			store={args.store}
			initialPath="/projects/project-commonspace"
		/>
	),
};
export const Conversation: Story = {
	args: {
		store: createStoryStore(storyBootstrap, {
			activeConversation: { kind: "channel", id: "channel-design" },
		}),
	},
	render: (args) => (
		<WorkspacePreview
			store={args.store}
			initialPath="/channels/channel-design"
		/>
	),
};
