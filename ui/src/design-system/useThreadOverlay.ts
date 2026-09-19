import { type RefObject, useEffect, useState } from "react";

/** Measure the conversation's available space, independent of window/sidebar width. */
export function useThreadOverlay(
	container: RefObject<HTMLElement | null>,
	enabled: boolean,
) {
	const [compact, setCompact] = useState(false);
	useEffect(() => {
		const element = container.current;
		if (!enabled || element === null) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry !== undefined) setCompact(entry.contentRect.width < 960);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [container, enabled]);
	return enabled && compact;
}
