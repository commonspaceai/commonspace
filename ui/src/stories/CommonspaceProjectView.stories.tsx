import type { CommonspaceMessage } from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CommonspaceProjectView } from "../CommonspaceProjectView";
import { COMMONSPACE_RESIZABLE_PANEL } from "../design-system/useResizablePanel";
import {
	createStoryBootstrap,
	createStoryStore,
	designChannel,
	emptyBootstrap,
	primaryProject,
	secondaryProject,
	storyBootstrap,
	storyProjectFetcher,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceProjectView",
	component: CommonspaceProjectView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen min-h-[720px] w-full">
				<Story />
			</div>
		),
	],
	args: {
		projectId: primaryProject.id,
		store: createStoryStore(storyBootstrap),
		onBack: fn(),
		onOpenConversation: fn(),
		fetcher: storyProjectFetcher,
	},
} satisfies Meta<typeof CommonspaceProjectView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectFiles: Story = {};

export const FocusedFile: Story = {
	args: { targetFile: { rootIndex: 0, path: "README.md" } },
};

const unrelatedProjectMessage = {
	id: "message-unrelated-project",
	conversation: { kind: "channel", id: designChannel.id },
	authorType: "user",
	authorId: "sample-user",
	authorName: "You",
	text: "This later message belongs only to Platform.",
	createdAt: "2026-09-03T10:01:00.000Z",
	projectIds: [secondaryProject.id],
	projectId: secondaryProject.id,
} satisfies CommonspaceMessage;

const mixedProjectBootstrap = createStoryBootstrap({
	state: {
		...storyBootstrap.state,
		messages: {
			...storyBootstrap.state.messages,
			[`channel:${designChannel.id}`]: [
				...(storyBootstrap.state.messages[`channel:${designChannel.id}`] ?? []),
				unrelatedProjectMessage,
			],
		},
	},
});

export const MixedProjectConversations: Story = {
	args: { store: createStoryStore(mixedProjectBootstrap) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Conversations" }));
		const designReview = canvas.getByRole("button", {
			name: "Open channel design-review",
		});
		await expect(designReview).toHaveTextContent(
			"I found the current visual baseline.",
		);
		await expect(designReview).not.toHaveTextContent(
			unrelatedProjectMessage.text,
		);
	},
};

export const ProjectSettings: Story = {
	args: { settingsRequest: 1 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const settings = await canvas.findByRole("complementary", {
			name: "Project settings",
		});
		await expect(settings).toBeVisible();
		const resizer = canvas.queryByRole("separator", {
			name: "Resize settings",
		});
		if (resizer === null) {
			return;
		}
		const initial = Number(resizer.getAttribute("aria-valuenow"));
		resizer.focus();
		await userEvent.keyboard("{ArrowRight}");
		await expect(resizer).toHaveAttribute(
			"aria-valuenow",
			String(
				Math.max(
					COMMONSPACE_RESIZABLE_PANEL.min,
					initial - COMMONSPACE_RESIZABLE_PANEL.step,
				),
			),
		);
		await userEvent.dblClick(resizer);
		await expect(resizer).toHaveAttribute(
			"aria-valuenow",
			String(COMMONSPACE_RESIZABLE_PANEL.defaultValue),
		);
	},
};

export const UnavailableProject: Story = {
	args: {
		projectId: "missing-project",
		store: createStoryStore(emptyBootstrap),
	},
};
