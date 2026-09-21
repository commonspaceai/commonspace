import {
	ActivityIcon,
	AtSignIcon,
	CheckCheckIcon,
	CopyIcon,
	FolderPlusIcon,
	type LucideIcon,
	MessageSquareIcon,
	MoreHorizontalIcon,
	PinIcon,
	SettingsIcon,
	SquarePenIcon,
	Trash2Icon,
} from "lucide-react";
import { type ComponentProps, Fragment, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

export type CommonspaceCollectionKind = "project" | "channel" | "agent";

const collectionActionTriggerClassName =
	"grid size-6 place-items-center rounded-sm border-0 bg-transparent text-foreground/65 opacity-0 transition-[background-color,color,opacity] hover:text-foreground aria-expanded:text-foreground data-[popup-open]:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 max-[780px]:opacity-100";
const collectionActionIconClassName = "size-3.5";

export type CollectionActionButtonProps = Omit<
	ComponentProps<"button">,
	"aria-label" | "children"
> & {
	label: string;
};

export function CollectionActionButton({
	label,
	className,
	type = "button",
	...props
}: CollectionActionButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={cn(collectionActionTriggerClassName, className)}
			aria-label={label}
		>
			<MoreHorizontalIcon
				className={collectionActionIconClassName}
				aria-hidden="true"
			/>
		</button>
	);
}

export interface CollectionActionMenuProps {
	kind: CommonspaceCollectionKind;
	label: string;
	meta: string;
	defaultOpen?: boolean;
	pinned?: boolean;
	triggerLabel?: string;
	onOpen: () => void;
	onTogglePinned?: () => void;
	onSettings?: () => void;
	onAddFolder?: () => void;
	unread?: boolean;
	onMarkRead?: () => void;
	onMarkUnread?: () => void;
	onStartFreshChat?: () => void;
	onMention?: () => void;
	mentionLabel?: string;
	onViewSessions?: () => void;
	onCopy?: () => void;
	copyLabel?: string;
	onRemove?: () => void | Promise<void>;
}

function openLabel(kind: CommonspaceCollectionKind): string {
	return kind === "agent" ? "Message agent" : `Open ${kind}`;
}

function settingsLabel(kind: CommonspaceCollectionKind): string {
	if (kind === "agent") return "Profile & capabilities";
	return `${kind.slice(0, 1).toLocaleUpperCase()}${kind.slice(1)} settings`;
}

function unsupportedCollectionKind(kind: never): never {
	throw new Error(`Unsupported collection kind: ${String(kind)}`);
}

function ActionCopy({
	label,
	description,
}: {
	label: string;
	description: string | undefined;
}) {
	return (
		<span className="grid min-w-0 gap-0.5">
			<strong className="truncate text-[13px] font-semibold">{label}</strong>
			{description === undefined ? null : (
				<small className="truncate text-xs font-normal text-muted-foreground">
					{description}
				</small>
			)}
		</span>
	);
}

type CollectionMenuActionId =
	| "add-folder"
	| "copy"
	| "fresh-chat"
	| "mention"
	| "open"
	| "pin"
	| "read-state"
	| "sessions"
	| "settings";

interface CollectionMenuActionBase {
	readonly icon: LucideIcon;
	readonly id: CollectionMenuActionId;
	readonly label: string;
	readonly onClick: () => void;
	readonly separatorBefore: boolean;
}

type CollectionMenuAction = CollectionMenuActionBase &
	(
		| {
				readonly description: string | undefined;
				readonly presentation: "copy";
		  }
		| { readonly presentation: "plain" }
	);

function agentMenuActions(
	props: CollectionActionMenuProps,
	requestFreshChat: () => void,
): CollectionMenuAction[] {
	const actions: CollectionMenuAction[] = [];
	if (props.onStartFreshChat !== undefined) {
		actions.push({
			description: "Keep history, reset agent context",
			id: "fresh-chat",
			icon: SquarePenIcon,
			label: "Start fresh chat",
			onClick: requestFreshChat,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	if (props.onMention !== undefined && props.mentionLabel !== undefined) {
		actions.push({
			description: "Add this agent to the composer",
			id: "mention",
			icon: AtSignIcon,
			label: props.mentionLabel,
			onClick: props.onMention,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	if (props.onViewSessions !== undefined) {
		actions.push({
			description: "Running, blocked, and completed work",
			id: "sessions",
			icon: ActivityIcon,
			label: "View sessions",
			onClick: props.onViewSessions,
			presentation: "copy",
			separatorBefore: true,
		});
	}
	return actions;
}

function channelMenuActions(
	props: CollectionActionMenuProps,
): CollectionMenuAction[] {
	const onClick = props.unread ? props.onMarkRead : props.onMarkUnread;
	if (onClick === undefined) return [];
	return [
		{
			id: "read-state",
			icon: CheckCheckIcon,
			label: props.unread ? "Mark read" : "Mark unread",
			onClick,
			presentation: "plain",
			separatorBefore: false,
		},
	];
}

function projectMenuActions(
	props: CollectionActionMenuProps,
): CollectionMenuAction[] {
	if (props.onAddFolder === undefined) return [];
	return [
		{
			id: "add-folder",
			icon: FolderPlusIcon,
			label: "Add local folder",
			onClick: props.onAddFolder,
			presentation: "plain",
			separatorBefore: false,
		},
	];
}

function commonMenuActions(
	props: CollectionActionMenuProps,
): CollectionMenuAction[] {
	const actions: CollectionMenuAction[] = [];
	if (props.onTogglePinned !== undefined) {
		actions.push({
			description:
				props.kind === "agent"
					? props.pinned
						? "Remove from your quick access"
						: "Keep this agent in quick access"
					: undefined,
			id: "pin",
			icon: PinIcon,
			label: props.pinned ? "Unpin from sidebar" : "Pin to sidebar",
			onClick: props.onTogglePinned,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	if (props.onCopy !== undefined && props.copyLabel !== undefined) {
		actions.push({
			description: props.kind === "agent" ? `Copy @${props.label}` : undefined,
			id: "copy",
			icon: CopyIcon,
			label: props.copyLabel,
			onClick: props.onCopy,
			presentation: "copy",
			separatorBefore: true,
		});
	}
	if (props.onSettings !== undefined) {
		actions.push({
			description:
				props.kind === "agent"
					? "Identity, runtime, tools, and skills"
					: undefined,
			id: "settings",
			icon: SettingsIcon,
			label: settingsLabel(props.kind),
			onClick: props.onSettings,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	return actions;
}

function collectionMenuActions(
	props: CollectionActionMenuProps,
	requestFreshChat: () => void,
): CollectionMenuAction[] {
	let kindActions: CollectionMenuAction[];
	const kind = props.kind;
	switch (kind) {
		case "agent":
			kindActions = agentMenuActions(props, requestFreshChat);
			break;
		case "channel":
			kindActions = channelMenuActions(props);
			break;
		case "project":
			kindActions = projectMenuActions(props);
			break;
		default:
			return unsupportedCollectionKind(kind);
	}
	return [
		{
			description:
				props.kind === "agent"
					? "Continue the private native session"
					: undefined,
			id: "open",
			icon: MessageSquareIcon,
			label: openLabel(props.kind),
			onClick: props.onOpen,
			presentation: "copy",
			separatorBefore: false,
		},
		...kindActions,
		...commonMenuActions(props),
	];
}

function CollectionMenuActionItem({
	action,
}: {
	action: CollectionMenuAction;
}) {
	const Icon = action.icon;
	return (
		<Fragment>
			{action.separatorBefore === true && <DropdownMenuSeparator />}
			<DropdownMenuItem
				className="min-h-10 gap-2.5 px-2.5 text-[13px]"
				onClick={action.onClick}
			>
				<Icon aria-hidden="true" />
				{action.presentation === "copy" ? (
					<ActionCopy label={action.label} description={action.description} />
				) : (
					action.label
				)}
			</DropdownMenuItem>
		</Fragment>
	);
}

export function CollectionActionMenu(props: CollectionActionMenuProps) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [freshConfirmOpen, setFreshConfirmOpen] = useState(false);
	const actions = collectionMenuActions(props, () => {
		setFreshConfirmOpen(true);
	});

	return (
		<>
			<DropdownMenu defaultOpen={props.defaultOpen ?? false}>
				<DropdownMenuTrigger
					className={collectionActionTriggerClassName}
					aria-label={props.triggerLabel ?? `More actions for ${props.label}`}
				>
					<MoreHorizontalIcon
						className={collectionActionIconClassName}
						aria-hidden="true"
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className={cn(
						"w-[272px] rounded-md border p-1.5 shadow-[var(--shadow-high)] ring-0",
						props.kind === "agent" && "w-[336px]",
					)}
				>
					<DropdownMenuGroup>
						<DropdownMenuLabel className="grid gap-0.5 border-b px-2.5 py-2.5">
							<strong className="truncate text-[13px] font-semibold text-foreground">
								{props.label}
							</strong>
							<span className="truncate font-mono text-xs font-normal text-muted-foreground">
								{props.meta}
							</span>
						</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuGroup>
						{actions.map((action) => (
							<CollectionMenuActionItem key={action.id} action={action} />
						))}
					</DropdownMenuGroup>
					{props.onRemove !== undefined && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								className="min-h-10 gap-2.5 px-2.5 text-[13px]"
								onClick={() => {
									setConfirmOpen(true);
								}}
							>
								<Trash2Icon aria-hidden="true" />
								<ActionCopy
									label={
										props.kind === "agent"
											? "Remove from Commonspace"
											: `Remove ${props.kind}`
									}
									description={
										props.kind === "agent"
											? "Leave the native harness profile untouched"
											: undefined
									}
								/>
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{props.onRemove !== undefined && (
				<ConfirmActionDialog
					open={confirmOpen}
					title={`Remove ${props.label}?`}
					description="This can be added again later. Existing local agent credentials stay untouched."
					onOpenChange={setConfirmOpen}
					onConfirm={props.onRemove}
				/>
			)}
			{props.onStartFreshChat !== undefined && (
				<ConfirmActionDialog
					open={freshConfirmOpen}
					title={`Start a new chat with ${props.label}?`}
					description="Earlier messages stay visible. Your next message starts with fresh native agent context."
					actionLabel="Start fresh"
					onOpenChange={setFreshConfirmOpen}
					onConfirm={props.onStartFreshChat}
				/>
			)}
		</>
	);
}
