import type {
	CommonspaceBootstrap,
	CommonspaceMessage,
	CommonspaceRoutingAssignment,
	RerouteAssignmentRequest,
} from "@commonspace/shared";
import { conversationKey } from "@commonspace/shared";
import { ChevronDownIcon, GitBranchIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import { AgentAvatar } from "./AgentAvatar";

function routingDurationLabel(durationMs: number | undefined): string | null {
	if (durationMs === undefined) return null;
	if (durationMs < 1_000) return `${String(durationMs)}ms`;
	return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

type RoutingAgent = CommonspaceBootstrap["agents"][number];
type RoutingDecision = NonNullable<CommonspaceMessage["routing"]>;

const enum RoutingOutcome {
	Cancelled = "Cancelled",
	Completed = "Completed",
	Failed = "Failed",
	Queued = "Queued",
	Routing = "Routing",
	Running = "Running",
}

const enum RoutingSource {
	Ai = "AI selected",
	AiPending = "AI routing",
	Corrected = "manually corrected",
	Local = "local routing",
	Mention = "explicit mention",
}

const enum RoutingRetryMode {
	Ai = "ai",
	Manual = "manual",
}

interface RoutingAssignmentView {
	readonly agentName: string;
	readonly id: string;
	readonly projectNames: readonly string[];
	readonly request: string;
}

interface RoutingCorrectionView {
	readonly from: string;
	readonly id: string;
	readonly projectNames: readonly string[];
	readonly to: string;
}

interface RoutingReceiptView {
	readonly agents: readonly {
		id: string;
		name: string;
		agent: RoutingAgent | undefined;
	}[];
	readonly assignments: readonly RoutingAssignmentView[];
	readonly channelAgents: readonly RoutingAgent[];
	readonly corrections: readonly RoutingCorrectionView[];
	readonly duration: string | null;
	readonly outcome: RoutingOutcome;
	readonly reason: string;
	readonly receipt: string;
	readonly replyError: string | undefined;
	readonly routingStatus: RoutingDecision["status"];
	readonly source: RoutingSource;
	readonly summary: string;
}

function indexById<T extends { id: string }>(
	items: readonly T[],
): ReadonlyMap<string, T> {
	const indexed = new Map<string, T>();
	for (const item of items) {
		if (!indexed.has(item.id)) indexed.set(item.id, item);
	}
	return indexed;
}

function currentRoutingResponses(
	bootstrap: CommonspaceBootstrap | null | undefined,
	messageId: string,
	superseded: ReadonlySet<string>,
): CommonspaceMessage[] {
	return Object.values(bootstrap?.state.messages ?? {})
		.flat()
		.filter(
			(candidate) =>
				candidate.sourceMessageId === messageId &&
				(candidate.routingAssignmentId === undefined ||
					!superseded.has(candidate.routingAssignmentId)),
		);
}

function responseFailed(response: CommonspaceMessage): boolean {
	return (
		response.replyStatus === "failed" ||
		response.replyStatus === "error" ||
		response.replyStatus === "timeout" ||
		response.replyStatus === "silent" ||
		(response.authorType === "system" && /\brun failed:/iu.test(response.text))
	);
}

function routingOutcome({
	bootstrap,
	message,
	responses,
	routing,
}: {
	bootstrap: CommonspaceBootstrap | null | undefined;
	message: CommonspaceMessage;
	responses: readonly CommonspaceMessage[];
	routing: RoutingDecision;
}): RoutingOutcome {
	if (message.replyStatus === "cancelled") return RoutingOutcome.Cancelled;
	if (
		message.replyStatus === "failed" ||
		message.replyStatus === "error" ||
		message.replyStatus === "timeout" ||
		message.replyStatus === "silent" ||
		routing.status === "failed" ||
		(routing.agentIds.length === 0 && routing.status !== "pending") ||
		responses.some(responseFailed)
	)
		return RoutingOutcome.Failed;
	if (
		message.replyStatus === "running" ||
		bootstrap?.liveActivities?.some(
			(activity) => activity.sourceMessageId === message.id,
		) === true
	)
		return RoutingOutcome.Running;
	if (message.replyStatus === "complete") return RoutingOutcome.Completed;
	if (responses.length > 0) return RoutingOutcome.Completed;
	if (routing.status === "pending") return RoutingOutcome.Routing;
	return RoutingOutcome.Queued;
}

function routingSource(
	routing: RoutingDecision,
	hasAgents: boolean,
): RoutingSource {
	if (routing.corrections.length > 0) return RoutingSource.Corrected;
	if (routing.source === "explicit") return RoutingSource.Mention;
	if (routing.source === "ai") {
		return hasAgents ? RoutingSource.Ai : RoutingSource.AiPending;
	}
	return RoutingSource.Local;
}

function deriveRoutingReceipt(
	message: CommonspaceMessage,
	bootstrap: CommonspaceBootstrap | null | undefined,
): RoutingReceiptView | null {
	const routing = message.routing;
	if (message.authorType !== "user" || routing === undefined) return null;
	const agentsById = indexById(bootstrap?.agents ?? []);
	const projectsById = indexById(bootstrap?.state.projects ?? []);
	const assignmentsById = indexById(routing.assignments);
	const channel =
		message.conversation.kind === "channel"
			? bootstrap?.state.channels.find(
					(candidate) => candidate.id === message.conversation.id,
				)
			: undefined;
	const channelAgents = (channel?.agentIds ?? []).flatMap((agentId) => {
		const agent = agentsById.get(agentId);
		return agent === undefined ? [] : [agent];
	});
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
	const agentName = (agentId: string) =>
		agentsById.get(agentId)?.displayName ?? agentId;
	const agents = currentAgentIds.map((id) => ({
		id,
		name: agentName(id),
		agent: agentsById.get(id),
	}));
	const destination = agents.map((agent) => agent.name).join(", ");
	const source = routingSource(routing, agents.length > 0);
	const responses = currentRoutingResponses(bootstrap, message.id, superseded);
	const outcome = routingOutcome({ bootstrap, message, responses, routing });
	let receipt = `Routed to ${destination} · ${source} · ${outcome}`;
	if (routing.status === "pending") receipt = "Selecting an agent…";
	else if (agents.length === 0) {
		receipt =
			outcome === RoutingOutcome.Cancelled
				? "Routing cancelled · No agent selected"
				: "Routing failed · No agent selected";
	}
	return {
		agents,
		assignments: routing.assignments.map((assignment) => ({
			agentName: agentName(assignment.agentId),
			id: assignment.id,
			projectNames: assignment.projectIds.map(
				(projectId) => projectsById.get(projectId)?.name ?? projectId,
			),
			request:
				assignment.legacySubRequest === undefined
					? "Original message"
					: `Historical request: ${assignment.legacySubRequest}`,
		})),
		channelAgents,
		corrections: routing.corrections.map((correction) => {
			const from = assignmentsById.get(correction.fromAssignmentId);
			const to = assignmentsById.get(correction.toAssignmentId);
			return {
				from:
					from === undefined
						? correction.fromAssignmentId
						: agentName(from.agentId),
				id: correction.id,
				projectNames: correction.projectIds.map(
					(projectId) => projectsById.get(projectId)?.name ?? projectId,
				),
				to:
					to === undefined ? correction.toAssignmentId : agentName(to.agentId),
			};
		}),
		duration: routingDurationLabel(routing.durationMs),
		outcome,
		reason: routing.reason,
		receipt,
		replyError: message.replyError,
		routingStatus: routing.status,
		source,
		summary:
			routing.status === "pending" || agents.length === 0
				? receipt
				: outcome === RoutingOutcome.Completed
					? ""
					: outcome,
	};
}

interface RoutingReceiptProps {
	message: CommonspaceMessage;
	quotedSource?: boolean;
	bootstrap: CommonspaceBootstrap | null | undefined;
	onCorrectRouting?: (request: RerouteAssignmentRequest) => Promise<void>;
	onRetryRouting?: (
		message: CommonspaceMessage,
		choice: { mode: "ai" } | { mode: "manual"; agentId: string },
	) => Promise<void>;
}

function RoutingCorrectionForm({
	assignment,
	messageId,
	agents,
	assignedAgentIds,
	onCorrectRouting,
}: {
	assignment: CommonspaceRoutingAssignment;
	messageId: string;
	agents: readonly RoutingAgent[];
	assignedAgentIds: readonly string[];
	onCorrectRouting: NonNullable<RoutingReceiptProps["onCorrectRouting"]>;
}) {
	const [agentIds, setAgentIds] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sourceName =
		agents.find((agent) => agent.id === assignment.agentId)?.displayName ??
		assignment.agentId;
	const alreadyAssignedElsewhere =
		agentIds.length > 0 &&
		agentIds.every((agentId) => assignedAgentIds.includes(agentId));
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				if (saving || agentIds.length === 0) return;
				setSaving(true);
				setError(null);
				try {
					await onCorrectRouting({
						sourceMessageId: messageId,
						assignmentId: assignment.id,
						agentIds,
						projectIds: assignment.projectIds,
					});
				} catch {
					setError("Could not save the correction. Try again.");
				} finally {
					setSaving(false);
				}
			}}
		>
			<fieldset disabled={saving} className="grid gap-2">
				<legend className="mb-2 font-medium text-foreground">
					Replace {sourceName} with
				</legend>
				<div className="grid max-h-48 gap-1 overflow-y-auto">
					{agents
						.filter((agent) => agent.id !== assignment.agentId)
						.map((agent) => (
							<label
								key={agent.id}
								className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-foreground hover:bg-muted/60"
							>
								<input
									type="checkbox"
									aria-label={`Replace ${sourceName} with ${agent.displayName}`}
									className="size-4 accent-primary"
									checked={agentIds.includes(agent.id)}
									onChange={(event) =>
										setAgentIds((current) =>
											event.target.checked
												? [...current, agent.id]
												: current.filter((id) => id !== agent.id),
										)
									}
								/>
								<AgentAvatar agent={agent} size="sm" />
								<span>{agent.displayName}</span>
								{assignedAgentIds.includes(agent.id) ? (
									<span className="ml-auto text-muted-foreground">
										Already routed
									</span>
								) : null}
							</label>
						))}
				</div>
				<p className="text-muted-foreground">
					{alreadyAssignedElsewhere
						? "These agents already received the message. Your correction guides future routing in this Channel."
						: "New agents receive the original message with the same Projects. Your correction guides future routing in this Channel."}
				</p>
				{error === null ? null : (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				)}
				<Button type="submit" size="sm" disabled={agentIds.length === 0}>
					{saving
						? "Saving…"
						: alreadyAssignedElsewhere
							? "Remember correction"
							: "Reroute and remember"}
				</Button>
			</fieldset>
		</form>
	);
}

function RoutingCorrectionControls({
	message,
	view,
	onCorrectRouting,
}: {
	message: CommonspaceMessage;
	view: RoutingReceiptView;
	onCorrectRouting: RoutingReceiptProps["onCorrectRouting"];
}) {
	const summaryRef = useRef<HTMLElement>(null);
	const [selectedAssignmentId, setSelectedAssignmentId] = useState<
		string | null
	>(null);
	const assignments = useMemo(() => {
		const superseded = new Set(
			message.routing?.corrections.map(
				(correction) => correction.fromAssignmentId,
			),
		);
		return (
			message.routing?.assignments.filter(
				(assignment) => !superseded.has(assignment.id),
			) ?? []
		);
	}, [message.routing]);
	const selectedAssignment =
		assignments.find((assignment) => assignment.id === selectedAssignmentId) ??
		assignments[0];
	if (
		onCorrectRouting === undefined ||
		message.deletedAt !== undefined ||
		view.routingStatus !== "resolved" ||
		view.channelAgents.length < 2 ||
		selectedAssignment === undefined
	)
		return null;
	return (
		<details className="mt-3 border-t pt-3">
			<summary
				ref={summaryRef}
				className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Wrong recipient?
			</summary>
			<div className="mt-3 grid gap-3">
				{assignments.length > 1 ? (
					<NativeSelect
						aria-label="Recipient to replace"
						value={selectedAssignment.id}
						onChange={(event) => setSelectedAssignmentId(event.target.value)}
					>
						{assignments.map((assignment) => (
							<option key={assignment.id} value={assignment.id}>
								{view.channelAgents.find(
									(agent) => agent.id === assignment.agentId,
								)?.displayName ?? assignment.agentId}
							</option>
						))}
					</NativeSelect>
				) : null}
				<RoutingCorrectionForm
					key={selectedAssignment.id}
					assignment={selectedAssignment}
					messageId={message.id}
					agents={view.channelAgents}
					assignedAgentIds={assignments.map((item) => item.agentId)}
					onCorrectRouting={async (request) => {
						await onCorrectRouting(request);
						summaryRef.current?.focus();
					}}
				/>
			</div>
		</details>
	);
}

function RoutingSummary({ view }: { view: RoutingReceiptView }) {
	return (
		<div className="ml-auto flex min-w-0 items-center text-[11px] text-muted-foreground">
			<PopoverTrigger
				aria-label={`Routing details: ${view.receipt}`}
				title={view.receipt}
				className={cn(
					"inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-left font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					view.outcome === RoutingOutcome.Failed && "text-destructive",
				)}
			>
				<GitBranchIcon
					aria-hidden="true"
					className="size-3.5 shrink-0 text-primary"
				/>
				{view.agents.length > 0 ? (
					<span className="inline-flex items-center pl-1" aria-hidden="true">
						{view.agents.slice(0, 3).map(({ id, name, agent }) => (
							<AgentAvatar
								key={id}
								agent={agent}
								fallbackName={name}
								size="stack"
								className="-ml-1 ring-1 ring-background first:ml-0"
							/>
						))}
						{view.agents.length > 3 ? (
							<span className="ml-1">+{view.agents.length - 3}</span>
						) : null}
					</span>
				) : null}
				{view.summary === "" ? null : (
					<span className="truncate">{view.summary}</span>
				)}
				<ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
			</PopoverTrigger>
			{view.agents.length > 0 && view.routingStatus !== "pending" ? (
				<span
					className="sr-only"
					role={view.outcome === RoutingOutcome.Failed ? "alert" : "status"}
				>
					{view.outcome}
				</span>
			) : null}
		</div>
	);
}

function RoutingHistory({ view }: { view: RoutingReceiptView }) {
	if (view.assignments.length === 0 && view.corrections.length === 0)
		return null;
	return (
		<div className="mt-3 grid w-full gap-3 border-t pt-3 text-xs">
			{view.assignments.length > 0 ? (
				<ul className="grid gap-1" aria-label="Routing assignments">
					{view.assignments.map((assignment) => (
						<li key={assignment.id}>
							<strong className="text-foreground">
								{assignment.agentName}:
							</strong>{" "}
							{assignment.request}
							{assignment.projectNames.length === 0
								? ""
								: ` · ${assignment.projectNames.join(", ")}`}
						</li>
					))}
				</ul>
			) : null}
			{view.corrections.length > 0 ? (
				<ul className="grid gap-1" aria-label="Routing corrections">
					{view.corrections.map((correction) => (
						<li key={correction.id}>
							Rerouted {correction.from} → {correction.to}
							{correction.projectNames.length === 0
								? ""
								: ` · ${correction.projectNames.join(", ")}`}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function RoutingRetryControls({
	manualAgentId,
	message,
	onManualAgentIdChange,
	onRetryingChange,
	onRetryRouting,
	retrying,
	view,
}: {
	manualAgentId: string;
	message: CommonspaceMessage;
	onManualAgentIdChange: (agentId: string) => void;
	onRetryingChange: (mode: RoutingRetryMode | null) => void;
	onRetryRouting: RoutingReceiptProps["onRetryRouting"];
	retrying: RoutingRetryMode | null;
	view: RoutingReceiptView;
}) {
	if (view.routingStatus !== "failed" || onRetryRouting === undefined)
		return null;
	return (
		<div className="flex flex-wrap items-center gap-2 border-t pt-2">
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={retrying !== null}
				onClick={async () => {
					onRetryingChange(RoutingRetryMode.Ai);
					try {
						await onRetryRouting(message, { mode: RoutingRetryMode.Ai });
					} finally {
						onRetryingChange(null);
					}
				}}
			>
				{retrying === RoutingRetryMode.Ai ? "Retrying…" : "Retry agent routing"}
			</Button>
			<NativeSelect
				aria-label="Manual routing agent"
				className="h-8 text-xs"
				value={manualAgentId}
				disabled={retrying !== null}
				onChange={(event) => onManualAgentIdChange(event.target.value)}
			>
				<option value="">Route manually…</option>
				{view.channelAgents.map((agent) => (
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
					onRetryingChange(RoutingRetryMode.Manual);
					try {
						await onRetryRouting(message, {
							mode: RoutingRetryMode.Manual,
							agentId: manualAgentId,
						});
					} finally {
						onRetryingChange(null);
					}
				}}
			>
				{retrying === RoutingRetryMode.Manual ? "Routing…" : "Route"}
			</Button>
		</div>
	);
}

function RoutingDetails({
	manualAgentId,
	message,
	onManualAgentIdChange,
	onRetryingChange,
	onRetryRouting,
	onCorrectRouting,
	retrying,
	view,
}: {
	manualAgentId: string;
	message: CommonspaceMessage;
	onManualAgentIdChange: (agentId: string) => void;
	onRetryingChange: (mode: RoutingRetryMode | null) => void;
	onRetryRouting: RoutingReceiptProps["onRetryRouting"];
	onCorrectRouting: RoutingReceiptProps["onCorrectRouting"];
	retrying: RoutingRetryMode | null;
	view: RoutingReceiptView;
}) {
	return (
		<PopoverContent
			aria-label="Routing details"
			className="max-h-[calc(100vh-2rem)] w-[340px] overflow-y-auto rounded-lg bg-card p-[18px] text-xs leading-relaxed"
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
			{view.replyError === undefined ? null : (
				<p>
					<strong className="text-foreground">Outcome:</strong>{" "}
					{view.replyError}
				</p>
			)}
			<p className="text-foreground">{view.reason}</p>
			<div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground">
				<p className="text-xs">
					<span className="capitalize">
						{view.routingStatus === "pending"
							? "Choosing an agent"
							: view.source}
					</span>
					<span> · {view.outcome}</span>
					{view.duration === null ? null : (
						<span>
							{" "}
							· <span className="sr-only">Routing duration: </span>
							{view.duration}
						</span>
					)}
				</p>
				<RoutingHistory view={view} />
			</div>
			<RoutingRetryControls
				manualAgentId={manualAgentId}
				message={message}
				onManualAgentIdChange={onManualAgentIdChange}
				onRetryingChange={onRetryingChange}
				onRetryRouting={onRetryRouting}
				retrying={retrying}
				view={view}
			/>
			<RoutingCorrectionControls
				message={message}
				view={view}
				onCorrectRouting={onCorrectRouting}
			/>
		</PopoverContent>
	);
}

export function RoutingReceipt({
	message,
	bootstrap,
	onRetryRouting,
	onCorrectRouting,
}: RoutingReceiptProps) {
	const [manualAgentId, setManualAgentId] = useState("");
	const [retrying, setRetrying] = useState<RoutingRetryMode | null>(null);
	const view = useMemo(
		() => deriveRoutingReceipt(message, bootstrap),
		[bootstrap, message],
	);
	const hasNewerVersion = (
		bootstrap?.state.messages[conversationKey(message.conversation)] ?? []
	).some((candidate) => candidate.supersedesMessageId === message.id);
	if (view === null) return null;
	return (
		<Popover>
			<RoutingSummary view={view} />
			<RoutingDetails
				manualAgentId={manualAgentId}
				message={message}
				onManualAgentIdChange={setManualAgentId}
				onRetryingChange={setRetrying}
				onRetryRouting={onRetryRouting}
				onCorrectRouting={hasNewerVersion ? undefined : onCorrectRouting}
				retrying={retrying}
				view={view}
			/>
		</Popover>
	);
}
