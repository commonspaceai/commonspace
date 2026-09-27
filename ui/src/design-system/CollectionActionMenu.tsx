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
import { type ComponentProps, type FormEvent, Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
	onRename?: (name: string) => void | Promise<void>;
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
	| "rename"
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
	requestRename: () => void,
): CollectionMenuAction[] {
	const onClick = props.unread ? props.onMarkRead : props.onMarkUnread;
	const actions: CollectionMenuAction[] = [];
	if (onClick !== undefined) {
		actions.push({
			id: "read-state",
			icon: CheckCheckIcon,
			label: props.unread ? "Mark read" : "Mark unread",
			onClick,
			presentation: "plain",
			separatorBefore: false,
		});
	}
	if (props.onRename !== undefined) {
		actions.push({
			description: undefined,
			id: "rename",
			icon: SquarePenIcon,
			label: "Rename channel",
			onClick: requestRename,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	return actions;
}

function projectMenuActions(
	props: CollectionActionMenuProps,
	requestRename: () => void,
): CollectionMenuAction[] {
	const actions: CollectionMenuAction[] = [];
	if (props.onRename !== undefined) {
		actions.push({
			description: "Change the project name",
			id: "rename",
			icon: SquarePenIcon,
			label: "Rename project",
			onClick: requestRename,
			presentation: "copy",
			separatorBefore: false,
		});
	}
	if (props.onAddFolder !== undefined) {
		actions.push({
			id: "add-folder",
			icon: FolderPlusIcon,
			label: "Add local folder",
			onClick: props.onAddFolder,
			presentation: "plain",
			separatorBefore: false,
		});
	}
	return actions;
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
	requestRename: () => void,
): CollectionMenuAction[] {
	let kindActions: CollectionMenuAction[];
	const kind = props.kind;
	switch (kind) {
		case "agent":
			kindActions = agentMenuActions(props, requestFreshChat);
			break;
		case "channel":
			kindActions = channelMenuActions(props, requestRename);
			break;
		case "project":
			kindActions = projectMenuActions(props, requestRename);
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

function RenameCollectionDialog({
	open,
	kind,
	label,
	name,
	error,
	saving,
	onNameChange,
	onOpenChange,
	onSubmit,
}: {
	open: boolean;
	kind: CommonspaceCollectionKind;
	label: string;
	name: string;
	error: string | null;
	saving: boolean;
	onNameChange: (name: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				closeLabel={`Close rename ${kind}`}
				className="rounded-md p-0 sm:max-w-[440px]"
			>
				<DialogHeader className="border-b px-5 py-4">
					<DialogTitle>Rename {kind}</DialogTitle>
					<DialogDescription>
						Choose a new name for {kind === "channel" ? `#${label}` : label}.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-5 p-5" onSubmit={onSubmit}>
					<label className="grid gap-1.5 text-sm font-medium">
						<span>{kind === "channel" ? "Channel" : "Project"} name</span>
						<input
							autoComplete="off"
							autoFocus
							maxLength={kind === "channel" ? 48 : 80}
							required
							value={name}
							onChange={(event) => {
								onNameChange(event.target.value);
							}}
							className="min-h-10 w-full rounded-sm border bg-background px-3 text-sm font-normal"
						/>
					</label>
					{error !== null && (
						<p className="text-xs text-destructive" role="alert">
							{error}
						</p>
					)}
					<footer className="-mx-5 -mb-5 flex justify-end gap-2 border-t bg-muted px-5 py-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								onOpenChange(false);
							}}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? "Saving…" : "Save"}
						</Button>
					</footer>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function CollectionActionMenu(props: CollectionActionMenuProps) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [freshConfirmOpen, setFreshConfirmOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameName, setRenameName] = useState(props.label);
	const [renameError, setRenameError] = useState<string | null>(null);
	const [renameSaving, setRenameSaving] = useState(false);
	const actions = collectionMenuActions(
		props,
		() => {
			setFreshConfirmOpen(true);
		},
		() => {
			setRenameName(props.label);
			setRenameError(null);
			setRenameOpen(true);
		},
	);
	const saveRename = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (renameSaving || props.onRename === undefined) return;
		setRenameSaving(true);
		setRenameError(null);
		try {
			await props.onRename(renameName);
			setRenameOpen(false);
		} catch (error) {
			setRenameError(error instanceof Error ? error.message : String(error));
		} finally {
			setRenameSaving(false);
		}
	};

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
			{props.onRename !== undefined && (
				<RenameCollectionDialog
					open={renameOpen}
					kind={props.kind}
					label={props.label}
					name={renameName}
					error={renameError}
					saving={renameSaving}
					onNameChange={(name) => {
						setRenameName(name);
						setRenameError(null);
					}}
					onOpenChange={setRenameOpen}
					onSubmit={(event) => {
						void saveRename(event);
					}}
				/>
			)}
		</>
	);
}
