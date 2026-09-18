// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChannelSettingsPane } from "../ui/src/CommonspaceContextSettings.tsx";
import { CommonspaceConversation } from "../ui/src/CommonspaceConversation.tsx";
import {
	createStoryStore,
	storyBootstrap,
} from "../ui/src/stories/story-fixtures.ts";

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("shows a context brief without instruction configuration and saves membership without rewriting context", async () => {
	const mutate = vi.fn(async () => undefined);
	render(
		<ChannelSettingsPane
			bootstrap={storyBootstrap}
			id="channel-design"
			store={createStoryStore(storyBootstrap, { mutate })}
			onClose={vi.fn()}
		/>,
	);
	expect(screen.queryByLabelText("Channel instructions")).toBeNull();
	expect(screen.getByRole("region", { name: "Context brief" })).toBeTruthy();
	expect(screen.queryByLabelText("Channel summary")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(mutate).toHaveBeenCalledWith({
			action: "set-channel-agents",
			channelId: "channel-design",
			agentIds: ["agent-hermes", "agent-codex"],
		}),
	);
});

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
	const user = userEvent.setup();
	await user.click(
		within(posts).getByRole("button", {
			name: "More actions for message from Ralph",
		}),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Pin message", exact: true }),
	);
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
	expect(screen.getByRole("region", { name: "Context brief" })).toBeTruthy();
	expect(screen.queryByLabelText("Channel summary")).toBeNull();
	expect(screen.queryByLabelText("Channel instructions")).toBeNull();
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
	const user = userEvent.setup();
	await user.click(
		within(posts).getByRole("button", {
			name: "More actions for message from Ralph",
		}),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Unpin message", exact: true }),
	);
	await waitFor(() =>
		expect(removePin).toHaveBeenCalledExactlyOnceWith("channel-pin"),
	);
});
