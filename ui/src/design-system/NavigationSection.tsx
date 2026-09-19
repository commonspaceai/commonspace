import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

export function NavigationSection(props: {
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAdd?: () => void;
	onNavigate?: (() => void) | undefined;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="mt-5 first:mt-2">
			<div className="flex items-center">
				<button
					type="button"
					aria-label={`${props.open ? "Collapse" : "Expand"} ${props.title.toLowerCase()}`}
					aria-expanded={props.open}
					onClick={() => props.onOpenChange(!props.open)}
					className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<ChevronDownIcon
						className={`size-3.5 transition-transform ${props.open ? "" : "-rotate-90"}`}
						aria-hidden="true"
					/>
				</button>
				<button
					type="button"
					onClick={props.onNavigate ?? (() => props.onOpenChange(!props.open))}
					className="min-h-8 min-w-0 flex-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					{props.title}
				</button>
				{props.actions}
				{props.onAdd !== undefined && (
					<button
						type="button"
						className="grid size-7 place-items-center rounded-sm border-0 bg-transparent text-lg text-sidebar-foreground/55 hover:text-sidebar-foreground"
						aria-label={`Add ${props.title.slice(0, -1).toLowerCase()}`}
						onClick={props.onAdd}
					>
						+
					</button>
				)}
			</div>
			{props.open && (
				<div className="grid gap-0.5 pt-0.5">{props.children}</div>
			)}
		</section>
	);
}
