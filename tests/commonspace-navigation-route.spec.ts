// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	commonspaceLegacyMessageTargetFromMatches,
	commonspaceMessageHref,
	commonspaceRouteFromMatches,
	commonspaceRouteHref,
	createCommonspaceRouter,
	createMemoryHistory,
} from "../ui/src/app-shell/commonspace-router.tsx";

async function resolveRoute(path: string) {
	const router = createCommonspaceRouter({
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	await router.load();
	return commonspaceRouteFromMatches(router.state.matches);
}

describe("Commonspace TanStack routes", () => {
	it.each([
		["/", { kind: "inbox", view: "attention" }],
		["/inbox", { kind: "inbox", view: "attention" }],
		["/inbox/sessions", { kind: "inbox", view: "sessions" }],
		["/threads", { kind: "threads" }],
		["/projects", { kind: "directory", directory: "projects" }],
		["/projects/", { kind: "directory", directory: "projects" }],
		["/channels", { kind: "directory", directory: "channels" }],
		["/agents", { kind: "directory", directory: "agents" }],
		["/projects/project%20one", { kind: "project", projectId: "project one" }],
		[
			"/projects/project%20one/files/2/src%2Findex.ts",
			{
				kind: "project",
				projectId: "project one",
				file: { rootIndex: 2, path: "src/index.ts" },
			},
		],
		[
			"/channels/channel%20one",
			{
				kind: "conversation",
				conversation: { kind: "channel", id: "channel one" },
			},
		],
		[
			"/channels/channel%20one/threads/thread%20one?message=message%20one",
			{
				kind: "conversation",
				conversation: { kind: "channel", id: "channel one" },
				threadId: "thread one",
				messageId: "message one",
			},
		],
		[
			"/agents/agent%20one?message=message%20one",
			{
				kind: "conversation",
				conversation: { kind: "dm", id: "agent one" },
				messageId: "message one",
			},
		],
	] as const)("matches %s", async (path, route) => {
		await expect(resolveRoute(path)).resolves.toEqual(route);
	});

	it("navigates canonical message links and clears focus at the next destination", async () => {
		const router = createCommonspaceRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		await router.load();

		const route = {
			kind: "conversation",
			conversation: { kind: "channel", id: "channel one" },
			threadId: "thread one",
			messageId: "message one",
		} as const;
		await router.navigate({ href: commonspaceRouteHref(router, route) });

		expect(router.state.location.href).toBe(
			"/channels/channel%20one/threads/thread%20one?message=message+one",
		);
		expect(commonspaceRouteFromMatches(router.state.matches)).toEqual(route);

		const destination = { kind: "inbox", view: "attention" } as const;
		await router.navigate({
			href: commonspaceRouteHref(router, destination),
		});
		expect(router.state.location.href).toBe("/");
		expect(commonspaceRouteFromMatches(router.state.matches)).toEqual(
			destination,
		);
	});

	it("builds a canonical destination for a trailing-slash directory", async () => {
		const router = createCommonspaceRouter({
			history: createMemoryHistory({ initialEntries: ["/projects/"] }),
		});
		await router.load();
		const route = { kind: "directory", directory: "projects" } as const;
		expect(commonspaceRouteFromMatches(router.state.matches)).toEqual(route);
		const href = commonspaceRouteHref(router, route);
		expect(href).toBe("/projects");
	});

	it("builds canonical message links through the router", async () => {
		const router = createCommonspaceRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		await router.load();

		expect(
			commonspaceMessageHref(router, {
				conversation: { kind: "channel", id: "channel one" },
				threadId: "thread one",
				messageId: "message one",
			}),
		).toBe("/channels/channel%20one/threads/thread%20one?message=message+one");
	});

	it.each([
		"/unknown",
		"/projects/project/files/-1/file.ts",
		"/projects/project/files/not-a-root/file.ts",
		"/channels/channel/threads/",
		"/agents/agent/extra",
	])("does not produce an application route for %s", async (path) => {
		await expect(resolveRoute(path)).resolves.toBeNull();
	});
});

describe("Commonspace route search normalization", () => {
	it.each([
		"message=",
		"message=one&message=two",
		"message=123",
		"message=true",
		`message=${"x".repeat(201)}`,
	])("sanitizes malformed message search parameters: %s", async (search) => {
		await expect(resolveRoute(`/channels/channel?${search}`)).resolves.toEqual({
			kind: "conversation",
			conversation: { kind: "channel", id: "channel" },
		});
	});

	it("reads legacy notification links through typed search validation", async () => {
		const router = createCommonspaceRouter({
			history: createMemoryHistory({
				initialEntries: [
					"/?conversation=channel&conversationId=general&threadId=thread-1&messageId=message-1",
				],
			}),
		});
		await router.load();
		expect(
			commonspaceLegacyMessageTargetFromMatches(router.state.matches),
		).toEqual({
			conversation: { kind: "channel", id: "general" },
			threadId: "thread-1",
			messageId: "message-1",
		});
	});

	it.each([
		"conversationId=&messageId=message-1",
		"conversationId=one&conversationId=two&messageId=message-1",
		"conversationId=general&messageId=",
		"conversationId=general&messageId=one&messageId=two",
		`conversationId=general&messageId=${"x".repeat(201)}`,
	])("rejects malformed legacy notification targets: %s", async (search) => {
		const router = createCommonspaceRouter({
			history: createMemoryHistory({
				initialEntries: [`/?conversation=channel&${search}`],
			}),
		});
		await router.load();
		expect(
			commonspaceLegacyMessageTargetFromMatches(router.state.matches),
		).toBeNull();
	});

	it.each(["threadId=", "threadId=one&threadId=two"])(
		"omits malformed legacy thread focus: %s",
		async (search) => {
			const router = createCommonspaceRouter({
				history: createMemoryHistory({
					initialEntries: [
						`/?conversation=channel&conversationId=general&messageId=message-1&${search}`,
					],
				}),
			});
			await router.load();
			expect(
				commonspaceLegacyMessageTargetFromMatches(router.state.matches),
			).toEqual({
				conversation: { kind: "channel", id: "general" },
				messageId: "message-1",
			});
		},
	);
});
