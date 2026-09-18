export function UnreadCount({ count }: { count: number }) {
	if (count <= 0) return null;
	return (
		<span
			aria-hidden="true"
			className="inline-flex h-[18px] min-w-[22px] shrink-0 items-center justify-center rounded-sm bg-sidebar-foreground/10 px-1.5 text-[11px] font-medium tabular-nums leading-none text-sidebar-foreground"
		>
			{count > 99 ? "99+" : count}
		</span>
	);
}
