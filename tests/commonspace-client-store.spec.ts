import type {
	CommonspaceBootstrap,
	SendMessageResponse,
} from "@commonspace/shared";
import {
	CommonspaceRoutingProvider,
	RoutingConfigurationIssue,
} from "@commonspace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommonspaceClientStore } from "../ui/src/commonspace-store.ts";
import { storyBootstrap } from "../ui/src/stories/story-fixtures.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: Error) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = (reason) => onReject(reason);
	});
	return { promise, resolve, reject };
}

function jsonResponse(
	value: CommonspaceBootstrap | SendMessageResponse,
): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function threadAdmission(): SendMessageResponse {
	const original = storyBootstrap.state.threads[0];
	if (original === undefined) throw new Error("Missing fixture thread");
	const thread = {
		...structuredClone(original),
		id: "thread-delayed-admission",
		rootMessageId: "message-delayed-admission",
	};
	const accepted: SendMessageResponse["accepted"] = {
		id: thread.rootMessageId,
		conversation: { kind: "channel", id: thread.channelId },
		authorType: "user",
		authorId: "user",
		authorName: "Ralph",
		text: "Delayed admission",
		createdAt: "2026-09-15T00:00:00.000Z",
		replyStatus: "queued",
	};
	const state = structuredClone(storyBootstrap.state);
	state.revision += 1;
	state.threads.push(thread);
	const key = `channel:${thread.channelId}`;
	state.messages[key] = [...(state.messages[key] ?? []), accepted];
	return { accepted, state, thread };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

it("refreshes changed routing without a workspace revision, including changes during refresh and reconnect", async () => {
	const events = new EventTarget();
	vi.stubGlobal(
		"EventSource",
		class {
			addEventListener = events.addEventListener.bind(events);
		},
	);
	const pending = deferred<Response>();
	const updated: CommonspaceBootstrap = {
		...storyBootstrap,
		routing: {
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "agent-codex",
		},
	};
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(jsonResponse(storyBootstrap))
		.mockReturnValueOnce(pending.promise)
		.mockImplementation(() => Promise.resolve(jsonResponse(updated)));
	vi.stubGlobal("fetch", fetch);
	const store = new CommonspaceClientStore();
	await store.refresh();
	store.connectEvents();
	const refreshing = store.refresh();
	events.dispatchEvent(new MessageEvent("routing-changed", { data: "{}" }));
	pending.resolve(jsonResponse(storyBootstrap));
	await refreshing;
	await vi.waitFor(() =>
		expect(store.getSnapshot().bootstrap?.routing).toEqual(updated.routing),
	);
	expect(fetch).toHaveBeenCalledTimes(3);
	events.dispatchEvent(new MessageEvent("routing-changed", { data: "{}" }));
	await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
	await store.refresh();
	events.dispatchEvent(new Event("open"));
	await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
});

it("does not resurrect a removed inference Agent when the same harness ID is re-added without live events", async () => {
	const removed = structuredClone(storyBootstrap);
	removed.state.revision += 1;
	removed.agents = removed.agents.filter(
		(agent) => agent.id !== "agent-hermes",
	);
	removed.state.agents = removed.state.agents.filter(
		(agent) => agent.id !== "agent-hermes",
	);
	removed.routing = {
		provider: CommonspaceRoutingProvider.Unconfigured,
		reason: RoutingConfigurationIssue.Missing,
		message: "Choose a workspace inference agent.",
	};
	const readded = structuredClone(removed);
	readded.state.revision += 1;
	const originalAgent = storyBootstrap.agents.find(
		(agent) => agent.id === "agent-hermes",
	);
	const originalDefinition = storyBootstrap.state.agents.find(
		(agent) => agent.id === "agent-hermes",
	);
	if (originalAgent === undefined || originalDefinition === undefined)
		throw new Error("Missing inference Agent fixture");
	readded.agents.push(structuredClone(originalAgent));
	readded.state.agents.push(structuredClone(originalDefinition));

	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(storyBootstrap))
			.mockResolvedValueOnce(jsonResponse(removed))
			.mockResolvedValueOnce(jsonResponse(readded)),
	);
	const store = new CommonspaceClientStore();
	await store.refresh();
	expect(store.getSnapshot().bootstrap?.routing).toMatchObject({
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: "agent-hermes",
	});

	await store.mutate({ action: "remove-agent", agentId: "agent-hermes" });
	expect(store.getSnapshot().bootstrap?.routing?.provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
	await store.mutate({
		action: "add-discovered-agent",
		agentId: "agent-hermes",
	});

	expect(
		store
			.getSnapshot()
			.bootstrap?.agents.some((agent) => agent.id === "agent-hermes"),
	).toBe(true);
	expect(store.getSnapshot().bootstrap?.routing?.provider).toBe(
		CommonspaceRoutingProvider.Unconfigured,
	);
});

describe("CommonspaceClientStore message admission", () => {
	it("keeps a later routing update when an older routing save response arrives", async () => {
		const pending = deferred<Response>();
		const events = new EventTarget();
		vi.stubGlobal(
			"EventSource",
			class {
				addEventListener = events.addEventListener.bind(events);
			},
		);
		const updated: CommonspaceBootstrap = {
			...storyBootstrap,
			routing: {
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "agent-codex",
			},
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(storyBootstrap))
				.mockReturnValueOnce(pending.promise)
				.mockImplementation(() => Promise.resolve(jsonResponse(updated))),
		);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.connectEvents();
		const saving = store.updateRoutingConfiguration({
			provider: CommonspaceRoutingProvider.Harness,
			harnessAgentId: "agent-hermes",
		});
		events.dispatchEvent(new MessageEvent("routing-changed", { data: "{}" }));
		await store.refresh();
		const observed: Array<CommonspaceBootstrap["routing"]> = [];
		const unsubscribe = store.subscribe(() =>
			observed.push(store.getSnapshot().bootstrap?.routing),
		);
		pending.resolve(
			Response.json({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "agent-hermes",
			}),
		);
		await saving;
		unsubscribe();
		expect(observed.length).toBeGreaterThan(0);
		for (const routing of observed) expect(routing).toEqual(updated.routing);
	});
	it("does not restore stale routing from a delayed workspace mutation", async () => {
		const pending = deferred<Response>();
		const oldBootstrap = {
			...storyBootstrap,
			state: {
				...storyBootstrap.state,
				revision: storyBootstrap.state.revision + 1,
			},
		};
		const updated: CommonspaceBootstrap = {
			...oldBootstrap,
			routing: {
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: "agent-codex",
			},
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(storyBootstrap))
				.mockReturnValueOnce(pending.promise)
				.mockResolvedValueOnce(jsonResponse(updated)),
		);
		const store = new CommonspaceClientStore();
		await store.refresh();
		const mutation = store.mutate({
			action: "set-defaults",
			maxAgentsPerTurn: 3,
		});
		await store.refresh();
		pending.resolve(jsonResponse(oldBootstrap));
		await mutation;
		expect(store.getSnapshot().bootstrap?.routing).toEqual(updated.routing);
	});
	it.each(["send", "edit"] as const)(
		"keeps a newer thread selection when a delayed %s finishes",
		async (operation) => {
			const admission = deferred<Response>();
			const response = threadAdmission();
			const original = storyBootstrap.state.threads[0];
			if (original === undefined) throw new Error("Missing fixture thread");
			vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
				String(input) === "/api/bootstrap"
					? Promise.resolve(jsonResponse(storyBootstrap))
					: admission.promise,
			);
			const store = new CommonspaceClientStore();
			await store.refresh();
			store.selectConversation(response.accepted.conversation);
			const pending =
				operation === "send"
					? store.send({ text: "Delayed admission" })
					: store.editMessage(original.rootMessageId, {
							text: "Delayed admission",
						});
			store.selectThread(original.id);
			admission.resolve(jsonResponse(response));
			await pending;
			expect(store.getSnapshot().activeThreadId).toBe(original.id);
			expect(store.messages().at(-1)?.id).toBe(response.accepted.id);
		},
	);

	it("does not reopen a thread after the user closes it during admission", async () => {
		const admission = deferred<Response>();
		const response = threadAdmission();
		const original = storyBootstrap.state.threads[0];
		if (original === undefined) throw new Error("Missing fixture thread");
		vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
			String(input) === "/api/bootstrap"
				? Promise.resolve(jsonResponse(storyBootstrap))
				: admission.promise,
		);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.selectConversation(response.accepted.conversation);
		store.selectThread(original.id);
		const pending = store.send({ text: "Delayed admission" });
		store.selectThread(null);
		admission.resolve(jsonResponse(response));
		await pending;
		expect(store.getSnapshot().activeThreadId).toBeNull();
	});

	it("still opens the admitted thread when navigation has not changed", async () => {
		const admission = deferred<Response>();
		const response = threadAdmission();
		vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
			String(input) === "/api/bootstrap"
				? Promise.resolve(jsonResponse(storyBootstrap))
				: admission.promise,
		);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.selectConversation(response.accepted.conversation);
		const pending = store.send({ text: "Delayed admission" });
		admission.resolve(jsonResponse(response));
		await pending;
		expect(store.getSnapshot().activeThreadId).toBe(response.thread?.id);
	});

	it("keeps the composer queue open and projects concurrent sends optimistically", async () => {
		const admissions = [deferred<Response>(), deferred<Response>()];
		const fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input) === "/api/bootstrap")
				return Promise.resolve(jsonResponse(storyBootstrap));
			return (
				admissions[fetch.mock.calls.length - 2]?.promise ?? Promise.reject()
			);
		});
		vi.stubGlobal("fetch", fetch);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.selectConversation({ kind: "dm", id: "agent-hermes" });

		const first = store
			.send({ text: "First follow-up" })
			.catch(() => undefined);
		const second = store
			.send({ text: "Second follow-up", delivery: "queue" })
			.catch(() => undefined);

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(store.getSnapshot().sending).toBe(true);
		expect(store.getSnapshot().pendingSubmissions).toMatchObject([
			{ text: "First follow-up", status: "admitting" },
			{ text: "Second follow-up", status: "admitting", delivery: "queue" },
		]);

		admissions[1]?.reject(new Error("second failed"));
		await vi.waitFor(() => {
			expect(store.getSnapshot().pendingSubmissions[1]).toMatchObject({
				text: "Second follow-up",
				status: "failed",
				error: "second failed",
			});
		});
		expect(store.getSnapshot().sending).toBe(true);

		admissions[0]?.reject(new Error("first failed"));
		await Promise.all([first, second]);
		expect(store.getSnapshot().sending).toBe(false);
		expect(store.getSnapshot().pendingSubmissions).toHaveLength(2);
	});

	it("removes only the settled optimistic admission", async () => {
		const admission = deferred<Response>();
		const fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input) === "/api/bootstrap")
				return Promise.resolve(jsonResponse(storyBootstrap));
			return admission.promise;
		});
		vi.stubGlobal("fetch", fetch);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.selectConversation({ kind: "dm", id: "agent-hermes" });
		const sending = store.send({ text: "Admit me" });
		const pending = store.getSnapshot().pendingSubmissions[0];
		if (pending === undefined) throw new Error("pending submission missing");
		const state: CommonspaceBootstrap["state"] = {
			...structuredClone(storyBootstrap.state),
			revision: storyBootstrap.state.revision + 1,
		};
		const accepted = {
			id: "accepted-admission",
			conversation: { kind: "dm" as const, id: "agent-hermes" },
			authorType: "user" as const,
			authorId: "user",
			authorName: "Ralph",
			text: "Admit me",
			createdAt: "2026-09-07T12:00:00.000Z",
			replyStatus: "queued" as const,
		};
		state.messages["dm:agent-hermes"] = [
			...(state.messages["dm:agent-hermes"] ?? []),
			accepted,
		];
		admission.resolve(jsonResponse({ accepted, state }));

		await sending;
		expect(store.getSnapshot().pendingSubmissions).toEqual([]);
		expect(store.messages().at(-1)).toMatchObject({ id: "accepted-admission" });
		expect(store.getSnapshot().sending).toBe(false);
		expect(pending.id).toMatch(/^submission-/u);
	});

	it("dismisses a failed admission without affecting other pending sends", async () => {
		const admissions = [deferred<Response>(), deferred<Response>()];
		const fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input) === "/api/bootstrap")
				return Promise.resolve(jsonResponse(storyBootstrap));
			return (
				admissions[fetch.mock.calls.length - 2]?.promise ?? Promise.reject()
			);
		});
		vi.stubGlobal("fetch", fetch);
		const store = new CommonspaceClientStore();
		await store.refresh();
		store.selectConversation({ kind: "dm", id: "agent-hermes" });
		const first = store.send({ text: "Restore this" }).catch(() => undefined);
		const second = store.send({ text: "Keep pending" }).catch(() => undefined);
		admissions[0]?.reject(new Error("offline"));
		await vi.waitFor(() => {
			expect(store.getSnapshot().pendingSubmissions[0]?.status).toBe("failed");
		});
		const failedId = store.getSnapshot().pendingSubmissions[0]?.id;
		if (failedId === undefined) throw new Error("failed submission missing");

		store.dismissPendingSubmission(failedId);
		expect(store.getSnapshot().pendingSubmissions).toMatchObject([
			{ text: "Keep pending", status: "admitting" },
		]);

		admissions[1]?.reject(new Error("cleanup"));
		await Promise.all([first, second]);
	});
});

it("reports an identical failure again after dismissing the current error", async () => {
	const store = new CommonspaceClientStore();
	vi.stubGlobal(
		"fetch",
		vi.fn().mockRejectedValue(new Error("Network unavailable")),
	);
	const mutation = {
		action: "create-channel",
		name: "Review",
		agentIds: [],
	} as const;
	await expect(store.mutate({ ...mutation, agentIds: [] })).rejects.toThrow(
		"Network unavailable",
	);
	store.dismissError();
	expect(store.getSnapshot().error).toBeNull();
	await expect(store.mutate({ ...mutation, agentIds: [] })).rejects.toThrow(
		"Network unavailable",
	);
	expect(store.getSnapshot().error).toBe("Network unavailable");
});
