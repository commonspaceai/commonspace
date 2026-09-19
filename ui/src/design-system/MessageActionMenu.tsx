import {
	BookmarkIcon,
	CheckCheckIcon,
	CopyIcon,
	MessageCircleReplyIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PinIcon,
	Trash2Icon,
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MessageActionMenuProps {
	authorName: string;
	summary: string;
	defaultOpen?: boolean;
	finalFocus?: () => HTMLElement | boolean | null;
	saved: boolean;
	onPin?: () => void;
	pinned?: boolean;
	pinning?: boolean;
	onReplyInThread?: () => void;
	onToggleSaved?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onMarkUnread?: () => void;
	onCopyLink?: () => void;
}

export function MessageActionMenu({
	authorName,
	summary,
	defaultOpen = false,
	finalFocus,
	saved,
	onPin,
	pinned = false,
	pinning = false,
	onReplyInThread,
	onToggleSaved,
	onEdit,
	onDelete,
	onMarkUnread,
	onCopyLink,
}: MessageActionMenuProps) {
	return (
		<DropdownMenu defaultOpen={defaultOpen}>
			<DropdownMenuTrigger
				className="grid size-7 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
				aria-label={`More actions for message from ${authorName}`}
			>
				<MoreHorizontalIcon className="size-4" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				finalFocus={finalFocus}
				align="end"
				className="w-[272px] rounded-md border p-1.5 shadow-[var(--shadow-high)] ring-0"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="grid gap-0.5 border-b px-2.5 py-2.5">
						<strong className="truncate text-[13px] font-semibold text-foreground">
							{authorName}
						</strong>
						<span className="truncate text-xs font-normal text-muted-foreground">
							{summary || "Attachment"}
						</span>
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuGroup>
					{onPin !== undefined && (
						<DropdownMenuItem
							className="min-h-9 gap-2.5 px-2.5 text-[13px]"
							onClick={onPin}
							disabled={pinning}
						>
							<PinIcon aria-hidden="true" />
							{pinned ? "Unpin message" : "Pin message"}
						</DropdownMenuItem>
					)}
					{onReplyInThread === undefined ? null : (
						<DropdownMenuItem
							className="min-h-9 gap-2.5 px-2.5 text-[13px]"
							onClick={onReplyInThread}
						>
							<MessageCircleReplyIcon aria-hidden="true" />
							Reply in thread
						</DropdownMenuItem>
					)}
					{onToggleSaved !== undefined && (
						<DropdownMenuItem
							className="min-h-9 gap-2.5 px-2.5 text-[13px]"
							onClick={onToggleSaved}
						>
							<BookmarkIcon aria-hidden="true" />
							{saved ? "Remove from saved" : "Save for later"}
						</DropdownMenuItem>
					)}
					{onMarkUnread !== undefined && (
						<DropdownMenuItem
							className="min-h-9 px-2.5 text-[13px]"
							onClick={onMarkUnread}
						>
							<CheckCheckIcon aria-hidden="true" />
							Mark unread
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
				{(onEdit !== undefined ||
					onCopyLink !== undefined ||
					onDelete !== undefined) && <DropdownMenuSeparator />}
				{onEdit !== undefined && (
					<DropdownMenuItem
						onClick={onEdit}
						className="min-h-9 gap-2.5 px-2.5 text-[13px]"
					>
						<PencilIcon aria-hidden="true" />
						Edit message
					</DropdownMenuItem>
				)}
				{onCopyLink !== undefined && (
					<DropdownMenuItem
						className="min-h-9 gap-2.5 px-2.5 text-[13px]"
						onClick={onCopyLink}
					>
						<CopyIcon aria-hidden="true" />
						Copy link
					</DropdownMenuItem>
				)}
				{onDelete !== undefined && (
					<DropdownMenuItem
						variant="destructive"
						onClick={onDelete}
						className="min-h-9 gap-2.5 px-2.5 text-[13px]"
					>
						<Trash2Icon aria-hidden="true" />
						Delete message
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
