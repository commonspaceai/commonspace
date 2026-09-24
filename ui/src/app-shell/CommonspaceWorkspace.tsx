import type { CommonspaceBootstrap } from "@commonspace/shared";
import {
	AGENT_ADAPTERS,
	CommonspaceRoutingProvider,
} from "@commonspace/shared";
import {
	CheckIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	UnplugIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { CommonspaceConversation } from "../CommonspaceConversation.tsx";
import { CommonspaceDirectory } from "../CommonspaceDirectory.tsx";
import { CommonspaceInbox } from "../CommonspaceInbox.tsx";
import { CommonspaceProjectView } from "../CommonspaceProjectView.tsx";
import { CommonspaceScheduled } from "../CommonspaceScheduled.tsx";
import { CommonspaceThreads } from "../CommonspaceThreads.tsx";
import type {
	CommonspaceClientSnapshot,
	CommonspaceStore,
} from "../commonspace-store.ts";
import { AgentAvatar } from "../design-system/AgentAvatar.tsx";
import {
	type SettingsOperation,
	SettingsOperationStatus,
} from "../settings-operation.ts";
import type { CommonspaceNavigation } from "./useCommonspaceNavigation.ts";

interface CommonspaceWorkspaceProps {
	navigation: CommonspaceNavigation;
	projectFetcher?: typeof globalThis.fetch;
	snapshot: CommonspaceClientSnapshot;
	store: CommonspaceStore;
}

function WorkspaceOnboarding({
	bootstrap,
	onAddAgent,
	store,
}: {
	bootstrap: CommonspaceBootstrap;
	onAddAgent: () => void;
	store: CommonspaceStore;
}) {
	const [selectedAgentId, setSelectedAgentId] = useState<string>();
	const [submission, setSubmission] = useState<SettingsOperation>({
		status: SettingsOperationStatus.Idle,
	});
	const selectedAgent = bootstrap.agents.find(
		(agent) => agent.id === selectedAgentId,
	);
	const singleAgent =
		bootstrap.agents.length === 1 ? bootstrap.agents[0] : undefined;
	if (bootstrap.agents.length === 1 && singleAgent === undefined)
		throw new Error("Workspace Agent count does not match its Agent records");
	const addedAgentsLabel =
		singleAgent === undefined
			? `${String(bootstrap.agents.length)} agents added`
			: `${singleAgent.displayName} added`;
	const saving = submission.status === SettingsOperationStatus.Running;

	const selectInferenceAgent = (agentId: string) => {
		if (saving) return;
		setSelectedAgentId(agentId);
		setSubmission({ status: SettingsOperationStatus.Idle });
	};

	const saveInferenceAgent = async () => {
		if (selectedAgent === undefined || saving) return;
		setSubmission({
			status: SettingsOperationStatus.Running,
			message: "Finishing setup…",
		});
		try {
			await store.updateRoutingConfiguration({
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: selectedAgent.id,
			});
			setSubmission({
				status: SettingsOperationStatus.Succeeded,
				message: "Workspace inference agent saved.",
			});
		} catch (cause) {
			setSubmission({
				status: SettingsOperationStatus.Failed,
				message: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	return (
		<main
			aria-label="Workspace setup"
			className="h-full min-h-0 overflow-y-auto bg-background px-8 py-12 @container/onboarding"
		>
			<div className="mx-auto grid min-h-full max-w-[1040px] content-center gap-14 py-8 @min-[860px]/onboarding:grid-cols-[minmax(0,0.8fr)_minmax(460px,1.2fr)] @min-[860px]/onboarding:items-center">
				<header className="max-w-md">
					<div className="mb-8 flex size-14 items-center justify-center rounded-md border bg-card font-heading text-xl font-semibold">
						CS
					</div>
					<h1 className="font-heading text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
						Bring an agent. Give the workspace a mind.
					</h1>
					<p className="mt-5 max-w-[42ch] text-base leading-7 text-muted-foreground">
						Commonspace runs on the harnesses you already use. Two choices make
						the workspace ready—no separate model account or API key.
					</p>
				</header>

				<section aria-label="Required setup steps" className="border-y bg-card">
					<div className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 py-6">
						<div
							className="grid size-8 place-items-center rounded-full border text-sm font-semibold"
							aria-hidden="true"
						>
							{bootstrap.agents.length > 0 ? (
								<CheckIcon className="size-4" />
							) : (
								"1"
							)}
						</div>
						<div>
							<h2 className="text-base font-semibold">Add one agent</h2>
							<p className="mt-1 text-sm leading-6 text-muted-foreground">
								Choose an installed ACP harness. Its runtime keeps ownership of
								authentication, tools, models, and sessions.
							</p>
							{bootstrap.agents.length === 0 ? (
								<Button className="mt-4" onClick={onAddAgent}>
									Add an agent
								</Button>
							) : (
								<p className="mt-3 text-sm font-medium">{addedAgentsLabel}</p>
							)}
						</div>
					</div>

					<div className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-t py-6">
						<div
							className="grid size-8 place-items-center rounded-full border text-sm font-semibold"
							aria-hidden="true"
						>
							{submission.status === SettingsOperationStatus.Succeeded ? (
								<CheckIcon className="size-4" />
							) : (
								"2"
							)}
						</div>
						<div>
							<h2 className="text-base font-semibold">
								Choose the workspace inference agent
							</h2>
							<p className="mt-1 text-sm leading-6 text-muted-foreground">
								This agent routes unaddressed Channel messages and compacts
								shared context in the background.
							</p>
							{bootstrap.agents.length === 0 ? (
								<p className="mt-4 text-sm text-muted-foreground">
									Add an agent to unlock this step.
								</p>
							) : (
								<fieldset className="mt-4 grid overflow-hidden rounded-md border">
									<legend className="sr-only">Workspace inference agent</legend>
									{bootstrap.agents.map((agent, index) => (
										<label
											key={agent.id}
											className={`grid min-h-[62px] cursor-pointer grid-cols-[20px_36px_minmax(0,1fr)] items-center gap-3 px-3 py-2 ${index === 0 ? "" : "border-t"} ${selectedAgentId === agent.id ? "bg-muted/40" : ""}`}
										>
											<input
												type="radio"
												name="onboarding-inference-agent"
												value={agent.id}
												checked={selectedAgentId === agent.id}
												disabled={saving}
												onChange={() => selectInferenceAgent(agent.id)}
											/>
											<AgentAvatar agent={agent} />
											<span>
												<strong className="block text-sm">
													{agent.displayName}
												</strong>
												<small className="text-xs text-muted-foreground">
													{AGENT_ADAPTERS[agent.adapter].label} ·{" "}
													{agent.model ?? "harness default"}
												</small>
											</span>
										</label>
									))}
								</fieldset>
							)}
							{submission.status === SettingsOperationStatus.Failed ? (
								<p className="mt-3 text-sm text-destructive" role="alert">
									{submission.message}
								</p>
							) : null}
							<Button
								className="mt-4"
								disabled={selectedAgent === undefined || saving}
								onClick={() => void saveInferenceAgent()}
							>
								{saving ? submission.message : "Use selected agent"}
							</Button>
						</div>
					</div>
				</section>
			</div>
		</main>
	);
}

function WorkspaceConnection({
	error,
	onRetry,
}: {
	error: string | null;
	onRetry: () => void;
}) {
	const failed = error !== null;
	return (
		<main
			aria-label="Workspace connection"
			className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background p-8"
		>
			<Empty
				role={failed ? "alert" : "status"}
				className="max-w-md flex-none border border-solid bg-card px-8 py-10"
			>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						{failed ? (
							<UnplugIcon aria-hidden="true" />
						) : (
							<LoaderCircleIcon
								aria-hidden="true"
								className="motion-safe:animate-spin"
							/>
						)}
					</EmptyMedia>
					<EmptyTitle>
						<h1>{failed ? "Workspace unavailable" : "Opening workspace"}</h1>
					</EmptyTitle>
					<EmptyDescription>
						{failed
							? "Check that Commonspace is running, then try again."
							: "Loading your conversations, projects, and agents…"}
					</EmptyDescription>
				</EmptyHeader>
				{failed && (
					<>
						<p className="max-w-full rounded-sm bg-muted px-3 py-2 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
							{error}
						</p>
						<Button variant="outline" onClick={onRetry}>
							<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
							Try again
						</Button>
					</>
				)}
			</Empty>
		</main>
	);
}

export function CommonspaceWorkspace({
	navigation,
	projectFetcher,
	snapshot,
	store,
}: CommonspaceWorkspaceProps) {
	const {
		activeDestination,
		activeProjectViewId,
		clearSettingsRequest,
		clearTargetMessage,
		composerInsertRequest,
		directoryKind,
		inboxViewRequest,
		messageUrl,
		navigationToken,
		openContextSettings,
		openConversation,
		openInbox,
		openProject,
		openThread,
		openTarget,
		requestCreate,
		settingsRequest,
		targetMessageId,
		targetProjectFile,
	} = navigation;

	if (snapshot.bootstrap === null) {
		return (
			<WorkspaceConnection
				error={snapshot.loading ? null : snapshot.error}
				onRetry={() => {
					void store.refresh();
				}}
			/>
		);
	}
	const routing = snapshot.bootstrap.routing;
	const inferenceReady =
		routing?.provider === CommonspaceRoutingProvider.Harness &&
		snapshot.bootstrap.agents.some(
			(agent) => agent.id === routing?.harnessAgentId,
		);
	if (snapshot.bootstrap.agents.length === 0 || !inferenceReady) {
		return (
			<WorkspaceOnboarding
				bootstrap={snapshot.bootstrap}
				store={store}
				onAddAgent={() => navigation.requestCreate("agents")}
			/>
		);
	}

	if (activeProjectViewId !== null) {
		const projectSettingsRequest =
			settingsRequest?.kind === "project" &&
			settingsRequest.id === activeProjectViewId
				? settingsRequest.token
				: undefined;
		return (
			<CommonspaceProjectView
				projectId={activeProjectViewId}
				navigationToken={navigationToken}
				targetFile={targetProjectFile}
				store={store}
				{...(projectFetcher === undefined ? {} : { fetcher: projectFetcher })}
				{...(projectSettingsRequest === undefined
					? {}
					: { settingsRequest: projectSettingsRequest })}
				onBack={openInbox}
				onOpenConversation={openConversation}
			/>
		);
	}

	if (activeDestination === "directory") {
		return (
			<CommonspaceDirectory
				key={directoryKind}
				kind={directoryKind}
				bootstrap={snapshot.bootstrap}
				store={store}
				onAdd={requestCreate}
				onOpenProject={openProject}
				onOpenConversation={openConversation}
				onOpenSettings={openContextSettings}
				onOpenSessions={() => openInbox("sessions")}
			/>
		);
	}

	if (activeDestination === "inbox") {
		return (
			<CommonspaceInbox
				store={store}
				onOpenItem={openTarget}
				viewRequest={inboxViewRequest}
			/>
		);
	}

	if (activeDestination === "threads") {
		return (
			<CommonspaceThreads
				bootstrap={snapshot.bootstrap}
				store={store}
				onOpenThread={openTarget}
			/>
		);
	}

	if (activeDestination === "scheduled") {
		return (
			<CommonspaceScheduled bootstrap={snapshot.bootstrap} store={store} />
		);
	}

	const conversationSettingsRequest =
		settingsRequest?.kind === "channel" || settingsRequest?.kind === "agent"
			? {
					kind: settingsRequest.kind,
					id: settingsRequest.id,
					token: settingsRequest.token,
				}
			: null;
	return (
		<CommonspaceConversation
			store={store}
			composerInsertRequest={composerInsertRequest}
			messageUrl={messageUrl}
			onOpenSettings={() => {
				const conversation = snapshot.activeConversation;
				if (conversation === null) return;
				openContextSettings(
					conversation.kind === "channel" ? "channel" : "agent",
					conversation.id,
				);
			}}
			onSettingsClosed={clearSettingsRequest}
			settingsRequest={conversationSettingsRequest}
			onThreadChange={openThread}
			targetMessageId={targetMessageId}
			onTargetMessageHandled={clearTargetMessage}
		/>
	);
}
