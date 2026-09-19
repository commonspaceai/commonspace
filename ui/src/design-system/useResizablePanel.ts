import { type RefObject, useEffect, useState } from "react";

export const COMMONSPACE_RESIZABLE_PANEL = {
	storageKey: "commonspace-panel-width",
	legacyStorageKeys: [
		"commonspace-thread-width",
		"commonspace-settings-width",
	] as const,
	defaultValue: 42,
	min: 25,
	max: 75,
	step: 5,
} as const;

interface UseResizablePanelOptions {
	storageKey: string;
	defaultValue: number;
	min: number;
	max: number;
	legacyStorageKeys?: readonly string[];
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function initialWidth({
	storageKey,
	defaultValue,
	min,
	max,
	legacyStorageKeys = [],
}: UseResizablePanelOptions): number {
	if (typeof window !== "undefined") {
		for (const key of [storageKey, ...legacyStorageKeys]) {
			try {
				const value = Number(window.localStorage.getItem(key));
				if (Number.isFinite(value) && value >= min && value <= max)
					return Math.round(value);
			} catch {
				// Try next key or use default when storage is unavailable.
			}
		}
	}
	return clamp(defaultValue, min, max);
}

export function useResizablePanel(
	container: RefObject<HTMLElement | null>,
	options: UseResizablePanelOptions,
) {
	const { storageKey, defaultValue, min, max } = options;
	const [width, setPanelWidth] = useState(() => initialWidth(options));
	const [resizing, setResizing] = useState(false);

	useEffect(() => {
		if (!resizing) return;
		const resize = (event: PointerEvent) => {
			const bounds = container.current?.getBoundingClientRect();
			if (bounds === undefined || bounds.width === 0) return;
			const nextWidth = ((bounds.right - event.clientX) / bounds.width) * 100;
			setPanelWidth(clamp(Math.round(nextWidth), min, max));
		};
		const stopResizing = () => {
			setResizing(false);
		};
		window.addEventListener("pointermove", resize);
		window.addEventListener("pointerup", stopResizing, { once: true });
		return () => {
			window.removeEventListener("pointermove", resize);
			window.removeEventListener("pointerup", stopResizing);
		};
	}, [container, max, min, resizing]);

	useEffect(() => {
		try {
			window.localStorage.setItem(storageKey, String(width));
		} catch {
			// Resizing remains available for this session.
		}
	}, [storageKey, width]);

	return {
		width,
		resizing,
		setWidth: (value: number) => {
			setPanelWidth(clamp(value, min, max));
		},
		startResizing: () => {
			setResizing(true);
		},
		resetWidth: () => {
			setPanelWidth(clamp(defaultValue, min, max));
		},
	};
}
