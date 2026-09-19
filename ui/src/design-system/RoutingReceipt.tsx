import type {
	CommonspaceBootstrap,
	CommonspaceMessage,
} from "@commonspace/shared";
import { ChevronDownIcon, GitBranchIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function routingDurationLabel(durationMs: number | undefined): string | null {
	if (durationMs === undefined) return null;
	if (durationMs < 1_000) return `${String(durationMs)}ms`;
	return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function routingAgentName(
	agentId: string,
	bootstrap?: CommonspaceBootstrap | null,
): string {
	return (
		bootstrap?.agents.find((agent) => agent.id === agentId)?.displayName ??
		agentId
	);
}

function routingOutcome(
	message: CommonspaceMessage,
	bootstrap?: CommonspaceBootstrap | null,
): "Routing" | "Queued" | "Running" | "Completed" | "Cancelled" | "Failed" {
	const superseded = new Set(
		message.routing?.corrections.map(
			(correction) => correction.fromAssignmentId,
		),
	);
	const responses = Object.values(bootstrap?.state.messages ?? {})
		.flat()
		.filter(
			(candidate) =>
				candidate.sourceMessageId === message.id &&
				(candidate.routingAssignmentId === undefined ||
					!superseded.has(candidate.routingAssignmentId)),
		);
	if (message.replyStatus === "cancelled") return "Cancelled";
	if (
		message.replyStatus === "failed" ||
		message.replyStatus === "error" ||
		message.replyStatus === "timeout" ||
		message.replyStatus === "silent" ||
		message.routing?.status === "failed" ||
		(message.routing?.agentIds.length === 0 &&
			message.routing.status !== "pending") ||
		responses.some(
			(response) =>
				response.replyStatus === "failed" ||
				response.replyStatus === "error" ||
				response.replyStatus === "timeout" ||
				response.replyStatus === "silent" ||
				(response.authorType === "system" &&
					/\brun failed:/iu.test(response.text)),
		)
	)
		return "Failed";
	if (
		message.replyStatus === "running" ||
		bootstrap?.liveActivities?.some(
			(activity) => activity.sourceMessageId === message.id,
		) === true
	)
		return "Running";
	if (message.replyStatus === "complete") return "Completed";
	if (responses.length > 0) return "Completed";
	if (message.routing?.status === "pending") return "Routing";
	return "Queued";
}

export function RoutingReceipt({
	message,
	bootstrap,
	onRetryRouting,
}: {
	message: CommonspaceMessage;
	quotedSource?: boolean;
	bootstrap: CommonspaceBootstrap | null | undefined;
	onRetryRouting?: (
		message: CommonspaceMessage,
		choice: { mode: "ai" } | { mode: "manual"; agentId: string },
	) => Promise<void>;
}) {
	const routing = message.routing;
	const [manualAgentId, setManualAgentId] = useState("");
	const [retrying, setRetrying] = useState<"ai" | "manual" | null>(null);
	if (message.authorType !== "user" || routing === undefined) return null;
	const channelAgents =
		message.conversation.kind === "channel"
			? (bootstrap?.state.channels
					.find((channel) => channel.id === message.conversation.id)
					?.agentIds.map((agentId) =>
						bootstrap.agents.find((agent) => agent.id === agentId),
					)
					.filter((agent) => agent !== undefined) ?? [])
			: [];
	const superseded = new Set(
		routing.corrections.map((correction) => correction.fromAssignmentId),
	);
	const currentAgentIds =
		routing.assignments.length === 0
			? routing.agentIds
			: [
					...new Set(
						routing.assignments
							.filter((assignment) => !superseded.has(assignment.id))
							.map((assignment) => assignment.agentId),
					),
				];
	const agents = currentAgentIds.map((agentId) =>
		routingAgentName(agentId, bootstrap),
	);
	const destination = agents.join(", ");
	const source =
		routing.corrections.length > 0
			? "manually corrected"
			: routing.source === "explicit"
				? "explicit mention"
				: routing.source === "ai"
					? agents.length > 0
						? "AI selected"
						: "AI routing"
					: "local routing";
	const outcome = routingOutcome(message, bootstrap);
	const duration = routingDurationLabel(routing.durationMs);
	const compactSource =
		source === "AI selected"
			? "AI"
			: source === "explicit mention"
				? "Mention"
				: source === "manually corrected"
					? "Corrected"
					: "Route";
	let receipt = `Routed to ${destination} · ${source} · ${outcome}`;
	if (routing.status === "pending") receipt = "Selecting an agent…";
	else if (agents.length === 0) {
		receipt =
			outcome === "Cancelled"
				? "Routing cancelled · No agent selected"
				: "Routing failed · No agent selected";
	}
	return (
		<Popover>
			<div className="ml-auto flex min-w-0 max-w-xs items-center gap-2 text-[11px] text-muted-foreground">
				<PopoverTrigger
					aria-label={`Routing details: ${receipt}`}
					className={cn(
						"inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-left font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						outcome === "Failed" && "text-destructive",
					)}
				>
					<GitBranchIcon
						aria-hidden="true"
						className="size-3.5 shrink-0 text-primary"
					/>
					<span className="truncate">
						{routing.status === "pending" || agents.length === 0
							? receipt
							: `${compactSource} to ${destination}`}
					</span>
					<ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
				</PopoverTrigger>
				{agents.length > 0 && routing.status !== "pending" && (
					<span
						role={outcome === "Failed" ? "alert" : "status"}
						className={cn(
							"shrink-0",
							outcome === "Failed" && "text-destructive",
						)}
					>
						{outcome}
					</span>
				)}
			</div>
			<PopoverContent
				aria-label="Routing details"
				className="w-[340px] rounded-lg bg-card p-[18px] text-xs leading-relaxed"
			>
				<div className="mb-3 flex items-center justify-between gap-3">
					<PopoverTitle className="font-semibold text-foreground">
						Routing details
					</PopoverTitle>
					<PopoverClose
						aria-label="Close routing details"
						className="grid size-7 place-items-center rounded-md hover:text-foreground"
					>
						<XIcon className="size-4" />
					</PopoverClose>
				</div>
				{message.replyError !== undefined && (
					<p>
						<strong className="text-foreground">Outcome:</strong>{" "}
						{message.replyError}
					</p>
				)}
				<p className="text-foreground">{routing.reason}</p>
				{routing.source === "ai" &&
					/^Jev .+ selected .+ for .+ delivery\.$/u.test(routing.reason) && (
						<p className="mt-1 text-xs text-muted-foreground">
							The router recorded its selection, but did not provide a detailed
							rationale.
						</p>
					)}
				<div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
					<p className="text-xs">
						<span className="capitalize">
							{routing.status === "pending" ? "Choosing an agent" : source}
						</span>
						<span> · {outcome}</span>
						{duration === null ? null : (
							<span>
								{" "}
								· <span className="sr-only">Routing duration: </span>
								{duration}
							</span>
						)}
					</p>
					{(routing.assignments.length > 0 ||
						routing.corrections.length > 0) && (
						<div className="mt-3 grid w-full gap-3 border-t pt-3 text-xs">
							{routing.assignments.length > 0 && (
								<ul className="grid gap-1" aria-label="Routing assignments">
									{routing.assignments.map((assignment) => {
										const projects = assignment.projectIds.map(
											(projectId) =>
												bootstrap?.state.projects.find(
													(project) => project.id === projectId,
												)?.name ?? projectId,
										);
										return (
											<li key={assignment.id}>
												<strong className="text-foreground">
													{routingAgentName(assignment.agentId, bootstrap)}:
												</strong>{" "}
												{assignment.legacySubRequest === undefined
													? "Original message"
													: `Historical request: ${assignment.legacySubRequest}`}
												{projects.length === 0
													? ""
													: ` · ${projects.join(", ")}`}
											</li>
										);
									})}
								</ul>
							)}
							{routing.corrections.length > 0 && (
								<ul className="grid gap-1" aria-label="Routing corrections">
									{routing.corrections.map((correction) => {
										const from = routing.assignments.find(
											(assignment) =>
												assignment.id === correction.fromAssignmentId,
										);
										const to = routing.assignments.find(
											(assignment) =>
												assignment.id === correction.toAssignmentId,
										);
										return (
											<li key={correction.id}>
												Rerouted{" "}
												{from === undefined
													? correction.fromAssignmentId
													: routingAgentName(from.agentId, bootstrap)}{" "}
												→{" "}
												{to === undefined
													? correction.toAssignmentId
													: routingAgentName(to.agentId, bootstrap)}
											</li>
										);
									})}
								</ul>
							)}
						</div>
					)}
				</div>
				{routing.status === "failed" && onRetryRouting !== undefined && (
					<div className="flex flex-wrap items-center gap-2 border-t pt-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={retrying !== null}
							onClick={async () => {
								setRetrying("ai");
								try {
									await onRetryRouting(message, { mode: "ai" });
								} finally {
									setRetrying(null);
								}
							}}
						>
							{retrying === "ai" ? "Retrying…" : "Retry AI routing"}
						</Button>
						<NativeSelect
							aria-label="Manual routing agent"
							className="h-8 text-xs"
							value={manualAgentId}
							disabled={retrying !== null}
							onChange={(event) => {
								setManualAgentId(event.target.value);
							}}
						>
							<option value="">Route manually…</option>
							{channelAgents.map((agent) => (
								<option key={agent.id} value={agent.id}>
									{agent.displayName}
								</option>
							))}
						</NativeSelect>
						<Button
							type="button"
							size="sm"
							disabled={manualAgentId === "" || retrying !== null}
							onClick={async () => {
								if (manualAgentId === "") return;
								setRetrying("manual");
								try {
									await onRetryRouting(message, {
										mode: "manual",
										agentId: manualAgentId,
									});
								} finally {
									setRetrying(null);
								}
							}}
						>
							{retrying === "manual" ? "Routing…" : "Route"}
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
