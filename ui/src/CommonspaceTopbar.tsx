import { CircleHelpIcon, SearchIcon, XIcon } from "lucide-react";
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
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
			<div className="flex items-center justify-end gap-2 text-xs text-muted-foreground max-[780px]:hidden">
				<span className="inline-flex items-center gap-2">
					<i
						className="size-1.5 rounded-full bg-[var(--status-success)]"
						aria-hidden="true"
					/>
					Local workspace
				</span>
				<Popover>
					<PopoverTrigger
						aria-label="Help and shortcuts"
						title="Help and keyboard shortcuts"
						className="grid size-9 place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-foreground"
					>
						<CircleHelpIcon className="size-4" aria-hidden="true" />
					</PopoverTrigger>
					<PopoverContent
						aria-label="Help and shortcuts"
						className="w-[360px] rounded-lg bg-card p-[18px] text-xs leading-relaxed"
					>
						<div className="mb-3 flex items-center justify-between gap-3">
							<PopoverTitle className="font-semibold text-foreground">
								Work stays connected
							</PopoverTitle>
							<PopoverClose
								aria-label="Close help"
								className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"
							>
								<XIcon className="size-4" aria-hidden="true" />
							</PopoverClose>
						</div>
						<p className="text-foreground">
							A Channel post starts routed work. Thread replies continue the
							same saved Agent session, with shared context that never rewrites
							the conversation record.
						</p>
						<dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 border-t pt-3 text-muted-foreground">
							<dt>Search Commonspace</dt>
							<dd>
								<kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
									⌘K / Ctrl K
								</kbd>
							</dd>
							<dt>Switch Channel / Thread writing</dt>
							<dd>
								<kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
									F6
								</kbd>
							</dd>
							<dt>Close the active panel</dt>
							<dd>
								<kbd className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
									Esc
								</kbd>
							</dd>
						</dl>
					</PopoverContent>
				</Popover>
			</div>
		</header>
	);
}
