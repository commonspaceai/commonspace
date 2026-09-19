import {
	BellPlusIcon,
	CheckCheckIcon,
	CopyIcon,
	FolderOpenIcon,
	MessageSquareTextIcon,
	MoreHorizontalIcon,
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
import { cn } from "@/lib/utils";

export interface ResourceActionMenuProps {
	kind: "thread" | "file" | "folder";
	label: string;
	meta: string;
	defaultOpen?: boolean;
	following?: boolean;
	unread?: boolean;
	triggerClassName?: string;
	onOpen: () => void;
	onToggleFollow?: () => void;
	onMarkRead?: () => void;
	onMarkUnread?: () => void;
	onCopy: () => void;
}

export function ResourceActionMenu({
	kind,
	label,
	meta,
	defaultOpen = false,
	following = false,
	unread = false,
	triggerClassName,
	onOpen,
	onToggleFollow,
	onMarkRead,
	onMarkUnread,
	onCopy,
}: ResourceActionMenuProps) {
	const markState = unread ? onMarkRead : onMarkUnread;
	return (
		<DropdownMenu defaultOpen={defaultOpen}>
			<DropdownMenuTrigger
				className={cn(
					"grid size-8 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus:opacity-100 max-[780px]:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30",
					triggerClassName,
				)}
				aria-label={`More actions for ${label}`}
			>
				<MoreHorizontalIcon className="size-4" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-[272px] rounded-md border p-1.5 shadow-[var(--shadow-high)] ring-0"
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
						{kind === "thread" ? (
							<MessageSquareTextIcon aria-hidden="true" />
						) : (
							<FolderOpenIcon aria-hidden="true" />
						)}
						{kind === "thread"
							? "Open thread"
							: kind === "folder"
								? "Open folder"
								: "Open file"}
					</DropdownMenuItem>
					{kind === "thread" && onToggleFollow !== undefined && (
						<DropdownMenuItem
							className="min-h-10 gap-2.5 px-2.5 text-[13px]"
							onClick={onToggleFollow}
						>
							<BellPlusIcon aria-hidden="true" />
							{following ? "Unfollow thread" : "Follow thread"}
						</DropdownMenuItem>
					)}
					{kind === "thread" && markState !== undefined && (
						<DropdownMenuItem
							className="min-h-10 gap-2.5 px-2.5 text-[13px]"
							onClick={markState}
						>
							<CheckCheckIcon aria-hidden="true" />
							{unread ? "Mark read" : "Mark unread"}
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="min-h-10 gap-2.5 px-2.5 text-[13px]"
					onClick={onCopy}
				>
					<CopyIcon aria-hidden="true" />
					{kind === "thread" ? "Copy link" : "Copy name"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
