// @vitest-environment jsdom

import type { CommonspaceQueuedFollowup } from "@commonspace/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCommonspaceTheme } from "../ui/src/app-shell/useCommonspaceTheme.ts";
import { QueuedFollowups } from "../ui/src/design-system/RunDelivery.tsx";
import { runtimeStoryBootstrap } from "../ui/src/stories/story-fixtures.ts";

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	document.documentElement.removeAttribute("style");
	document.documentElement.className = "";
});

function Theme() {
	useCommonspaceTheme();
	return null;
}

function Queue() {
	const [followups, setFollowups] = useState(
		runtimeStoryBootstrap.queuedFollowups ?? [],
	);
	const composer = useRef<HTMLTextAreaElement>(null);
	return (
		<>
			<QueuedFollowups
				followups={followups}
				onMove={vi.fn()}
				onFocusComposer={() => composer.current?.focus()}
				onRemove={(id) =>
					setFollowups((items) => items.filter((item) => item.messageId !== id))
				}
			/>
			<textarea ref={composer} aria-label="Follow-up" />
		</>
	);
}

function DelayedQueue({
	followups,
}: {
	followups: CommonspaceQueuedFollowup[];
}) {
	return (
		<>
			<QueuedFollowups
				followups={followups}
				onMove={vi.fn()}
				onRemove={vi.fn()}
			/>
			<textarea aria-label="Another draft" />
		</>
	);
}

it("applies the resolved theme to native browser controls", () => {
	window.localStorage.setItem("commonspace-color-mode", "dark");
	render(<Theme />);
	expect(document.documentElement.style.colorScheme).toBe("dark");
});

it("keeps keyboard focus on a neighboring follow-up after removal", () => {
	render(<Queue />);
	const remove = screen.getAllByRole("button", {
		name: "Remove queued follow-up",
	})[0];
	if (remove === undefined) throw new Error("Missing follow-up");
	remove.focus();
	act(() => remove.click());
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "Expand queued follow-up 1" }),
	);
	const last = screen.getByRole("button", { name: "Remove queued follow-up" });
	last.focus();
	act(() => last.click());
	expect(document.activeElement).toBe(
		screen.getByRole("textbox", { name: "Follow-up" }),
	);
});

it("does not steal focus when a queued removal completes after the user moves elsewhere", () => {
	const followups = runtimeStoryBootstrap.queuedFollowups ?? [];
	const { rerender } = render(<DelayedQueue followups={followups} />);
	const remove = screen.getAllByRole("button", {
		name: "Remove queued follow-up",
	})[0];
	if (remove === undefined) throw new Error("Missing follow-up");
	remove.focus();
	act(() => remove.click());
	const draft = screen.getByRole("textbox", { name: "Another draft" });
	draft.focus();
	rerender(<DelayedQueue followups={followups.slice(1)} />);
	expect(document.activeElement).toBe(draft);
});
