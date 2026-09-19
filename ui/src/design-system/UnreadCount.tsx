export function UnreadCount({ count }: { count: number }) {
	if (count <= 0) return null;
	return (
		<span
			aria-hidden="true"
			className="inline-flex h-[18px] min-w-[22px] shrink-0 items-center justify-center px-1.5 text-xs tabular-nums leading-none text-muted-foreground"
		>
			{count > 99 ? "99+" : count}
		</span>
	);
}
