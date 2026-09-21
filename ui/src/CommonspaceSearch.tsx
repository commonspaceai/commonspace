import {
	COMMONSPACE_SEARCH_KINDS,
	type CommonspaceProject,
	type CommonspaceSearchHighlight,
	type CommonspaceSearchKind,
	type CommonspaceSearchResponse,
	type CommonspaceSearchResult,
} from "@commonspace/shared";
import {
	ActivityIcon,
	BotIcon,
	CheckCheckIcon,
	ChevronDownIcon,
	FileIcon,
	FolderIcon,
	HashIcon,
	ListFilterIcon,
	LoaderCircleIcon,
	MessageSquareTextIcon,
	MessagesSquareIcon,
	NotebookTextIcon,
	PlayIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import {
	Fragment,
	useDeferredValue,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

export interface CommonspaceSearchDialogProps {
	projects: readonly CommonspaceProject[];
	onClose: () => void;
	onSelect: (result: CommonspaceSearchResult) => void;
	fetcher?: typeof globalThis.fetch;
}

const searchTypes = {
	project: { label: "Projects", icon: FolderIcon },
	channel: { label: "Channels", icon: HashIcon },
	message: { label: "Messages", icon: MessageSquareTextIcon },
	dm: { label: "Direct messages", icon: MessagesSquareIcon },
	agent: { label: "Agents", icon: BotIcon },
	file: { label: "Files", icon: FileIcon },
	trace: { label: "Activity traces", icon: ActivityIcon },
	decision: { label: "Decisions", icon: CheckCheckIcon },
	run: { label: "Runs", icon: PlayIcon },
	brief: { label: "Briefs", icon: NotebookTextIcon },
} satisfies Record<
	CommonspaceSearchKind,
	{ label: string; icon: typeof SearchIcon }
>;

function SearchFilters({
	projects,
	selectedKinds,
	projectId,
	onKindsChange,
	onProjectChange,
	onClear,
}: {
	projects: readonly CommonspaceProject[];
	selectedKinds: readonly CommonspaceSearchKind[];
	projectId: string;
	onKindsChange: (kinds: CommonspaceSearchKind[]) => void;
	onProjectChange: (projectId: string) => void;
	onClear: () => void;
}) {
	const firstKind = selectedKinds[0];
	const typeLabel =
		selectedKinds.length > 1
			? `${selectedKinds.length} types`
			: firstKind === undefined
				? "All types"
				: searchTypes[firstKind].label;
	const projectLabel =
		projectId === ""
			? "All projects"
			: (projects.find((project) => project.id === projectId)?.name ??
				"Selected project");
	return (
		<section
			className="flex flex-col gap-2 border-b px-3.5 py-3"
			aria-label="Search filters"
		>
			<div className="flex min-w-0 items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<Button variant="outline" size="sm" className="h-8" />}
						aria-label={`Filter result types: ${typeLabel}`}
					>
						<ListFilterIcon data-icon="inline-start" aria-hidden="true" />
						{typeLabel}
						<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-56">
						<DropdownMenuGroup>
							<DropdownMenuLabel>Result types</DropdownMenuLabel>
							<p className="px-1.5 pb-2 text-xs text-muted-foreground">
								Choose one or more.
							</p>
							{COMMONSPACE_SEARCH_KINDS.map((kind) => {
								const option = searchTypes[kind];
								const Icon = option.icon;
								return (
									<DropdownMenuCheckboxItem
										key={kind}
										checked={selectedKinds.includes(kind)}
										onCheckedChange={(checked) =>
											onKindsChange(
												checked
													? [...selectedKinds, kind]
													: selectedKinds.filter(
															(selected) => selected !== kind,
														),
											)
										}
									>
										<Icon aria-hidden="true" />
										{option.label}
									</DropdownMenuCheckboxItem>
								);
							})}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="outline"
								size="sm"
								className="h-8 min-w-0 max-w-64 shrink"
							/>
						}
						aria-label={`Filter by project: ${projectLabel}`}
					>
						<FolderIcon data-icon="inline-start" aria-hidden="true" />
						<span className="truncate">{projectLabel}</span>
						<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-64">
						<DropdownMenuGroup>
							<DropdownMenuLabel>Project</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={projectId}
								onValueChange={(value) => {
									if (
										typeof value === "string" &&
										(value === "" ||
											projects.some((project) => project.id === value))
									)
										onProjectChange(value);
								}}
							>
								<DropdownMenuRadioItem value="" closeOnClick>
									All projects
								</DropdownMenuRadioItem>
								{projects.map((project) => (
									<DropdownMenuRadioItem
										key={project.id}
										value={project.id}
										closeOnClick
									>
										<span className="truncate" title={project.name}>
											{project.name}
										</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				{(selectedKinds.length > 0 || projectId !== "") && (
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={onClear}
					>
						Clear filters
					</Button>
				)}
			</div>
			{selectedKinds.length > 0 && (
				<fieldset
					className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
					aria-label="Selected result types"
				>
					{selectedKinds.map((kind) => (
						<Button
							key={kind}
							variant="secondary"
							size="xs"
							aria-label={`Remove ${searchTypes[kind].label} filter`}
							onClick={() =>
								onKindsChange(
									selectedKinds.filter((selected) => selected !== kind),
								)
							}
						>
							{searchTypes[kind].label}
							<XIcon data-icon="inline-end" aria-hidden="true" />
						</Button>
					))}
				</fieldset>
			)}
		</section>
	);
}

type SearchOutcome =
	| { kind: "ready"; url: string; data: CommonspaceSearchResponse }
	| { kind: "error"; url: string; message: string };

function searchUrl(
	query: string,
	kinds: readonly CommonspaceSearchKind[],
	projectId: string,
): string {
	const params = new URLSearchParams({ q: query, limit: "24" });
	if (kinds.length > 0) params.set("types", kinds.join(","));
	if (projectId !== "") params.set("project", projectId);
	return `/api/search?${params.toString()}`;
}

async function responseError(response: Response): Promise<string> {
	try {
		const body: { error?: unknown } = await response.json();
		if (typeof body.error === "string" && body.error !== "") return body.error;
	} catch {
		// Keep stable fallback below.
	}
	return `Search failed (${String(response.status)})`;
}

function HighlightedText({
	text,
	field,
	highlights,
}: {
	text: string;
	field: CommonspaceSearchHighlight["field"];
	highlights: readonly CommonspaceSearchHighlight[];
}) {
	const ranges = highlights
		.filter(
			(range) =>
				range.field === field &&
				range.start >= 0 &&
				range.end > range.start &&
				range.end <= text.length,
		)
		.sort((left, right) => left.start - right.start);
	if (ranges.length === 0) return <>{text}</>;
	const parts: Array<{ text: string; highlighted: boolean; start: number }> =
		[];
	let offset = 0;
	for (const range of ranges) {
		if (range.start < offset) continue;
		if (range.start > offset)
			parts.push({
				text: text.slice(offset, range.start),
				highlighted: false,
				start: offset,
			});
		parts.push({
			text: text.slice(range.start, range.end),
			highlighted: true,
			start: range.start,
		});
		offset = range.end;
	}
	if (offset < text.length)
		parts.push({ text: text.slice(offset), highlighted: false, start: offset });
	return (
		<>
			{parts.map((part) =>
				part.highlighted ? (
					<mark
						className="rounded-sm bg-primary/15 text-inherit"
						key={part.start}
					>
						{part.text}
					</mark>
				) : (
					part.text
				),
			)}
		</>
	);
}

function kindLabel(kind: CommonspaceSearchKind): string {
	if (kind === "dm") return "Agent conversation";
	return `${kind.slice(0, 1).toLocaleUpperCase()}${kind.slice(1)}`;
}

const searchReceiptFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

const emptySearchResults: readonly CommonspaceSearchResult[] = [];

function resultReceiptLabel(result: CommonspaceSearchResult): string {
	const receiptLocation = result.receipt.split(" · ")[0]?.trim();
	const location =
		receiptLocation !== undefined &&
		receiptLocation !== result.detail.trim() &&
		receiptLocation !== kindLabel(result.kind)
			? receiptLocation
			: undefined;
	const occurredAt = result.occurredAt;
	const time =
		occurredAt === undefined
			? undefined
			: searchReceiptFormatter.format(new Date(occurredAt));
	return [location, time]
		.filter((value): value is string => value !== undefined)
		.join(" · ");
}

interface IndexedSearchResult {
	index: number;
	result: CommonspaceSearchResult;
}

interface SearchResultSection {
	id: string;
	label: string;
	results: IndexedSearchResult[];
	mixedKinds?: boolean;
}

function browseResultSections(
	results: readonly CommonspaceSearchResult[],
): SearchResultSection[] {
	const indexed = results.map((result, index) => ({ result, index }));
	const recent = indexed.slice(0, 4);
	const remainingByKind = new Map<
		CommonspaceSearchKind,
		IndexedSearchResult[]
	>();
	for (const item of indexed.slice(recent.length)) {
		const grouped = remainingByKind.get(item.result.kind);
		if (grouped === undefined) remainingByKind.set(item.result.kind, [item]);
		else grouped.push(item);
	}
	const sections: SearchResultSection[] = [];
	if (recent.length > 0)
		sections.push({
			id: "recent",
			label: "Recent",
			results: recent,
			mixedKinds: true,
		});
	for (const kind of COMMONSPACE_SEARCH_KINDS) {
		const grouped = remainingByKind.get(kind);
		if (grouped !== undefined)
			sections.push({
				id: kind,
				label: searchTypes[kind].label,
				results: grouped,
			});
	}
	return sections;
}

function SearchResultOption({
	result,
	index,
	active,
	showKind,
	resultsId,
	onActivate,
	onSelect,
}: {
	result: CommonspaceSearchResult;
	index: number;
	active: boolean;
	showKind: boolean;
	resultsId: string;
	onActivate: (index: number) => void;
	onSelect: (result: CommonspaceSearchResult) => void;
}) {
	const Icon = searchTypes[result.kind].icon;
	return (
		<button
			id={`${resultsId}-${String(index)}`}
			type="button"
			role="option"
			aria-label={`Open ${kindLabel(result.kind)}: ${result.title}`}
			aria-selected={active}
			className="grid min-h-[68px] w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-hover aria-selected:bg-selection aria-selected:outline-1 aria-selected:-outline-offset-1 aria-selected:outline-border"
			onMouseEnter={() => {
				onActivate(index);
			}}
			onClick={() => {
				onSelect(result);
			}}
		>
			<span
				className="grid size-8 place-items-center rounded-md bg-background text-muted-foreground [&_svg]:size-4"
				aria-hidden="true"
			>
				<Icon />
			</span>
			<span className="min-w-0">
				<strong className="block truncate text-sm font-medium">
					<HighlightedText
						text={result.title}
						field="title"
						highlights={result.highlights}
					/>
				</strong>
				<small className="block truncate text-xs text-muted-foreground">
					<HighlightedText
						text={result.detail}
						field="detail"
						highlights={result.highlights}
					/>
				</small>
				<small
					className="block truncate text-xs text-muted-foreground"
					title={result.receipt}
				>
					{resultReceiptLabel(result)}
				</small>
			</span>
			{showKind && result.detail.trim() !== kindLabel(result.kind) ? (
				<span className="max-w-32 truncate text-xs text-muted-foreground">
					{kindLabel(result.kind)}
				</span>
			) : null}
		</button>
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The cohesive dialog controller avoids a larger cross-component prop and callback surface.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The cohesive dialog controller keeps request, focus, and keyboard ownership in one place.
export function CommonspaceSearchDialog({
	projects,
	onClose,
	onSelect,
	fetcher = globalThis.fetch,
}: CommonspaceSearchDialogProps) {
	const resultsId = useId();
	const [returnFocus] = useState(() =>
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null,
	);
	const selectingResult = useRef(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const resultsViewport = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState("");
	const [selectedKinds, setSelectedKinds] = useState<CommonspaceSearchKind[]>(
		[],
	);
	const [projectId, setProjectId] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
	const [retry, setRetry] = useState(0);
	const deferredQuery = useDeferredValue(query);
	const requestUrl = searchUrl(deferredQuery, selectedKinds, projectId);
	const currentUrl = searchUrl(query, selectedKinds, projectId);
	const currentOutcome = outcome?.url === currentUrl ? outcome : null;
	const response =
		currentOutcome?.kind === "ready" ? currentOutcome.data : null;
	const error =
		currentOutcome?.kind === "error" ? currentOutcome.message : null;
	const pending = currentOutcome === null;
	const results = response?.results ?? emptySearchResults;
	const browsing = query.trim() === "";
	const resultSections = useMemo(
		() =>
			browsing
				? browseResultSections(results)
				: [
						{
							id: "matches",
							label: "Results",
							results: results.map((result, index) => ({ result, index })),
							mixedKinds: true,
						},
					],
		[browsing, results],
	);
	const boundedActiveIndex =
		results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);
	const activeResult = results[boundedActiveIndex];
	const selectResult = (result: CommonspaceSearchResult) => {
		selectingResult.current = true;
		onSelect(result);
	};

	useEffect(() => {
		void retry;
		setOutcome(null);
		if (resultsViewport.current !== null) resultsViewport.current.scrollTop = 0;
		const controller = new AbortController();
		void fetcher(requestUrl, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		})
			.then(async (result) => {
				if (!result.ok) throw new Error(await responseError(result));
				const data: CommonspaceSearchResponse = await result.json();
				return data;
			})
			.then((data) => {
				if (!controller.signal.aborted)
					setOutcome({ kind: "ready", url: requestUrl, data });
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setOutcome({
						kind: "error",
						url: requestUrl,
						message: cause instanceof Error ? cause.message : String(cause),
					});
			});
		return () => {
			controller.abort();
		};
	}, [fetcher, requestUrl, retry]);

	const moveSelection = (offset: number) => {
		if (results.length === 0) return;
		const nextIndex =
			(boundedActiveIndex + offset + results.length) % results.length;
		setActiveIndex(nextIndex);
		const viewport = resultsViewport.current;
		const option =
			viewport?.querySelectorAll<HTMLElement>('[role="option"]')[nextIndex];
		if (viewport === null || option === undefined) return;
		const frame = viewport.getBoundingClientRect();
		const row = option.getBoundingClientRect();
		if (row.top < frame.top) viewport.scrollTop += row.top - frame.top;
		else if (row.bottom > frame.bottom)
			viewport.scrollTop += row.bottom - frame.bottom;
	};
	const clearFilters = () => {
		setSelectedKinds([]);
		setProjectId("");
		setActiveIndex(0);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				showCloseButton
				finalFocus={() => (selectingResult.current ? false : returnFocus)}
				aria-describedby={undefined}
				className="top-[10dvh] h-[min(520px,80dvh)] max-h-[80dvh] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] -translate-y-0 overflow-hidden sm:max-w-[720px]"
			>
				<DialogHeader className="sr-only">
					<DialogTitle>Search Commonspace</DialogTitle>
				</DialogHeader>
				<div className="grid min-h-[68px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3.5 py-2">
					<SearchIcon aria-hidden="true" />
					<input
						ref={inputRef}
						autoFocus
						type="search"
						aria-label="Search Commonspace"
						aria-controls={results.length > 0 ? resultsId : undefined}
						aria-activedescendant={
							activeResult === undefined
								? undefined
								: `${resultsId}-${String(boundedActiveIndex)}`
						}
						placeholder="Search messages, projects, channels, agents, files, or runs…"
						value={query}
						className="h-11 min-w-0 border-0 bg-transparent text-[17px] tracking-[-0.01em] outline-none placeholder:text-muted-foreground"
						onChange={(event) => {
							setQuery(event.target.value);
							setActiveIndex(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								moveSelection(1);
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								moveSelection(-1);
							} else if (event.key === "Enter" && activeResult !== undefined) {
								event.preventDefault();
								selectResult(activeResult);
							}
						}}
					/>
					<kbd className="mr-9 rounded-sm border bg-muted px-1.5 py-1 font-mono text-xs text-muted-foreground">
						ESC
					</kbd>
				</div>
				<SearchFilters
					projects={projects}
					selectedKinds={selectedKinds}
					projectId={projectId}
					onKindsChange={(kinds) => {
						setSelectedKinds(kinds);
						setActiveIndex(0);
					}}
					onProjectChange={(id) => {
						setProjectId(id);
						setActiveIndex(0);
					}}
					onClear={clearFilters}
				/>
				<div className="flex items-center justify-between px-4 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
					<span>{query.trim() === "" ? "Browse" : "Results"}</span>
					<span role="status" aria-live="polite" aria-atomic="true">
						{pending
							? "Searching…"
							: response?.truncated === true
								? `${String(results.length)}+`
								: results.length}
						{!pending && <span className="sr-only"> results</span>}
					</span>
				</div>
				<div
					ref={resultsViewport}
					className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2"
					aria-busy={pending}
				>
					{pending && (
						<div className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
							<LoaderCircleIcon
								className="size-4 motion-safe:animate-spin"
								aria-hidden="true"
							/>
							Searching workspace…
						</div>
					)}
					{error !== null && (
						<Empty role="alert" className="min-h-36">
							<EmptyHeader>
								<EmptyTitle>Search unavailable</EmptyTitle>
								<EmptyDescription>{error}</EmptyDescription>
							</EmptyHeader>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setOutcome(null);
									setRetry((attempt) => attempt + 1);
									inputRef.current?.focus();
								}}
							>
								Try again
							</Button>
						</Empty>
					)}
					{error === null && !pending && results.length === 0 && (
						<Empty className="min-h-36">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<SearchIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>
									{query.trim() !== ""
										? `No results for “${query.trim()}”.`
										: "No matching results."}
								</EmptyTitle>
								<EmptyDescription>
									Try another search or change the filters.
								</EmptyDescription>
							</EmptyHeader>
							{(selectedKinds.length > 0 || projectId !== "") && (
								<Button variant="outline" size="sm" onClick={clearFilters}>
									Clear filters
								</Button>
							)}
						</Empty>
					)}
					{results.length > 0 && (
						<div
							id={resultsId}
							role="listbox"
							aria-label="Commonspace search results"
						>
							{resultSections.map((section) => {
								const headingId = `${resultsId}-${section.id}-heading`;
								return (
									<Fragment key={section.id}>
										{browsing && (
											<div
												id={headingId}
												className="flex items-center justify-between px-3 pt-3 pb-1 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
											>
												<span>{section.label}</span>
												<span>{String(section.results.length)}</span>
											</div>
										)}
										<fieldset
											className="m-0 min-w-0 border-0 p-0"
											aria-labelledby={browsing ? headingId : undefined}
										>
											{section.results.map(({ result, index }) => (
												<SearchResultOption
													key={result.id}
													result={result}
													index={index}
													active={index === boundedActiveIndex}
													showKind={section.mixedKinds === true}
													resultsId={resultsId}
													onActivate={setActiveIndex}
													onSelect={selectResult}
												/>
											))}
										</fieldset>
									</Fragment>
								);
							})}
						</div>
					)}
				</div>
				<footer
					className="flex min-h-10 items-center justify-end gap-3 border-t px-3.5 py-1.5 text-xs text-muted-foreground"
					aria-hidden="true"
				>
					<span>
						<kbd className="rounded-sm border bg-muted px-1 py-0.5 font-mono">
							↑
						</kbd>
						<kbd className="rounded-sm border bg-muted px-1 py-0.5 font-mono">
							↓
						</kbd>{" "}
						Navigate
					</span>
					<span>
						<kbd className="rounded-sm border bg-muted px-1 py-0.5 font-mono">
							↵
						</kbd>{" "}
						Open
					</span>
					<span>
						<kbd className="rounded-sm border bg-muted px-1 py-0.5 font-mono">
							esc
						</kbd>{" "}
						Close
					</span>
				</footer>
			</DialogContent>
		</Dialog>
	);
}
