import {
	ActivityIcon,
	AtSignIcon,
	CheckCheckIcon,
	CopyIcon,
	FolderPlusIcon,
	MessageSquareIcon,
	MoreHorizontalIcon,
	PinIcon,
	SettingsIcon,
	SquarePenIcon,
	Trash2Icon,
} from "lucide-react";
import { type ComponentProps, useState } from "react";
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

export function CollectionActionMenu({
	kind,
	label,
	meta,
	defaultOpen = false,
	pinned = false,
	triggerLabel,
	onOpen,
	onTogglePinned,
	onSettings,
	onAddFolder,
	unread = false,
	onMarkRead,
	onMarkUnread,
	onStartFreshChat,
	onMention,
	mentionLabel,
	onViewSessions,
	onCopy,
	copyLabel,
	onRemove,
}: CollectionActionMenuProps) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [freshConfirmOpen, setFreshConfirmOpen] = useState(false);

	return (
		<>
			<DropdownMenu defaultOpen={defaultOpen}>
				<DropdownMenuTrigger
					className={collectionActionTriggerClassName}
					aria-label={triggerLabel ?? `More actions for ${label}`}
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
						kind === "agent" && "w-[336px]",
					)}
				>
					<DropdownMenuGroup>
						<DropdownMenuLabel className="grid gap-0.5 border-b px-2.5 py-2.5">
							<strong className="truncate text-[13px] font-semibold text-foreground">
								{label}
							</strong>
							<span className="truncate font-mono text-xs font-normal text-muted-foreground">
								{meta}
							</span>
						</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuGroup>
						<DropdownMenuItem
							className="min-h-10 gap-2.5 px-2.5 text-[13px]"
							onClick={onOpen}
						>
							<MessageSquareIcon aria-hidden="true" />
							<ActionCopy
								label={openLabel(kind)}
								description={
									kind === "agent"
										? "Continue the private native session"
										: undefined
								}
							/>
						</DropdownMenuItem>
						{kind === "agent" && onStartFreshChat !== undefined && (
							<DropdownMenuItem
								className="min-h-10 gap-2.5 px-2.5 text-[13px]"
								onClick={() => {
									setFreshConfirmOpen(true);
								}}
							>
								<SquarePenIcon aria-hidden="true" />
								<ActionCopy
									label="Start fresh chat"
									description="Keep history, reset agent context"
								/>
							</DropdownMenuItem>
						)}
						{kind === "agent" &&
							onMention !== undefined &&
							mentionLabel !== undefined && (
								<DropdownMenuItem
									className="min-h-10 gap-2.5 px-2.5 text-[13px]"
									onClick={onMention}
								>
									<AtSignIcon aria-hidden="true" />
									<ActionCopy
										label={mentionLabel}
										description="Add this agent to the composer"
									/>
								</DropdownMenuItem>
							)}
						{kind === "channel" &&
							(unread ? onMarkRead : onMarkUnread) !== undefined && (
								<DropdownMenuItem
									className="min-h-10 gap-2.5 px-2.5 text-[13px]"
									onClick={unread ? onMarkRead : onMarkUnread}
								>
									<CheckCheckIcon aria-hidden="true" />
									{unread ? "Mark read" : "Mark unread"}
								</DropdownMenuItem>
							)}
						{kind === "project" && onAddFolder !== undefined && (
							<DropdownMenuItem
								className="min-h-10 gap-2.5 px-2.5 text-[13px]"
								onClick={onAddFolder}
							>
								<FolderPlusIcon aria-hidden="true" />
								Add local folder
							</DropdownMenuItem>
						)}
						{kind === "agent" && onViewSessions !== undefined && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="min-h-10 gap-2.5 px-2.5 text-[13px]"
									onClick={onViewSessions}
								>
									<ActivityIcon aria-hidden="true" />
									<ActionCopy
										label="View sessions"
										description="Running, blocked, and completed work"
									/>
								</DropdownMenuItem>
							</>
						)}
						{onTogglePinned !== undefined && (
							<DropdownMenuItem
								className="min-h-10 gap-2.5 px-2.5 text-[13px]"
								onClick={onTogglePinned}
							>
								<PinIcon aria-hidden="true" />
								<ActionCopy
									label={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
									description={
										kind === "agent"
											? pinned
												? "Remove from your quick access"
												: "Keep this agent in quick access"
											: undefined
									}
								/>
							</DropdownMenuItem>
						)}
						{onCopy !== undefined && copyLabel !== undefined && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="min-h-10 gap-2.5 px-2.5 text-[13px]"
									onClick={onCopy}
								>
									<CopyIcon aria-hidden="true" />
									<ActionCopy
										label={copyLabel}
										description={
											kind === "agent" ? `Copy @${label}` : undefined
										}
									/>
								</DropdownMenuItem>
							</>
						)}
						{onSettings !== undefined && (
							<DropdownMenuItem
								className="min-h-10 gap-2.5 px-2.5 text-[13px]"
								onClick={onSettings}
							>
								<SettingsIcon aria-hidden="true" />
								<ActionCopy
									label={settingsLabel(kind)}
									description={
										kind === "agent"
											? "Identity, runtime, tools, and skills"
											: undefined
									}
								/>
							</DropdownMenuItem>
						)}
					</DropdownMenuGroup>
					{onRemove !== undefined && (
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
										kind === "agent"
											? "Remove from Commonspace"
											: `Remove ${kind}`
									}
									description={
										kind === "agent"
											? "Leave the native harness profile untouched"
											: undefined
									}
								/>
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{onRemove !== undefined && (
				<ConfirmActionDialog
					open={confirmOpen}
					title={`Remove ${label}?`}
					description="This can be added again later. Existing local agent credentials stay untouched."
					onOpenChange={setConfirmOpen}
					onConfirm={onRemove}
				/>
			)}
			{onStartFreshChat !== undefined && (
				<ConfirmActionDialog
					open={freshConfirmOpen}
					title={`Start a new chat with ${label}?`}
					description="Earlier messages stay visible. Your next message starts with fresh native agent context."
					actionLabel="Start fresh"
					onOpenChange={setFreshConfirmOpen}
					onConfirm={onStartFreshChat}
				/>
			)}
		</>
	);
}
