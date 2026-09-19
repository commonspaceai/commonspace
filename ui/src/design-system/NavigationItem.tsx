import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

/** Navigation owns selection. Hover and focus must not look like another selection. */
export function NavigationItem({
	className,
	...props
}: ComponentPropsWithRef<"button">) {
	return (
		<button
			type="button"
			className={cn(
				"relative grid min-h-9 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-sidebar-foreground/80 hover:text-sidebar-foreground aria-pressed:bg-selection aria-pressed:text-sidebar-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				className,
			)}
			{...props}
		/>
	);
}

export function NavigationItemGroup({
	className,
	...props
}: ComponentPropsWithRef<"div">) {
	return (
		<div
			className={cn(
				"group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-md has-[>button[aria-pressed=true]]:bg-selection",
				className,
			)}
			{...props}
		/>
	);
}
