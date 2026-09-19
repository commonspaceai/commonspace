import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThreadView = "all" | "running" | "followed";
const labels = {
	all: "All threads",
	running: "Running",
	followed: "Following",
} as const;
export function ChannelThreadFilter({
	value,
	counts,
	onChange,
}: {
	value: ThreadView;
	counts: Record<ThreadView, number>;
	onChange: (value: ThreadView) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="compact"
						aria-label="Channel thread view"
						className="text-muted-foreground"
					/>
				}
			>
				{labels[value]}
				<ChevronDownIcon className="size-3.5" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-48">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(next) => {
						if (next === "all" || next === "running" || next === "followed")
							onChange(next);
					}}
				>
					{(["all", "running", "followed"] as const).map((view) => (
						<DropdownMenuRadioItem
							key={view}
							value={view}
							closeOnClick
							aria-label={`Show ${view} threads`}
						>
							<span className="flex-1">{labels[view]}</span>
							<span className="text-xs tabular-nums text-muted-foreground">
								{counts[view]}
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
