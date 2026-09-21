import type {
	CommonspaceAgentTrace,
	CommonspaceTraceEntry,
} from "@commonspace/shared";
import { AGENT_ADAPTERS } from "@commonspace/shared";
import { ChevronDownIcon, Clock3Icon, XIcon } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MessageMarkdown } from "./MessageMarkdown";

interface AgentTraceProps {
	authorName: string;
	trace: CommonspaceAgentTrace;
}

type CompactionTraceEntry = Extract<
	CommonspaceTraceEntry,
	{ type: "compaction" }
>;
type PlanTraceEntry = Extract<CommonspaceTraceEntry, { type: "plan" }>;
type ReasoningTraceEntry = Extract<
	CommonspaceTraceEntry,
	{ type: "reasoning" }
>;
type ToolTraceEntry = Extract<CommonspaceTraceEntry, { type: "tool" }>;
type UsageTraceEntry = Extract<CommonspaceTraceEntry, { type: "usage" }>;

function assertNever(value: never): never {
	void value;
	throw new Error("Unsupported agent trace entry");
}

function runtimeName(trace: CommonspaceAgentTrace): string {
	return AGENT_ADAPTERS[trace.adapter].label;
}

function durationLabel(startedAt: string, completedAt: string): string {
	const duration = Date.parse(completedAt) - Date.parse(startedAt);
	if (!Number.isFinite(duration) || duration < 0) return "completed";
	if (duration < 1_000) return `${String(Math.round(duration))}ms`;
	if (duration < 60_000)
		return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(duration / 60_000);
	const seconds = Math.round((duration % 60_000) / 1_000);
	return `${String(minutes)}m ${String(seconds)}s`;
}

function statusLabel(
	status: Extract<CommonspaceTraceEntry, { type: "tool" }>["status"],
): string {
	if (status === "in_progress") return "Running";
	if (status === "completed") return "Complete";
	if (status === "failed") return "Failed";
	return "Pending";
}

function planStatusLabel(
	status: Extract<
		CommonspaceTraceEntry,
		{ type: "plan" }
	>["steps"][number]["status"],
): string {
	if (status === "in_progress") return "In progress";
	if (status === "completed") return "Complete";
	return "Pending";
}

interface TraceEntryFrameProps {
	children: ReactNode;
	icon: string;
	kind: CommonspaceTraceEntry["type"];
	meta?: ReactNode;
	title: ReactNode;
}

function TraceEntryFrame({
	children,
	icon,
	kind,
	meta,
	title,
}: TraceEntryFrameProps) {
	return (
		<li
			className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
			data-trace-kind={kind}
		>
			<span
				className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
				aria-hidden="true"
			>
				{icon}
			</span>
			<div className="min-w-0">
				<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
					<strong>{title}</strong>
					{meta ?? null}
				</div>
				{children}
			</div>
		</li>
	);
}

function compactionLabel(status: CompactionTraceEntry["status"]): string {
	switch (status) {
		case "in_progress":
			return "Compacting context";
		case "completed":
			return "Context compacted";
		case "cancelled":
			return "Context compaction cancelled";
		case "failed":
			return "Context compaction failed";
	}
}

function CompactionEntry({ entry }: { entry: CompactionTraceEntry }) {
	return (
		<TraceEntryFrame
			icon="↻"
			kind="compaction"
			meta={<span>Session context</span>}
			title={compactionLabel(entry.status)}
		>
			<div className="mt-1 text-muted-foreground">
				<MessageMarkdown text={entry.text} />
			</div>
		</TraceEntryFrame>
	);
}

function ReasoningEntry({ entry }: { entry: ReasoningTraceEntry }) {
	return (
		<TraceEntryFrame icon="◇" kind="reasoning" title="Reasoning">
			<div className="mt-1 text-muted-foreground">
				<MessageMarkdown text={entry.text} />
			</div>
		</TraceEntryFrame>
	);
}

function planStatusIcon(
	status: PlanTraceEntry["steps"][number]["status"],
): string {
	switch (status) {
		case "completed":
			return "✓";
		case "in_progress":
			return "•";
		case "pending":
			return "○";
	}
}

function PlanEntry({ entry }: { entry: PlanTraceEntry }) {
	return (
		<TraceEntryFrame
			icon="☷"
			kind="plan"
			meta={<span>{String(entry.steps.length)} steps</span>}
			title="Plan"
		>
			{entry.markdown !== undefined && entry.steps.length === 0 ? (
				<p className="mt-2 text-[13px] leading-5">{entry.markdown}</p>
			) : null}
			{entry.steps.length > 0 ? (
				<ol className="mt-2 grid gap-1">
					{entry.steps.map((step, index) => (
						<li
							key={`${entry.id}-${String(index)}`}
							className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 text-[13px] leading-5"
							data-status={step.status}
						>
							<span
								className="inline-grid size-5 place-items-center rounded-full border font-mono text-[10px]"
								aria-hidden="true"
							>
								{planStatusIcon(step.status)}
							</span>
							<span>{step.text}</span>
							<small className="text-xs text-muted-foreground">
								{planStatusLabel(step.status)}
							</small>
						</li>
					))}
				</ol>
			) : null}
		</TraceEntryFrame>
	);
}

function ToolEntry({ entry }: { entry: ToolTraceEntry }) {
	const hasToolMetadata =
		entry.toolName !== undefined || entry.toolKind !== undefined;
	return (
		<TraceEntryFrame
			icon="⌘"
			kind="tool"
			meta={
				<span
					className={cn(
						"rounded-full border px-2 py-1 font-mono text-[10px]",
						entry.status === "failed" &&
							"border-destructive/40 text-destructive",
						entry.status === "completed" && "text-[var(--status-success)]",
					)}
				>
					{statusLabel(entry.status)}
				</span>
			}
			title={entry.title}
		>
			{hasToolMetadata ? (
				<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
					{entry.toolKind !== undefined ? <span>{entry.toolKind}</span> : null}
					{entry.toolName !== undefined ? <code>{entry.toolName}</code> : null}
				</div>
			) : null}
			{entry.input !== undefined ? (
				<TracePayload label="Input" value={entry.input} />
			) : null}
			{entry.output !== undefined ? (
				<TracePayload label="Output" value={entry.output} />
			) : null}
		</TraceEntryFrame>
	);
}

function UsageEntry({ entry }: { entry: UsageTraceEntry }) {
	return (
		<TraceEntryFrame
			icon="◴"
			kind="usage"
			meta={
				<span>
					{entry.usedTokens.toLocaleString()} /{" "}
					{entry.contextWindow.toLocaleString()} tokens
				</span>
			}
			title="Context usage"
		>
			{entry.costAmount !== undefined ? (
				<p className="mt-2 font-mono text-xs text-muted-foreground">
					{entry.costAmount.toLocaleString(undefined, {
						maximumFractionDigits: 6,
					})}{" "}
					{entry.costCurrency ?? ""}
				</p>
			) : null}
		</TraceEntryFrame>
	);
}

function TraceEntry({ entry }: { entry: CommonspaceTraceEntry }) {
	switch (entry.type) {
		case "compaction":
			return <CompactionEntry entry={entry} />;
		case "reasoning":
			return <ReasoningEntry entry={entry} />;
		case "plan":
			return <PlanEntry entry={entry} />;
		case "tool":
			return <ToolEntry entry={entry} />;
		case "usage":
			return <UsageEntry entry={entry} />;
	}
	return assertNever(entry);
}

function TracePayload({ label, value }: { label: string; value: string }) {
	return (
		<div className="mt-2">
			<span className="text-xs font-semibold text-muted-foreground">
				{label}
			</span>
			<section
				aria-label={`${label} payload`}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll overflowing trace payloads.
				tabIndex={0}
				className="mt-1 max-h-60 overflow-auto rounded-sm border bg-muted p-2"
			>
				<pre className="font-mono text-xs">
					<code>{value}</code>
				</pre>
			</section>
		</div>
	);
}

export function AgentTraceTimeline({
	entries,
}: {
	entries: readonly CommonspaceTraceEntry[];
}) {
	const newestFirst = useMemo(
		() =>
			entries.toSorted((left, right) =>
				right.updatedAt.localeCompare(left.updatedAt),
			),
		[entries],
	);
	return (
		<ol className="grid">
			{newestFirst.map((entry) => (
				<TraceEntry key={`${entry.type}-${entry.id}`} entry={entry} />
			))}
		</ol>
	);
}

export function AgentTrace({ authorName, trace }: AgentTraceProps) {
	if (trace.entries.length === 0) return null;
	const runtime = runtimeName(trace);
	return (
		<Popover>
			<PopoverTrigger
				className="ml-auto inline-flex min-h-6 items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
				aria-label={`Show activity for ${authorName}`}
				title={`${runtime} activity`}
			>
				<Clock3Icon className="size-3" aria-hidden="true" /> Activity{" "}
				<ChevronDownIcon className="size-3" aria-hidden="true" />
			</PopoverTrigger>
			<PopoverContent
				aria-label={`${authorName} activity trace`}
				className="max-h-[min(600px,75vh)] w-[360px] overflow-y-auto rounded-lg bg-card p-[18px] text-xs"
			>
				<div className="mb-3 flex items-center justify-between gap-3">
					<PopoverTitle>{authorName} activity</PopoverTitle>
					<PopoverClose
						aria-label="Close activity"
						className="grid size-6 place-items-center text-muted-foreground"
					>
						<XIcon className="size-4" />
					</PopoverClose>
				</div>
				<p className="mb-2 text-xs text-muted-foreground">
					{runtime} · {durationLabel(trace.startedAt, trace.completedAt)}
				</p>
				<AgentTraceTimeline entries={trace.entries} />
			</PopoverContent>
		</Popover>
	);
}
