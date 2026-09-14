import { RouterProvider } from "@tanstack/react-router";
import { CircleAlertIcon, MenuIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommonspaceWorkspace } from "./app-shell/CommonspaceWorkspace.tsx";
import {
	createCommonspaceRouter,
	createMemoryHistory,
} from "./app-shell/commonspace-router.tsx";
import { useCommonspaceNavigation } from "./app-shell/useCommonspaceNavigation.ts";
import { useCommonspaceTheme } from "./app-shell/useCommonspaceTheme.ts";
import { CommonspaceSearchDialog } from "./CommonspaceSearch.tsx";
import { CommonspaceSidebar } from "./CommonspaceSidebar.tsx";
import { CommonspaceTopbar } from "./CommonspaceTopbar.tsx";
import type { CommonspaceStore } from "./commonspace-store.ts";

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

function WorkspaceErrorNotice({
	error,
	loading,
	onRefresh,
}: {
	error: string;
	loading: boolean;
	onRefresh: () => void;
}) {
	return (
		<div
			className="fixed right-4 bottom-4 z-50 flex max-w-md items-start gap-3 rounded-md border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
			role="alert"
		>
			<CircleAlertIcon
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-destructive"
			/>
			<div className="min-w-0 flex-1">
				<p className="leading-relaxed [overflow-wrap:anywhere]">{error}</p>
				<Button
					variant="outline"
					size="sm"
					className="mt-3"
					disabled={loading}
					onClick={onRefresh}
				>
					<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
					Refresh workspace
				</Button>
			</div>
		</div>
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
	const navigation = useCommonspaceNavigation(store, snapshot);
	const {
		activeDestination,
		activeProjectViewId,
		closeNavigation,
		closeSearch,
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
		openSearchResult,
		openTarget,
		openThreads,
		searchOpen,
		toggleNavigation,
	} = navigation;

	useEffect(() => {
		store.connectEvents();
		return () => {
			store.disconnectEvents();
		};
	}, [store]);

	return (
		<div className="relative flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
			<CommonspaceTopbar onOpenSearch={openSearch} />
			<div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-[260px_minmax(0,1fr)] bg-sidebar max-[780px]:grid-cols-1">
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
				<aside
					className={cn(
						"relative z-20 min-h-0 min-w-0 overflow-hidden bg-sidebar text-sidebar-foreground max-[780px]:absolute max-[780px]:inset-y-0 max-[780px]:left-0 max-[780px]:w-[min(88vw,320px)] max-[780px]:-translate-x-full max-[780px]:pt-12 max-[780px]:shadow-2xl max-[780px]:transition-transform",
						navigationOpen && "max-[780px]:translate-x-0",
					)}
				>
					<CommonspaceSidebar
						wide
						expandSidebar={() => undefined}
						store={store}
						colorMode={colorMode}
						onSetColorMode={setColorMode}
						onSettingsOpenChange={setWorkspaceSettingsOpen}
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
				<section
					inert={workspaceSettingsOpen}
					aria-hidden={workspaceSettingsOpen || undefined}
					className="min-h-0 min-w-0 overflow-hidden bg-background"
				>
					<CommonspaceWorkspace
						navigation={navigation}
						snapshot={snapshot}
						store={store}
						{...(projectFetcher === undefined ? {} : { projectFetcher })}
					/>
				</section>
			</div>
			{searchOpen && snapshot.bootstrap !== null && (
				<CommonspaceSearchDialog
					projects={snapshot.bootstrap.state.projects}
					onClose={closeSearch}
					onSelect={openSearchResult}
					{...(searchFetcher === undefined ? {} : { fetcher: searchFetcher })}
				/>
			)}
			{snapshot.bootstrap !== null && snapshot.error !== null && (
				<WorkspaceErrorNotice
					error={snapshot.error}
					loading={snapshot.loading}
					onRefresh={() => {
						void store.refresh();
					}}
				/>
			)}
		</div>
	);
}
