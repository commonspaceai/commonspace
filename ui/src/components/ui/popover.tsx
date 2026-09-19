import { Popover as Primitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverTitle = Primitive.Title;
export const PopoverClose = Primitive.Close;

export function PopoverContent({ className, ...props }: Primitive.Popup.Props) {
	return (
		<Primitive.Portal>
			<Primitive.Positioner
				align="start"
				sideOffset={6}
				collisionPadding={12}
				className="z-50"
			>
				<Primitive.Popup
					className={cn(
						"max-h-[var(--available-height)] w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover p-4 text-sm leading-5 text-popover-foreground shadow-[var(--shadow-high)] outline-none [overflow-wrap:anywhere]",
						className,
					)}
					{...props}
				/>
			</Primitive.Positioner>
		</Primitive.Portal>
	);
}
