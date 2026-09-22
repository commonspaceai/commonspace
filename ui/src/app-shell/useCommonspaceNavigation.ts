import type {
	CommonspaceSearchResult,
	CommonspaceState,
	ConversationRef,
} from "@commonspace/shared";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommonspaceDirectoryKind } from "../CommonspaceDirectory.tsx";
import type {
	CommonspaceClientSnapshot,
	CommonspaceStore,
} from "../commonspace-store.ts";
import type { CommonspaceCollectionKind } from "../design-system/CollectionActionMenu.tsx";
import {
	type CommonspaceMessageTarget,
	type CommonspaceRoute,
	commonspaceLegacyMessageTargetFromMatches,
	commonspaceMessageHref,
	commonspaceRouteFromMatches,
	commonspaceRouteHref,
} from "./commonspace-router.tsx";

type CommonspaceDestination =
	| "conversation"
	| "directory"
	| "inbox"
	| "threads"
	| "project";

interface ConversationTarget {
	messageId: string;
	conversation: ConversationRef;
	threadId?: string;
}

interface ContextSettingsRequest {
	kind: CommonspaceCollectionKind;
	id: string;
	token: number;
}

interface ComposerInsertRequest {
	text: string;
	token: number;
	threadId?: string;
}

type NavigationIntent =
	| { kind: "settings"; request: ContextSettingsRequest }
	| { kind: "mention"; request: ComposerInsertRequest };

function conversationRoute(
	conversation: ConversationRef,
	threadId?: string,
	messageId?: string,
): Extract<CommonspaceRoute, { kind: "conversation" }> {
	const route: Extract<CommonspaceRoute, { kind: "conversation" }> = {
		kind: "conversation",
		conversation,
	};
	if (threadId !== undefined) route.threadId = threadId;
	if (messageId !== undefined) route.messageId = messageId;
	return route;
}

function projectRoute(
	projectId: string,
	file?: { rootIndex: number; path: string },
): Extract<CommonspaceRoute, { kind: "project" }> {
	const route: Extract<CommonspaceRoute, { kind: "project" }> = {
		kind: "project",
		projectId,
	};
	if (file !== undefined) route.file = file;
	return route;
}

function routeAvailable(
	state: CommonspaceState,
	route: CommonspaceRoute,
): boolean {
	if (route.kind === "project") {
		const project = state.projects.find((item) => item.id === route.projectId);
		return (
			project !== undefined &&
			(route.file === undefined ||
				project.paths[route.file.rootIndex] !== undefined)
		);
	}
	if (route.kind !== "conversation") return true;
	const { conversation } = route;
	const exists =
		conversation.kind === "channel"
			? state.channels.some((item) => item.id === conversation.id)
			: state.agents.some((item) => item.id === conversation.id);
	if (!exists) return false;
	const thread =
		route.threadId === undefined
			? undefined
			: state.threads.find(
					(item) =>
						item.id === route.threadId &&
						conversation.kind === "channel" &&
						item.channelId === conversation.id,
				);
	if (route.threadId !== undefined && thread === undefined) return false;
	if (route.messageId === undefined) return true;
	const message = state.messages[
		`${conversation.kind}:${conversation.id}`
	]?.find((item) => item.id === route.messageId);
	return (
		message !== undefined &&
		(thread === undefined ||
			message.threadId === thread.id ||
			message.id === thread.rootMessageId)
	);
}

export function useCommonspaceNavigation(
	store: CommonspaceStore,
	snapshot: CommonspaceClientSnapshot,
) {
	const router = useRouter();
	const routeMatches = useRouterState({ select: (state) => state.matches });
	const leafMatch = routeMatches.at(-1);
	const routeMatchKey = JSON.stringify([
		leafMatch?.routeId,
		leafMatch?.params,
		leafMatch?.search,
	]);
	const matchedRoute = commonspaceRouteFromMatches(routeMatches);
	const matchedRouteHref =
		matchedRoute === null ? null : commonspaceRouteHref(router, matchedRoute);
	const legacyMessageTarget =
		commonspaceLegacyMessageTargetFromMatches(routeMatches);
	const [navigationOpen, setNavigationOpen] = useState(false);
	const [navigationToken, setNavigationToken] = useState(0);
	const [searchOpen, setSearchOpen] = useState(false);
	const [activeDestination, setActiveDestination] =
		useState<CommonspaceDestination>("inbox");
	const [directoryKind, setDirectoryKind] =
		useState<CommonspaceDirectoryKind>("projects");
	const [createRequest, setCreateRequest] = useState<{
		kind: CommonspaceCollectionKind;
		token: number;
	} | null>(null);
	const [settingsRequest, setSettingsRequest] =
		useState<ContextSettingsRequest | null>(null);
	const [inboxViewRequest, setInboxViewRequest] = useState<{
		view: "attention" | "sessions";
		token: number;
	} | null>(null);
	const [composerInsertRequest, setComposerInsertRequest] =
		useState<ComposerInsertRequest | null>(null);
	const [activeProjectViewId, setActiveProjectViewId] = useState<string | null>(
		null,
	);
	const [targetProjectFile, setTargetProjectFile] = useState<{
		rootIndex: number;
		path: string;
	} | null>(null);
	const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
	const appliedRouteMatch = useRef<string | null>(null);
	const pendingNavigationIntent = useRef<{
		href: string;
		intent: NavigationIntent;
	} | null>(null);
	const applyNavigationIntent = useCallback((intent: NavigationIntent) => {
		if (intent.kind === "settings") setSettingsRequest(intent.request);
		else setComposerInsertRequest(intent.request);
	}, []);

	const applyRoute = useCallback(
		(route: CommonspaceRoute): boolean => {
			const bootstrap = snapshot.bootstrap;
			if (bootstrap === null) return false;
			const state = bootstrap.state;
			if (!routeAvailable(state, route)) return false;
			setSettingsRequest(null);
			setComposerInsertRequest(null);
			setSearchOpen(false);
			setNavigationOpen(false);
			setNavigationToken((token) => token + 1);
			setTargetMessageId(null);
			if (route.kind === "project") {
				store.selectProject(route.projectId);
				setActiveProjectViewId(route.projectId);
				setTargetProjectFile(route.file ?? null);
				setActiveDestination("project");
				return true;
			}
			setActiveProjectViewId(null);
			setTargetProjectFile(null);
			if (route.kind === "conversation") {
				const { conversation } = route;
				const currentConversation = store.getSnapshot().activeConversation;
				if (
					currentConversation?.kind !== conversation.kind ||
					currentConversation.id !== conversation.id
				)
					store.selectConversation(conversation);
				const threadId = route.threadId ?? null;
				if (store.getSnapshot().activeThreadId !== threadId)
					store.selectThread(threadId);
				setTargetMessageId(route.messageId ?? null);
				setActiveDestination("conversation");
				return true;
			}
			if (route.kind === "directory") {
				setDirectoryKind(route.directory);
				setActiveDestination("directory");
				return true;
			}
			if (route.kind === "threads") {
				setActiveDestination("threads");
				return true;
			}
			setInboxViewRequest({ view: route.view, token: Date.now() });
			setActiveDestination("inbox");
			return true;
		},
		[snapshot.bootstrap, store],
	);

	const navigate = useCallback(
		(
			route: CommonspaceRoute,
			replace = false,
			intent: NavigationIntent | null = null,
		): boolean => {
			const href = commonspaceRouteHref(router, route);
			pendingNavigationIntent.current = null;
			setSettingsRequest(null);
			setComposerInsertRequest(null);
			setNavigationOpen(false);
			setSearchOpen(false);
			setNavigationToken((token) => token + 1);
			if (intent !== null) {
				if (href === matchedRouteHref) {
					applyNavigationIntent(intent);
					return true;
				}
				pendingNavigationIntent.current = { href, intent };
			}
			void router.navigate({ href, replace });
			return true;
		},
		[applyNavigationIntent, matchedRouteHref, router],
	);

	useEffect(() => {
		if (snapshot.bootstrap === null) return;
		const route =
			legacyMessageTarget === null
				? matchedRoute
				: conversationRoute(
						legacyMessageTarget.conversation,
						legacyMessageTarget.threadId,
						legacyMessageTarget.messageId,
					);
		if (
			appliedRouteMatch.current === routeMatchKey &&
			route !== null &&
			routeAvailable(snapshot.bootstrap.state, route)
		)
			return;
		if (route === null || !applyRoute(route)) {
			appliedRouteMatch.current = routeMatchKey;
			navigate({ kind: "inbox", view: "attention" }, true);
			return;
		}
		appliedRouteMatch.current = routeMatchKey;
		const pendingIntent = pendingNavigationIntent.current;
		pendingNavigationIntent.current = null;
		if (
			pendingIntent !== null &&
			pendingIntent.href === commonspaceRouteHref(router, route)
		)
			applyNavigationIntent(pendingIntent.intent);
		if (legacyMessageTarget !== null) {
			navigate(route, true);
			void store
				.mutate({
					action: "mark-inbox-item-read",
					messageId: legacyMessageTarget.messageId,
				})
				.catch(() => undefined);
		}
	}, [
		applyNavigationIntent,
		applyRoute,
		legacyMessageTarget,
		matchedRoute,
		navigate,
		routeMatchKey,
		router,
		snapshot.bootstrap,
		store,
	]);

	useEffect(() => {
		const handleKeyboardNavigation = (event: KeyboardEvent) => {
			if (event.key === "Escape") setNavigationOpen(false);
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLocaleLowerCase() === "k"
			) {
				event.preventDefault();
				setSearchOpen(true);
			}
		};
		window.addEventListener("keydown", handleKeyboardNavigation);
		return () => {
			window.removeEventListener("keydown", handleKeyboardNavigation);
		};
	}, []);

	const openConversation = (
		conversation?: ConversationRef,
		messageId?: string,
	) => {
		const target = conversation ?? store.getSnapshot().activeConversation;
		if (target === null) return;
		navigate(conversationRoute(target, undefined, messageId));
	};

	const openTarget = (target: ConversationTarget) => {
		navigate(
			conversationRoute(target.conversation, target.threadId, target.messageId),
		);
	};

	const openSearchResult = (result: CommonspaceSearchResult) => {
		setSearchOpen(false);
		if (result.target.kind === "project") {
			navigate(projectRoute(result.target.projectId));
			return;
		}
		if (result.target.kind === "conversation") {
			navigate(
				conversationRoute(
					result.target.conversation,
					result.target.threadId,
					result.target.messageId,
				),
			);
			return;
		}
		if (result.target.kind === "project-file") {
			navigate({
				kind: "project",
				projectId: result.target.projectId,
				file: {
					rootIndex: result.target.rootIndex,
					path: result.target.path,
				},
			});
			return;
		}
		openConversation({ kind: "dm", id: result.target.agentId });
	};

	const openDirectory = (kind: CommonspaceDirectoryKind) => {
		navigate({ kind: "directory", directory: kind });
	};

	const openInbox = (view: "attention" | "sessions" = "attention") => {
		navigate({ kind: "inbox", view });
	};

	const openContextSettings = (kind: CommonspaceCollectionKind, id: string) => {
		const route =
			kind === "project"
				? projectRoute(id)
				: conversationRoute({
						kind: kind === "channel" ? "channel" : "dm",
						id,
					});
		const request = { kind, id, token: Date.now() };
		navigate(route, false, { kind: "settings", request });
	};

	const openProject = (
		projectId: string,
		file?: { rootIndex: number; path: string },
	) => {
		navigate(projectRoute(projectId, file));
	};

	const openThread = (threadId: string | null) => {
		const conversation = store.getSnapshot().activeConversation;
		if (conversation === null) return;
		// A send can open a thread without changing the URL. Closing it must
		// update selection even when navigation resolves to the current route.
		store.selectThread(threadId);
		navigate(conversationRoute(conversation, threadId ?? undefined));
	};

	const mentionAgent = (agentName: string) => {
		const current = store.getSnapshot();
		if (current.activeConversation?.kind !== "channel") return;
		const threadId = current.activeThreadId ?? undefined;
		const request: ComposerInsertRequest = {
			text: `@${agentName} `,
			token: Date.now(),
		};
		if (threadId !== undefined) request.threadId = threadId;
		navigate(conversationRoute(current.activeConversation, threadId), false, {
			kind: "mention",
			request,
		});
	};

	const requestCreate = (kind: CommonspaceDirectoryKind) => {
		const singular =
			kind === "projects"
				? "project"
				: kind === "channels"
					? "channel"
					: "agent";
		setCreateRequest({ kind: singular, token: Date.now() });
	};
	const messageUrl = useCallback(
		(target: CommonspaceMessageTarget) =>
			new URL(
				commonspaceMessageHref(router, target),
				window.location.origin,
			).toString(),
		[router],
	);

	return {
		activeDestination,
		activeProjectViewId,
		closeNavigation: () => setNavigationOpen(false),
		closeSearch: () => setSearchOpen(false),
		composerInsertRequest,
		createRequest,
		directoryKind,
		inboxViewRequest,
		messageUrl,
		mentionAgent,
		navigationOpen,
		navigationToken,
		openContextSettings,
		openConversation,
		openDirectory,
		openInbox,
		openProject,
		openThread,
		openSearch: () => setSearchOpen(true),
		openSearchResult,
		openTarget,
		openThreads: () => navigate({ kind: "threads" }),
		requestCreate,
		searchOpen,
		settingsRequest,
		targetMessageId,
		targetProjectFile,
		clearSettingsRequest: () => setSettingsRequest(null),
		clearTargetMessage: () => setTargetMessageId(null),
		toggleNavigation: () => setNavigationOpen((open) => !open),
	};
}

export type CommonspaceNavigation = ReturnType<typeof useCommonspaceNavigation>;
