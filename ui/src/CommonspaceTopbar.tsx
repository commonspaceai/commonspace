import { SearchIcon } from "lucide-react";
import { CommonspaceLogo } from "@/design-system/CommonspaceLogo";

export interface CommonspaceTopbarProps {
	onOpenSearch: () => void;
}

export function CommonspaceTopbar({ onOpenSearch }: CommonspaceTopbarProps) {
	return (
		<header className="relative z-30 grid min-h-[60px] grid-cols-[212px_minmax(180px,580px)_1fr] items-center gap-8 border-b bg-sidebar px-6 py-2 text-sidebar-foreground max-[780px]:grid-cols-[48px_minmax(0,1fr)] max-[780px]:gap-3 max-[780px]:px-3">
			<div className="flex min-h-9 w-fit items-center gap-3.5 text-left text-sidebar-foreground max-[780px]:px-2">
				<CommonspaceLogo decorative className="size-6" />
				<strong className="font-heading text-[15px] font-semibold max-[780px]:sr-only">
					Commonspace
				</strong>
			</div>
			<button
				type="button"
				aria-label="Search messages, channels, and agents"
				onClick={onOpenSearch}
				className="grid min-h-10 w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-sidebar-border bg-transparent px-3 text-left text-sidebar-foreground/80 hover:border-sidebar-foreground/40 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-foreground"
			>
				<SearchIcon className="size-4" aria-hidden="true" />
				<span className="truncate">Search workspace</span>
				<kbd className="px-1.5 font-sans text-xs text-muted-foreground">⌘K</kbd>
			</button>
			<span className="flex items-center justify-end gap-2 text-xs text-muted-foreground max-[780px]:hidden">
				<i
					className="size-1.5 rounded-full bg-[var(--status-success)]"
					aria-hidden="true"
				/>
				Local workspace
			</span>
		</header>
	);
}
