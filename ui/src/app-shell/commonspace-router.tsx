import type { ConversationRef } from "@commonspace/shared";
import {
	createBrowserHistory,
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	type Router,
	type RouterHistory,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

const MAX_ID_LENGTH = 200;
const MAX_FILE_PATH_LENGTH = 4_096;

export type CommonspaceRoute =
	| { kind: "inbox"; view: "attention" | "sessions" }
	| { kind: "threads" }
	| { kind: "scheduled" }
	| { kind: "directory"; directory: "projects" | "channels" | "agents" }
	| {
			kind: "project";
			projectId: string;
			file?: { rootIndex: number; path: string };
	  }
	| {
			kind: "conversation";
			conversation: ConversationRef;
			threadId?: string;
			messageId?: string;
	  };

export interface CommonspaceMessageTarget {
	conversation: ConversationRef;
	messageId: string;
	threadId?: string;
}

interface CommonspaceRouterContext {
	app: ReactNode;
}

interface CommonspaceRawSearch {
	message?: string | string[];
	conversation?: string | string[];
	conversationId?: string | string[];
	threadId?: string | string[];
	messageId?: string | string[];
}

interface CommonspaceSearch {
	message?: string | undefined;
	conversation?: "channel" | "dm" | undefined;
	conversationId?: string | undefined;
	threadId?: string | undefined;
	messageId?: string | undefined;
}

function boundedSearchValue(value: string | string[] | undefined) {
	return typeof value === "string" &&
		value !== "" &&
		value.length <= MAX_ID_LENGTH
		? value
		: undefined;
}

function validateSearch(search: CommonspaceRawSearch): CommonspaceSearch {
	// Clear invalid keys explicitly: TanStack merges validation into raw search.
	return {
		message: boundedSearchValue(search.message),
		conversation:
			search.conversation === "channel" || search.conversation === "dm"
				? search.conversation
				: undefined,
		conversationId: boundedSearchValue(search.conversationId),
		threadId: boundedSearchValue(search.threadId),
		messageId: boundedSearchValue(search.messageId),
	};
}

function CommonspaceRouterRoot() {
	return rootRoute.useRouteContext().app;
}

const rootRoute = createRootRouteWithContext<CommonspaceRouterContext>()({
	component: CommonspaceRouterRoot,
	validateSearch,
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const inboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/inbox",
});
const inboxSessionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/inbox/sessions",
});
const threadsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/threads",
});
const scheduledRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/scheduled",
});
const projectsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects",
});
const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects/$projectId",
});
const projectFileRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects/$projectId/files/$rootIndex/$filePath",
});
const channelsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/channels",
});
const channelRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/channels/$channelId",
});
const channelThreadRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/channels/$channelId/threads/$threadId",
});
const agentsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents",
});
const agentRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents/$agentId",
});
const unmatchedRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/$",
});

const commonspaceRouteTree = rootRoute.addChildren([
	indexRoute,
	inboxRoute,
	inboxSessionsRoute,
	threadsRoute,
	scheduledRoute,
	projectsRoute,
	projectRoute,
	projectFileRoute,
	channelsRoute,
	channelRoute,
	channelThreadRoute,
	agentsRoute,
	agentRoute,
	unmatchedRoute,
]);

export type CommonspaceRouter = Router<typeof commonspaceRouteTree>;

export function createCommonspaceRouter({
	history = createBrowserHistory(),
}: {
	history?: RouterHistory;
} = {}): CommonspaceRouter {
	return createRouter({
		routeTree: commonspaceRouteTree,
		history,
		context: { app: null },
		defaultNotFoundComponent: () => null,
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: CommonspaceRouter;
	}
}

export type CommonspaceRouteMatch =
	CommonspaceRouter["state"]["matches"][number];

function validParameter(value: string | undefined, maximum = MAX_ID_LENGTH) {
	return value !== undefined && value !== "" && value.length <= maximum
		? value
		: null;
}

function projectMatchRoute(params: {
	projectId: string;
}): CommonspaceRoute | null {
	const projectId = validParameter(params.projectId);
	return projectId === null ? null : { kind: "project", projectId };
}

function projectFileMatchRoute(params: {
	projectId: string;
	rootIndex: string;
	filePath: string;
}): CommonspaceRoute | null {
	const projectId = validParameter(params.projectId);
	const path = validParameter(params.filePath, MAX_FILE_PATH_LENGTH);
	const rootIndex = Number(params.rootIndex);
	if (
		projectId === null ||
		path === null ||
		!Number.isSafeInteger(rootIndex) ||
		rootIndex < 0
	)
		return null;
	return { kind: "project", projectId, file: { rootIndex, path } };
}

function conversationMatchRoute(
	conversation: ConversationRef,
	messageId?: string,
	threadId?: string,
): CommonspaceRoute {
	const route: Extract<CommonspaceRoute, { kind: "conversation" }> = {
		kind: "conversation",
		conversation,
	};
	if (messageId !== undefined) route.messageId = messageId;
	if (threadId !== undefined) route.threadId = threadId;
	return route;
}

function channelMatchRoute(
	params: { channelId: string },
	messageId?: string,
): CommonspaceRoute | null {
	const channelId = validParameter(params.channelId);
	return channelId === null
		? null
		: conversationMatchRoute({ kind: "channel", id: channelId }, messageId);
}

function channelThreadMatchRoute(
	params: { channelId: string; threadId: string },
	messageId?: string,
): CommonspaceRoute | null {
	const channelId = validParameter(params.channelId);
	const threadId = validParameter(params.threadId);
	return channelId === null || threadId === null
		? null
		: conversationMatchRoute(
				{ kind: "channel", id: channelId },
				messageId,
				threadId,
			);
}

function agentMatchRoute(
	params: { agentId: string },
	messageId?: string,
): CommonspaceRoute | null {
	const agentId = validParameter(params.agentId);
	return agentId === null
		? null
		: conversationMatchRoute({ kind: "dm", id: agentId }, messageId);
}

export function commonspaceRouteFromMatches(
	matches: readonly CommonspaceRouteMatch[],
): CommonspaceRoute | null {
	const match = matches.at(-1);
	if (match === undefined) return null;
	const { message: messageId } = match.search;
	switch (match.routeId) {
		case "/":
		case "/inbox":
			return { kind: "inbox", view: "attention" };
		case "/inbox/sessions":
			return { kind: "inbox", view: "sessions" };
		case "/threads":
			return { kind: "threads" };
		case "/scheduled":
			return { kind: "scheduled" };
		case "/projects":
			return { kind: "directory", directory: "projects" };
		case "/channels":
			return { kind: "directory", directory: "channels" };
		case "/agents":
			return { kind: "directory", directory: "agents" };
		case "/projects/$projectId":
			return projectMatchRoute(match.params);
		case "/projects/$projectId/files/$rootIndex/$filePath":
			return projectFileMatchRoute(match.params);
		case "/channels/$channelId":
			return channelMatchRoute(match.params, messageId);
		case "/channels/$channelId/threads/$threadId":
			return channelThreadMatchRoute(match.params, messageId);
		case "/agents/$agentId":
			return agentMatchRoute(match.params, messageId);
		default:
			return null;
	}
}

export function commonspaceLegacyMessageTargetFromMatches(
	matches: readonly CommonspaceRouteMatch[],
): CommonspaceMessageTarget | null {
	const match = matches.at(-1);
	if (match?.routeId !== "/") return null;
	const { conversation, conversationId, messageId, threadId } = match.search;
	if (
		(conversation !== "channel" && conversation !== "dm") ||
		conversationId === undefined ||
		messageId === undefined
	)
		return null;
	const target: CommonspaceMessageTarget = {
		conversation: { kind: conversation, id: conversationId },
		messageId,
	};
	if (threadId !== undefined) target.threadId = threadId;
	return target;
}

function directoryRouteHref(
	router: CommonspaceRouter,
	directory: Extract<CommonspaceRoute, { kind: "directory" }>["directory"],
): string {
	if (directory === "projects")
		return router.buildLocation({ to: "/projects", search: {} }).href;
	if (directory === "channels")
		return router.buildLocation({ to: "/channels", search: {} }).href;
	return router.buildLocation({ to: "/agents", search: {} }).href;
}

function projectRouteHref(
	router: CommonspaceRouter,
	route: Extract<CommonspaceRoute, { kind: "project" }>,
): string {
	if (route.file === undefined)
		return router.buildLocation({
			to: "/projects/$projectId",
			params: { projectId: route.projectId },
			search: {},
		}).href;
	return router.buildLocation({
		to: "/projects/$projectId/files/$rootIndex/$filePath",
		params: {
			projectId: route.projectId,
			rootIndex: String(route.file.rootIndex),
			filePath: route.file.path,
		},
		search: {},
	}).href;
}

function conversationRouteHref(
	router: CommonspaceRouter,
	route: Extract<CommonspaceRoute, { kind: "conversation" }>,
): string {
	const search =
		route.messageId === undefined ? {} : { message: route.messageId };
	if (route.conversation.kind === "dm")
		return router.buildLocation({
			to: "/agents/$agentId",
			params: { agentId: route.conversation.id },
			search,
		}).href;
	if (route.threadId === undefined)
		return router.buildLocation({
			to: "/channels/$channelId",
			params: { channelId: route.conversation.id },
			search,
		}).href;
	return router.buildLocation({
		to: "/channels/$channelId/threads/$threadId",
		params: {
			channelId: route.conversation.id,
			threadId: route.threadId,
		},
		search,
	}).href;
}

export function commonspaceRouteHref(
	router: CommonspaceRouter,
	route: CommonspaceRoute,
): string {
	switch (route.kind) {
		case "inbox":
			return router.buildLocation({
				to: route.view === "sessions" ? "/inbox/sessions" : "/",
				search: {},
			}).href;
		case "threads":
			return router.buildLocation({ to: "/threads", search: {} }).href;
		case "scheduled":
			return router.buildLocation({ to: "/scheduled", search: {} }).href;
		case "directory":
			return directoryRouteHref(router, route.directory);
		case "project":
			return projectRouteHref(router, route);
		case "conversation":
			return conversationRouteHref(router, route);
	}
}

export function commonspaceMessageHref(
	router: CommonspaceRouter,
	target: CommonspaceMessageTarget,
): string {
	const route: Extract<CommonspaceRoute, { kind: "conversation" }> = {
		kind: "conversation",
		conversation: target.conversation,
		messageId: target.messageId,
	};
	if (target.threadId !== undefined) route.threadId = target.threadId;
	return commonspaceRouteHref(router, route);
}

export { createMemoryHistory };
