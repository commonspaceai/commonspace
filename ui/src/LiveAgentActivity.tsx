import type {
	AgentAdapterKind,
	CommonspaceAgentProfile,
	CommonspaceLiveAgentActivity,
	CommonspaceTraceEntry,
} from "@commonspace/shared";
import { AGENT_ADAPTERS } from "@commonspace/shared";
import { ChevronDownIcon, SquareIcon } from "lucide-react";
import { useId, useState } from "react";
import { AgentTraceTimeline } from "./AgentTrace.tsx";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";
import { cn } from "./lib/utils.ts";

function runtimeLabel(adapter: AgentAdapterKind): string {
	return AGENT_ADAPTERS[adapter].label;
}

function waitingActivityText(adapter: AgentAdapterKind): string {
	return `Waiting for ${runtimeLabel(adapter)} activity…`;
}

function latestTraceEntry(
	entries: readonly CommonspaceTraceEntry[],
): CommonspaceTraceEntry | undefined {
	return entries.reduce<CommonspaceTraceEntry | undefined>(
		(latest, entry) =>
			latest === undefined || entry.updatedAt > latest.updatedAt
				? entry
				: latest,
		undefined,
	);
}

function liveActivityDetail(activity: CommonspaceLiveAgentActivity): {
	kind: string;
	text: string;
} {
	const entry = latestTraceEntry(activity.entries);
	if (entry === undefined)
		return { kind: "Waiting", text: waitingActivityText(activity.adapter) };
	if (entry.type === "reasoning")
		return { kind: "Reasoning", text: entry.text };
	if (entry.type === "compaction")
		return {
			kind:
				entry.status === "in_progress"
					? "Compacting context"
					: "Context compacted",
			text: entry.text,
		};
	if (entry.type === "plan") {
		const step =
			entry.steps.findLast((candidate) => candidate.status === "in_progress") ??
			entry.steps.at(-1);
		return {
			kind: "Plan",
			text: step?.text ?? entry.markdown ?? "Updating plan…",
		};
	}
	if (entry.type === "tool")
		return {
			kind: entry.status === "in_progress" ? "Tool running" : "Tool",
			text: entry.title,
		};
	return {
		kind: "Context",
		text: `${entry.usedTokens.toLocaleString()} / ${entry.contextWindow.toLocaleString()} tokens`,
	};
}

export interface LiveAgentActivityProps {
	activities: readonly CommonspaceLiveAgentActivity[];
	fallbackAgents: readonly CommonspaceAgentProfile[];
	agents: readonly CommonspaceAgentProfile[];
	phase: "queued" | "running";
	onStop: (activity: CommonspaceLiveAgentActivity) => void;
}

export function LiveAgentActivity({
	activities,
	fallbackAgents,
	agents,
	phase,
	onStop,
}: LiveAgentActivityProps) {
	const panelIdPrefix = useId();
	const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
		null,
	);
	if (activities.length === 0 && fallbackAgents.length === 0) return null;
	const expandedActivityId = activities.some(
		(activity) => activity.id === selectedActivityId,
	)
		? selectedActivityId
		: null;

	return (
		<div
			className="mx-auto mb-3 grid w-[min(780px,calc(100%-48px))] gap-2"
			role="status"
			aria-label="Live agent activity"
			aria-live="polite"
		>
			{activities.length > 0
				? activities.map((activity, index) => {
						const agent = agents.find(
							(candidate) => candidate.id === activity.agentId,
						);
						const detail = liveActivityDetail(activity);
						const expanded = activity.id === expandedActivityId;
						const panelId = `${panelIdPrefix}-${String(index)}`;
						return (
							<article
								key={activity.id}
								className={cn(
									"overflow-hidden rounded-lg border bg-background shadow-xs transition-[border-color,box-shadow]",
									expanded && "border-primary/35 shadow-sm",
								)}
								data-runtime={activity.adapter}
							>
								<div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch">
									<button
										type="button"
										className="group grid min-h-[72px] w-full grid-cols-[40px_minmax(0,1fr)_20px] items-center gap-3 border-0 bg-transparent px-4 text-left transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
										aria-label={`${activity.agentName} activity`}
										aria-expanded={expanded}
										aria-controls={panelId}
										onClick={() => {
											setSelectedActivityId(expanded ? null : activity.id);
										}}
									>
										<AgentAvatar
											agent={agent}
											fallbackName={activity.agentName}
											size="lg"
											ariaLabel={`${activity.agentName} is responding`}
										/>
										<span className="min-w-0 self-center">
											<span className="flex min-w-0 items-baseline justify-between gap-3">
												<strong className="shrink-0 text-sm font-semibold text-foreground">
													{activity.agentName}
												</strong>
												<span className="shrink-0 truncate text-xs text-muted-foreground">
													{runtimeLabel(activity.adapter)} · {detail.kind}
												</span>
											</span>
											<span className="mt-1 block truncate text-sm text-muted-foreground">
												{detail.text}
											</span>
										</span>
										<ChevronDownIcon
											className={cn(
												"size-4 text-muted-foreground transition-transform group-hover:text-foreground",
												expanded && "rotate-180",
											)}
											aria-hidden="true"
										/>
									</button>
									<button
										type="button"
										className="m-2 ml-0 inline-flex min-w-[82px] items-center justify-center gap-2 rounded-md border border-destructive/35 bg-background px-3 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
										aria-label={`Stop ${activity.agentName}`}
										onClick={() => {
											onStop(activity);
										}}
									>
										<SquareIcon
											className="size-3 fill-current"
											aria-hidden="true"
										/>
										Stop
									</button>
								</div>
								{expanded && (
									<section
										id={panelId}
										className="border-t bg-muted/45 px-4 py-3"
										aria-label={`${activity.agentName} live activity`}
									>
										{activity.entries.length > 0 ? (
											<AgentTraceTimeline entries={activity.entries} />
										) : (
											<p className="text-xs text-muted-foreground">
												{waitingActivityText(activity.adapter)}
											</p>
										)}
									</section>
								)}
							</article>
						);
					})
				: fallbackAgents.map((agent) => (
						<article
							key={agent.id}
							className="overflow-hidden rounded-lg border bg-background shadow-xs"
							data-runtime={agent.adapter}
						>
							<div className="grid min-h-[72px] grid-cols-[40px_minmax(0,1fr)] items-center gap-3 px-4">
								<AgentAvatar
									agent={agent}
									size="lg"
									ariaLabel={`${agent.displayName} is ${phase === "queued" ? "queued" : "responding"}`}
								/>
								<span className="min-w-0">
									<span className="flex items-baseline gap-2">
										<strong className="text-sm font-semibold">
											{agent.displayName}
										</strong>
										<span className="truncate text-xs text-muted-foreground">
											{runtimeLabel(agent.adapter)} ·{" "}
											{phase === "queued" ? "Queued" : "Waiting"}
										</span>
									</span>
									<span className="mt-1 block truncate text-sm text-muted-foreground">
										{phase === "queued"
											? "Queued for provider run…"
											: waitingActivityText(agent.adapter)}
									</span>
								</span>
							</div>
						</article>
					))}
		</div>
	);
}
