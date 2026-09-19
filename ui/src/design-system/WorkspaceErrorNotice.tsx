import { CircleAlertIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkspaceErrorNotice({
	error,
	loading,
	onRefresh,
	onDismiss,
}: {
	error: string;
	loading: boolean;
	onRefresh: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			className="flex max-h-40 shrink-0 items-center gap-3 overflow-y-auto border-t bg-popover px-4 py-3 text-sm text-popover-foreground"
			role="alert"
		>
			<CircleAlertIcon
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-destructive"
			/>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
				<p className="min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">
					{error}
				</p>
				<Button
					variant="outline"
					size="sm"
					className="shrink-0"
					disabled={loading}
					onClick={onRefresh}
				>
					<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
					Refresh workspace
				</Button>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Dismiss workspace error"
				onClick={onDismiss}
			>
				<XIcon aria-hidden="true" />
			</Button>
		</div>
	);
}
