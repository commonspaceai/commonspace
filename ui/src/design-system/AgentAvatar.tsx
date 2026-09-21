import type { CommonspaceAgentProfile } from "@commonspace/shared";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type AgentAvatarIdentity = Pick<
	CommonspaceAgentProfile,
	"displayName" | "avatarEmoji" | "accentColor" | "status"
>;

export type AgentAvatarSize =
	| "sm"
	| "md"
	| "lg"
	| "activity"
	| "stack"
	| "profile";

export interface AgentAvatarProps
	extends Omit<
		ComponentProps<"span">,
		"aria-hidden" | "aria-label" | "children" | "role" | "style"
	> {
	agent?: AgentAvatarIdentity | undefined;
	fallbackName?: string;
	size?: AgentAvatarSize;
	status?: CommonspaceAgentProfile["status"];
	showStatus?: boolean;
	statusClassName?: string;
	ariaLabel?: string;
	style?: CSSProperties;
}

const sizeClasses: Record<AgentAvatarSize, string> = {
	sm: "size-5 text-xs",
	md: "size-8 text-xs",
	lg: "size-10 text-xs",
	activity: "size-[34px] text-xs",
	stack: "size-5 text-[10px]",
	profile: "size-16 text-2xl",
};

export function agentAvatarText({
	displayName,
	avatarEmoji,
}: {
	displayName: string;
	avatarEmoji?: string | undefined;
}): string {
	const emoji = avatarEmoji?.trim();
	if (emoji !== undefined && emoji !== "") return emoji;
	return displayName.trim().slice(0, 1).toLocaleUpperCase() || "?";
}

export function agentAvatarStyle(
	accentColor: string | undefined,
): CSSProperties | undefined {
	return accentColor === undefined
		? undefined
		: {
				backgroundColor: accentColor,
			};
}

export function AgentAvatar({
	agent,
	fallbackName,
	size = "md",
	status,
	showStatus = false,
	statusClassName,
	ariaLabel,
	className,
	style,
	...props
}: AgentAvatarProps) {
	const displayName = agent?.displayName ?? fallbackName ?? "Agent";
	const resolvedStatus = status ?? agent?.status;
	const appearance = agentAvatarStyle(agent?.accentColor);
	const mergedStyle =
		appearance === undefined && style === undefined
			? undefined
			: { ...appearance, ...style };

	return (
		<span
			{...props}
			className={cn(
				"relative grid shrink-0 place-items-center rounded-md bg-muted font-sans font-medium text-foreground",
				sizeClasses[size],
				className,
			)}
			style={mergedStyle}
			role="img"
			aria-label={ariaLabel}
			aria-hidden={ariaLabel === undefined ? "true" : undefined}
		>
			{agentAvatarText({ displayName, avatarEmoji: agent?.avatarEmoji })}
			{showStatus && (
				<i
					className={cn(
						"absolute right-[-2px] bottom-[-2px] size-2 rounded-full border border-background bg-muted-foreground",
						resolvedStatus === "running" && "bg-[var(--status-success)]",
						statusClassName,
					)}
					aria-hidden="true"
				/>
			)}
		</span>
	);
}
