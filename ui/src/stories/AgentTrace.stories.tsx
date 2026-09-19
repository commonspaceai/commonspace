import type { CommonspaceTraceEntry } from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AgentTrace, AgentTraceTimeline } from "../AgentTrace";
import { trace, traceEntries } from "./story-fixtures";

const meta = {
	title: "Components/AgentTrace",
	component: AgentTrace,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[720px] max-w-full">
				<Story />
			</div>
		),
	],
	args: { authorName: "Review Bot", trace },
} satisfies Meta<typeof AgentTrace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const trigger = canvas.getByRole("button", {
			name: "Show Hermes activity for Review Bot",
		});
		await userEvent.click(trigger);
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
	},
};

export const TimelineOnly: Story = {
	render: () => (
		<section
			aria-label="Trace timeline"
			className="w-[720px] max-w-full rounded-md border bg-background p-4"
		>
			<strong className="mb-3 block">Timeline states</strong>
			<AgentTraceTimeline entries={traceEntries} />
		</section>
	),
};

const compactionEntry = {
	type: "compaction",
	id: "compaction-1",
	status: "in_progress",
	text: "Compacting context — summarizing earlier conversation so I can continue...",
	createdAt: "2026-09-08T08:00:00.000Z",
	updatedAt: "2026-09-08T08:00:01.000Z",
} satisfies CommonspaceTraceEntry;

export const CompactionInProgress: Story = {
	render: () => <AgentTraceTimeline entries={[compactionEntry]} />,
};

export const CompactionCompleted: Story = {
	render: () => (
		<AgentTraceTimeline
			entries={[
				{
					...compactionEntry,
					status: "completed",
					text: "Context compaction complete — continuing turn...",
				},
			]}
		/>
	),
};

export const NoActivity: Story = {
	args: { trace: { ...trace, entries: [] } },
};
