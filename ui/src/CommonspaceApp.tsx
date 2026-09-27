import { CommonspaceRoutingProvider } from "@commonspace/shared";
import { RouterProvider } from "@tanstack/react-router";
import { MenuIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { CommonspaceWorkspace } from "./app-shell/CommonspaceWorkspace.tsx";
import {
	createCommonspaceRouter,
	createMemoryHistory,
} from "./app-shell/commonspace-router.tsx";
import {
	type CommonspaceNavigation,
	useCommonspaceNavigation,
} from "./app-shell/useCommonspaceNavigation.ts";
import { useCommonspaceTheme } from "./app-shell/useCommonspaceTheme.ts";
import { CommonspaceSearchDialog } from "./CommonspaceSearch.tsx";
import { CommonspaceSidebar } from "./CommonspaceSidebar.tsx";
import { CommonspaceTopbar } from "./CommonspaceTopbar.tsx";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { WorkspaceErrorNotice } from "./design-system/WorkspaceErrorNotice";
import type { CommonspaceColorMode } from "./theme.ts";

export interface CommonspaceAppProps {
	store: CommonspaceStore;
	projectFetcher?: typeof globalThis.fetch;
	searchFetcher?: typeof globalThis.fetch;
	initialPath?: string;
}

export function CommonspaceApp({
	store,
	projectFetcher,
	searchFetcher,
	initialPath,
}: CommonspaceAppProps) {
	const router = useMemo(
		() =>
			createCommonspaceRouter(
				initialPath === undefined
					? {}
					: {
							history: createMemoryHistory({ initialEntries: [initialPath] }),
						},
			),
		[initialPath],
	);
	return (
		<RouterProvider
			router={router}
			context={{
				app: (
					<CommonspaceAppShell
						store={store}
						{...(projectFetcher === undefined ? {} : { projectFetcher })}
						{...(searchFetcher === undefined ? {} : { searchFetcher })}
					/>
				),
			}}
		/>
	);
}

function CommonspaceAppShell({
	store,
	projectFetcher,
	searchFetcher,
}: Omit<CommonspaceAppProps, "initialPath">) {
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const { colorMode, setColorMode } = useCommonspaceTheme();
	const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
	const bootstrap = snapshot.bootstrap;
	const routing = bootstrap?.routing;
	const onboarding =
		bootstrap !== null &&
		!(
			routing?.provider === CommonspaceRoutingProvider.Harness &&
			bootstrap.agents.some((agent) => agent.id === routing.harnessAgentId)
		);
	const shellVisible = bootstrap !== null && !onboarding;
	const navigation = useCommonspaceNavigation(store, snapshot, shellVisible);
	const { closeSearch, openSearch, openSearchResult, searchOpen } = navigation;

	useEffect(() => {
		store.connectEvents();
		return () => {
			store.disconnectEvents();
		};
	}, [store]);

	return (
		<div className="relative flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
			{shellVisible ? <CommonspaceTopbar onOpenSearch={openSearch} /> : null}
			<div
				className={cn(
					"relative grid min-h-0 min-w-0 flex-1 bg-sidebar",
					shellVisible
						? "grid-cols-[var(--navigation-width)_minmax(0,1fr)] max-[780px]:grid-cols-1"
						: "grid-cols-1",
				)}
			>
				<CommonspaceAppNavigation
					navigation={navigation}
					shellVisible={shellVisible}
					store={store}
					colorMode={colorMode}
					setColorMode={setColorMode}
					onSettingsOpenChange={setWorkspaceSettingsOpen}
				/>
				<section
					inert={workspaceSettingsOpen && shellVisible}
					aria-hidden={(workspaceSettingsOpen && shellVisible) || undefined}
					className="relative isolate min-h-0 min-w-0 overflow-hidden bg-background"
				>
					<CommonspaceWorkspace
						navigation={navigation}
						snapshot={snapshot}
						store={store}
						onboarding={onboarding}
						{...(projectFetcher === undefined ? {} : { projectFetcher })}
					/>
				</section>
			</div>
			{shellVisible && searchOpen && bootstrap !== null && (
				<CommonspaceSearchDialog
					projects={bootstrap.state.projects}
					onClose={closeSearch}
					onSelect={openSearchResult}
					{...(searchFetcher === undefined ? {} : { fetcher: searchFetcher })}
				/>
			)}
			{!workspaceSettingsOpen &&
				snapshot.bootstrap !== null &&
				snapshot.error !== null && (
					<WorkspaceErrorNotice
						error={snapshot.error}
						onDismiss={() => store.dismissError()}
						loading={snapshot.loading}
						onRefresh={() => {
							void store.refresh();
						}}
					/>
				)}
		</div>
	);
}

interface CommonspaceAppNavigationProps {
	navigation: CommonspaceNavigation;
	shellVisible: boolean;
	store: CommonspaceStore;
	colorMode: CommonspaceColorMode;
	setColorMode: (colorMode: CommonspaceColorMode) => void;
	onSettingsOpenChange: (open: boolean) => void;
}

function CommonspaceAppNavigation({
	navigation,
	shellVisible,
	store,
	colorMode,
	setColorMode,
	onSettingsOpenChange,
}: CommonspaceAppNavigationProps) {
	const {
		activeDestination,
		activeProjectViewId,
		closeNavigation,
		createRequest,
		mentionAgent,
		navigationOpen,
		navigationToken,
		openContextSettings,
		openConversation,
		openDirectory,
		openInbox,
		openProject,
		openSearch,
		openTarget,
		openThreads,
		toggleNavigation,
	} = navigation;

	return (
		<>
			{shellVisible ? (
				<>
					<button
						type="button"
						aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
						aria-expanded={navigationOpen}
						className="absolute top-2 left-3 z-30 hidden size-11 place-items-center rounded-sm border-0 bg-transparent text-foreground hover:bg-muted max-[780px]:grid"
						onClick={toggleNavigation}
					>
						{navigationOpen ? (
							<XIcon aria-hidden="true" />
						) : (
							<MenuIcon aria-hidden="true" />
						)}
					</button>
					<button
						type="button"
						className={cn(
							"pointer-events-none absolute inset-0 z-10 hidden border-0 bg-black/30 opacity-0 transition-opacity max-[780px]:block",
							navigationOpen && "pointer-events-auto max-[780px]:opacity-100",
						)}
						aria-label="Close navigation"
						aria-hidden={!navigationOpen}
						tabIndex={navigationOpen ? 0 : -1}
						onClick={closeNavigation}
					/>
				</>
			) : null}
			<aside
				className={cn(
					"relative z-20 min-h-0 min-w-0 overflow-hidden bg-sidebar text-sidebar-foreground max-[780px]:absolute max-[780px]:inset-y-0 max-[780px]:left-0 max-[780px]:w-[min(88vw,320px)] max-[780px]:-translate-x-full max-[780px]:pt-12 max-[780px]:shadow-2xl max-[780px]:transition-transform",
					navigationOpen && "max-[780px]:translate-x-0",
					!shellVisible && "hidden",
				)}
			>
				<CommonspaceSidebar
					wide
					shellHidden={!shellVisible}
					expandSidebar={() => undefined}
					store={store}
					colorMode={colorMode}
					onSetColorMode={setColorMode}
					onSettingsOpenChange={onSettingsOpenChange}
					inboxActive={activeDestination === "inbox"}
					threadsActive={activeDestination === "threads"}
					conversationActive={activeDestination === "conversation"}
					directoryActive={activeDestination === "directory"}
					activeProjectViewId={activeProjectViewId}
					createRequest={createRequest}
					navigationToken={navigationToken}
					onOpenSearch={openSearch}
					onOpenInbox={() => openInbox()}
					onOpenThreads={openThreads}
					onOpenDirectory={openDirectory}
					onOpenContextSettings={openContextSettings}
					onOpenAgentSessions={() => openInbox("sessions")}
					onMentionAgent={mentionAgent}
					onOpenProject={openProject}
					onOpenConversation={(conversation, messageId, threadId) => {
						if (messageId !== undefined) {
							const target = { conversation, messageId };
							openTarget(
								threadId === undefined ? target : { ...target, threadId },
							);
						} else openConversation(conversation);
					}}
				/>
			</aside>
		</>
	);
}
