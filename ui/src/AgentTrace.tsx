import type {
	CommonspaceAgentTrace,
	CommonspaceTraceEntry,
} from "@commonspace/shared";
import { AGENT_ADAPTERS } from "@commonspace/shared";
import { ChevronDownIcon, Clock3Icon, XIcon } from "lucide-react";
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

function TraceEntry({ entry }: { entry: CommonspaceTraceEntry }) {
	if (entry.type === "compaction") {
		const label =
			entry.status === "in_progress"
				? "Compacting context"
				: entry.status === "completed"
					? "Context compacted"
					: entry.status === "cancelled"
						? "Context compaction cancelled"
						: "Context compaction failed";
		return (
			<li
				className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
				data-trace-kind="compaction"
			>
				<span
					className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
					aria-hidden="true"
				>
					↻
				</span>
				<div className="min-w-0">
					<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
						<strong>{label}</strong>
						<span>Session context</span>
					</div>
					<div className="mt-1 text-muted-foreground">
						<MessageMarkdown text={entry.text} />
					</div>
				</div>
			</li>
		);
	}

	if (entry.type === "reasoning") {
		return (
			<li
				className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
				data-trace-kind="reasoning"
			>
				<span
					className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
					aria-hidden="true"
				>
					◇
				</span>
				<div className="min-w-0">
					<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
						<strong>Reasoning</strong>
					</div>
					<div className="mt-1 text-muted-foreground">
						<MessageMarkdown text={entry.text} />
					</div>
				</div>
			</li>
		);
	}

	if (entry.type === "plan") {
		return (
			<li
				className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
				data-trace-kind="plan"
			>
				<span
					className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
					aria-hidden="true"
				>
					☷
				</span>
				<div className="min-w-0">
					<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
						<strong>Plan</strong>
						<span>{String(entry.steps.length)} steps</span>
					</div>
					{entry.markdown !== undefined && entry.steps.length === 0 && (
						<p className="mt-2 text-[13px] leading-5">{entry.markdown}</p>
					)}
					{entry.steps.length > 0 && (
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
										{step.status === "completed"
											? "✓"
											: step.status === "in_progress"
												? "•"
												: "○"}
									</span>
									<span>{step.text}</span>
									<small className="text-xs text-muted-foreground">
										{planStatusLabel(step.status)}
									</small>
								</li>
							))}
						</ol>
					)}
				</div>
			</li>
		);
	}

	if (entry.type === "tool") {
		return (
			<li
				className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
				data-trace-kind="tool"
			>
				<span
					className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
					aria-hidden="true"
				>
					⌘
				</span>
				<div className="min-w-0">
					<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
						<strong>{entry.title}</strong>
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
					</div>
					{(entry.toolName !== undefined || entry.toolKind !== undefined) && (
						<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
							{entry.toolKind !== undefined && <span>{entry.toolKind}</span>}
							{entry.toolName !== undefined && <code>{entry.toolName}</code>}
						</div>
					)}
					{entry.input !== undefined && (
						<TracePayload label="Input" value={entry.input} />
					)}
					{entry.output !== undefined && (
						<TracePayload label="Output" value={entry.output} />
					)}
				</div>
			</li>
		);
	}

	return (
		<li
			className="grid grid-cols-[minmax(0,1fr)] border-b py-3 last:border-b-0 [&>span]:hidden"
			data-trace-kind="usage"
		>
			<span
				className="grid size-7 place-items-center rounded-full border bg-background font-mono text-xs text-muted-foreground"
				aria-hidden="true"
			>
				◴
			</span>
			<div className="min-w-0">
				<div className="flex items-center justify-between gap-2 text-xs [&>span]:text-muted-foreground">
					<strong>Context usage</strong>
					<span>
						{entry.usedTokens.toLocaleString()} /{" "}
						{entry.contextWindow.toLocaleString()} tokens
					</span>
				</div>
				{entry.costAmount !== undefined && (
					<p className="mt-2 font-mono text-xs text-muted-foreground">
						{entry.costAmount.toLocaleString(undefined, {
							maximumFractionDigits: 6,
						})}{" "}
						{entry.costCurrency ?? ""}
					</p>
				)}
			</div>
		</li>
	);
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
	const newestFirst = entries.toSorted((left, right) =>
		right.updatedAt.localeCompare(left.updatedAt),
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
				className="ml-auto inline-flex min-h-6 items-center gap-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
				aria-label={`Show ${runtime} activity for ${authorName}`}
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
				<p className="mb-2 text-[11px] text-muted-foreground">
					{runtime} · {durationLabel(trace.startedAt, trace.completedAt)}
				</p>
				<AgentTraceTimeline entries={trace.entries} />
			</PopoverContent>
		</Popover>
	);
}
