import { ChevronDownIcon } from "lucide-react";
import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export function NativeSelect({
	className,
	...props
}: ComponentPropsWithRef<"select">) {
	const singleLine =
		props.multiple !== true && (props.size === undefined || props.size <= 1);
	return (
		<span className="relative grid min-w-0 items-center">
			<select
				{...props}
				data-slot="native-select"
				className={cn(
					"col-start-1 row-start-1 h-9 w-full min-w-0 rounded-sm border border-input bg-background px-3 text-[13px] text-foreground transition-colors hover:border-muted-foreground/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
					singleLine && "appearance-none pr-9",
					className,
				)}
			/>
			{singleLine ? (
				<ChevronDownIcon
					aria-hidden="true"
					className="pointer-events-none absolute right-3 size-3.5 text-muted-foreground"
				/>
			) : null}
		</span>
	);
}
