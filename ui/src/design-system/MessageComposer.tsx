import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export function MessageComposerFrame({
	className,
	...props
}: ComponentPropsWithRef<"form">) {
	return (
		<form
			className={cn(
				"relative flex flex-col gap-2 rounded-[9px] border bg-background p-3 transition-[background-color,border-color,box-shadow] focus-within:border-primary/45 focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/15",
				className,
			)}
			{...props}
		/>
	);
}

export function MessageComposerInput({
	className,
	...props
}: ComponentPropsWithRef<"textarea">) {
	return (
		<textarea
			className={cn(
				"block min-h-[54px] max-h-40 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

/** Aligns attachment and send controls in channel and thread composers. */
export function MessageComposerActions({
	className,
	...props
}: ComponentPropsWithRef<"div">) {
	return (
		<div
			className={cn("flex min-h-7 flex-wrap items-center gap-2", className)}
			{...props}
		/>
	);
}
