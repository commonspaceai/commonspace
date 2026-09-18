// @vitest-environment jsdom
import type { CommonspaceRetentionPreview } from "@commonspace/shared";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationRetention } from "../ui/src/ConversationRetention";
import { buildChannel, designChannel } from "../ui/src/stories/story-fixtures";

afterEach(cleanup);

const impact: CommonspaceRetentionPreview = {
	revision: 42,
	conversation: { kind: "channel", id: buildChannel.id },
	messages: 17,
	threads: 5,
	attachments: 3,
	pins: 2,
	permissions: 1,
};

it("requires a fresh preview after selection changes or a failed deletion and applies only the reviewed revision", async () => {
	const store = {
		previewRetention: vi.fn().mockResolvedValue(impact),
		applyRetention: vi
			.fn()
			.mockRejectedValueOnce(new Error("retention preview is stale"))
			.mockResolvedValue(undefined),
	};
	render(
		<ConversationRetention
			store={store}
			channels={[buildChannel, designChannel]}
			agents={[]}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Choose conversation…" }));
	const picker = await screen.findByRole("combobox", { name: "Conversation" });
	fireEvent.change(picker, { target: { value: `channel:${buildChannel.id}` } });
	fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
	await screen.findByRole("region", { name: "Deletion preview" });
	expect(store.applyRetention).not.toHaveBeenCalled();
	fireEvent.change(picker, {
		target: { value: `channel:${designChannel.id}` },
	});
	expect(
		screen.queryByRole("button", { name: "Delete history permanently" }),
	).toBeNull();
	fireEvent.change(picker, { target: { value: `channel:${buildChannel.id}` } });
	fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Delete history permanently" }),
	);
	expect((await screen.findByRole("alert")).textContent).toContain("stale");
	expect(
		screen.queryByRole("button", { name: "Delete history permanently" }),
	).toBeNull();
	expect(store.applyRetention).toHaveBeenCalledWith(impact);
	fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
	fireEvent.click(
		await screen.findByRole("button", { name: "Delete history permanently" }),
	);
	expect((await screen.findByRole("status")).textContent).toBe(
		"Conversation history deleted.",
	);
	expect(store.applyRetention).toHaveBeenCalledTimes(2);
});

it("locks the selected conversation while its preview is pending and discards state on close", async () => {
	const pending = Promise.withResolvers<CommonspaceRetentionPreview>();
	const store = {
		previewRetention: vi.fn().mockReturnValue(pending.promise),
		applyRetention: vi.fn(),
	};
	render(
		<ConversationRetention
			store={store}
			channels={[buildChannel]}
			agents={[]}
		/>,
	);
	const trigger = screen.getByRole("button", { name: "Choose conversation…" });
	fireEvent.click(trigger);
	const picker = await screen.findByRole("combobox", { name: "Conversation" });
	fireEvent.change(picker, { target: { value: `channel:${buildChannel.id}` } });
	fireEvent.click(screen.getByRole("button", { name: "Review deletion" }));
	expect(picker.hasAttribute("disabled")).toBe(true);
	expect(
		screen.getByRole("button", { name: "Reviewing…" }).hasAttribute("disabled"),
	).toBe(true);
	await act(async () => {
		pending.resolve(impact);
	});
	fireEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	fireEvent.click(trigger);
	expect(
		(
			await screen.findByRole("combobox", { name: "Conversation" })
		).getAttribute("disabled"),
	).toBeNull();
	expect(screen.queryByRole("region", { name: "Deletion preview" })).toBeNull();
	expect(store.applyRetention).not.toHaveBeenCalled();
});
