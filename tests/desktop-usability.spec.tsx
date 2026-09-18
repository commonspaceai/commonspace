// @vitest-environment jsdom

import type { CommonspaceQueuedFollowup } from "@commonspace/shared";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCommonspaceTheme } from "../ui/src/app-shell/useCommonspaceTheme.ts";
import {
	AgentSettingsPane,
	ChannelSettingsPane,
} from "../ui/src/CommonspaceContextSettings.tsx";
import { QueuedFollowups } from "../ui/src/design-system/RunDelivery.tsx";
import {
	createStoryStore,
	populatedCapabilityInventory,
	runtimeStoryBootstrap,
	storyBootstrap,
} from "../ui/src/stories/story-fixtures.ts";

function fieldValue(label: string): string {
	const field = screen.getByLabelText(label);
	if (
		!(field instanceof HTMLInputElement) &&
		!(field instanceof HTMLTextAreaElement)
	)
		throw new Error(`Expected an editable field: ${label}`);
	return field.value;
}

function pendingOperation() {
	let resolve: (() => void) | undefined;
	let reject: ((error: Error) => void) | undefined;
	const promise = new Promise<void>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	if (resolve === undefined || reject === undefined)
		throw new Error("Pending operation was not initialized");
	return { promise, resolve, reject };
}

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

it("preserves an open context correction across live updates", () => {
	const bootstrap = structuredClone(storyBootstrap);
	const channel = bootstrap.state.channels[0];
	if (channel === undefined) throw new Error("Missing fixture channel");
	const props = {
		bootstrap,
		id: channel.id,
		store: createStoryStore(bootstrap),
		onClose: vi.fn(),
	};
	const { rerender } = render(<ChannelSettingsPane {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Edit context" }));
	fireEvent.change(screen.getByLabelText("Channel summary"), {
		target: { value: "Keep my correction" },
	});
	const refreshed = structuredClone(bootstrap);
	const updated = refreshed.state.channels[0];
	if (updated === undefined) throw new Error("Missing refreshed channel");
	updated.memory.summary = "Fresh shared context";
	rerender(<ChannelSettingsPane {...props} bootstrap={refreshed} />);
	expect(fieldValue("Channel summary")).toBe("Keep my correction");
	fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
	fireEvent.click(screen.getByRole("button", { name: "Edit context" }));
	expect(fieldValue("Channel summary")).toBe("Fresh shared context");
});

it("discards a correction draft when the selected Channel changes", () => {
	const bootstrap = structuredClone(storyBootstrap);
	const channel = bootstrap.state.channels[0];
	if (channel === undefined) throw new Error("Missing fixture channel");
	const other = {
		...structuredClone(channel),
		id: "channel-other-settings",
		name: "other-settings",
	};
	bootstrap.state.channels.push(other);
	const props = {
		bootstrap,
		id: channel.id,
		store: createStoryStore(bootstrap),
		onClose: vi.fn(),
	};
	const { rerender } = render(<ChannelSettingsPane {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Edit context" }));
	fireEvent.change(screen.getByLabelText("Channel summary"), {
		target: { value: "First Channel draft" },
	});
	rerender(<ChannelSettingsPane {...props} id={other.id} />);
	expect(screen.queryByLabelText("Channel summary")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Edit context" }));
	expect(fieldValue("Channel summary")).not.toBe("First Channel draft");
});

it("preserves Agent profile edits across native discovery and live refresh", async () => {
	const bootstrap = structuredClone(storyBootstrap);
	const agent = bootstrap.agents.find(
		(candidate) => candidate.id === "agent-hermes",
	);
	if (agent === undefined) throw new Error("Missing fixture agent");
	agent.fullAccess = false;
	const store = createStoryStore(bootstrap, {
		discoverAgents: async () => undefined,
		inspectAgentCapabilities: async () => populatedCapabilityInventory,
	});
	const props = { bootstrap, id: agent.id, store, onClose: vi.fn() };
	const rendered = render(<AgentSettingsPane {...props} />);
	await act(async () => undefined);
	fireEvent.change(screen.getByLabelText("Workspace name"), {
		target: { value: "My unsaved agent name" },
	});
	const refreshed = structuredClone(bootstrap);
	const updated = refreshed.agents.find(
		(candidate) => candidate.id === agent.id,
	);
	if (updated === undefined) throw new Error("Missing refreshed agent");
	updated.displayName = "Server name";
	updated.fullAccess = true;
	rendered.rerender(<AgentSettingsPane {...props} bootstrap={refreshed} />);
	expect(fieldValue("Workspace name")).toBe("My unsaved agent name");
	const access = screen.getByRole("checkbox", { name: /Full access/ });
	expect(access instanceof HTMLInputElement && access.checked).toBe(true);
});

it("retains a rejected pin draft and clears it only after a successful retry", async () => {
	const first = pendingOperation();
	const retry = pendingOperation();
	const addPin = vi
		.fn()
		.mockImplementationOnce(() => first.promise)
		.mockImplementationOnce(() => retry.promise);
	const channel = storyBootstrap.state.channels[0];
	if (channel === undefined) throw new Error("Missing fixture channel");
	render(
		<ChannelSettingsPane
			bootstrap={storyBootstrap}
			id={channel.id}
			store={createStoryStore(storyBootstrap, { addPin })}
			onClose={vi.fn()}
		/>,
	);
	fireEvent.change(screen.getByLabelText("New channel pin note"), {
		target: { value: "Keep this note until it is saved" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Pin", exact: true }));
	expect(addPin).toHaveBeenCalledTimes(1);
	expect(fieldValue("New channel pin note")).toBe(
		"Keep this note until it is saved",
	);
	await act(async () => first.reject(new Error("Pin save failed")));
	expect(fieldValue("New channel pin note")).toBe(
		"Keep this note until it is saved",
	);
	expect(screen.getByRole("alert").textContent).toBe("Pin save failed");
	fireEvent.click(screen.getByRole("button", { name: "Pin", exact: true }));
	expect(addPin).toHaveBeenCalledTimes(2);
	await act(async () => retry.resolve());
	expect(fieldValue("New channel pin note")).toBe("");
	expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps a newer pin draft when an earlier note finishes saving", async () => {
	const pending = pendingOperation();
	const addPin = vi.fn(() => pending.promise);
	const channel = storyBootstrap.state.channels[0];
	if (channel === undefined) throw new Error("Missing fixture channel");
	render(
		<ChannelSettingsPane
			bootstrap={storyBootstrap}
			id={channel.id}
			store={createStoryStore(storyBootstrap, { addPin })}
			onClose={vi.fn()}
		/>,
	);
	fireEvent.change(screen.getByLabelText("New channel pin note"), {
		target: { value: "First note" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Pin", exact: true }));
	expect(addPin).toHaveBeenCalledTimes(1);
	fireEvent.change(screen.getByLabelText("New channel pin note"), {
		target: { value: "Next note stays editable" },
	});
	await act(async () => pending.resolve());
	expect(fieldValue("New channel pin note")).toBe("Next note stays editable");
});

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
