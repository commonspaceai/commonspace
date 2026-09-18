// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelSettingsPane } from "../ui/src/CommonspaceContextSettings.tsx";
import { CommonspaceConversation } from "../ui/src/CommonspaceConversation.tsx";
import {
	createStoryStore,
	storyBootstrap,
} from "../ui/src/stories/story-fixtures.ts";

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it("pins a Channel root to the Channel even while its Thread is open", async () => {
	const addPin = vi.fn(async () => undefined);
	render(
		<CommonspaceConversation
			store={createStoryStore(storyBootstrap, {
				activeConversation: { kind: "channel", id: "channel-design" },
				activeThreadId: "thread-review",
				addPin,
			})}
		/>,
	);
	const posts = screen.getByRole("region", { name: "design-review posts" });
	const button = posts.querySelector(
		'button[aria-label="Pin message from Ralph"]',
	);
	expect(button).not.toBeNull();
	if (button === null) throw new Error("Missing Channel pin action");
	fireEvent.click(button);
	await waitFor(() =>
		expect(addPin).toHaveBeenCalledWith({
			scope: { kind: "channel", id: "channel-design" },
			kind: "message",
			messageId: "message-root",
		}),
	);
});

it("shows pinned message content and keeps memory editing out of the default settings view", () => {
	const bootstrap = structuredClone(storyBootstrap);
	bootstrap.state.pins.push({
		id: "pin-root",
		scope: { kind: "channel", id: "channel-design" },
		kind: "message",
		messageId: "message-root",
		createdAt: "2026-09-18T00:00:00.000Z",
		removedAt: null,
	});
	render(
		<ChannelSettingsPane
			bootstrap={bootstrap}
			id="channel-design"
			store={createStoryStore(bootstrap)}
			onClose={vi.fn()}
		/>,
	);
	expect(
		screen.getByText(
			"Review the visual baseline and document the next component states.",
		),
	).toBeTruthy();
	expect(screen.queryByText("message-root")).toBeNull();
	const advanced = screen.getByLabelText("Advanced context");
	expect(advanced instanceof HTMLDetailsElement && advanced.open).toBe(false);
	expect(advanced.contains(screen.getByLabelText("Channel summary"))).toBe(
		true,
	);
	expect(advanced.contains(screen.getByLabelText("Channel instructions"))).toBe(
		true,
	);
});

it("unpins only the Channel copy when the same message is also pinned in a Thread", async () => {
	const bootstrap = structuredClone(storyBootstrap);
	bootstrap.state.pins.push(
		{
			id: "channel-pin",
			kind: "message",
			messageId: "message-root",
			scope: { kind: "channel", id: "channel-design" },
			createdAt: "2026-09-18T00:00:00.000Z",
			removedAt: null,
		},
		{
			id: "thread-pin",
			kind: "message",
			messageId: "message-root",
			scope: { kind: "thread", id: "thread-review" },
			createdAt: "2026-09-18T00:00:00.000Z",
			removedAt: null,
		},
	);
	const removePin = vi.fn(async () => undefined);
	render(
		<CommonspaceConversation
			store={createStoryStore(bootstrap, {
				activeConversation: { kind: "channel", id: "channel-design" },
				activeThreadId: "thread-review",
				removePin,
			})}
		/>,
	);
	const posts = screen.getByRole("region", { name: "design-review posts" });
	const button = posts.querySelector(
		'button[aria-label="Unpin message from Ralph"]',
	);
	if (button === null) throw new Error("Missing Channel unpin action");
	fireEvent.click(button);
	await waitFor(() =>
		expect(removePin).toHaveBeenCalledExactlyOnceWith("channel-pin"),
	);
});
