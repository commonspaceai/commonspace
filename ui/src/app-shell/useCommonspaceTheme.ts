import { useEffect, useState } from "react";
import type { CommonspaceColorMode } from "../theme.ts";

function initialColorMode(): CommonspaceColorMode {
	if (typeof window !== "undefined") {
		try {
			const saved = window.localStorage.getItem("commonspace-color-mode");
			if (saved === "light" || saved === "dark" || saved === "system")
				return saved;
		} catch {
			// Use light mode when local storage is unavailable.
		}
	}
	return "light";
}

export function useCommonspaceTheme() {
	const [colorMode, setColorMode] =
		useState<CommonspaceColorMode>(initialColorMode);

	useEffect(() => {
		const root = document.documentElement;
		const media =
			typeof window.matchMedia === "function"
				? window.matchMedia("(prefers-color-scheme: dark)")
				: null;
		const applyMode = () => {
			const dark =
				colorMode === "dark" ||
				(colorMode === "system" && media?.matches === true);
			root.classList.toggle("dark", dark);
			root.classList.toggle("light", !dark);
			root.classList.toggle("system", colorMode === "system");
			root.style.colorScheme = dark ? "dark" : "light";
		};
		applyMode();
		if (colorMode === "system" && media !== null)
			media.addEventListener("change", applyMode);
		try {
			window.localStorage.setItem("commonspace-color-mode", colorMode);
		} catch {
			// The theme still applies for this session when storage is unavailable.
		}
		return () => {
			if (colorMode === "system" && media !== null)
				media.removeEventListener("change", applyMode);
		};
	}, [colorMode]);

	return { colorMode, setColorMode };
}
