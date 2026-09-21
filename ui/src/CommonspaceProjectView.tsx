import type {
	CommonspaceBootstrap,
	CommonspaceProject,
	CommonspaceState,
	ConversationRef,
} from "@commonspace/shared";
import { referencedProjectIds } from "@commonspace/shared";
import { ArrowLeftIcon, FolderPlusIcon, SettingsIcon } from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommonspaceLogo } from "@/design-system/CommonspaceLogo";
import { ConfirmActionDialog } from "@/design-system/ConfirmActionDialog";
import { ResizablePanelHandle } from "@/design-system/ResizablePanelHandle";
import {
	COMMONSPACE_RESIZABLE_PANEL,
	useResizablePanel,
} from "@/design-system/useResizablePanel";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { cn } from "@/lib/utils";
import { CommonspaceProjectChanges } from "./CommonspaceProjectChanges.tsx";
import { CommonspaceProjectFiles } from "./CommonspaceProjectFiles.tsx";
import type { CommonspaceStore } from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";

export interface CommonspaceProjectViewProps {
	projectId: string;
	targetFile?: { rootIndex: number; path: string } | null;
	settingsRequest?: number;
	navigationToken?: number;
	store: CommonspaceStore;
	onBack: () => void;
	onOpenConversation: (conversation: ConversationRef) => void;
	fetcher?: typeof globalThis.fetch;
}

type ProjectTab = "conversations" | "files" | "changes";

function deriveProjectConversations(
	agents: CommonspaceBootstrap["agents"],
	channels: CommonspaceState["channels"],
	messages: CommonspaceState["messages"],
	projectId: string,
) {
	const projectChannels = channels.flatMap((channel) => {
		const latest = messages[`channel:${channel.id}`]?.findLast((message) =>
			referencedProjectIds(message).includes(projectId),
		);
		return latest === undefined ? [] : [{ channel, latest }];
	});
	const directMessages = agents.flatMap((agent) => {
		const latest = messages[`dm:${agent.id}`]?.findLast((message) =>
			referencedProjectIds(message).includes(projectId),
		);
		return latest === undefined ? [] : [{ agent, latest }];
	});
	return { channels: projectChannels, directMessages };
}

type ProjectConversationsSummary = ReturnType<
	typeof deriveProjectConversations
>;

const emptyProjectConversations: ProjectConversationsSummary = {
	channels: [],
	directMessages: [],
};

function ProjectConversations({
	conversations,
	project,
	onOpenConversation,
}: {
	conversations: ProjectConversationsSummary;
	project: CommonspaceProject;
	onOpenConversation: (conversation: ConversationRef) => void;
}) {
	const conversationCount =
		conversations.channels.length + conversations.directMessages.length;
	return (
		<section
			className="mx-auto w-full max-w-[1280px] overflow-hidden bg-background"
			aria-labelledby="project-conversations-heading"
		>
			<header className="sr-only">
				<strong
					id="project-conversations-heading"
					className="block text-[17px]"
				>
					Conversations
				</strong>
				<small className="mt-1 block text-xs text-muted-foreground">
					{project.name} · real workspace conversations
				</small>
			</header>
			<div>
				{conversations.channels.map(({ channel, latest }) => {
					return (
						<button
							key={`channel:${channel.id}`}
							type="button"
							className="grid min-h-[82px] w-full grid-cols-[34px_minmax(0,1fr)_20px] items-center gap-3 border-0 border-b bg-transparent px-4 py-2.5 text-left last:border-b-0 hover:bg-hover"
							aria-label={`Open channel ${channel.name}`}
							onClick={() =>
								onOpenConversation({ kind: "channel", id: channel.id })
							}
						>
							<span
								className="grid size-[34px] place-items-center rounded-lg bg-muted text-muted-foreground"
								aria-hidden="true"
							>
								#
							</span>
							<span className="min-w-0">
								<strong className="block truncate"># {channel.name}</strong>
								<small className="block truncate text-xs text-muted-foreground">
									Channel
								</small>
								<p className="mt-1 truncate text-sm">{latest.text}</p>
							</span>
							<span className="text-muted-foreground" aria-hidden="true">
								→
							</span>
						</button>
					);
				})}
				{conversations.directMessages.map(({ agent, latest }) => {
					return (
						<button
							key={`dm:${agent.id}`}
							type="button"
							className="grid min-h-[82px] w-full grid-cols-[34px_minmax(0,1fr)_20px] items-center gap-3 border-0 border-b bg-transparent px-4 py-2.5 text-left last:border-b-0 hover:bg-hover"
							aria-label={`Open direct message ${agent.displayName}`}
							onClick={() => onOpenConversation({ kind: "dm", id: agent.id })}
						>
							<AgentAvatar agent={agent} size="activity" />
							<span className="min-w-0">
								<strong className="block truncate">{agent.displayName}</strong>
								<small className="block truncate text-xs text-muted-foreground">
									Direct message
								</small>
								<p className="mt-1 truncate text-sm">{latest.text}</p>
							</span>
							<span className="text-muted-foreground" aria-hidden="true">
								→
							</span>
						</button>
					);
				})}
				{conversationCount === 0 && (
					<div className="p-10 text-center text-sm text-muted-foreground">
						No conversations are connected to this project yet.
					</div>
				)}
			</div>
			<div className="sr-only">
				{conversationCount}{" "}
				{conversationCount === 1 ? "conversation" : "conversations"} available
				in {project.name}
			</div>
		</section>
	);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The cohesive project controller keeps tab, settings panel, and project mutation ownership together.
export function CommonspaceProjectView({
	projectId,
	targetFile,
	settingsRequest,
	navigationToken,
	store,
	onBack,
	onOpenConversation,
	fetcher = globalThis.fetch,
}: CommonspaceProjectViewProps) {
	const [activeTab, setActiveTab] = useState<ProjectTab>("files");
	const [addingFolder, setAddingFolder] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
	const projectLayout = useRef<HTMLElement>(null);
	const {
		width: panelWidth,
		resizing: resizingPanel,
		setWidth: setPanelWidth,
		startResizing: startPanelResize,
		resetWidth: resetPanelWidth,
	} = useResizablePanel(projectLayout, COMMONSPACE_RESIZABLE_PANEL);
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const bootstrap = snapshot.bootstrap;
	const state = bootstrap?.state;
	const project = state?.projects.find(
		(candidate) => candidate.id === projectId,
	);
	const agents = bootstrap?.agents;
	const channels = state?.channels;
	const messages = state?.messages;
	const resolvedProjectId = project?.id;
	const conversations = useMemo(
		() =>
			agents === undefined ||
			channels === undefined ||
			messages === undefined ||
			resolvedProjectId === undefined
				? emptyProjectConversations
				: deriveProjectConversations(
						agents,
						channels,
						messages,
						resolvedProjectId,
					),
		[agents, channels, messages, resolvedProjectId],
	);

	useEffect(() => {
		void navigationToken;
		void projectId;
		setSettingsOpen(settingsRequest !== undefined);
	}, [navigationToken, projectId, settingsRequest]);

	const addLocalFolder = async () => {
		setAddingFolder(true);
		try {
			const path = await store.selectDirectory();
			if (path !== null)
				await store.mutate({ action: "add-project-path", projectId, path });
		} catch {
			// Store exposes picker and mutation failures through its shared error state.
		} finally {
			setAddingFolder(false);
		}
	};

	if (project === undefined || state === undefined || bootstrap === null) {
		return (
			<main
				className="flex h-full min-h-0 flex-col bg-background"
				aria-label="Project unavailable"
			>
				<header className="flex min-h-16 items-center border-b px-6">
					<div>
						<h1 className="font-heading text-lg font-bold">
							Project unavailable
						</h1>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Selected local context could not be found.
						</p>
					</div>
				</header>
				<div className="grid flex-1 place-items-center">
					<Button variant="outline" onClick={onBack}>
						<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
						Back to Workspace
					</Button>
				</div>
			</main>
		);
	}

	const conversationCount =
		conversations.channels.length + conversations.directMessages.length;
	const folderCount = project.paths.length;
	const folderSummary =
		folderCount === 1
			? "1 folder · working directory"
			: `${String(folderCount)} folders · working + references`;
	const settingsStyle: CSSProperties & {
		"--commonspace-settings-width": string;
	} = {
		"--commonspace-settings-width": `${String(panelWidth)}%`,
	};
	return (
		<main
			ref={projectLayout}
			className={cn("h-full min-h-0", resizingPanel && "select-none")}
			aria-label={`Project ${project.name}`}
		>
			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					if (
						value === "conversations" ||
						value === "files" ||
						value === "changes"
					)
						setActiveTab(value);
				}}
				className="relative flex h-full min-h-0 flex-col gap-0 overflow-hidden bg-background"
			>
				<WorkspaceHeader
					title={project.name}
					subtitle={`${String(conversationCount)} ${conversationCount === 1 ? "conversation" : "conversations"} · ${folderSummary}`}
					mark={
						project.name.toLocaleLowerCase() === "commonspace" ? (
							<CommonspaceLogo decorative className="size-5" />
						) : (
							project.name.slice(0, 1).toLocaleUpperCase()
						)
					}
					actions={
						<button
							type="button"
							className="grid size-9 place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Open project settings"
							aria-expanded={settingsOpen}
							onClick={() => {
								setSettingsOpen((open) => !open);
							}}
						>
							<SettingsIcon className="size-[18px]" aria-hidden="true" />
						</button>
					}
				/>
				<nav
					className="flex min-h-14 shrink-0 items-center gap-3 overflow-x-auto border-b px-8 py-1 whitespace-nowrap max-[780px]:px-3"
					aria-label="Project views"
				>
					<Button
						variant="ghost"
						aria-label="Workspace"
						onClick={onBack}
						size="icon-sm"
						title="Back to workspace"
					>
						<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
						<span className="sr-only">Workspace</span>
					</Button>
					<TabsList variant="project" aria-label="Project views">
						{(["conversations", "files", "changes"] as const).map((tab) => (
							<TabsTrigger key={tab} value={tab}>
								{tab.slice(0, 1).toLocaleUpperCase()}
								{tab.slice(1)}
							</TabsTrigger>
						))}
					</TabsList>
					<span className="flex-1" />
					<Button
						variant="outline"
						className="max-[780px]:hidden"
						aria-label="Add local folder"
						disabled={addingFolder}
						onClick={() => {
							void addLocalFolder();
						}}
					>
						<FolderPlusIcon data-icon="inline-start" aria-hidden="true" />
						{addingFolder ? "Choosing…" : "Add context folder"}
					</Button>
				</nav>
				<TabsContent
					value="conversations"
					className="min-h-0 flex-1 overflow-auto bg-background px-8 py-3"
				>
					<ProjectConversations
						conversations={conversations}
						project={project}
						onOpenConversation={onOpenConversation}
					/>
				</TabsContent>
				<TabsContent
					value="files"
					className="min-h-0 flex-1 overflow-hidden bg-background"
				>
					<CommonspaceProjectFiles
						projectId={project.id}
						roots={project.paths}
						targetFile={targetFile ?? null}
						fetcher={fetcher}
					/>
				</TabsContent>
				<TabsContent
					value="changes"
					className="min-h-0 flex-1 overflow-hidden bg-background"
				>
					<CommonspaceProjectChanges projectId={project.id} fetcher={fetcher} />
				</TabsContent>
				{settingsOpen && (
					<ResizablePanelHandle
						className="commonspace-settings-resizer absolute top-[72px] right-0 bottom-0 z-30 h-auto"
						style={{ right: `max(340px, ${String(panelWidth)}%)` }}
						ariaLabel="Resize settings"
						value={panelWidth}
						min={COMMONSPACE_RESIZABLE_PANEL.min}
						max={COMMONSPACE_RESIZABLE_PANEL.max}
						step={COMMONSPACE_RESIZABLE_PANEL.step}
						onChange={setPanelWidth}
						onStartResize={startPanelResize}
						onReset={resetPanelWidth}
					/>
				)}
				{settingsOpen && (
					<aside
						className="commonspace-project-context-settings absolute top-[72px] right-0 bottom-0 z-20 flex min-w-[340px] max-w-full flex-col border-l bg-background shadow-[-20px_0_48px_color-mix(in_oklch,var(--foreground)_9%,transparent)]"
						style={settingsStyle}
						aria-label="Project settings"
					>
						<header className="flex min-h-[70px] items-center gap-3 border-b py-2.5 pr-3.5 pl-5">
							<div className="min-w-0 flex-1">
								<h2 className="truncate font-heading text-[17px] font-bold">
									{project.name}
								</h2>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{conversationCount}{" "}
									{conversationCount === 1 ? "conversation" : "conversations"} ·{" "}
									{folderSummary}
								</p>
							</div>
							<button
								type="button"
								className="grid size-8 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
								aria-label="Close project settings"
								onClick={() => {
									setSettingsOpen(false);
								}}
							>
								×
							</button>
						</header>
						<div className="min-h-0 flex-1 overflow-y-auto p-5">
							<section>
								<h3 className="mb-3 font-heading text-sm font-bold">
									Local context
								</h3>
								<div className="space-y-1">
									<strong className="block text-sm">
										{project.paths[0] === undefined
											? "No working folder"
											: `Working · ${project.paths[0].split("/").at(-1) ?? project.name}`}
									</strong>
									<span className="mt-1 block text-xs text-muted-foreground">
										Read-only project browser
									</span>
								</div>
								<button
									type="button"
									className="mt-3 min-h-11 rounded-sm border bg-background px-4 font-semibold hover:bg-muted"
									onClick={() => {
										void addLocalFolder();
									}}
								>
									Add context folder
								</button>
							</section>
							<section className="mt-7 border-t pt-6">
								<h3 className="mb-3 font-heading text-sm font-bold">
									Connected work
								</h3>
								<div className="space-y-1">
									<strong className="block text-sm">
										{conversationCount}{" "}
										{conversationCount === 1 ? "conversation" : "conversations"}
									</strong>
									<span className="mt-1 block text-xs text-muted-foreground">
										Channels and direct sessions using this context
									</span>
								</div>
							</section>
							<section className="mt-7 border-t pt-6">
								<h3 className="mb-3 font-heading text-sm font-bold">
									Danger zone
								</h3>
								<button
									type="button"
									className="min-h-11 rounded-sm border border-destructive/40 bg-background px-4 font-semibold text-destructive hover:bg-destructive/5"
									onClick={() => {
										setRemoveConfirmOpen(true);
									}}
								>
									Remove project
								</button>
							</section>
						</div>
					</aside>
				)}
				<ConfirmActionDialog
					open={removeConfirmOpen}
					title={`Remove ${project.name}?`}
					description="This can be added again later. Conversations keep their transcript while this local folder context is removed."
					onOpenChange={setRemoveConfirmOpen}
					onConfirm={async () => {
						await store.mutate({
							action: "remove-project",
							projectId: project.id,
						});
						onBack();
					}}
				/>
			</Tabs>
		</main>
	);
}
