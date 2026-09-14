import type { CommonspaceQueuedFollowup } from "@commonspace/shared";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	CircleStopIcon,
	CornerUpRightIcon,
	ListPlusIcon,
	RotateCcwIcon,
	SquareArrowUpIcon,
	XIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const deliveryOptions = {
	queue: {
		label: "Queue",
		status: "Queued",
		description: "Send after the current run finishes",
		icon: ListPlusIcon,
	},
	steer: {
		label: "Steer",
		status: "Steer",
		description: "Prioritize new guidance for the active run",
		icon: CornerUpRightIcon,
	},
	"stop-and-send": {
		label: "Interrupt and send",
		status: "Interrupt",
		description: "Stop the current run and send this next",
		icon: SquareArrowUpIcon,
	},
} satisfies Record<
	CommonspaceQueuedFollowup["delivery"],
	{
		label: string;
		status: string;
		description: string;
		icon: typeof ListPlusIcon;
	}
>;

type DeliveryMode = CommonspaceQueuedFollowup["delivery"];

function DeliveryOptionButton({
	delivery,
	disabled,
	thread,
	steeringAvailable,
}: {
	delivery: DeliveryMode;
	disabled: boolean;
	thread: boolean;
	steeringAvailable: boolean;
}) {
	const option = deliveryOptions[delivery];
	const Icon = option.icon;
	if (
		(delivery === "steer" && !steeringAvailable) ||
		(thread && delivery === "stop-and-send")
	)
		return null;
	const label = option.label;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="submit"
						name="delivery"
						value={delivery}
						variant={delivery === "queue" ? "outline" : "ghost"}
						size={delivery === "queue" ? "sm" : "icon-xs"}
						className={delivery === "queue" ? "h-8" : "size-8"}
						disabled={disabled}
					/>
				}
				aria-label={label}
			>
				<Icon data-icon="inline-start" aria-hidden="true" />
				{delivery === "queue" && "Queue"}
			</TooltipTrigger>
			<TooltipContent>
				<strong>{option.label}</strong>
				<br />
				{option.description}
			</TooltipContent>
		</Tooltip>
	);
}

export function RunDeliveryControls({
	disabled,
	thread = false,
	onStop,
	stopping = false,
	steeringAvailable = false,
}: {
	disabled: boolean;
	thread?: boolean;
	onStop?: () => void;
	stopping?: boolean;
	steeringAvailable?: boolean;
}) {
	return (
		<fieldset
			aria-label={thread ? "Active thread run delivery" : "Active run delivery"}
			className="order-2 m-0 ml-auto flex shrink-0 items-center gap-0.5 rounded-md border-0 bg-muted p-0.5"
		>
			{(["queue", "steer", "stop-and-send"] as const).map((delivery) => (
				<DeliveryOptionButton
					key={delivery}
					delivery={delivery}
					disabled={disabled}
					thread={thread}
					steeringAvailable={steeringAvailable}
				/>
			))}
			{onStop !== undefined && (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-8 text-destructive hover:text-destructive"
								disabled={stopping}
								onClick={onStop}
							/>
						}
						aria-label={thread ? "Stop thread run" : "Stop current run"}
					>
						<CircleStopIcon aria-hidden="true" />
					</TooltipTrigger>
					<TooltipContent>
						<strong>Stop</strong>
						<br />
						Stop the current run and keep queued follow-ups
					</TooltipContent>
				</Tooltip>
			)}
		</fieldset>
	);
}

export interface PendingAdmissionItem {
	id: string;
	text: string;
	status: "admitting" | "failed";
	error?: string;
	delivery?: CommonspaceQueuedFollowup["delivery"];
	attachmentCount?: number;
}

function PendingAdmissionRow({
	item,
	onRestore,
	onDismiss,
}: {
	item: PendingAdmissionItem;
	onRestore: (id: string) => void;
	onDismiss: (id: string) => void;
}) {
	const failed = item.status === "failed";
	const delivery = item.delivery ?? "queue";
	const attachmentCount = item.attachmentCount ?? 0;
	const status = failed
		? `Send failed${item.error === undefined ? "" : ` · ${item.error}`}`
		: `Admitting · ${deliveryOptions[delivery].status}`;
	return (
		<li className="flex min-w-0 items-start gap-3 px-3 py-2">
			<div className="min-w-0 flex-1">
				<p className="line-clamp-2 whitespace-pre-wrap text-xs leading-5 [overflow-wrap:anywhere]">
					{item.text || "Message with attachments"}
				</p>
				<p
					className={cn(
						"mt-0.5 text-[10px] text-muted-foreground",
						failed && "text-destructive",
					)}
					role={failed ? "alert" : "status"}
				>
					{status}
					{attachmentCount > 0
						? ` · ${String(attachmentCount)} attachment${attachmentCount === 1 ? "" : "s"}`
						: ""}
				</p>
			</div>
			{failed && (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						size="xs"
						variant="outline"
						onClick={() => onRestore(item.id)}
					>
						<RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
						Restore
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Dismiss failed message"
						onClick={() => onDismiss(item.id)}
					>
						<XIcon aria-hidden="true" />
					</Button>
				</div>
			)}
		</li>
	);
}

export function PendingAdmissions({
	items,
	thread = false,
	className,
	onRestore,
	onDismiss,
}: {
	items: PendingAdmissionItem[];
	thread?: boolean;
	className?: string;
	onRestore: (id: string) => void;
	onDismiss: (id: string) => void;
}) {
	if (items.length === 0) return null;
	return (
		<section
			aria-label={thread ? "Pending thread messages" : "Pending messages"}
			className={cn(
				"min-w-0 overflow-hidden rounded-md border bg-background",
				className,
			)}
		>
			<header className="flex min-h-9 items-center gap-2 border-b bg-muted/50 px-3">
				<SquareArrowUpIcon
					className="size-3.5 text-muted-foreground"
					aria-hidden="true"
				/>
				<h2 className="text-xs font-medium">Sending</h2>
				<Badge variant="outline">{items.length}</Badge>
			</header>
			<ul className="max-h-44 divide-y overflow-y-auto overscroll-contain">
				{items.map((item) => (
					<PendingAdmissionRow
						key={item.id}
						item={item}
						onRestore={onRestore}
						onDismiss={onDismiss}
					/>
				))}
			</ul>
		</section>
	);
}

export interface QueuedFollowupsProps {
	followups: CommonspaceQueuedFollowup[];
	thread?: boolean;
	className?: string;
	onMove: (messageId: string, direction: "up" | "down") => void;
	onRemove: (messageId: string) => void;
	onFocusComposer?: () => void;
}

export function QueuedFollowups({
	followups,
	thread = false,
	className,
	onMove,
	onRemove,
	onFocusComposer,
}: QueuedFollowupsProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const trayRef = useRef<HTMLElement>(null);
	const previewRefs = useRef(new Map<string, HTMLButtonElement>());
	const pendingFocus = useRef<{
		control: HTMLButtonElement;
		messageId: string | undefined;
	} | null>(null);
	useLayoutEffect(() => {
		const pending = pendingFocus.current;
		if (pending === null) return;
		if (pending.control.isConnected && !pending.control.disabled) return;
		pendingFocus.current = null;
		// A delayed queue response must not pull focus back from another control.
		if (
			document.activeElement !== document.body &&
			document.activeElement !== pending.control
		)
			return;
		const target =
			pending.messageId === undefined
				? null
				: previewRefs.current.get(pending.messageId);
		if (target !== null && target !== undefined) target.focus();
		else if (followups.length === 0) onFocusComposer?.();
		else trayRef.current?.focus();
	}, [followups, onFocusComposer]);
	if (followups.length === 0) return null;
	const itemLabel = thread ? "queued thread follow-up" : "queued follow-up";
	return (
		<section
			ref={trayRef}
			tabIndex={-1}
			aria-label={thread ? "Queued thread follow-ups" : "Queued follow-ups"}
			className={cn(
				"min-w-0 overflow-hidden rounded-md border bg-background",
				className,
			)}
		>
			<header className="flex min-h-9 items-center gap-2 border-b bg-muted/50 px-3">
				<ListPlusIcon
					aria-hidden="true"
					className="size-3.5 text-muted-foreground"
				/>
				<h2 className="text-xs font-medium">Up next</h2>
				<Badge variant="outline">{followups.length}</Badge>
			</header>
			<ol className="max-h-44 divide-y overflow-y-auto overscroll-contain">
				{followups.map((followup, index) => {
					const option = deliveryOptions[followup.delivery];
					const Icon = option.icon;
					const expanded = expandedId === followup.messageId;
					return (
						<li
							key={followup.messageId}
							className="flex min-w-0 items-start gap-2 px-2 py-2"
						>
							<div className="min-w-0 flex-1">
								<button
									ref={(element) => {
										if (element === null)
											previewRefs.current.delete(followup.messageId);
										else previewRefs.current.set(followup.messageId, element);
									}}
									type="button"
									aria-expanded={expanded}
									aria-label={`${expanded ? "Collapse" : "Expand"} ${itemLabel} ${index + 1}`}
									className="block w-full rounded-sm px-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() =>
										setExpandedId(expanded ? null : followup.messageId)
									}
								>
									<span
										className={cn(
											"block whitespace-pre-wrap text-xs leading-5 [overflow-wrap:anywhere]",
											!expanded && "line-clamp-2",
										)}
									>
										{followup.text || "Message with attachments"}
									</span>
								</button>
								<span className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
									<Icon className="size-3" aria-hidden="true" />
									{option.status}
								</span>
							</div>
							<div className="flex shrink-0 items-center">
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="ghost"
												size="icon-xs"
												className="size-7"
												disabled={index === 0}
												onClick={(event) => {
													pendingFocus.current = {
														control: event.currentTarget,
														messageId: followup.messageId,
													};
													onMove(followup.messageId, "up");
												}}
											/>
										}
										aria-label={`Move ${itemLabel} up`}
									>
										<ArrowUpIcon aria-hidden="true" />
									</TooltipTrigger>
									<TooltipContent>Move earlier</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="ghost"
												size="icon-xs"
												className="size-7"
												disabled={index === followups.length - 1}
												onClick={(event) => {
													pendingFocus.current = {
														control: event.currentTarget,
														messageId: followup.messageId,
													};
													onMove(followup.messageId, "down");
												}}
											/>
										}
										aria-label={`Move ${itemLabel} down`}
									>
										<ArrowDownIcon aria-hidden="true" />
									</TooltipTrigger>
									<TooltipContent>Move later</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="ghost"
												size="icon-xs"
												className="size-7"
												onClick={(event) => {
													pendingFocus.current = {
														control: event.currentTarget,
														messageId: (
															followups[index + 1] ?? followups[index - 1]
														)?.messageId,
													};
													onRemove(followup.messageId);
												}}
											/>
										}
										aria-label={`Remove ${itemLabel}`}
									>
										<XIcon aria-hidden="true" />
									</TooltipTrigger>
									<TooltipContent>Remove from queue</TooltipContent>
								</Tooltip>
							</div>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
