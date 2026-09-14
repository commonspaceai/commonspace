import type {
	CommonspaceProject,
	CommonspaceSearchResponse,
	CommonspaceSearchResult,
} from "@commonspace/shared";
import { COMMONSPACE_SEARCH_KINDS } from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { CommonspaceSearchDialog } from "../CommonspaceSearch";
import { errorSearchFetcher, pendingSearchFetcher } from "./story-fixtures";

const project: CommonspaceProject = {
	id: "platform",
	name: "Platform",
	paths: ["/workspace/platform"],
	createdAt: "2026-09-03T00:00:00.000Z",
};

const results: CommonspaceSearchResult[] = [
	{
		id: "channel-verification",
		kind: "channel",
		projectIds: ["reference"],
		title: "#verification",
		detail: "Channel",
		receipt: "Channel",
		occurredAt: "2026-09-03T10:00:00.000Z",
		highlights: [],
		target: {
			kind: "conversation",
			conversation: { kind: "channel", id: "verification" },
		},
	},
	{
		id: "message-review",
		kind: "message",
		projectIds: [project.id],
		title: "Review the visual baseline",
		detail: "Ralph · verification",
		receipt: "verification",
		occurredAt: "2026-09-03T10:02:00.000Z",
		highlights: [],
		target: {
			kind: "conversation",
			conversation: { kind: "channel", id: "verification" },
			messageId: "message-review",
		},
	},
	{
		id: "file-baseline",
		kind: "file",
		projectIds: [project.id],
		title: "visual-baseline.png",
		detail: "image/png · 128 KB",
		receipt: "Platform",
		highlights: [],
		target: {
			kind: "project-file",
			projectId: "platform",
			rootIndex: 0,
			path: "visual-baseline.png",
		},
	},
];

const fetcher: typeof globalThis.fetch = async (input) => {
	const url = new URL(String(input), "http://storybook.local");
	const query = url.searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
	const kinds = COMMONSPACE_SEARCH_KINDS.filter((kind) =>
		url.searchParams.get("types")?.split(",").includes(kind),
	);
	const projectId = url.searchParams.get("project");
	const filtered = results.filter(
		(result) =>
			`${result.title} ${result.detail}`.toLocaleLowerCase().includes(query) &&
			(kinds.length === 0 || kinds.includes(result.kind)) &&
			(projectId === null || result.projectIds?.includes(projectId)),
	);
	const response: CommonspaceSearchResponse = {
		query,
		results: filtered,
		appliedFilters: { kinds, projectId },
		truncated: false,
	};
	return new Response(JSON.stringify(response), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
};

const meta = {
	title: "Workspace/CommonspaceSearch",
	component: CommonspaceSearchDialog,
	parameters: { layout: "fullscreen" },
	args: {
		projects: [
			project,
			{
				...project,
				id: "reference",
				name: "Reference notes",
				paths: ["/workspace/reference"],
			},
		],
		fetcher,
		onClose: fn(),
		onSelect: fn(),
	},
} satisfies Meta<typeof CommonspaceSearchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Browse: Story = {};

export const ProjectDestination: Story = {
	args: {
		fetcher: async () =>
			new Response(
				JSON.stringify({
					query: "",
					results: [
						{
							id: "project:platform",
							kind: "project",
							title: project.name,
							detail: "1 folder",
							receipt: "Project",
							projectIds: [project.id],
							highlights: [],
							target: { kind: "project", projectId: project.id },
						},
					],
					appliedFilters: { kinds: [], projectId: null },
					truncated: false,
				} satisfies CommonspaceSearchResponse),
				{ headers: { "content-type": "application/json" } },
			),
	},
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		const option = await body.findByRole("option", {
			name: "Open Project: Platform",
		});
		await waitFor(() => expect(option).toBeVisible());
		await expect(
			within(option).getAllByText("Project", { exact: true }),
		).toHaveLength(1);
		await userEvent.click(body.getByRole("searchbox"));
		await userEvent.keyboard("{Enter}");
		await expect(args.onSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				target: { kind: "project", projectId: project.id },
			}),
		);
	},
};

export const DenseResults: Story = {
	args: {
		fetcher: async (input, init) => {
			const response = await fetcher(input, init);
			const data: CommonspaceSearchResponse = await response.json();
			return new Response(
				JSON.stringify({
					...data,
					results: data.results.flatMap((result) =>
						Array.from({ length: 8 }, (_, index) => ({
							...result,
							id: `${result.id}-${index}`,
							title: `${result.title} ${index + 1}`,
						})),
					),
				} satisfies CommonspaceSearchResponse),
				{ headers: { "content-type": "application/json" } },
			);
		},
	},
};

export const NormalizedQuery: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.type(
			body.getByRole("searchbox", { name: "Search Commonspace" }),
			"VERIFICATION  ",
		);
		await expect(
			await body.findByRole("option", {
				name: /Open Channel: #verification/iu,
			}),
		).toBeVisible();
		await expect(body.queryByText("Searching…")).not.toBeInTheDocument();
	},
};

export const QueryAndKeyboardSelection: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = body.getByRole("searchbox", { name: "Search Commonspace" });
		await userEvent.type(input, "verification");
		await expect(
			body.getByRole("option", { name: /Open Channel: #verification/iu }),
		).toBeVisible();
		await expect(
			body.getByRole("option", { name: /Open Channel: #verification/iu }),
		).not.toHaveTextContent(/Channel[\s\S]*Channel/iu);
		await userEvent.keyboard("{ArrowDown}");
		await expect(
			body.getByRole("option", {
				name: /Open Message: Review the visual baseline/iu,
			}),
		).toHaveAttribute("aria-selected", "true");
	},
};

export const NoResults: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.type(
			body.getByRole("searchbox", { name: "Search Commonspace" }),
			"missing result",
		);
		await expect(
			body.getByText("No results for “missing result”."),
		).toBeVisible();
	},
};

export const Pending: Story = {
	args: { fetcher: pendingSearchFetcher },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const status = body.getByText("Searching…");
		await waitFor(() => expect(status).toBeVisible());
	},
};

export const RequestFailed: Story = {
	args: { fetcher: errorSearchFetcher },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(await body.findByRole("alert")).toHaveTextContent(
			"Search is temporarily unavailable.",
		);
	},
};

export const RetryPreservesSearch: Story = {
	render: (args) => {
		let failed = false;
		const retryFetcher: typeof globalThis.fetch = async (input, init) => {
			const url = new URL(String(input), "http://storybook.local");
			if (url.searchParams.get("project") === "platform" && !failed) {
				failed = true;
				return errorSearchFetcher(input, init);
			}
			return fetcher(input, init);
		};
		return <CommonspaceSearchDialog {...args} fetcher={retryFetcher} />;
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = body.getByRole("searchbox", { name: "Search Commonspace" });
		await userEvent.type(input, "baseline");
		await userEvent.click(
			body.getByRole("button", { name: "Filter by project: All projects" }),
		);
		await userEvent.click(
			await body.findByRole("menuitemradio", { name: "Platform" }),
		);
		await expect(await body.findByRole("alert")).toBeVisible();
		await userEvent.click(body.getByRole("button", { name: "Try again" }));
		await expect(
			await body.findByRole("option", { name: /Open Message: Review/ }),
		).toBeVisible();
		await expect(input).toHaveValue("baseline");
		await expect(input).toHaveFocus();
		await expect(
			body.getByRole("button", { name: "Filter by project: Platform" }),
		).toBeVisible();
	},
};

export const FilterByTypes: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			body.getByRole("button", { name: "Filter result types: All types" }),
		);
		await userEvent.click(
			await body.findByRole("menuitemcheckbox", { name: "Messages" }),
		);
		await userEvent.click(
			body.getByRole("menuitemcheckbox", { name: "Files" }),
		);
		await userEvent.keyboard("{Escape}");
		const list = within(
			await body.findByRole("listbox", { name: "Commonspace search results" }),
		);
		await expect(list.getAllByRole("option")).toHaveLength(2);
		await expect(
			list.getByRole("option", { name: /Open Message:/u }),
		).toBeVisible();
		await expect(
			list.getByRole("option", { name: /Open File:/u }),
		).toBeVisible();
		await expect(
			body.getByRole("button", { name: "Remove Messages filter" }),
		).toBeVisible();
		await userEvent.click(
			body.getByRole("button", { name: "Remove Files filter" }),
		);
		await expect(
			within(await body.findByRole("listbox")).getAllByRole("option"),
		).toHaveLength(1);
	},
};

export const ProjectFilterAndReset: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		const input = body.getByRole("searchbox", { name: "Search Commonspace" });
		await userEvent.type(input, "verification");
		await userEvent.click(
			body.getByRole("button", { name: "Filter by project: All projects" }),
		);
		await userEvent.click(
			await body.findByRole("menuitemradio", { name: "Platform" }),
		);
		await expect(
			within(await body.findByRole("listbox")).getAllByRole("option"),
		).toHaveLength(1);
		await userEvent.click(
			within(body.getByRole("region", { name: "Search filters" })).getByRole(
				"button",
				{ name: "Clear filters" },
			),
		);
		await expect(input).toHaveValue("verification");
		await expect(
			within(await body.findByRole("listbox")).getAllByRole("option"),
		).toHaveLength(2);
	},
};

export const TypeFilterPending: Story = {
	args: {
		onSelect: fn(),
		fetcher: (input, init) => {
			const url = new URL(String(input), "http://storybook.local");
			if (url.searchParams.has("types"))
				return new Promise<Response>(() => undefined);
			return fetcher(input, init);
		},
	},
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		await body.findByRole("listbox");
		await userEvent.click(
			body.getByRole("button", { name: "Filter result types: All types" }),
		);
		await userEvent.click(
			await body.findByRole("menuitemcheckbox", { name: "Messages" }),
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(body.getByText("Searching…")).toBeVisible());
		await expect(body.queryByRole("listbox")).not.toBeInTheDocument();
		await userEvent.click(
			body.getByRole("searchbox", { name: "Search Commonspace" }),
		);
		await userEvent.keyboard("{Enter}");
		await expect(args.onSelect).not.toHaveBeenCalled();
	},
};

export const FilterMenuOpen: Story = {
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			body.getByRole("button", { name: "Filter result types: All types" }),
		);
		const channels = await body.findByRole("menuitemcheckbox", {
			name: "Channels",
		});
		await waitFor(() => expect(channels).toBeVisible());
	},
};

export const ReturningToPendingQuery: Story = {
	render: (args) => {
		let requested = false;
		const pendingAfterFirst: typeof globalThis.fetch = (input, init) => {
			if (requested) return new Promise<Response>(() => undefined);
			requested = true;
			return fetcher(input, init);
		};
		return <CommonspaceSearchDialog {...args} fetcher={pendingAfterFirst} />;
	},
	play: async ({ canvasElement, args }) => {
		const body = within(canvasElement.ownerDocument.body);
		await body.findByRole("listbox");
		await userEvent.click(
			body.getByRole("button", { name: "Filter result types: All types" }),
		);
		await userEvent.click(
			await body.findByRole("menuitemcheckbox", { name: "Messages" }),
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(body.getByText("Searching…")).toBeVisible());
		await userEvent.click(body.getByRole("button", { name: "Clear filters" }));
		await expect(body.queryByRole("listbox")).not.toBeInTheDocument();
		await expect(body.getByText("Searching…")).toBeVisible();
		await userEvent.click(
			body.getByRole("searchbox", { name: "Search Commonspace" }),
		);
		await userEvent.keyboard("{Enter}");
		await expect(args.onSelect).not.toHaveBeenCalled();
	},
};
