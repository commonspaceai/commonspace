import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookmarkIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { AgentAvatar } from "@/design-system/AgentAvatar";
import { CollectionToolbar } from "@/design-system/CollectionToolbar";
import { UnreadCount } from "@/design-system/UnreadCount";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { uiReviewCatalog } from "./review-catalog";

const agent = {
	displayName: "Review Bot",
	avatarEmoji: "🔎",
	accentColor: "#635bff",
	status: "running" as const,
};

function ComponentPatterns() {
	const [filter, setFilter] = useState("all");
	return (
		<main
			aria-label="Component review"
			className="bg-background text-foreground"
		>
			<WorkspaceHeader
				title="Shared component review"
				subtitle="Production components · switch Light / Dark in the toolbar"
				mark={<BookmarkIcon />}
			/>
			<div className="mx-auto grid max-w-5xl gap-8 p-6">
				<p className="text-sm text-muted-foreground">
					Rendering and passing interactions do not establish visual acceptance.
					Compare the owners here, then inspect their assembled screens below.
				</p>
				<section className="grid gap-3" aria-labelledby="review-actions">
					<h2 id="review-actions" className="text-sm font-semibold">
						Actions
					</h2>
					<div className="flex flex-wrap items-center gap-3">
						<Button>
							<PlusIcon /> Add channel
						</Button>
						<Button variant="outline">Cancel</Button>
						<Button variant="ghost">View details</Button>
						<Button variant="destructive">Remove agent</Button>
						<Button disabled>Saving…</Button>
						<Button variant="ghost" size="icon-sm" aria-label="Close preview">
							<XIcon />
						</Button>
					</div>
				</section>
				<section className="grid gap-3" aria-labelledby="review-filters">
					<h2 id="review-filters" className="text-sm font-semibold">
						Collection controls
					</h2>
					<CollectionToolbar className="px-0">
						<fieldset aria-label="Review filter" className="flex gap-1">
							{(["all", "unread", "saved"] as const).map((value) => (
								<Button
									key={value}
									variant="filter"
									size="compact"
									aria-pressed={filter === value}
									onClick={() => setFilter(value)}
								>
									{value === "all"
										? "All"
										: value === "unread"
											? "Unread"
											: "Saved"}
								</Button>
							))}
						</fieldset>
						<label
							htmlFor="review-order"
							className="flex items-center gap-3 text-xs"
						>
							Order
							<NativeSelect id="review-order" defaultValue="recent">
								<option value="recent">Recent activity</option>
								<option value="name">Name A–Z</option>
							</NativeSelect>
						</label>
					</CollectionToolbar>
					<p className="text-xs text-muted-foreground" role="status">
						Selected filter: {filter}
					</p>
				</section>
				<section className="grid gap-3" aria-labelledby="review-identity">
					<h2 id="review-identity" className="text-sm font-semibold">
						One agent, every context
					</h2>
					<div className="flex flex-wrap items-end gap-8">
						{(["sm", "stack", "md", "activity", "lg", "profile"] as const).map(
							(size) => (
								<div key={size} className="grid justify-items-center gap-2">
									<AgentAvatar
										agent={agent}
										size={size}
										ariaLabel={`Review Bot, ${size}`}
									/>
									<span className="text-xs text-muted-foreground">{size}</span>
								</div>
							),
						)}
						<div className="grid justify-items-center gap-2">
							<AgentAvatar fallbackName="Removed agent" />
							<span className="text-xs text-muted-foreground">
								Unavailable identity
							</span>
						</div>
					</div>
					<div className="flex items-center gap-3 text-xs">
						<span>Unread counts</span>
						<UnreadCount count={2} />
						<UnreadCount count={24} />
						<UnreadCount count={120} />
					</div>
				</section>
				<section className="grid gap-3" aria-labelledby="review-screens">
					<h2 id="review-screens" className="text-sm font-semibold">
						Review in context
					</h2>
					<ul className="divide-y">
						{uiReviewCatalog.slice(1).map((story) => (
							<li key={story.id} className="grid gap-1 py-3">
								<a
									className="text-sm font-medium text-primary underline-offset-4 hover:underline"
									href={`/?path=/story/${story.id}`}
									target="_top"
								>
									{story.name}
								</a>
								<p className="text-xs text-muted-foreground">
									{story.question}
								</p>
							</li>
						))}
					</ul>
				</section>
			</div>
		</main>
	);
}

const meta = {
	title: "Review/Component System",
	component: ComponentPatterns,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ComponentPatterns>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SharedPatterns: Story = {
	name: "Shared patterns",
	tags: ["smoke"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const filter = within(canvas.getByRole("group", { name: "Review filter" }));
		await userEvent.click(filter.getByRole("button", { name: "Unread" }));
		await expect(
			filter.getByRole("button", { name: "Unread" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(filter.getByRole("button", { name: "All" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	},
};
