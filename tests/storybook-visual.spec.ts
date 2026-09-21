import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { openStory } from "./storybook-helpers";

type StoryReady = (page: Page) => Promise<void>;

const stories: Array<{
	id: string;
	title: string;
	storyName: string;
	name: string;
	ready?: StoryReady;
}> = [
	{
		id: "design-system-agentavatar--size-and-status-matrix",
		title: "Design System/AgentAvatar",
		storyName: "Size And Status Matrix",
		name: "agent-avatar-status-and-sizes",
	},
	{
		id: "design-system-collectionactionmenu--rest",
		title: "Design System/CollectionActionMenu",
		storyName: "Rest",
		name: "collection-action-menu-rest",
	},
	{
		id: "design-system-collectionactionmenu--long-metadata",
		title: "Design System/CollectionActionMenu",
		storyName: "Long Metadata",
		name: "collection-action-menu-long-metadata",
	},
	{
		id: "design-system-collectionactionmenu--open-menu",
		title: "Design System/CollectionActionMenu",
		storyName: "Open Menu",
		name: "collection-action-menu-open",
		ready: async (page) => {
			await expect(page.getByRole("menu")).toBeVisible();
		},
	},
	{
		id: "design-system-messageactionmenu--rest",
		title: "Design System/MessageActionMenu",
		storyName: "Rest",
		name: "message-action-menu-rest",
	},
	{
		id: "design-system-messageactionmenu--open-menu",
		title: "Design System/MessageActionMenu",
		storyName: "Open Menu",
		name: "message-action-menu-open",
		ready: async (page) => {
			await expect(page.getByRole("menu")).toBeVisible();
		},
	},
	{
		id: "design-system-messageactionmenu--attachment-only",
		title: "Design System/MessageActionMenu",
		storyName: "Attachment Only",
		name: "message-action-menu-attachment-only",
	},
	{
		id: "design-system-workspaceheader--default",
		title: "Design System/WorkspaceHeader",
		storyName: "Default",
		name: "workspace-header-default",
	},
	{
		id: "design-system-workspaceheader--with-visible-close-action",
		title: "Design System/WorkspaceHeader",
		storyName: "With Visible Close Action",
		name: "workspace-header-with-close-action",
	},
	{
		id: "design-system-workspaceheader--long-title",
		title: "Design System/WorkspaceHeader",
		storyName: "Long Title",
		name: "workspace-header-long-title",
	},
	{
		id: "workspace-commonspacesearch--browse",
		title: "Workspace/CommonspaceSearch",
		storyName: "Browse",
		name: "commonspace-search-browse",
		ready: async (page) => {
			await expect(
				page.getByRole("dialog", { name: "Search Commonspace" }),
			).toBeVisible();
			await expect(
				page.getByRole("listbox", { name: "Commonspace search results" }),
			).toBeVisible();
		},
	},
	{
		id: "workspace-commonspacesearch--query-and-keyboard-selection",
		title: "Workspace/CommonspaceSearch",
		storyName: "Query And Keyboard Selection",
		name: "commonspace-search-query-and-keyboard-selection",
		ready: async (page) => {
			const input = page.getByRole("searchbox", { name: "Search Commonspace" });
			await expect(input).toHaveValue("verification");
			await expect(
				page.getByRole("option", {
					name: /Open Message: Review the visual baseline/iu,
				}),
			).toHaveAttribute("aria-selected", "true");
		},
	},
];

for (const story of stories) {
	test(`${story.name} matches the reviewed Storybook baseline`, async ({
		page,
	}) => {
		await openStory(page, {
			id: story.id,
			title: story.title,
			name: story.storyName,
		});
		if (story.id.startsWith("workspace-commonspacesearch--")) {
			await expect(
				page.getByRole("dialog", { name: "Search Commonspace" }),
			).toBeVisible();
		} else {
			await expect(page.locator("#storybook-root")).toBeVisible();
		}
		if (story.ready !== undefined) await story.ready(page);
		await expect(page).toHaveScreenshot(`${story.name}.png`, {
			fullPage: true,
		});
	});
}
