import { ArrowDownAZIcon, Clock3Icon, ListOrderedIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChannelSortMode } from "../channel-sorting";
import type { SidebarCollectionKind } from "../sidebar-preferences";

const sortOptions = {
	recent: { label: "Recent activity", icon: Clock3Icon },
	alphabetical: { label: "Alphabetical", icon: ArrowDownAZIcon },
	custom: { label: "Custom order", icon: ListOrderedIcon },
} satisfies Record<ChannelSortMode, { label: string; icon: typeof Clock3Icon }>;

export function SidebarSortControl({
	kind,
	mode,
	onModeChange,
}: {
	kind: SidebarCollectionKind;
	mode: ChannelSortMode;
	onModeChange: (mode: ChannelSortMode) => void;
}) {
	const active = sortOptions[mode];
	const Icon = active.icon;
	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger
						render={
							<DropdownMenuTrigger
								render={
									<Button variant="ghost" size="icon-xs" className="size-7" />
								}
							/>
						}
						aria-label={`Sort ${kind}s: ${active.label}`}
					>
						<Icon aria-hidden="true" />
					</TooltipTrigger>
					<TooltipContent>
						Sort {kind}s · {active.label}
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Sort {kind}s</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={mode}
							onValueChange={(value) => {
								if (
									value === "recent" ||
									value === "alphabetical" ||
									value === "custom"
								)
									onModeChange(value);
							}}
						>
							{(["recent", "alphabetical", "custom"] as const).map((value) => {
								const option = sortOptions[value];
								const OptionIcon = option.icon;
								return (
									<DropdownMenuRadioItem key={value} value={value} closeOnClick>
										<OptionIcon aria-hidden="true" />
										{option.label}
									</DropdownMenuRadioItem>
								);
							})}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<p className="px-2 pt-2 pb-1 text-[11px] leading-relaxed text-muted-foreground">
						Custom: drag to reorder.{" "}
						<span className="whitespace-nowrap">Alt+↑/↓</span> moves within a
						group.
					</p>
				</DropdownMenuContent>
			</DropdownMenu>
			{mode === "custom" && (
				<p id={`${kind}-custom-order-help`} className="sr-only">
					Drag to reorder, or use Alt with the up and down arrow keys.
				</p>
			)}
		</>
	);
}
