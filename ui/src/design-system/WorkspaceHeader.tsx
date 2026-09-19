import type { ReactNode } from "react";

export interface WorkspaceHeaderProps {
	title: string;
	subtitle?: string;
	mark: ReactNode;
	actions?: ReactNode;
	landmark?: boolean;
}

export function WorkspaceHeader({
	title,
	subtitle,
	mark,
	actions,
	landmark = true,
}: WorkspaceHeaderProps) {
	const Header = landmark ? "header" : "div";
	return (
		<Header className="flex min-h-[76px] items-center gap-2 border-b bg-background py-3 px-[30px] max-[780px]:pl-[60px]">
			<span
				className="grid size-5 shrink-0 place-items-center rounded-sm border-0 bg-transparent font-mono text-sm font-semibold text-muted-foreground"
				aria-hidden="true"
			>
				{mark}
			</span>
			<div className="min-w-0 flex-1">
				<h1 className="truncate font-heading text-lg font-semibold leading-tight tracking-[-0.01em]">
					{title}
				</h1>
				{subtitle === undefined ? null : (
					<p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
						{subtitle}
					</p>
				)}
			</div>
			{actions}
		</Header>
	);
}
