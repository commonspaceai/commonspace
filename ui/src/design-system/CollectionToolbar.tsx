import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

/** Shared collection width, alignment, and wrapping for filters and view controls. */
export function CollectionToolbar({
	className,
	...props
}: ComponentPropsWithRef<"div">) {
	return (
		<div
			data-slot="collection-toolbar"
			className={cn(
				"flex min-h-12 w-full flex-wrap items-center justify-between gap-2 border-b px-8 py-2 max-[780px]:px-3",
				className,
			)}
			{...props}
		/>
	);
}
