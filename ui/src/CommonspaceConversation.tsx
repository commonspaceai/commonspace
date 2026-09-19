import {
	AGENT_ADAPTERS,
	type AgentAdapterKind,
	type CommonspaceAgentProfile,
	type CommonspaceBootstrap,
	type CommonspaceLiveAgentActivity,
	type CommonspaceMessage,
	type CommonspacePermissionRequest,
	type CommonspacePin,
	type CommonspaceThread,
	type ConversationRef,
	deriveCommonspaceInboxItems,
	deriveCommonspaceSessions,
	referencedProjectIds,
	type SendFileAttachment,
	type SendImageAttachment,
} from "@commonspace/shared";
import {
	ArrowUpIcon,
	MessageCircleReplyIcon,
	PaperclipIcon,
	SettingsIcon,
	XIcon,
} from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	Fragment,
	lazy,
	type ReactNode,
	type SetStateAction,
	Suspense,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { ChannelThreadFilter } from "@/design-system/ChannelThreadFilter";
import {
	MessageComposerActions,
	MessageComposerFrame,
	MessageComposerInput,
} from "@/design-system/MessageComposer";
import { RoutingReceipt } from "@/design-system/RoutingReceipt";
import {
	type PendingAdmissionItem,
	PendingAdmissions,
	QueuedFollowups,
	RunDeliveryControls,
} from "@/design-system/RunDelivery";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import { cn } from "@/lib/utils";
import { AgentTrace } from "./AgentTrace.tsx";

import {
	AgentSettingsPane,
	ChannelSettingsPane,
} from "./CommonspaceContextSettings.tsx";
import {
	type CommonspacePendingSubmission,
	type CommonspaceStore,
	CommonspaceSubmissionError,
} from "./commonspace-store.ts";
import { AgentAvatar } from "./design-system/AgentAvatar.tsx";
import { MessageActionMenu } from "./design-system/MessageActionMenu.tsx";
import { ResizablePanelHandle } from "./design-system/ResizablePanelHandle.tsx";
import {
	COMMONSPACE_RESIZABLE_PANEL,
	useResizablePanel,
} from "./design-system/useResizablePanel.ts";
import { useThreadOverlay } from "./design-system/useThreadOverlay";
import { LiveAgentActivity } from "./LiveAgentActivity.tsx";
import { RunAttribution } from "./RunAttribution.tsx";
import {
	resolveSlashCommand,
	slashCommandSuggestions,
} from "./slash-commands.ts";
import {
	insertTag,
	type TagSuggestion,
	tagReferenceParts,
	tagSuggestions,
} from "./tagging.ts";

type ChannelThreadView = "running" | "followed" | "all";

const LazyMessageMarkdown = lazy(async () => {
	const module = await import("./MessageMarkdown.tsx");
	return { default: module.MessageMarkdown };
});

const messageMarkdownFallback = (
	<p
		className="text-xs text-muted-foreground"
		role="status"
		aria-label="Formatting agent message"
	>
		Formatting message…
	</p>
);

function restoreText(current: string, restored: string): string {
	if (restored === "" || current === restored) return current;
	return current === "" ? restored : `${restored}\n\n${current}`;
}

function contextLines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function threadSubject(message: CommonspaceMessage | undefined): string {
	const subject = message?.text.normalize("NFKC").replace(/\s+/gu, " ").trim();
	return subject === undefined || subject === "" ? "Thread replies" : subject;
}

function threadContextStatusLabel(
	status: CommonspaceThread["context"]["memory"]["status"],
): string {
	switch (status) {
		case "current":
			return "Context ready";
		case "stale":
			return "Context needs refresh";
		case "compacting":
			return "Updating context";
		case "failed":
			return "Context update failed";
		case "empty":
			return "Context is building";
	}
}

function restoreImages(
	current: SendImageAttachment[],
	restored: SendImageAttachment[],
): SendImageAttachment[] {
	return [
		...restored,
		...current.filter(
			(candidate) =>
				!restored.some(
					(item) =>
						item.name === candidate.name &&
						item.mimeType === candidate.mimeType &&
						item.data === candidate.data,
				),
		),
	];
}

function restoreFiles(
	current: SendFileAttachment[],
	restored: SendFileAttachment[],
): SendFileAttachment[] {
	return [
		...restored,
		...current.filter(
			(candidate) =>
				!restored.some(
					(item) =>
						item.name === candidate.name &&
						item.mimeType === candidate.mimeType &&
						item.data === candidate.data,
				),
		),
	];
}

function pendingAdmissionItem(
	submission: CommonspacePendingSubmission,
): PendingAdmissionItem {
	const item: PendingAdmissionItem = {
		id: submission.id,
		text: submission.text,
		status: submission.status,
		attachmentCount: submission.attachments.length + submission.files.length,
	};
	if (submission.error !== undefined) item.error = submission.error;
	if (submission.delivery !== undefined) item.delivery = submission.delivery;
	return item;
}

async function stopAgentActivities(
	store: CommonspaceStore,
	activities: CommonspaceLiveAgentActivity[],
): Promise<Set<string>> {
	const stopped = new Set<string>();
	for (const activity of activities) {
		for (const agentId of await store.stopAgentRuns(
			activity.sourceMessageId,
			activity.agentId,
		))
			stopped.add(agentId);
	}
	return stopped;
}

const messageActionButtonClassName =
	"grid size-7 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

type FollowupDelivery = "queue" | "steer" | "stop-and-send";

function submittedFollowupDelivery(
	event: FormEvent<HTMLFormElement>,
): FollowupDelivery {
	const submitter =
		event.nativeEvent instanceof SubmitEvent
			? event.nativeEvent.submitter
			: null;
	if (submitter instanceof HTMLButtonElement) {
		const delivery = submitter.value;
		if (
			delivery === "queue" ||
			delivery === "steer" ||
			delivery === "stop-and-send"
		)
			return delivery;
	}
	return "queue";
}

export interface CommonspaceConversationProps {
	store: CommonspaceStore;
	targetMessageId?: string | null;
	onTargetMessageHandled?: () => void;
	settingsRequest?: {
		kind: "channel" | "agent";
		id: string;
		token: number;
	} | null;
	composerInsertRequest?: {
		text: string;
		token: number;
		threadId?: string;
	} | null;
	onOpenSettings?: () => void;
	onSettingsClosed?: () => void;
	onThreadChange?: (threadId: string | null) => void;
	messageUrl?: (target: {
		conversation: ConversationRef;
		threadId?: string;
		messageId: string;
	}) => string;
}

export function matchesContextSettingsRequest(
	settingsRequest: {
		kind: "channel" | "agent";
		id: string;
		token: number;
	} | null,
	conversation: ConversationRef | null,
): boolean {
	if (settingsRequest === null || conversation === null) return false;
	return settingsRequest.kind === "channel"
		? conversation.kind === "channel" && conversation.id === settingsRequest.id
		: conversation.kind === "dm" && conversation.id === settingsRequest.id;
}

interface CommandFeedback {
	tone: "info" | "success" | "error";
	title: string;
	body: string;
	action?: "reset-dm";
}

const MAX_PASTED_IMAGES = 4;
const MAX_PASTED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHED_FILES = 8;
const MAX_ATTACHED_FILE_BYTES = 8 * 1024 * 1024;
const PASTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

function isPastedImageType(
	value: string,
): value is SendImageAttachment["mimeType"] {
	return PASTED_IMAGE_TYPES.has(value);
}

function readPastedImage(file: File): Promise<SendImageAttachment> {
	const mimeType = file.type;
	if (!isPastedImageType(mimeType))
		return Promise.reject(
			new Error("Only PNG, JPEG, GIF, and WebP images can be pasted."),
		);
	if (file.size === 0 || file.size > MAX_PASTED_IMAGE_BYTES)
		return Promise.reject(new Error("Pasted images must be 8 MB or smaller."));
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => {
			reject(new Error("Could not read the pasted image."));
		};
		reader.onload = () => {
			const result = reader.result;
			const marker = ";base64,";
			const markerIndex =
				typeof result === "string" ? result.indexOf(marker) : -1;
			if (typeof result !== "string" || markerIndex < 0) {
				reject(new Error("Could not read the pasted image."));
				return;
			}
			resolve({
				name: file.name.trim() || "pasted-image.png",
				mimeType,
				data: result.slice(markerIndex + marker.length),
			});
		};
		reader.readAsDataURL(file);
	});
}

function readAttachedFile(file: File): Promise<SendFileAttachment> {
	if (file.size === 0 || file.size > MAX_ATTACHED_FILE_BYTES)
		return Promise.reject(new Error("Attached files must be 8 MB or smaller."));
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => {
			reject(new Error("Could not read the attached file."));
		};
		reader.onload = () => {
			const result = reader.result;
			const marker = ";base64,";
			const markerIndex =
				typeof result === "string" ? result.indexOf(marker) : -1;
			if (typeof result !== "string" || markerIndex < 0) {
				reject(new Error("Could not read the attached file."));
				return;
			}
			resolve({
				name: file.name.trim() || "attachment",
				mimeType: file.type.trim() || "application/octet-stream",
				data: result.slice(markerIndex + marker.length),
			});
		};
		reader.readAsDataURL(file);
	});
}

function blobBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(new Error("Could not read stored attachment."));
		reader.onload = () => {
			const result = reader.result;
			const marker = ";base64,";
			const markerIndex =
				typeof result === "string" ? result.indexOf(marker) : -1;
			if (typeof result !== "string" || markerIndex < 0) {
				reject(new Error("Could not read stored attachment."));
				return;
			}
			resolve(result.slice(markerIndex + marker.length));
		};
		reader.readAsDataURL(blob);
	});
}

async function replayAttachments(message: CommonspaceMessage): Promise<{
	images: SendImageAttachment[];
	files: SendFileAttachment[];
}> {
	const images = await Promise.all(
		(message.attachments ?? []).map(async (attachment) => {
			const response = await fetch(
				`/api/attachments/${encodeURIComponent(attachment.id)}`,
			);
			if (!response.ok) throw new Error(`Could not reload ${attachment.name}.`);
			return {
				name: attachment.name,
				mimeType: attachment.mimeType,
				data: await blobBase64(await response.blob()),
			};
		}),
	);
	const files = await Promise.all(
		(message.files ?? []).map(async (file) => {
			const response = await fetch(`/api/files/${encodeURIComponent(file.id)}`);
			if (!response.ok) throw new Error(`Could not reload ${file.name}.`);
			return {
				name: file.name,
				mimeType: file.mimeType,
				data: await blobBase64(await response.blob()),
			};
		}),
	);
	return { images, files };
}

function PendingImageStrip({
	images,
	onRemove,
}: {
	images: readonly SendImageAttachment[];
	onRemove: (index: number) => void;
}) {
	if (images.length === 0) return null;
	return (
		<section className="flex flex-wrap gap-2 py-2" aria-label="Attached images">
			{images.map((image, index) => (
				<figure
					key={`${image.name}-${String(index)}`}
					className="relative w-24"
				>
					<img
						className="h-16 w-24 rounded-sm border object-cover"
						src={`data:${image.mimeType};base64,${image.data}`}
						alt={`Pasted attachment ${image.name}`}
					/>
					<figcaption className="mt-1 truncate text-xs text-muted-foreground">
						{image.name}
					</figcaption>
					<button
						className="absolute -top-1 -right-1 grid size-7 place-items-center rounded-sm border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
						type="button"
						aria-label={`Remove ${image.name}`}
						onClick={() => {
							onRemove(index);
						}}
					>
						×
					</button>
				</figure>
			))}
		</section>
	);
}

function PendingFileStrip({
	files,
	onRemove,
}: {
	files: readonly SendFileAttachment[];
	onRemove: (index: number) => void;
}) {
	if (files.length === 0) return null;
	return (
		<section className="grid gap-1 py-2" aria-label="Attached files">
			{files.map((file, index) => (
				<span
					key={`${file.name}-${String(index)}`}
					className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center rounded-sm border bg-muted px-3"
				>
					<span className="min-w-0">
						<strong className="block truncate text-xs">{file.name}</strong>
						<small className="block truncate text-[10px] text-muted-foreground">
							{file.mimeType}
						</small>
					</span>
					<button
						className="grid size-8 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
						type="button"
						aria-label={`Remove ${file.name}`}
						onClick={() => {
							onRemove(index);
						}}
					>
						×
					</button>
				</span>
			))}
		</section>
	);
}

function runtimeLabel(adapter: AgentAdapterKind | undefined): string {
	return adapter === undefined ? "Agent" : AGENT_ADAPTERS[adapter].label;
}

function conversationTitle(
	store: CommonspaceStore,
	ref: ConversationRef | null,
): { title: string; subtitle: string } {
	const bootstrap = store.getSnapshot().bootstrap;
	if (ref === null || bootstrap === null)
		return { title: "Commonspace", subtitle: "Select a channel or agent" };
	if (ref.kind === "dm") {
		const agent = bootstrap.agents.find((candidate) => candidate.id === ref.id);
		const sessionContinuity =
			agent !== undefined && bootstrap.state.dmSessions[agent.id] !== undefined
				? "Session preserved"
				: "New session";
		return {
			title: agent?.displayName ?? ref.id,
			subtitle: `${runtimeLabel(agent?.adapter)} · ${agent?.model ?? "default model"} · ${sessionContinuity}`,
		};
	}
	const channel = bootstrap.state.channels.find(
		(candidate) => candidate.id === ref.id,
	);
	const members = (channel?.agentIds ?? []).map(
		(id) =>
			bootstrap.agents.find((agent) => agent.id === id)?.displayName ?? id,
	);
	const roster =
		members.length === 0
			? "No agents"
			: members.map((name) => `@${name}`).join(" ");
	return {
		title: channel?.name ?? "channel",
		subtitle: `Global Channel · ${roster}`,
	};
}

function renderMessageText(
	message: CommonspaceMessage,
	bootstrap?: CommonspaceBootstrap,
) {
	return tagReferenceParts(message.text, bootstrap).map((part, index) =>
		part.kind === "text" ? (
			<span key={`${message.id}-${String(index)}`}>{part.text}</span>
		) : (
			<mark
				key={`${message.id}-${String(index)}`}
				className="rounded-sm bg-muted px-1 font-semibold text-foreground"
			>
				{part.text}
			</mark>
		),
	);
}

function fileSizeLabel(size: number): string {
	if (size < 1_024) return `${String(size)} B`;
	if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
	return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function conversationDateLabel(
	messages: readonly CommonspaceMessage[],
): string | null {
	const timestamp = messages[0]?.createdAt;
	if (timestamp === undefined) return null;
	const date = new Date(timestamp);
	if (Number.isNaN(date.valueOf())) return null;
	const today = new Date();
	const prefix =
		date.toDateString() === today.toDateString()
			? "Today"
			: date.toLocaleDateString([], { month: "short", day: "numeric" });
	return `${prefix} · ${date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`;
}

function MessageRow({
	message,
	elementId,
	bootstrap,
	flush = false,
	quotedSource = false,
	replyLink,
	highlighted = false,
	onReplyToAgent,
	onPin,
	pinned = false,
	onEdit,
	onDelete,
	onOpenVersion,
	saved = false,
	onReplyInThread,
	onToggleSaved,
	onMarkUnread,
	onCopyLink,
	onRetryRouting,
}: {
	message: CommonspaceMessage;
	elementId?: string;
	bootstrap?: CommonspaceBootstrap | null;
	flush?: boolean;
	quotedSource?: boolean;
	replyLink?: ReactNode;
	highlighted?: boolean;
	onReplyToAgent?: (message: CommonspaceMessage) => void;
	onPin?: (message: CommonspaceMessage, attachmentId?: string) => Promise<void>;
	pinned?: boolean;
	onEdit?: (message: CommonspaceMessage, text: string) => Promise<void>;
	onDelete?: (message: CommonspaceMessage) => Promise<void>;
	onOpenVersion?: (messageId: string) => void;
	saved?: boolean;
	onReplyInThread?: () => void;
	onToggleSaved?: (
		message: CommonspaceMessage,
		saved: boolean,
	) => Promise<void>;
	onMarkUnread?: (message: CommonspaceMessage) => Promise<void>;
	onCopyLink?: (message: CommonspaceMessage) => void;
	onRetryRouting?: (
		message: CommonspaceMessage,
		choice: { mode: "ai" } | { mode: "manual"; agentId: string },
	) => Promise<void>;
}) {
	const supersedesMessageId = message.supersedesMessageId;
	const [editing, setEditing] = useState(false);
	const editInputRef = useRef<HTMLTextAreaElement>(null);
	const [editedText, setEditedText] = useState(message.text);
	const [savingEdit, setSavingEdit] = useState(false);
	const [pinning, setPinning] = useState(false);
	const [pinError, setPinError] = useState<string | null>(null);
	const pinMessage = async () => {
		if (onPin === undefined || pinning) return;
		setPinning(true);
		setPinError(null);
		try {
			await onPin(message);
		} catch (error) {
			setPinError(
				error instanceof Error ? error.message : "Could not update pin.",
			);
		} finally {
			setPinning(false);
		}
	};
	const submitEdit = async (event: FormEvent) => {
		event.preventDefault();
		if (onEdit === undefined || editedText.trim() === "" || savingEdit) return;
		setSavingEdit(true);
		try {
			await onEdit(message, editedText);
			setEditing(false);
		} finally {
			setSavingEdit(false);
		}
	};
	const messageAgent =
		message.authorType === "agent"
			? bootstrap?.agents.find((agent) => agent.id === message.authorId)
			: undefined;
	return (
		<article
			id={elementId}
			className={cn(
				"group/message relative mx-auto mb-0 grid w-full max-w-[920px] grid-cols-[32px_minmax(0,1fr)] gap-[11px] rounded-md px-1.5 py-2.5",
				flush && "px-0 py-2.5",
				quotedSource &&
					"max-w-none grid-cols-[24px_minmax(0,1fr)] gap-2.5 rounded-none border-y border-border/70 bg-muted/20 px-4 py-3",
				highlighted && "bg-muted/40",
			)}
			data-author={message.authorType}
			aria-current={highlighted ? "true" : undefined}
		>
			{pinError !== null && (
				<p role="alert" className="col-span-2 text-xs text-destructive">
					{pinError}
				</p>
			)}
			{message.authorType === "agent" ? (
				<AgentAvatar
					agent={messageAgent}
					fallbackName={message.authorName}
					size={quotedSource ? "sm" : "md"}
				/>
			) : (
				<div
					className={cn(
						"grid size-8 place-items-center rounded-[7px] bg-muted font-sans text-xs font-medium",
						quotedSource && "size-6 rounded-md text-[10px]",
						message.authorType === "system" && "bg-muted text-muted-foreground",
					)}
					aria-hidden="true"
				>
					{message.authorName.slice(0, 1).toUpperCase()}
				</div>
			)}
			<div className="min-w-0">
				<header
					className={cn(
						"flex min-h-[21px] flex-wrap items-center gap-2 text-sm [&>strong]:font-heading [&>strong]:font-semibold",
						quotedSource && "min-h-5 text-xs",
					)}
				>
					<strong>{message.authorName}</strong>
					<time className="whitespace-nowrap text-muted-foreground text-[11px]">
						{new Date(message.createdAt).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</time>
					<div className="ml-auto flex min-w-0 items-center gap-2">
						<RoutingReceipt
							quotedSource={quotedSource}
							message={message}
							bootstrap={bootstrap}
							{...(onRetryRouting === undefined ? {} : { onRetryRouting })}
						/>
						{message.authorType === "agent" && message.trace !== undefined && (
							<AgentTrace
								authorName={message.authorName}
								trace={message.trace}
							/>
						)}
						<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 has-[[aria-expanded=true]]:opacity-100">
							{message.authorType === "agent" &&
								onReplyToAgent !== undefined && (
									<button
										type="button"
										className={messageActionButtonClassName}
										aria-label={`Reply directly to ${message.authorName}`}
										title={`Reply directly to ${message.authorName}`}
										onClick={() => {
											onReplyToAgent(message);
										}}
									>
										<MessageCircleReplyIcon
											className="size-4"
											aria-hidden="true"
										/>
									</button>
								)}
							{(onPin !== undefined ||
								onEdit !== undefined ||
								onDelete !== undefined ||
								onToggleSaved !== undefined ||
								onCopyLink !== undefined) && (
								<MessageActionMenu
									finalFocus={() => editInputRef.current ?? true}
									authorName={message.authorName}
									summary={message.text}
									saved={saved}
									pinned={pinned}
									pinning={pinning}
									{...(onPin === undefined || message.deletedAt !== undefined
										? {}
										: {
												onPin: () => {
													void pinMessage();
												},
											})}
									{...(onReplyInThread === undefined
										? {}
										: { onReplyInThread })}
									{...(onToggleSaved === undefined
										? {}
										: {
												onToggleSaved: () => {
													void onToggleSaved(message, !saved);
												},
											})}
									{...(onMarkUnread === undefined
										? {}
										: {
												onMarkUnread: () => {
													void onMarkUnread(message);
												},
											})}
									{...(onCopyLink === undefined
										? {}
										: { onCopyLink: () => onCopyLink(message) })}
									{...(message.authorType !== "user" ||
									message.deletedAt !== undefined ||
									onEdit === undefined
										? {}
										: {
												onEdit: () => {
													setEditedText(message.text);
													setEditing(true);
												},
											})}
									{...(message.deletedAt !== undefined || onDelete === undefined
										? {}
										: {
												onDelete: () => {
													if (
														window.confirm(
															"Delete this delivered message content? The transcript marker and delivery history will remain.",
														)
													)
														void onDelete(message);
												},
											})}
								/>
							)}
						</div>
					</div>
				</header>
				{supersedesMessageId !== undefined && (
					<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
						<span>Edited branch</span>
						{onOpenVersion !== undefined && (
							<button
								type="button"
								aria-label="Open previous message version"
								onClick={() => {
									onOpenVersion(supersedesMessageId);
								}}
							>
								Previous version
							</button>
						)}
					</div>
				)}
				{message.deletedAt !== undefined ? (
					<p
						className="mt-2 rounded-sm border bg-muted p-2 text-xs text-muted-foreground"
						role="status"
					>
						Message deleted · content was delivered at{" "}
						{new Date(message.createdAt).toLocaleString()}
					</p>
				) : (
					message.text !== "" &&
					(message.authorType === "agent" ? (
						<Suspense fallback={messageMarkdownFallback}>
							<LazyMessageMarkdown text={message.text} />
						</Suspense>
					) : (
						<p
							className={cn(
								"mt-1 whitespace-pre-wrap text-sm leading-[1.65]",
								quotedSource &&
									"line-clamp-2 text-[13px] leading-5 text-muted-foreground",
							)}
							title={quotedSource ? message.text : undefined}
						>
							{renderMessageText(message, bootstrap ?? undefined)}
						</p>
					))
				)}
				{editing && (
					<form
						className="mt-3 grid gap-2 rounded-md border bg-muted p-3 [&_button]:min-h-9 [&_button]:rounded-sm [&_button]:border [&_button]:px-3 [&_label]:grid [&_label]:gap-1 [&_textarea]:min-h-24 [&_textarea]:rounded-sm [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"
						aria-label="Edit delivered message"
						onSubmit={(event) => {
							void submitEdit(event);
						}}
					>
						<label>
							Message
							<textarea
								ref={editInputRef}
								aria-label="Edited message"
								value={editedText}
								onChange={(event) => {
									setEditedText(event.target.value);
								}}
							/>
						</label>
						<div>
							<button
								type="submit"
								disabled={savingEdit || editedText.trim() === ""}
							>
								{savingEdit ? "Branching…" : "Create branch"}
							</button>
							<button
								type="button"
								onClick={() => {
									setEditing(false);
								}}
							>
								Cancel
							</button>
						</div>
					</form>
				)}
				<div className="mt-1 grid justify-items-start gap-0">{replyLink}</div>
				{message.attachments !== undefined &&
					message.attachments.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-2">
							{message.attachments.map((attachment) => (
								<figure
									key={attachment.id}
									className="relative overflow-hidden rounded-md border"
								>
									<img
										src={`/api/attachments/${encodeURIComponent(attachment.id)}`}
										alt={attachment.name}
										className="max-h-72 max-w-full object-contain"
										loading="lazy"
									/>
									{onPin !== undefined && (
										<button
											type="button"
											aria-label={`Pin attachment ${attachment.name}`}
											onClick={() => {
												void onPin(message, attachment.id);
											}}
										>
											Pin
										</button>
									)}
								</figure>
							))}
						</div>
					)}
				{message.files !== undefined && message.files.length > 0 && (
					<section className="mt-3 grid gap-1" aria-label="Message files">
						{message.files.map((file) => (
							<span
								key={file.id}
								className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center rounded-sm border bg-muted px-3 text-xs"
							>
								<a
									href={`/api/files/${encodeURIComponent(file.id)}`}
									download={file.name}
									aria-label={`Download ${file.name}`}
								>
									<strong>{file.name}</strong>
									<small>
										{file.mimeType} · {fileSizeLabel(file.size)}
									</small>
								</a>
								{onPin !== undefined && (
									<button
										type="button"
										aria-label={`Pin attachment ${file.name}`}
										onClick={() => {
											void onPin(message, file.id);
										}}
									>
										Pin
									</button>
								)}
							</span>
						))}
					</section>
				)}

				{message.authorType === "agent" &&
					message.projectId !== undefined &&
					message.runAttribution !== undefined && (
						<RunAttribution
							attribution={message.runAttribution}
							authorName={message.authorName}
							messageId={message.id}
							projectId={message.projectId}
						/>
					)}
			</div>
		</article>
	);
}

function suggestionLabel(suggestion: TagSuggestion): string {
	if (suggestion.kind === "agent") {
		const scope = suggestion.membershipScope ?? "channel";
		return `Agent · ${suggestion.label}${suggestion.channelMembership === "outside" ? ` · will be added to this ${scope}` : ""}`;
	}
	if (suggestion.kind === "project") return `Project · ${suggestion.label}`;
	return `Channel · ${suggestion.label}`;
}

interface SuggestionMenuProps {
	id: string;
	selectedSuggestion: number;
	slashSuggestions: ReturnType<typeof slashCommandSuggestions>;
	referenceSuggestions: TagSuggestion[];
	onSelectSlash: (name: string) => void;
	onSelectTag: (suggestion: TagSuggestion) => void;
}

function SuggestionMenu({
	id,
	selectedSuggestion,
	slashSuggestions,
	referenceSuggestions,
	onSelectSlash,
	onSelectTag,
}: SuggestionMenuProps) {
	return (
		<div
			id={id}
			className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
			role="listbox"
			aria-label={
				slashSuggestions.length > 0 ? "Slash commands" : "Tag suggestions"
			}
		>
			{slashSuggestions.map((command, index) => (
				<button
					key={command.id}
					id={`${id}-option-${String(index)}`}
					type="button"
					role="option"
					aria-selected={index === selectedSuggestion}
					className={cn(
						"grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm px-3 text-left text-xs hover:bg-muted",
						index === selectedSuggestion && "bg-muted",
					)}
					onMouseDown={(event) => {
						event.preventDefault();
						onSelectSlash(command.name);
					}}
				>
					<strong>{command.name}</strong>
					<span>{command.description}</span>
				</button>
			))}
			{referenceSuggestions.map((suggestion, index) => {
				const previousMembership =
					referenceSuggestions[index - 1]?.channelMembership;
				const showMembershipHeading =
					suggestion.channelMembership !== undefined &&
					suggestion.channelMembership !== previousMembership;
				const membershipScope = suggestion.membershipScope ?? "channel";
				return (
					<Fragment key={`${suggestion.kind}-${suggestion.id}`}>
						{showMembershipHeading && (
							<div
								className="border-t px-3 py-2 text-[10px] font-semibold tracking-[0.05em] text-muted-foreground uppercase"
								role="presentation"
							>
								{suggestion.channelMembership === "member"
									? `In this ${membershipScope}`
									: `Not in this ${membershipScope} · tagging adds them`}
							</div>
						)}
						<button
							id={`${id}-option-${String(index + slashSuggestions.length)}`}
							type="button"
							role="option"
							aria-selected={
								index + slashSuggestions.length === selectedSuggestion
							}
							className={cn(
								"grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm px-3 text-left text-xs hover:bg-muted",
								index + slashSuggestions.length === selectedSuggestion &&
									"bg-muted",
							)}
							onMouseDown={(event) => {
								event.preventDefault();
								onSelectTag(suggestion);
							}}
						>
							<strong>{suggestion.token}</strong>
							<span>{suggestionLabel(suggestion)}</span>
						</button>
					</Fragment>
				);
			})}
		</div>
	);
}

function liveActivitiesFor(
	activities: readonly CommonspaceLiveAgentActivity[] | undefined,
	conversation: ConversationRef | null,
	threadId: string | undefined,
): CommonspaceLiveAgentActivity[] {
	if (conversation === null) return [];
	return (activities ?? []).filter(
		(activity) =>
			activity.conversation.kind === conversation.kind &&
			activity.conversation.id === conversation.id &&
			activity.threadId === threadId,
	);
}

function ThreadAgentActivity({
	thread,
	agents,
	respondingAgentIds = thread.agentIds,
}: {
	thread: CommonspaceThread;
	agents: readonly CommonspaceAgentProfile[];
	respondingAgentIds?: readonly string[];
}) {
	return (
		<span className="inline-flex items-center pl-1">
			{respondingAgentIds.map((agentId, index) => {
				const agent = agents.find((candidate) => candidate.id === agentId);
				const name = agent?.displayName ?? agentId;
				return (
					<AgentAvatar
						key={agentId}
						agent={agent}
						fallbackName={name}
						size="stack"
						className="-ml-1 first:ml-0"
						data-runtime={agent?.adapter}
						ariaLabel={`${name} is responding`}
						style={{ zIndex: respondingAgentIds.length - index }}
					/>
				);
			})}
		</span>
	);
}

function ThreadReplyAgents({
	replies,
	agents,
}: {
	replies: readonly CommonspaceMessage[];
	agents: readonly CommonspaceAgentProfile[];
}) {
	const replyingAgents = [
		...new Map(
			replies
				.filter((reply) => reply.authorType === "agent")
				.map((reply) => [reply.authorId, reply] as const),
		).values(),
	];
	if (replyingAgents.length === 0) return null;
	return (
		<span className="inline-flex items-center pl-1">
			{replyingAgents.map((reply) => {
				const agent = agents.find(
					(candidate) => candidate.id === reply.authorId,
				);
				return (
					<AgentAvatar
						key={reply.authorId}
						agent={agent}
						fallbackName={reply.authorName}
						size="stack"
						className="-ml-1 first:ml-0"
						data-runtime={agent?.adapter}
						ariaLabel={`${reply.authorName} replied`}
					/>
				);
			})}
		</span>
	);
}

function PermissionRequests({
	permissions,
	agents,
	onRespond,
}: {
	permissions: readonly CommonspacePermissionRequest[];
	agents: readonly CommonspaceAgentProfile[];
	onRespond: (permissionId: string, optionId: string) => Promise<void>;
}) {
	return (
		<>
			{permissions.map((permission) => {
				const agentName =
					agents.find((agent) => agent.id === permission.agentId)
						?.displayName ?? permission.agentId;
				return (
					<section
						key={permission.id}
						className="mx-auto mb-3 w-[min(780px,calc(100%-48px))] rounded-md border border-[color-mix(in_oklch,var(--status-warning)_45%,var(--border))] bg-[color-mix(in_oklch,var(--status-warning)_7%,var(--background))] p-4"
						aria-label={`Permission request from ${agentName}`}
					>
						<header className="flex items-center justify-between gap-2 text-xs">
							<strong>{agentName} needs permission</strong>
							<span className="text-muted-foreground">
								{permission.kind ?? "native request"}
							</span>
						</header>
						<p className="mt-2 text-[13px]">{permission.title}</p>
						<div className="mt-3 flex flex-wrap gap-2">
							{permission.options.map((option) => (
								<button
									className="min-h-10 rounded-sm border bg-background px-3 text-xs font-semibold hover:bg-muted"
									key={option.optionId}
									type="button"
									data-kind={option.kind}
									onClick={() => {
										void onRespond(permission.id, option.optionId);
									}}
								>
									{option.name}
								</button>
							))}
						</div>
					</section>
				);
			})}
		</>
	);
}

export function CommonspaceConversation({
	store,
	targetMessageId = null,
	onTargetMessageHandled,
	settingsRequest = null,
	composerInsertRequest = null,
	onOpenSettings,
	onSettingsClosed,
	onThreadChange,
	messageUrl,
}: CommonspaceConversationProps) {
	const suggestionListId = useId();
	const threadSuggestionListId = useId();
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const selectThread = useCallback(
		(threadId: string | null) => {
			if (onThreadChange === undefined) store.selectThread(threadId);
			else onThreadChange(threadId);
		},
		[onThreadChange, store],
	);
	const activeFocusScopeKey =
		snapshot.activeConversation === null
			? null
			: `${snapshot.activeConversation.kind}:${snapshot.activeConversation.id}\u0000${snapshot.activeThreadId ?? ""}`;
	const [draft, setDraft] = useState("");
	const [threadDraft, setThreadDraft] = useState("");
	const [focusedComposer, setFocusedComposer] = useState<
		"channel" | "thread" | null
	>(null);
	const [pendingImages, setPendingImages] = useState<SendImageAttachment[]>([]);
	const [pendingThreadImages, setPendingThreadImages] = useState<
		SendImageAttachment[]
	>([]);
	const [pendingFiles, setPendingFiles] = useState<SendFileAttachment[]>([]);
	const [pendingThreadFiles, setPendingThreadFiles] = useState<
		SendFileAttachment[]
	>([]);

	const [threadReplyTarget, setThreadReplyTarget] = useState<{
		agentId: string;
		agentName: string;
	} | null>(null);
	const [threadContextOpen, setThreadContextOpen] = useState(false);
	const [threadContextSummary, setThreadContextSummary] = useState("");
	const [threadContextDecisions, setThreadContextDecisions] = useState("");
	const [threadContextQuestions, setThreadContextQuestions] = useState("");
	const [threadContextSaving, setThreadContextSaving] = useState(false);
	const [threadContextCompacting, setThreadContextCompacting] = useState(false);
	const [threadPinNote, setThreadPinNote] = useState("");
	const [channelThreadView, setChannelThreadView] =
		useState<ChannelThreadView>("all");
	const [selectedSuggestion, setSelectedSuggestion] = useState(0);
	const [selectedThreadSuggestion, setSelectedThreadSuggestion] = useState(0);
	const [commandFeedback, setCommandFeedback] =
		useState<CommandFeedback | null>(null);
	const [stoppingScope, setStoppingScope] = useState(false);
	const [focusedMessageId, setFocusedMessageId] = useState<string | null>(
		targetMessageId,
	);
	const [focusedRootMessageId, setFocusedRootMessageId] = useState<
		string | null
	>(targetMessageId ?? null);
	const previousFocusScopeKey = useRef(activeFocusScopeKey);
	const [contextSettingsOpen, setContextSettingsOpen] = useState(false);
	const conversationLayout = useRef<HTMLDivElement>(null);
	const {
		width: panelWidth,
		resizing: resizingPanel,
		setWidth: setPanelWidth,
		startResizing: startPanelResize,
		resetWidth: resetPanelWidth,
	} = useResizablePanel(conversationLayout, COMMONSPACE_RESIZABLE_PANEL);
	const bottom = useRef<HTMLDivElement>(null);
	const threadMessages = useRef<HTMLDivElement>(null);
	const composer = useRef<HTMLTextAreaElement>(null);
	const threadComposer = useRef<HTMLTextAreaElement>(null);
	const threadPanel = useRef<HTMLElement>(null);
	const threadOverlay = useThreadOverlay(
		conversationLayout,
		snapshot.activeConversation !== null,
	);
	const closeThread = () => {
		selectThread(null);
	};
	const previousThreadId = useRef(snapshot.activeThreadId);
	useEffect(() => {
		if (previousThreadId.current !== null && snapshot.activeThreadId === null)
			composer.current?.focus();
		previousThreadId.current = snapshot.activeThreadId;
	}, [snapshot.activeThreadId]);
	const rootInputOccupied = useRef(false);
	const threadInputOccupied = useRef(false);
	rootInputOccupied.current =
		draft !== "" || pendingImages.length > 0 || pendingFiles.length > 0;
	threadInputOccupied.current =
		threadDraft !== "" ||
		pendingThreadImages.length > 0 ||
		pendingThreadFiles.length > 0;
	const handledComposerInsertToken = useRef<number | null>(null);
	const suppressThreadAutoScroll = useRef(false);
	const bootstrap = snapshot.bootstrap;
	const messages = store.messages();
	const conversationPendingSubmissions = snapshot.pendingSubmissions.filter(
		(submission) =>
			snapshot.activeConversation !== null &&
			submission.conversation.kind === snapshot.activeConversation.kind &&
			submission.conversation.id === snapshot.activeConversation.id,
	);
	const unreadMessageIds = new Set(
		bootstrap === null
			? []
			: [
					...deriveCommonspaceInboxItems(bootstrap.state)
						.filter((item) => item.unread)
						.map((item) => item.messageId),
					...(bootstrap.state.inboxUnreadMessageIds ?? []),
				],
	);
	const savedMessageIds = new Set(bootstrap?.state.inboxSavedItemIds ?? []);
	const heading = conversationTitle(store, snapshot.activeConversation);
	const isChannel = snapshot.activeConversation?.kind === "channel";
	const activeChannel =
		isChannel && bootstrap !== null
			? bootstrap.state.channels.find(
					(channel) => channel.id === snapshot.activeConversation?.id,
				)
			: undefined;
	const slashSuggestions =
		snapshot.activeConversation === null ||
		pendingImages.length > 0 ||
		pendingFiles.length > 0
			? []
			: slashCommandSuggestions(draft, snapshot.activeConversation.kind);
	const resolvedDraftCommand =
		snapshot.activeConversation === null ||
		pendingImages.length > 0 ||
		pendingFiles.length > 0
			? null
			: resolveSlashCommand(draft, snapshot.activeConversation.kind);
	const referenceSuggestions =
		bootstrap === null || draft.startsWith("/")
			? []
			: tagSuggestions(draft, bootstrap, activeChannel?.agentIds);
	const suggestionCount = slashSuggestions.length + referenceSuggestions.length;
	const activeSuggestionId =
		suggestionCount > 0
			? `${suggestionListId}-option-${String(selectedSuggestion)}`
			: undefined;
	const channelThreads =
		isChannel && bootstrap !== null
			? bootstrap.state.threads.filter(
					(thread) => thread.channelId === snapshot.activeConversation?.id,
				)
			: [];
	const activeThread = channelThreads.find(
		(thread) => thread.id === snapshot.activeThreadId,
	);
	useEffect(() => {
		if (threadOverlay && snapshot.activeThreadId !== null) {
			threadPanel.current
				?.querySelector<HTMLButtonElement>('button[aria-label="Close thread"]')
				?.focus();
		}
	}, [threadOverlay, snapshot.activeThreadId]);
	const activeThreadProject =
		activeThread === undefined || bootstrap === null
			? undefined
			: bootstrap.state.projects.find(
					(project) => project.id === activeThread.projectId,
				);
	const sessions = useMemo(
		() =>
			bootstrap === null
				? []
				: deriveCommonspaceSessions(
						bootstrap.state,
						bootstrap.liveActivities ?? [],
					),
		[bootstrap],
	);
	const activeThreadSessions = useMemo(
		() =>
			activeThread === undefined
				? []
				: sessions.filter((session) => session.threadId === activeThread.id),
		[activeThread, sessions],
	);
	const threadFollowing = activeThreadSessions.some(
		(session) => session.followed,
	);
	const activeThreadAgentIds = [
		...new Set(
			activeThreadSessions.length > 0
				? activeThreadSessions.map((session) => session.agentId)
				: (activeThread?.agentIds ?? []),
		),
	];
	const activeThreadAgentNames = activeThreadAgentIds.map(
		(agentId) =>
			bootstrap?.agents.find((agent) => agent.id === agentId)?.displayName ??
			agentId,
	);
	const activeThreadSessionState = activeThreadSessions.some(
		(session) => session.status === "running",
	)
		? "Session active"
		: activeThreadSessions.some(
					(session) => session.status === "needs-attention",
				)
			? "Session needs attention"
			: activeThreadSessions.length > 0
				? "Session preserved"
				: "Session pending";
	const activeThreadSessionLabel =
		activeThreadAgentNames.length === 0
			? activeThreadSessionState
			: `${activeThreadAgentNames.join(", ")} · ${activeThreadSessionState}`;
	const activeThreadContextLabel =
		activeThread === undefined
			? "Context unavailable"
			: threadContextStatusLabel(activeThread.context.memory.status);

	const threadSlashSuggestions =
		activeThread === undefined ||
		pendingThreadImages.length > 0 ||
		pendingThreadFiles.length > 0
			? []
			: slashCommandSuggestions(threadDraft, "channel");
	const resolvedThreadCommand =
		activeThread === undefined ||
		pendingThreadImages.length > 0 ||
		pendingThreadFiles.length > 0
			? null
			: resolveSlashCommand(threadDraft, "channel");
	const threadReferenceSuggestions =
		activeThread === undefined ||
		bootstrap === null ||
		threadDraft.startsWith("/")
			? []
			: tagSuggestions(threadDraft, bootstrap, activeThread.agentIds, "thread");
	const threadSuggestionCount =
		threadSlashSuggestions.length + threadReferenceSuggestions.length;
	const activeThreadSuggestionId =
		threadSuggestionCount > 0
			? `${threadSuggestionListId}-option-${String(selectedThreadSuggestion)}`
			: undefined;
	const roots = isChannel
		? messages.filter(
				(message) =>
					message.authorType === "user" &&
					message.parentMessageId === undefined,
			)
		: messages;
	const channelThreadByRoot = new Map(
		channelThreads.map((thread) => [thread.rootMessageId, thread]),
	);
	const runningThreadIds = new Set(
		sessions
			.filter((session) => session.status === "running")
			.flatMap((session) =>
				session.threadId === undefined ? [] : [session.threadId],
			),
	);
	const followedThreadIds = new Set(
		sessions
			.filter((session) => session.followed)
			.flatMap((session) =>
				session.threadId === undefined ? [] : [session.threadId],
			),
	);
	const rootsForChannelThreadView = roots.filter((root) => {
		if (!isChannel || channelThreadView === "all") return true;
		const threadId = channelThreadByRoot.get(root.id)?.id;
		if (threadId === undefined) return false;
		return channelThreadView === "running"
			? runningThreadIds.has(threadId)
			: followedThreadIds.has(threadId);
	});
	const runningThreadCount = channelThreads.filter((thread) =>
		runningThreadIds.has(thread.id),
	).length;
	const followedThreadCount = channelThreads.filter((thread) =>
		followedThreadIds.has(thread.id),
	).length;
	const conversationUnreadMessages = messages.filter((message) =>
		unreadMessageIds.has(message.id),
	);
	const firstUnreadRootId = isChannel
		? roots.find(
				(root) =>
					unreadMessageIds.has(root.id) ||
					messages.some(
						(message) =>
							message.parentMessageId === root.id &&
							unreadMessageIds.has(message.id),
					),
			)?.id
		: undefined;
	const pendingDirectMessage = isChannel
		? undefined
		: messages.findLast(
				(message) =>
					message.authorType === "user" &&
					(message.replyStatus === "queued" ||
						message.replyStatus === "running"),
			);
	const directMessagePhase =
		pendingDirectMessage?.replyStatus === "queued" ||
		pendingDirectMessage?.replyStatus === "running"
			? pendingDirectMessage.replyStatus
			: null;
	const directMessageActivities = liveActivitiesFor(
		bootstrap?.liveActivities,
		snapshot.activeConversation,
		undefined,
	);
	const directMessageFollowups =
		snapshot.activeConversation?.kind === "dm"
			? (bootstrap?.queuedFollowups ?? []).filter(
					(item) =>
						item.conversation.kind === "dm" &&
						item.conversation.id === snapshot.activeConversation?.id,
				)
			: [];
	const rootPendingSubmissions = conversationPendingSubmissions.filter(
		(submission) => submission.threadId === undefined,
	);
	const directMessagePermissions =
		snapshot.activeConversation?.kind === "dm"
			? (bootstrap?.state.permissions ?? []).filter(
					(permission) =>
						permission.status === "pending" &&
						permission.conversation.kind === "dm" &&
						permission.conversation.id === snapshot.activeConversation?.id,
				)
			: [];
	const directMessageAgents =
		snapshot.activeConversation?.kind === "dm" && bootstrap !== null
			? bootstrap.agents.filter(
					(agent) => agent.id === snapshot.activeConversation?.id,
				)
			: [];
	const activeRoot =
		activeThread === undefined
			? undefined
			: messages.find((message) => message.id === activeThread.rootMessageId);
	const replies =
		activeThread === undefined
			? []
			: messages.filter(
					(message) =>
						message.threadId === activeThread.id &&
						message.parentMessageId === activeThread.rootMessageId,
				);
	const activeThreadActivities = liveActivitiesFor(
		bootstrap?.liveActivities,
		snapshot.activeConversation,
		activeThread?.id,
	);
	const activeThreadFollowups =
		activeThread === undefined
			? []
			: (bootstrap?.queuedFollowups ?? []).filter(
					(item) => item.threadId === activeThread.id,
				);
	const activeThreadPendingSubmissions =
		activeThread === undefined
			? []
			: conversationPendingSubmissions.filter(
					(submission) => submission.threadId === activeThread.id,
				);
	const activeThreadPermissions =
		activeThread === undefined
			? []
			: (bootstrap?.state.permissions ?? []).filter(
					(permission) =>
						permission.status === "pending" &&
						permission.threadId === activeThread.id,
				);
	const activeThreadPins =
		activeThread === undefined || bootstrap === null
			? []
			: (bootstrap.state.pins ?? []).filter(
					(pin) =>
						pin.removedAt === null &&
						((pin.scope.kind === "thread" &&
							pin.scope.id === activeThread.id) ||
							(pin.scope.kind === "channel" &&
								pin.scope.id === activeThread.channelId)),
				);
	const threadContextDirty =
		activeThread !== undefined &&
		(threadContextSummary !== activeThread.context.memory.summary ||
			contextLines(threadContextDecisions).join("\n") !==
				activeThread.context.memory.decisions.join("\n") ||
			contextLines(threadContextQuestions).join("\n") !==
				activeThread.context.memory.openQuestions.join("\n"));
	const rootComposerHasContent =
		draft !== "" || pendingImages.length > 0 || pendingFiles.length > 0;
	const threadComposerHasContent =
		threadDraft !== "" ||
		pendingThreadImages.length > 0 ||
		pendingThreadFiles.length > 0;
	const rootComposerEmphasized =
		focusedComposer === "channel" ||
		(focusedComposer === null && rootComposerHasContent);
	const threadComposerEmphasized =
		focusedComposer === "thread" ||
		(focusedComposer === null && threadComposerHasContent);
	const rootComposerReceded =
		activeThread !== undefined &&
		!rootComposerHasContent &&
		(focusedComposer === "thread" ||
			(focusedComposer === null && threadComposerHasContent));
	const threadComposerReceded =
		!threadComposerHasContent &&
		(focusedComposer === "channel" ||
			(focusedComposer === null && rootComposerHasContent));
	const rootIsCommand =
		pendingImages.length === 0 &&
		pendingFiles.length === 0 &&
		draft.startsWith("/");
	const threadIsCommand =
		pendingThreadImages.length === 0 &&
		pendingThreadFiles.length === 0 &&
		threadDraft.startsWith("/");

	const scrollThreadToBottom = useCallback(() => {
		const messagesViewport = threadMessages.current;
		if (messagesViewport === null) return;
		const bottomOffset = messagesViewport.scrollHeight;
		messagesViewport.scrollTop = bottomOffset;
		messagesViewport.scrollTo?.({ top: bottomOffset, behavior: "auto" });
	}, []);

	useEffect(() => {
		void messages.length;
		void snapshot.sending;
		void directMessagePhase;
		bottom.current?.scrollIntoView({ block: "end" });
	}, [messages.length, snapshot.sending, directMessagePhase]);
	useEffect(() => {
		void snapshot.activeThreadId;
		if (targetMessageId == null) return;
		const targetMessage = messages.find(
			(message) => message.id === targetMessageId,
		);
		setFocusedMessageId(targetMessageId);
		setFocusedRootMessageId(targetMessage?.parentMessageId ?? targetMessageId);
		const target = document.getElementById(
			`commonspace-message-${targetMessageId}`,
		);
		if (target === null) return;
		suppressThreadAutoScroll.current = true;
		target.scrollIntoView({ block: "center", behavior: "smooth" });
		onTargetMessageHandled?.();
	}, [
		messages,
		onTargetMessageHandled,
		snapshot.activeThreadId,
		targetMessageId,
	]);
	useEffect(() => {
		composer.current?.focus();
		setCommandFeedback(null);
		setPendingImages([]);
		setPendingFiles([]);
		if (
			!matchesContextSettingsRequest(
				settingsRequest,
				snapshot.activeConversation,
			)
		) {
			setContextSettingsOpen(false);
		}
	}, [settingsRequest, snapshot.activeConversation]);
	useEffect(() => {
		const previous = previousFocusScopeKey.current;
		previousFocusScopeKey.current = activeFocusScopeKey;
		if (
			targetMessageId !== null ||
			previous === null ||
			activeFocusScopeKey === null ||
			previous === activeFocusScopeKey
		)
			return;
		setFocusedMessageId(null);
		setFocusedRootMessageId(null);
	}, [activeFocusScopeKey, targetMessageId]);
	useEffect(() => {
		if (
			!matchesContextSettingsRequest(
				settingsRequest,
				snapshot.activeConversation,
			)
		)
			return;
		if (snapshot.activeThreadId !== null) selectThread(null);
		setContextSettingsOpen(true);
	}, [
		settingsRequest,
		selectThread,
		snapshot.activeConversation,
		snapshot.activeThreadId,
	]);
	useEffect(() => {
		if (activeThread !== undefined) setContextSettingsOpen(false);
	}, [activeThread]);
	useEffect(() => {
		void snapshot.activeConversation?.id;
		void snapshot.activeConversation?.kind;
		void snapshot.activeThreadId;
		setThreadReplyTarget(null);
		setThreadDraft("");
		setPendingThreadImages([]);
		setPendingThreadFiles([]);
		setThreadContextOpen(false);
		setThreadPinNote("");
	}, [
		snapshot.activeConversation?.id,
		snapshot.activeConversation?.kind,
		snapshot.activeThreadId,
	]);
	useEffect(() => {
		if (
			composerInsertRequest === null ||
			!isChannel ||
			handledComposerInsertToken.current === composerInsertRequest.token ||
			(composerInsertRequest.threadId !== undefined &&
				composerInsertRequest.threadId !== snapshot.activeThreadId)
		)
			return;
		handledComposerInsertToken.current = composerInsertRequest.token;
		const insert = (current: string) =>
			`${current}${current !== "" && !/\s$/u.test(current) ? " " : ""}${composerInsertRequest.text}`;
		if (composerInsertRequest.threadId !== undefined) {
			setThreadDraft(insert);
			threadComposer.current?.focus();
		} else {
			setDraft(insert);
			composer.current?.focus();
		}
	}, [composerInsertRequest, isChannel, snapshot.activeThreadId]);
	useEffect(() => {
		const memory = activeThread?.context?.memory;
		if (memory === undefined) return;
		setThreadContextSummary(memory.summary);
		setThreadContextDecisions(memory.decisions.join("\n"));
		setThreadContextQuestions(memory.openQuestions.join("\n"));
	}, [activeThread?.context?.memory]);
	useEffect(() => {
		void replies.length;
		if (snapshot.activeThreadId === null) return;
		if (suppressThreadAutoScroll.current) {
			suppressThreadAutoScroll.current = false;
			return;
		}
		scrollThreadToBottom();
	}, [replies.length, snapshot.activeThreadId, scrollThreadToBottom]);
	const attachPastedImages = async (
		files: readonly File[],
		setImages: Dispatch<SetStateAction<SendImageAttachment[]>>,
	) => {
		try {
			const images = await Promise.all(
				files.slice(0, MAX_PASTED_IMAGES).map(readPastedImage),
			);
			setImages((current) =>
				[...current, ...images].slice(0, MAX_PASTED_IMAGES),
			);
			setCommandFeedback(null);
		} catch (error) {
			setCommandFeedback({
				tone: "error",
				title: "Could not attach image",
				body: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const attachFiles = async (
		files: readonly File[],
		setFiles: Dispatch<SetStateAction<SendFileAttachment[]>>,
	) => {
		try {
			const attached = await Promise.all(
				files.slice(0, MAX_ATTACHED_FILES).map(readAttachedFile),
			);
			setFiles((current) =>
				[...current, ...attached].slice(0, MAX_ATTACHED_FILES),
			);
			setCommandFeedback(null);
		} catch (error) {
			setCommandFeedback({
				tone: "error",
				title: "Could not attach file",
				body: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const selectSuggestion = (suggestion: TagSuggestion) => {
		setDraft((current) => insertTag(current, suggestion.token));
		setSelectedSuggestion(0);
	};

	const selectSlashSuggestion = (name: string) => {
		setDraft(name);
		setSelectedSuggestion(0);
	};

	const selectThreadSuggestion = (suggestion: TagSuggestion) => {
		setThreadDraft((current) => insertTag(current, suggestion.token));
		setSelectedThreadSuggestion(0);
	};

	const selectThreadSlashSuggestion = (name: string) => {
		setThreadDraft(name);
		setSelectedThreadSuggestion(0);
	};

	const resetDirectMessage = async () => {
		const conversation = snapshot.activeConversation;
		if (conversation?.kind !== "dm") return;
		setCommandFeedback({
			tone: "info",
			title: "Starting a new chat…",
			body: "Clearing this transcript and rotating the agent session.",
		});
		try {
			await store.mutate({ action: "reset-dm", agentId: conversation.id });
			setCommandFeedback({
				tone: "success",
				title: "New chat started",
				body: "Earlier messages remain visible, and your next message starts with fresh agent context.",
			});
			composer.current?.focus();
		} catch (error) {
			setCommandFeedback({
				tone: "error",
				title: "Could not start a new chat",
				body: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const executeSlashCommand = async (text: string, threadId?: string) => {
		const conversation = snapshot.activeConversation;
		if (conversation === null || bootstrap === null) return;
		const resolved = resolveSlashCommand(text, conversation.kind);
		if (resolved === null) {
			const token = text.split(/\s+/, 1)[0] ?? text;
			setCommandFeedback({
				tone: "error",
				title: "Unknown command",
				body: `${token} is not available here. Type /help to see Commonspace commands.`,
			});
			return;
		}

		if (resolved.command.id === "help") {
			const commands = slashCommandSuggestions("/", conversation.kind);
			setCommandFeedback({
				tone: "info",
				title: "Commonspace commands",
				body: commands
					.map((command) => `${command.name} — ${command.description}`)
					.join("\n"),
			});
			return;
		}

		if (resolved.command.id === "stop") {
			const matchingActivities = (bootstrap.liveActivities ?? []).filter(
				(activity) =>
					activity.conversation.kind === conversation.kind &&
					activity.conversation.id === conversation.id &&
					activity.threadId === threadId,
			);
			const targetMessageId =
				matchingActivities.at(-1)?.sourceMessageId ??
				[...messages]
					.reverse()
					.find(
						(message) =>
							message.authorType === "user" &&
							(threadId === undefined
								? conversation.kind === "dm" ||
									message.parentMessageId === undefined
								: message.threadId === threadId),
					)?.id;
			if (targetMessageId === undefined) {
				setCommandFeedback({
					tone: "info",
					title: "Nothing to stop",
					body: "No agent is currently working in this conversation.",
				});
				return;
			}
			try {
				const stopped = await store.stopAgentRuns(targetMessageId);
				setCommandFeedback(
					stopped.length === 0
						? {
								tone: "info",
								title: "Nothing to stop",
								body: "That agent work has already finished.",
							}
						: {
								tone: "success",
								title: "Agent work stopped",
								body: `Stopped ${stopped.length === 1 ? stopped[0] : `${String(stopped.length)} agents`}.`,
							},
				);
			} catch (error) {
				setCommandFeedback({
					tone: "error",
					title: "Could not stop agent work",
					body: error instanceof Error ? error.message : String(error),
				});
			}
			return;
		}

		if (resolved.command.id === "status") {
			if (conversation.kind === "dm") {
				const agent = bootstrap.agents.find(
					(candidate) => candidate.id === conversation.id,
				);
				const project = bootstrap.state.projects.find(
					(candidate) => candidate.id === snapshot.activeProjectId,
				);
				setCommandFeedback({
					tone: "info",
					title: "Direct-message status",
					body: `${agent?.displayName ?? conversation.id} · ${runtimeLabel(agent?.adapter)} · ${agent?.model ?? "default model"} · ${agent?.status ?? "unknown"}${project === undefined ? "" : `\nProject context: ${project.name}`}`,
				});
			} else {
				const channel = bootstrap.state.channels.find(
					(candidate) => candidate.id === conversation.id,
				);
				const project = bootstrap.state.projects.find(
					(candidate) => candidate.id === snapshot.activeProjectId,
				);
				setCommandFeedback({
					tone: "info",
					title: "Channel status",
					body: `${heading.title} · Global Channel · ${String(channel?.agentIds.length ?? 0)} ${(channel?.agentIds.length ?? 0) === 1 ? "agent" : "agents"}${project === undefined ? "" : `\nNext thread project context: ${project.name}`}\nWorkspace model: ${bootstrap.state.defaults.model ?? "agent defaults"} · Workspace reasoning: ${bootstrap.state.defaults.reasoning}`,
				});
			}
			return;
		}

		if (resolved.command.id === "agents") {
			setCommandFeedback({
				tone: "info",
				title: "Available agents",
				body:
					bootstrap.agents.length === 0
						? "No agents are configured."
						: bootstrap.agents
								.map(
									(agent) =>
										`${agent.displayName} · ${runtimeLabel(agent.adapter)} · ${agent.model ?? "default model"}`,
								)
								.join("\n"),
			});
			return;
		}

		if (resolved.command.id === "retry") {
			const previous = [...messages]
				.reverse()
				.find(
					(message) =>
						message.authorType === "user" &&
						(threadId === undefined
							? conversation.kind === "dm" ||
								message.parentMessageId === undefined
							: message.threadId === threadId),
				);
			if (previous === undefined) {
				setCommandFeedback({
					tone: "error",
					title: "Nothing to retry",
					body: "Send a message first, then use /retry.",
				});
				return;
			}
			setCommandFeedback({
				tone: "info",
				title: "Retrying message",
				body: previous.text,
			});
			try {
				const replay = await replayAttachments(previous);
				const projectIds = referencedProjectIds(previous);
				if (replay.images.length === 0 && replay.files.length === 0) {
					if (threadId === undefined)
						await store.send(
							previous.text,
							undefined,
							[],
							undefined,
							projectIds,
						);
					else if (projectIds.length === 0)
						await store.send(previous.text, threadId);
					else
						await store.send(
							previous.text,
							threadId,
							[],
							undefined,
							projectIds,
						);
				} else {
					await store.send(
						previous.text,
						threadId,
						replay.images,
						undefined,
						projectIds,
						replay.files,
					);
				}
			} catch (error) {
				setCommandFeedback({
					tone: "error",
					title: "Retry failed",
					body: error instanceof Error ? error.message : String(error),
				});
			}
			return;
		}

		const skipConfirmation = ["now", "--yes", "-y"].includes(
			resolved.args.toLocaleLowerCase(),
		);
		if (skipConfirmation) {
			await resetDirectMessage();
		} else {
			setCommandFeedback({
				tone: "info",
				title: "Start a new chat?",
				body: "This keeps earlier messages visible and starts a fresh native session for this agent.",
				action: "reset-dm",
			});
		}
	};

	const stopActivity = async (activity: CommonspaceLiveAgentActivity) => {
		try {
			const stopped = await store.stopAgentRuns(
				activity.sourceMessageId,
				activity.agentId,
			);
			setCommandFeedback(
				stopped.length === 0
					? {
							tone: "info",
							title: "Nothing to stop",
							body: `${activity.agentName} has already finished.`,
						}
					: {
							tone: "success",
							title: `${activity.agentName} stopped`,
							body: "No further work from this run will be posted.",
						},
			);
		} catch (error) {
			setCommandFeedback({
				tone: "error",
				title: `Could not stop ${activity.agentName}`,
				body: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const stopActivities = async (activities: CommonspaceLiveAgentActivity[]) => {
		if (activities.length === 0 || stoppingScope) return;
		setStoppingScope(true);
		try {
			const stopped = await stopAgentActivities(store, activities);
			setCommandFeedback({
				tone: stopped.size === 0 ? "info" : "success",
				title: stopped.size === 0 ? "Nothing to stop" : "Run stopped",
				body:
					stopped.size === 0
						? "The active run has already finished."
						: "Queued follow-ups are preserved and will run next.",
			});
		} catch (error) {
			setCommandFeedback({
				tone: "error",
				title: "Could not stop the run",
				body: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setStoppingScope(false);
		}
	};

	const restorePendingSubmission = (
		submission: CommonspacePendingSubmission,
	) => {
		const thread = submission.threadId !== undefined;
		if (thread) {
			setThreadDraft((current) => restoreText(current, submission.text));
			setPendingThreadImages((current) =>
				restoreImages(current, submission.attachments),
			);
			setPendingThreadFiles((current) =>
				restoreFiles(current, submission.files),
			);
			if (submission.targetAgentId !== undefined) {
				const agent = bootstrap?.agents.find(
					(candidate) => candidate.id === submission.targetAgentId,
				);
				setThreadReplyTarget({
					agentId: submission.targetAgentId,
					agentName: agent?.displayName ?? submission.targetAgentId,
				});
			}
			threadComposer.current?.focus();
		} else {
			setDraft((current) => restoreText(current, submission.text));
			setPendingImages((current) =>
				restoreImages(current, submission.attachments),
			);
			setPendingFiles((current) => restoreFiles(current, submission.files));
			composer.current?.focus();
		}
		store.dismissPendingSubmission(submission.id);
	};

	const sendRoot = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = draft.trim();
		if (text === "" && pendingImages.length === 0 && pendingFiles.length === 0)
			return;
		const attachments = pendingImages;
		const files = pendingFiles;
		const delivery =
			directMessageActivities.length > 0 && !isChannel
				? submittedFollowupDelivery(event)
				: undefined;
		setDraft("");
		if (rootIsCommand) {
			await executeSlashCommand(text);
			return;
		}
		setPendingImages([]);
		setPendingFiles([]);
		setCommandFeedback(null);
		try {
			if (files.length > 0)
				await store.send(
					text,
					undefined,
					attachments,
					delivery,
					undefined,
					files,
				);
			else if (delivery !== undefined)
				await store.send(text, undefined, attachments, delivery);
			else if (attachments.length > 0)
				await store.send(text, undefined, attachments);
			else await store.send(text);
		} catch (error) {
			if (!rootInputOccupied.current) {
				setDraft(text);
				setPendingImages(attachments);
				setPendingFiles(files);
				if (error instanceof CommonspaceSubmissionError)
					store.dismissPendingSubmission(error.submissionId);
			}
		}
	};

	const sendThreadReply = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = threadDraft.trim();
		if (
			(text === "" &&
				pendingThreadImages.length === 0 &&
				pendingThreadFiles.length === 0) ||
			activeThread === undefined
		)
			return;
		const attachments = pendingThreadImages;
		const files = pendingThreadFiles;
		const delivery =
			activeThreadActivities.length > 0 && threadReplyTarget === null
				? submittedFollowupDelivery(event)
				: undefined;
		setThreadDraft("");
		if (threadIsCommand) {
			setThreadReplyTarget(null);
			await executeSlashCommand(text, activeThread.id);
			return;
		}
		setPendingThreadImages([]);
		setPendingThreadFiles([]);
		setCommandFeedback(null);
		scrollThreadToBottom();
		try {
			if (threadReplyTarget === null) {
				if (files.length > 0)
					await store.send(
						text,
						activeThread.id,
						attachments,
						delivery,
						undefined,
						files,
					);
				else if (delivery !== undefined)
					await store.send(text, activeThread.id, attachments, delivery);
				else await store.send(text, activeThread.id, attachments);
			} else {
				if (files.length > 0)
					await store.sendDirectReply(
						text,
						activeThread.id,
						threadReplyTarget.agentId,
						attachments,
						undefined,
						files,
					);
				else
					await store.sendDirectReply(
						text,
						activeThread.id,
						threadReplyTarget.agentId,
						attachments,
					);
			}
			setThreadReplyTarget(null);
		} catch (error) {
			if (!threadInputOccupied.current) {
				setThreadDraft(text);
				setPendingThreadImages(attachments);
				setPendingThreadFiles(files);
				if (error instanceof CommonspaceSubmissionError)
					store.dismissPendingSubmission(error.submissionId);
			}
		}
	};

	const replyDirectlyToAgent = (message: CommonspaceMessage) => {
		setThreadReplyTarget({
			agentId: message.authorId,
			agentName: message.authorName,
		});
		threadComposer.current?.focus();
		scrollThreadToBottom();
	};

	const saveThreadContext = async (event: FormEvent) => {
		event.preventDefault();
		if (activeThread === undefined || threadContextSaving) return;
		setThreadContextSaving(true);
		try {
			await store.updateThreadContext(activeThread.id, {
				summary: threadContextSummary,
				decisions: contextLines(threadContextDecisions),
				openQuestions: contextLines(threadContextQuestions),
			});
		} finally {
			setThreadContextSaving(false);
		}
	};
	const resetThreadContextDraft = () => {
		if (activeThread === undefined) return;
		setThreadContextSummary(activeThread.context.memory.summary);
		setThreadContextDecisions(activeThread.context.memory.decisions.join("\n"));
		setThreadContextQuestions(
			activeThread.context.memory.openQuestions.join("\n"),
		);
	};

	const compactActiveThreadContext = async () => {
		if (activeThread === undefined || threadContextCompacting) return;
		setThreadContextCompacting(true);
		try {
			await store.compactThreadContext(activeThread.id);
		} finally {
			setThreadContextCompacting(false);
		}
	};

	const addThreadNotePin = async (event: FormEvent) => {
		event.preventDefault();
		const note = threadPinNote.trim();
		if (activeThread === undefined || note === "") return;
		await store.addPin({
			scope: { kind: "thread", id: activeThread.id },
			kind: "note",
			note,
		});
		setThreadPinNote("");
	};

	const pinnedMessagesByScope = useMemo(() => {
		const scopes = new Map<string, Set<string>>();
		for (const pin of bootstrap?.state.pins ?? []) {
			if (
				pin.removedAt !== null ||
				pin.kind !== "message" ||
				pin.messageId === undefined
			)
				continue;
			const key = `${pin.scope.kind}:${pin.scope.id}`;
			const messages = scopes.get(key) ?? new Set<string>();
			messages.add(pin.messageId);
			scopes.set(key, messages);
		}
		return scopes;
	}, [bootstrap?.state.pins]);
	const toggleMessagePin = async (
		scope: CommonspacePin["scope"],
		message: CommonspaceMessage,
		attachmentId?: string,
	) => {
		const existingPins = (bootstrap?.state.pins ?? []).filter(
			(pin) =>
				pin.removedAt === null &&
				pin.scope.kind === scope.kind &&
				pin.scope.id === scope.id &&
				pin.kind === "message" &&
				pin.messageId === message.id,
		);
		if (attachmentId === undefined && existingPins.length > 0) {
			for (const pin of existingPins) await store.removePin(pin.id);
			return;
		}
		await store.addPin(
			attachmentId === undefined
				? { scope, kind: "message", messageId: message.id }
				: { scope, kind: "attachment", messageId: message.id, attachmentId },
		);
	};
	const pinChannelMessage = async (
		message: CommonspaceMessage,
		attachmentId?: string,
	) => {
		if (message.conversation.kind !== "channel") return;
		await toggleMessagePin(
			{ kind: "channel", id: message.conversation.id },
			message,
			attachmentId,
		);
	};
	const pinThreadMessage = async (
		message: CommonspaceMessage,
		attachmentId?: string,
	) => {
		if (activeThread === undefined) return;
		await toggleMessagePin(
			{ kind: "thread", id: activeThread.id },
			message,
			attachmentId,
		);
	};

	const editDeliveredMessage = async (
		message: CommonspaceMessage,
		text: string,
	) => {
		await store.editMessage(message.id, { text });
	};
	const retryFailedRouting = async (
		message: CommonspaceMessage,
		choice: { mode: "ai" } | { mode: "manual"; agentId: string },
	) => {
		await store.retryRouting(
			choice.mode === "ai"
				? { sourceMessageId: message.id, mode: "ai" }
				: {
						sourceMessageId: message.id,
						mode: "manual",
						agentId: choice.agentId,
					},
		);
	};

	const deleteDeliveredMessage = async (message: CommonspaceMessage) => {
		await store.deleteMessage(message.id);
	};
	const toggleSavedMessage = async (
		message: CommonspaceMessage,
		saved: boolean,
	) => {
		await store.mutate({
			action: "set-inbox-item-saved",
			messageId: message.id,
			saved,
		});
	};
	const markMessageUnread = async (message: CommonspaceMessage) => {
		await store.mutate({
			action: "set-inbox-item-unread",
			messageId: message.id,
			unread: true,
		});
	};
	const copyMessageLink = (message: CommonspaceMessage) => {
		const target: {
			conversation: ConversationRef;
			threadId?: string;
			messageId: string;
		} = {
			conversation: message.conversation,
			messageId: message.id,
		};
		if (message.threadId !== undefined) target.threadId = message.threadId;
		const link = messageUrl?.(target);
		if (link === undefined) return;
		void navigator.clipboard?.writeText(link).catch(() => undefined);
	};

	const openMessageVersion = (messageId: string) => {
		const version = messages.find((message) => message.id === messageId);
		if (version?.threadId !== undefined) selectThread(version.threadId);
		setFocusedRootMessageId(
			version?.parentMessageId ?? version?.id ?? messageId,
		);
	};
	const markConversationRead = () => {
		for (const message of conversationUnreadMessages) {
			void store.mutate({
				action: "mark-inbox-item-read",
				messageId: message.id,
			});
		}
	};
	const toggleThreadFollowing = () => {
		const followed = !threadFollowing;
		for (const session of activeThreadSessions) {
			void store.mutate({
				action: "set-session-followed",
				sessionId: session.id,
				followed,
			});
		}
	};
	const nextUnreadMessage = messages.find((message) =>
		unreadMessageIds.has(message.id),
	);
	const dateLabel = conversationDateLabel(rootsForChannelThreadView);

	return (
		<main
			className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
			aria-label="Commonspace conversation"
		>
			<WorkspaceHeader
				title={heading.title}
				subtitle={heading.subtitle}
				mark={
					snapshot.activeConversation === null ? "✦" : isChannel ? "#" : "@"
				}
				actions={
					<div className="flex items-center gap-1">
						{isChannel && (
							<ChannelThreadFilter
								value={channelThreadView}
								counts={{
									all: roots.length,
									running: runningThreadCount,
									followed: followedThreadCount,
								}}
								onChange={setChannelThreadView}
							/>
						)}
						{nextUnreadMessage !== undefined && (
							<button
								type="button"
								className="min-h-8 rounded-sm border-0 bg-transparent px-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline"
								aria-label="Jump to next unread message"
								onClick={() => {
									if (isChannel) setChannelThreadView("all");
									openMessageVersion(nextUnreadMessage.id);
								}}
							>
								Next unread
							</button>
						)}
						{snapshot.activeConversation !== null && (
							<button
								type="button"
								className="grid size-8 place-items-center rounded-full border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
								aria-label={
									isChannel ? "Open channel settings" : "Open agent profile"
								}
								aria-pressed={contextSettingsOpen}
								onClick={() => {
									if (!contextSettingsOpen && onOpenSettings !== undefined) {
										onOpenSettings();
										return;
									}
									if (activeThread !== undefined) selectThread(null);
									if (contextSettingsOpen) onSettingsClosed?.();
									setContextSettingsOpen((open) => !open);
								}}
							>
								<SettingsIcon className="size-[18px]" aria-hidden="true" />
							</button>
						)}
					</div>
				}
			/>

			{snapshot.activeConversation === null ? (
				<div className="flex flex-1 flex-col items-start justify-start px-[clamp(24px,6vw,72px)] py-[clamp(44px,8vh,82px)]">
					<div
						className="mb-5 grid size-12 place-items-center rounded-md border bg-muted font-mono text-primary"
						aria-hidden="true"
					>
						C
					</div>
				</div>
			) : (
				<div
					ref={conversationLayout}
					data-thread-overlay={threadOverlay && activeThread !== undefined}
					className={cn(
						"commonspace-conversation-layout relative grid min-h-0 flex-1 overflow-hidden",
						resizingPanel && "select-none",
					)}
					style={
						activeThread !== undefined && !threadOverlay
							? {
									gridTemplateColumns: `minmax(420px, ${String(100 - panelWidth)}fr) 8px minmax(360px, ${String(panelWidth)}fr)`,
								}
							: contextSettingsOpen
								? {
										gridTemplateColumns: `${String(100 - panelWidth)}fr 8px minmax(340px, ${String(panelWidth)}fr)`,
									}
								: undefined
					}
				>
					<section
						inert={threadOverlay && activeThread !== undefined}
						className="commonspace-conversation-primary flex min-h-0 min-w-0 flex-col bg-background"
						aria-label={
							isChannel ? `${heading.title} posts` : `${heading.title} messages`
						}
					>
						<div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4 max-[640px]:px-2">
							{rootsForChannelThreadView.length === 0 && (
								<div className="p-10 text-center text-sm text-muted-foreground">
									{roots.length === 0
										? "No messages yet. Start the conversation."
										: channelThreadView === "running"
											? "No threads are running."
											: "No followed threads."}
								</div>
							)}
							{dateLabel !== null && (
								<div className="mx-auto mb-2 flex w-full max-w-[920px] items-center justify-center text-xs text-muted-foreground">
									<span>{dateLabel}</span>
								</div>
							)}
							{isChannel
								? rootsForChannelThreadView.map((root) => {
										const thread = channelThreads.find(
											(candidate) => candidate.rootMessageId === root.id,
										);
										const threadIsActive = thread?.id === activeThread?.id;
										const threadIsFocused =
											threadIsActive || root.id === focusedRootMessageId;
										const threadReplies =
											thread === undefined
												? []
												: messages.filter(
														(message) =>
															message.threadId === thread.id &&
															message.parentMessageId === root.id,
													);
										const replyCount = threadReplies.length;
										const unreadReplies = threadReplies.filter((reply) =>
											unreadMessageIds.has(reply.id),
										);
										const unreadCount = unreadReplies.length;
										const threadActivities = liveActivitiesFor(
											bootstrap?.liveActivities,
											snapshot.activeConversation,
											thread?.id,
										);
										return (
											<Fragment key={root.id}>
												{root.id === firstUnreadRootId &&
													conversationUnreadMessages.length > 0 && (
														<button
															type="button"
															className="mx-auto mb-1 grid min-h-8 w-full max-w-[920px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground before:h-px before:bg-border hover:[&>span:last-child]:text-foreground hover:[&>span:last-child]:underline"
															aria-label={`${String(conversationUnreadMessages.length)} new ${conversationUnreadMessages.length === 1 ? "message" : "messages"}, mark read`}
															onClick={markConversationRead}
														>
															<span>
																{String(conversationUnreadMessages.length)} new{" "}
																{conversationUnreadMessages.length === 1
																	? "message"
																	: "messages"}
															</span>
															<span className="text-muted-foreground">
																Mark read
															</span>
														</button>
													)}
												<article
													id={`commonspace-message-${root.id}`}
													className={cn(
														"relative mx-auto mb-2 w-full max-w-[920px] px-1.5 py-1",
														threadIsFocused &&
															"before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-border",
													)}
													aria-current={threadIsFocused ? "true" : undefined}
												>
													<MessageRow
														message={root}
														replyLink={
															replyCount === 0 &&
															threadActivities.length === 0 ? null : (
																<button
																	type="button"
																	className={cn(
																		"relative inline-flex min-h-7 w-fit items-center gap-2 rounded-sm border-0 bg-transparent py-0.5 pr-2 pl-0 text-xs font-normal text-primary hover:underline",
																		unreadCount > 0 && "text-primary",
																	)}
																	aria-label={`${String(replyCount)} ${replyCount === 1 ? "reply" : "replies"}${unreadCount === 0 ? "" : `, ${String(unreadCount)} unread`}`}
																	onClick={() => {
																		if (thread === undefined) return;
																		setContextSettingsOpen(false);
																		selectThread(thread.id);
																		for (const reply of unreadReplies) {
																			void store.mutate({
																				action: "mark-inbox-item-read",
																				messageId: reply.id,
																			});
																		}
																	}}
																>
																	<span className="inline-flex min-w-0 items-center gap-2">
																		{bootstrap !== null && (
																			<ThreadReplyAgents
																				replies={threadReplies}
																				agents={bootstrap.agents}
																			/>
																		)}
																		<span>
																			{unreadCount > 0
																				? `${String(unreadCount)} new ${unreadCount === 1 ? "reply" : "replies"}`
																				: replyCount === 0
																					? "Reply"
																					: `${String(replyCount)} ${replyCount === 1 ? "reply" : "replies"}`}
																		</span>
																	</span>
																	{threadActivities.length > 0 && (
																		<span className="inline-flex items-center gap-2">
																			{thread !== undefined &&
																				bootstrap !== null && (
																					<ThreadAgentActivity
																						thread={thread}
																						agents={bootstrap.agents}
																						{...(threadActivities.length === 0
																							? {}
																							: {
																									respondingAgentIds:
																										threadActivities.map(
																											(activity) =>
																												activity.agentId,
																										),
																								})}
																					/>
																				)}
																			<span className="rounded-full bg-[color-mix(in_oklch,var(--status-warning)_11%,var(--background))] px-2 py-1 text-[10px] text-foreground">
																				Agents working
																			</span>
																		</span>
																	)}
																	{unreadCount > 0 && (
																		<span
																			className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-background bg-primary"
																			aria-hidden="true"
																		/>
																	)}
																</button>
															)
														}
														bootstrap={bootstrap}
														flush
														onPin={pinChannelMessage}
														pinned={
															pinnedMessagesByScope
																.get(`channel:${root.conversation.id}`)
																?.has(root.id) ?? false
														}
														onEdit={editDeliveredMessage}
														onDelete={deleteDeliveredMessage}
														onOpenVersion={openMessageVersion}
														saved={savedMessageIds.has(root.id)}
														onToggleSaved={toggleSavedMessage}
														onMarkUnread={markMessageUnread}
														onCopyLink={copyMessageLink}
														onRetryRouting={retryFailedRouting}
														{...(thread === undefined
															? {}
															: {
																	onReplyInThread: () => {
																		setContextSettingsOpen(false);
																		selectThread(thread.id);
																	},
																})}
													/>
												</article>
											</Fragment>
										);
									})
								: roots.map((message) => (
										<MessageRow
											key={message.id}
											elementId={`commonspace-message-${message.id}`}
											message={message}
											bootstrap={bootstrap}
											highlighted={message.id === focusedMessageId}
											onEdit={editDeliveredMessage}
											onDelete={deleteDeliveredMessage}
											onOpenVersion={openMessageVersion}
											saved={savedMessageIds.has(message.id)}
											onToggleSaved={toggleSavedMessage}
											onMarkUnread={markMessageUnread}
											onCopyLink={copyMessageLink}
											onRetryRouting={retryFailedRouting}
										/>
									))}
							{directMessagePhase !== null && (
								<LiveAgentActivity
									activities={directMessageActivities}
									fallbackAgents={directMessageAgents}
									agents={bootstrap?.agents ?? []}
									phase={directMessagePhase}
									onStop={(activity) => {
										void stopActivity(activity);
									}}
								/>
							)}
							<PermissionRequests
								permissions={directMessagePermissions}
								agents={bootstrap?.agents ?? []}
								onRespond={(permissionId, optionId) =>
									store.respondPermission(permissionId, optionId)
								}
							/>
							<div ref={bottom} />
						</div>

						<PendingAdmissions
							items={rootPendingSubmissions.map(pendingAdmissionItem)}
							className="mx-auto mb-2 w-[min(920px,calc(100%-48px))]"
							onRestore={(submissionId) => {
								const submission = rootPendingSubmissions.find(
									(candidate) => candidate.id === submissionId,
								);
								if (submission !== undefined)
									restorePendingSubmission(submission);
							}}
							onDismiss={(submissionId) => {
								store.dismissPendingSubmission(submissionId);
							}}
						/>
						<QueuedFollowups
							followups={directMessageFollowups}
							onFocusComposer={() => composer.current?.focus()}
							className="mx-auto mb-2 w-[min(920px,calc(100%-48px))]"
							onMove={(messageId, direction) => {
								void store
									.reorderFollowup(messageId, direction)
									.catch(() => undefined);
							}}
							onRemove={(messageId) => {
								void store.removeFollowup(messageId).catch(() => undefined);
							}}
						/>

						{commandFeedback !== null && (
							<section
								className={cn(
									"mx-4 mb-2 rounded-md border bg-muted px-3 py-2 text-xs",
									commandFeedback.tone === "error" &&
										"border-destructive/30 bg-destructive/5 text-destructive",
									commandFeedback.tone === "success" &&
										"border-[color-mix(in_oklch,var(--status-success)_32%,var(--border))]",
								)}
								role={commandFeedback.tone === "error" ? "alert" : "status"}
								aria-label="Command result"
							>
								<header className="flex items-center justify-between gap-3">
									<strong>{commandFeedback.title}</strong>
									<button
										type="button"
										className="grid size-7 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
										aria-label="Dismiss command result"
										onClick={() => {
											setCommandFeedback(null);
											composer.current?.focus();
										}}
									>
										×
									</button>
								</header>
								<p>{commandFeedback.body}</p>
								{commandFeedback.action === "reset-dm" && (
									<div className="mt-3 flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											onClick={() => {
												void resetDirectMessage();
											}}
										>
											Start new chat
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => {
												setCommandFeedback(null);
												composer.current?.focus();
											}}
										>
											Cancel
										</Button>
									</div>
								)}
							</section>
						)}

						<MessageComposerFrame
							aria-label={
								isChannel
									? `Start a new Thread in ${heading.title}`
									: `Message ${heading.title}`
							}
							data-composer-emphasis={
								rootComposerEmphasized
									? "active"
									: rootComposerReceded
										? "receded"
										: "idle"
							}
							className={cn(
								"mx-auto mb-[22px] w-[calc(100%-44px)] max-w-[920px] shrink-0 transition-[opacity,background-color,border-color,box-shadow]",
								rootComposerEmphasized && "border-primary/35 bg-card shadow-sm",
								rootComposerReceded &&
									"border-transparent bg-muted/30 opacity-80",
							)}
							onFocusCapture={() => {
								setFocusedComposer("channel");
							}}
							onBlurCapture={(event) => {
								const next = event.relatedTarget;
								if (
									!(next instanceof Node) ||
									!event.currentTarget.contains(next)
								)
									setFocusedComposer(null);
							}}
							onSubmit={(event) => {
								void sendRoot(event);
							}}
						>
							{suggestionCount > 0 && (
								<SuggestionMenu
									id={suggestionListId}
									selectedSuggestion={selectedSuggestion}
									slashSuggestions={slashSuggestions}
									referenceSuggestions={referenceSuggestions}
									onSelectSlash={selectSlashSuggestion}
									onSelectTag={selectSuggestion}
								/>
							)}
							<div className="relative w-full">
								<MessageComposerInput
									ref={composer}
									aria-label={
										isChannel
											? `Post in ${heading.title}`
											: `Message ${heading.title}`
									}
									aria-autocomplete="list"
									aria-controls={
										suggestionCount > 0 ? suggestionListId : undefined
									}
									aria-activedescendant={activeSuggestionId}
									placeholder={
										isChannel
											? `Start a new Thread in #${heading.title}`
											: `Message ${heading.title}`
									}
									value={draft}
									onChange={(event) => {
										setDraft(event.target.value);
										setSelectedSuggestion(0);
									}}
									onPaste={(event) => {
										const files = Array.from(event.clipboardData.files).filter(
											(file) => file.type.startsWith("image/"),
										);
										if (files.length > 0)
											void attachPastedImages(files, setPendingImages);
									}}
									onKeyDown={(event) => {
										if (
											suggestionCount > 0 &&
											(event.key === "ArrowDown" || event.key === "ArrowUp")
										) {
											event.preventDefault();
											setSelectedSuggestion((current) =>
												event.key === "ArrowDown"
													? (current + 1) % suggestionCount
													: (current - 1 + suggestionCount) % suggestionCount,
											);
										} else if (suggestionCount > 0 && event.key === "Tab") {
											event.preventDefault();
											if (slashSuggestions.length > 0) {
												const suggestion =
													slashSuggestions[selectedSuggestion] ??
													slashSuggestions[0];
												if (suggestion !== undefined)
													selectSlashSuggestion(suggestion.name);
											} else {
												const suggestion =
													referenceSuggestions[selectedSuggestion] ??
													referenceSuggestions[0];
												if (suggestion !== undefined)
													selectSuggestion(suggestion);
											}
										} else if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											if (
												slashSuggestions.length > 0 &&
												resolvedDraftCommand === null
											) {
												const suggestion =
													slashSuggestions[selectedSuggestion] ??
													slashSuggestions[0];
												if (suggestion !== undefined)
													selectSlashSuggestion(suggestion.name);
											} else if (referenceSuggestions.length > 0) {
												const suggestion =
													referenceSuggestions[selectedSuggestion] ??
													referenceSuggestions[0];
												if (suggestion !== undefined)
													selectSuggestion(suggestion);
											} else {
												const form = event.currentTarget.form;
												const steer =
													directMessageActivities.length > 0 &&
													!isChannel &&
													(event.metaKey || event.ctrlKey)
														? form?.querySelector<HTMLButtonElement>(
																'button[name="delivery"][value="steer"]:not(:disabled)',
															)
														: undefined;
												form?.requestSubmit(steer);
											}
										}
									}}
								/>
								<PendingImageStrip
									images={pendingImages}
									onRemove={(index) => {
										setPendingImages((current) =>
											current.filter((_, candidate) => candidate !== index),
										);
									}}
								/>
								<PendingFileStrip
									files={pendingFiles}
									onRemove={(index) => {
										setPendingFiles((current) =>
											current.filter((_, candidate) => candidate !== index),
										);
									}}
								/>
							</div>
							<MessageComposerActions>
								{directMessageActivities.length > 0 && !isChannel && (
									<RunDeliveryControls
										disabled={
											draft.trim() === "" &&
											pendingImages.length === 0 &&
											pendingFiles.length === 0
										}
										stopping={stoppingScope}
										onStop={() => {
											void stopActivities(directMessageActivities);
										}}
									/>
								)}
								<label className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
									<PaperclipIcon className="size-5" aria-hidden="true" />
									<input
										className="absolute inset-0 opacity-0"
										type="file"
										multiple
										aria-label="Attach files"
										onChange={(event) => {
											const files = Array.from(event.target.files ?? []);
											if (files.length > 0)
												void attachFiles(files, setPendingFiles);
											event.target.value = "";
										}}
									/>
								</label>
								{!isChannel && directMessageActivities.length === 0 ? (
									<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
										Enter to send · files · / commands
									</span>
								) : null}
								{(directMessageActivities.length === 0 || isChannel) && (
									<button
										type="submit"
										aria-label={
											rootIsCommand
												? "Run command"
												: isChannel
													? "Post message"
													: "Send message"
										}
										title={
											rootIsCommand
												? "Run command"
												: isChannel
													? "Post message"
													: "Send message"
										}
										className="ml-auto inline-flex size-9 items-center justify-center rounded-lg border-0 bg-primary/20 text-primary disabled:opacity-45"
										disabled={
											draft.trim() === "" &&
											pendingImages.length === 0 &&
											pendingFiles.length === 0
										}
									>
										<ArrowUpIcon className="size-5" aria-hidden="true" />
										<span className="sr-only">
											{rootIsCommand ? "Run" : isChannel ? "Post" : "Send"}
										</span>
									</button>
								)}
							</MessageComposerActions>
						</MessageComposerFrame>
					</section>

					{activeThread !== undefined && !threadOverlay && (
						<ResizablePanelHandle
							className="commonspace-thread-resizer relative z-20"
							ariaLabel="Resize thread"
							value={panelWidth}
							min={COMMONSPACE_RESIZABLE_PANEL.min}
							max={COMMONSPACE_RESIZABLE_PANEL.max}
							step={COMMONSPACE_RESIZABLE_PANEL.step}
							onChange={setPanelWidth}
							onStartResize={startPanelResize}
							onReset={resetPanelWidth}
						/>
					)}

					{activeThread !== undefined && (
						<aside
							ref={threadPanel}
							className="commonspace-thread-panel relative z-20 flex min-h-0 min-w-[360px] flex-col border-l bg-card"
							aria-label="Thread replies"
							onKeyDown={(event) => {
								if (event.key !== "Escape" || event.defaultPrevented) return;
								event.preventDefault();
								event.stopPropagation();
								if (threadContextOpen) {
									setThreadContextOpen(false);
									event.currentTarget
										.querySelector<HTMLButtonElement>(
											'button[aria-label="Open thread context"]',
										)
										?.focus();
								} else closeThread();
							}}
						>
							<header className="grid min-h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b px-5 py-3">
								<div className="min-w-0">
									<div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
										<span>Thread in</span>
										<button
											type="button"
											className="truncate rounded-sm border-0 bg-transparent p-0 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
											aria-label={`Show source message in #${activeChannel?.name ?? activeThread.channelId}`}
											title="Show the source message in the Channel"
											onClick={() => {
												if (activeRoot === undefined) return;
												setFocusedRootMessageId(activeRoot.id);
												requestAnimationFrame(() => {
													document
														.getElementById(
															`commonspace-message-${activeRoot.id}`,
														)
														?.scrollIntoView({
															block: "center",
															behavior: "smooth",
														});
												});
											}}
										>
											#{activeChannel?.name ?? activeThread.channelId}
										</button>
										<span aria-hidden="true">·</span>
										<span className="truncate">
											{activeThreadProject?.name ?? "No project"}
										</span>
									</div>
									<h2
										className="mt-0.5 truncate font-heading text-[15px] font-semibold tracking-[-0.01em]"
										title={threadSubject(activeRoot)}
									>
										{threadSubject(activeRoot)}
									</h2>
								</div>
								<div className="flex items-center gap-1">
									<button
										type="button"
										className="min-h-8 rounded-md border-0 bg-transparent px-2.5 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
										aria-label={
											threadFollowing ? "Unfollow thread" : "Follow thread"
										}
										aria-pressed={threadFollowing}
										disabled={activeThreadSessions.length === 0}
										onClick={toggleThreadFollowing}
									>
										{threadFollowing ? "Following" : "Follow"}
									</button>
									<button
										type="button"
										className="grid size-8 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
										aria-label="Close thread"
										onClick={closeThread}
									>
										<XIcon className="size-4" aria-hidden="true" />
									</button>
								</div>
								<div className="col-span-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
									<span
										className="inline-flex min-w-0 items-center gap-1.5"
										title="Replies continue the saved native agent session for this Thread."
									>
										<span className="inline-flex items-center pl-1">
											{activeThreadAgentIds
												.slice(0, 3)
												.map((agentId, index) => {
													const agent = bootstrap?.agents.find(
														(candidate) => candidate.id === agentId,
													);
													const name = agent?.displayName ?? agentId;
													return (
														<AgentAvatar
															key={agentId}
															agent={agent}
															fallbackName={name}
															size="stack"
															className="-ml-1 first:ml-0"
															ariaLabel={`${name} agent session`}
															style={{
																zIndex: activeThreadAgentIds.length - index,
															}}
														/>
													);
												})}
										</span>
										<span className="truncate">{activeThreadSessionLabel}</span>
									</span>
									<span className="text-border" aria-hidden="true">
										·
									</span>
									<button
										type="button"
										className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-sm border border-transparent bg-transparent px-1.5 hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
										aria-label="Open thread context"
										aria-pressed={threadContextOpen}
										title="Review inherited Channel context and the current Thread summary."
										onClick={() => {
											setThreadContextOpen((value) => !value);
										}}
									>
										<span
											className={cn(
												"size-1.5 rounded-full bg-muted-foreground",
												activeThread.context.memory.status === "current" &&
													"bg-[var(--status-success)]",
												activeThread.context.memory.status === "stale" &&
													"bg-[var(--status-warning)]",
												activeThread.context.memory.status === "failed" &&
													"bg-destructive",
												activeThread.context.memory.status === "compacting" &&
													"bg-primary",
											)}
											aria-hidden="true"
										/>
										{activeThreadContextLabel}
									</button>
								</div>
							</header>
							{threadContextOpen && (
								<section
									className="min-h-0 flex-1 overflow-y-auto bg-card p-6 text-[13px] leading-relaxed [&_button]:min-h-9 [&_button]:rounded-sm [&_button]:border [&_button]:px-3 [&_details]:rounded-md [&_details]:border [&_details]:bg-background [&_details]:p-3 [&_form]:mt-5 [&_form]:grid [&_form]:gap-3 [&_header]:flex [&_header]:items-center [&_header]:justify-between [&_header]:gap-3 [&_header>span]:text-xs [&_header>span]:text-muted-foreground [&_input]:min-h-10 [&_input]:rounded-sm [&_input]:border [&_input]:bg-background [&_input]:px-2 [&_label]:grid [&_label]:gap-1 [&_textarea]:min-h-20 [&_textarea]:rounded-sm [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"
									aria-label="Thread context"
								>
									<Button
										type="button"
										variant="ghost"
										className="mb-4"
										onClick={() => {
											setThreadContextOpen(false);
											requestAnimationFrame(() =>
												threadComposer.current?.focus(),
											);
										}}
									>
										Back to replies
									</Button>
									<p className="mb-4 text-xs leading-5 text-muted-foreground">
										Agents use this shared context to continue the Thread
										without rereading the whole Channel. Editing it does not
										change the conversation record.
									</p>
									<details open>
										<summary>
											Inherited from #
											{activeChannel?.name ?? activeThread.channelId}
										</summary>
										<p className="mt-2 text-xs text-muted-foreground">
											Captured when this Thread started.
										</p>
										<p>
											{activeThread.context.channelSnapshot.summary ||
												"No Channel summary existed when this Thread started."}
										</p>
										{activeThread.context.channelSnapshot.decisions.length >
											0 && (
											<ul>
												{activeThread.context.channelSnapshot.decisions.map(
													(decision) => (
														<li key={decision}>{decision}</li>
													),
												)}
											</ul>
										)}
									</details>
									<form
										aria-label="Edit Thread context"
										onSubmit={(event) => {
											void saveThreadContext(event);
										}}
									>
										<header>
											<strong>Current Thread context</strong>
											<span data-status={activeThread.context.memory.status}>
												{activeThreadContextLabel}
											</span>
										</header>
										<label>
											Summary
											<textarea
												aria-label="Thread summary"
												value={threadContextSummary}
												onChange={(event) => {
													setThreadContextSummary(event.target.value);
												}}
											/>
										</label>
										<label>
											Decisions
											<textarea
												aria-label="Thread decisions"
												value={threadContextDecisions}
												onChange={(event) => {
													setThreadContextDecisions(event.target.value);
												}}
											/>
										</label>
										<label>
											Open questions
											<textarea
												aria-label="Thread open questions"
												value={threadContextQuestions}
												onChange={(event) => {
													setThreadContextQuestions(event.target.value);
												}}
											/>
										</label>
										<div className="flex flex-wrap gap-2">
											<button
												type="submit"
												disabled={threadContextSaving || !threadContextDirty}
											>
												{threadContextSaving ? "Saving…" : "Save changes"}
											</button>
											<button
												type="button"
												disabled={threadContextSaving || !threadContextDirty}
												onClick={resetThreadContextDraft}
											>
												Reset changes
											</button>
											<button
												type="button"
												aria-label="Update Thread context summary"
												title="Ask the inference agent to refresh this summary from the Thread."
												disabled={threadContextCompacting}
												onClick={() => {
													void compactActiveThreadContext();
												}}
											>
												{threadContextCompacting
													? "Updating…"
													: "Update summary"}
											</button>
										</div>
									</form>
									<section
										className="mt-3 grid gap-2 rounded-md border bg-background p-3"
										aria-label="Thread pins"
									>
										<header>
											<strong>Pins</strong>
											<span>{activeThreadPins.length}</span>
										</header>
										{activeThreadPins.map((pin) => {
											const source =
												pin.messageId === undefined
													? undefined
													: messages.find(
															(message) => message.id === pin.messageId,
														);
											const attachment =
												pin.attachmentId === undefined
													? undefined
													: source?.attachments?.find(
															(candidate) => candidate.id === pin.attachmentId,
														);
											const label =
												pin.kind === "note"
													? (pin.note ?? "Pinned note")
													: pin.kind === "attachment"
														? (attachment?.name ?? "Pinned attachment")
														: (source?.text ?? "Pinned message");
											return (
												<div key={pin.id}>
													<span>
														{pin.scope.kind === "channel"
															? "Channel"
															: pin.kind === "note"
																? "Note"
																: pin.kind === "attachment"
																	? "File"
																	: (source?.authorName ?? "Message")}
													</span>
													<p>{label}</p>
													<button
														type="button"
														aria-label={`Remove pin ${label}`}
														onClick={() => {
															void store.removePin(pin.id);
														}}
													>
														Remove
													</button>
												</div>
											);
										})}
										<form
											aria-label="Add Thread pin note"
											onSubmit={(event) => {
												void addThreadNotePin(event);
											}}
										>
											<input
												aria-label="New Thread pin note"
												value={threadPinNote}
												onChange={(event) => {
													setThreadPinNote(event.target.value);
												}}
												placeholder="Pin a note to shared context"
											/>
											<button
												type="submit"
												disabled={threadPinNote.trim() === ""}
											>
												Pin note
											</button>
										</form>
									</section>
								</section>
							)}
							<div
								className={
									threadContextOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"
								}
							>
								<div
									ref={threadMessages}
									className="min-h-0 flex-1 overflow-y-auto px-[18px] py-1"
									role="log"
									aria-label="Thread messages"
								>
									{activeRoot !== undefined && (
										<MessageRow
											message={activeRoot}
											quotedSource
											bootstrap={bootstrap}
											flush
											highlighted={activeRoot.id === focusedMessageId}
											onPin={pinThreadMessage}
											pinned={
												pinnedMessagesByScope
													.get(`thread:${activeThread.id}`)
													?.has(activeRoot.id) ?? false
											}
											onEdit={editDeliveredMessage}
											onDelete={deleteDeliveredMessage}
											onOpenVersion={openMessageVersion}
											saved={savedMessageIds.has(activeRoot.id)}
											onToggleSaved={toggleSavedMessage}
											onMarkUnread={markMessageUnread}
											onCopyLink={copyMessageLink}
											onRetryRouting={retryFailedRouting}
										/>
									)}
									<div className="my-4 flex items-center gap-2">
										<span className="h-px flex-1 bg-border" />
										<span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
											Replies
										</span>
										<span className="h-px flex-1 bg-border" />
									</div>
									{replies.map((reply) => (
										<MessageRow
											key={reply.id}
											elementId={`commonspace-message-${reply.id}`}
											message={reply}
											bootstrap={bootstrap}
											highlighted={reply.id === focusedMessageId}
											onReplyToAgent={replyDirectlyToAgent}
											onPin={pinThreadMessage}
											pinned={
												pinnedMessagesByScope
													.get(`thread:${activeThread.id}`)
													?.has(reply.id) ?? false
											}
											onEdit={editDeliveredMessage}
											onDelete={deleteDeliveredMessage}
											onOpenVersion={openMessageVersion}
											saved={savedMessageIds.has(reply.id)}
											onToggleSaved={toggleSavedMessage}
											onMarkUnread={markMessageUnread}
											onCopyLink={copyMessageLink}
											onRetryRouting={retryFailedRouting}
										/>
									))}
									{activeThreadActivities.length > 0 && (
										<LiveAgentActivity
											activities={activeThreadActivities}
											fallbackAgents={[]}
											agents={bootstrap?.agents ?? []}
											phase="running"
											onStop={(activity) => {
												void stopActivity(activity);
											}}
										/>
									)}
									<PermissionRequests
										permissions={activeThreadPermissions}
										agents={bootstrap?.agents ?? []}
										onRespond={(permissionId, optionId) =>
											store.respondPermission(permissionId, optionId)
										}
									/>
								</div>
								<PendingAdmissions
									items={activeThreadPendingSubmissions.map(
										pendingAdmissionItem,
									)}
									thread
									className="mx-3 mb-2"
									onRestore={(submissionId) => {
										const submission = activeThreadPendingSubmissions.find(
											(candidate) => candidate.id === submissionId,
										);
										if (submission !== undefined)
											restorePendingSubmission(submission);
									}}
									onDismiss={(submissionId) => {
										store.dismissPendingSubmission(submissionId);
									}}
								/>
								<QueuedFollowups
									followups={activeThreadFollowups}
									onFocusComposer={() => threadComposer.current?.focus()}
									thread
									className="mx-3 mb-2"
									onMove={(messageId, direction) => {
										void store
											.reorderFollowup(messageId, direction)
											.catch(() => undefined);
									}}
									onRemove={(messageId) => {
										void store.removeFollowup(messageId).catch(() => undefined);
									}}
								/>
								<MessageComposerFrame
									aria-label="Reply in active Thread"
									data-composer-emphasis={
										threadComposerEmphasized
											? "active"
											: threadComposerReceded
												? "receded"
												: "idle"
									}
									className={cn(
										"mx-auto mb-[22px] w-[calc(100%-44px)] max-w-[920px] shrink-0 transition-[opacity,background-color,border-color,box-shadow]",
										threadComposerEmphasized &&
											"border-primary/35 bg-card shadow-sm",
										threadComposerReceded &&
											"border-transparent bg-muted/30 opacity-80",
									)}
									onFocusCapture={() => {
										setFocusedComposer("thread");
									}}
									onBlurCapture={(event) => {
										const next = event.relatedTarget;
										if (
											!(next instanceof Node) ||
											!event.currentTarget.contains(next)
										)
											setFocusedComposer(null);
									}}
									onSubmit={(event) => {
										void sendThreadReply(event);
									}}
								>
									{threadSuggestionCount > 0 && (
										<SuggestionMenu
											id={threadSuggestionListId}
											selectedSuggestion={selectedThreadSuggestion}
											slashSuggestions={threadSlashSuggestions}
											referenceSuggestions={threadReferenceSuggestions}
											onSelectSlash={selectThreadSlashSuggestion}
											onSelectTag={selectThreadSuggestion}
										/>
									)}
									<div className="relative w-full">
										{threadReplyTarget !== null && (
											<div
												className="mb-2 flex items-center gap-2 border-b px-1 pb-2 text-xs text-muted-foreground"
												role="status"
											>
												<span
													className="min-w-0 flex-1 truncate"
													title="Only this agent will respond"
												>
													Replying only to{" "}
													<span className="text-foreground">
														{threadReplyTarget.agentName}
													</span>
												</span>
												<button
													type="button"
													className="grid size-7 shrink-0 place-items-center rounded-md hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
													aria-label="Cancel direct reply"
													onClick={() => {
														setThreadReplyTarget(null);
														threadComposer.current?.focus();
													}}
												>
													×
												</button>
											</div>
										)}
										<MessageComposerInput
											ref={threadComposer}
											aria-label="Reply in thread"
											aria-autocomplete="list"
											aria-controls={
												threadSuggestionCount > 0
													? threadSuggestionListId
													: undefined
											}
											aria-activedescendant={activeThreadSuggestionId}
											placeholder="Continue this Thread…"
											value={threadDraft}
											onChange={(event) => {
												setThreadDraft(event.target.value);
												setSelectedThreadSuggestion(0);
											}}
											onPaste={(event) => {
												const files = Array.from(
													event.clipboardData.files,
												).filter((file) => file.type.startsWith("image/"));
												if (files.length > 0)
													void attachPastedImages(
														files,
														setPendingThreadImages,
													);
											}}
											onKeyDown={(event) => {
												if (
													threadSuggestionCount > 0 &&
													(event.key === "ArrowDown" || event.key === "ArrowUp")
												) {
													event.preventDefault();
													setSelectedThreadSuggestion((current) =>
														event.key === "ArrowDown"
															? (current + 1) % threadSuggestionCount
															: (current - 1 + threadSuggestionCount) %
																threadSuggestionCount,
													);
												} else if (
													threadSuggestionCount > 0 &&
													event.key === "Tab"
												) {
													event.preventDefault();
													if (threadSlashSuggestions.length > 0) {
														const suggestion =
															threadSlashSuggestions[
																selectedThreadSuggestion
															] ?? threadSlashSuggestions[0];
														if (suggestion !== undefined)
															selectThreadSlashSuggestion(suggestion.name);
													} else {
														const suggestion =
															threadReferenceSuggestions[
																selectedThreadSuggestion
															] ?? threadReferenceSuggestions[0];
														if (suggestion !== undefined)
															selectThreadSuggestion(suggestion);
													}
												} else if (event.key === "Enter" && !event.shiftKey) {
													event.preventDefault();
													if (
														threadSlashSuggestions.length > 0 &&
														resolvedThreadCommand === null
													) {
														const suggestion =
															threadSlashSuggestions[
																selectedThreadSuggestion
															] ?? threadSlashSuggestions[0];
														if (suggestion !== undefined)
															selectThreadSlashSuggestion(suggestion.name);
													} else if (threadReferenceSuggestions.length > 0) {
														const suggestion =
															threadReferenceSuggestions[
																selectedThreadSuggestion
															] ?? threadReferenceSuggestions[0];
														if (suggestion !== undefined)
															selectThreadSuggestion(suggestion);
													} else {
														const form = event.currentTarget.form;
														const steer =
															activeThreadActivities.length > 0 &&
															threadReplyTarget === null &&
															(event.metaKey || event.ctrlKey)
																? form?.querySelector<HTMLButtonElement>(
																		'button[name="delivery"][value="steer"]:not(:disabled)',
																	)
																: undefined;
														form?.requestSubmit(steer);
													}
												}
											}}
										/>
										<PendingImageStrip
											images={pendingThreadImages}
											onRemove={(index) => {
												setPendingThreadImages((current) =>
													current.filter((_, candidate) => candidate !== index),
												);
											}}
										/>
										<PendingFileStrip
											files={pendingThreadFiles}
											onRemove={(index) => {
												setPendingThreadFiles((current) =>
													current.filter((_, candidate) => candidate !== index),
												);
											}}
										/>
									</div>
									<MessageComposerActions>
										{activeThreadActivities.length > 0 &&
											threadReplyTarget === null && (
												<RunDeliveryControls
													thread
													disabled={
														threadDraft.trim() === "" &&
														pendingThreadImages.length === 0 &&
														pendingThreadFiles.length === 0
													}
												/>
											)}
										<label className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
											<PaperclipIcon className="size-5" aria-hidden="true" />
											<input
												className="absolute inset-0 opacity-0"
												type="file"
												multiple
												aria-label="Attach files to Thread"
												onChange={(event) => {
													const files = Array.from(event.target.files ?? []);
													if (files.length > 0)
														void attachFiles(files, setPendingThreadFiles);
													event.target.value = "";
												}}
											/>
										</label>
										{(activeThreadActivities.length === 0 ||
											threadReplyTarget !== null) && (
											<button
												className="ml-auto inline-flex size-9 items-center justify-center rounded-lg border-0 bg-primary/20 text-primary disabled:opacity-45"
												type="submit"
												aria-label={threadIsCommand ? "Run" : "Reply"}
												disabled={
													threadDraft.trim() === "" &&
													pendingThreadImages.length === 0 &&
													pendingThreadFiles.length === 0
												}
											>
												<ArrowUpIcon className="size-5" aria-hidden="true" />
											</button>
										)}
									</MessageComposerActions>
								</MessageComposerFrame>
							</div>
						</aside>
					)}
					{contextSettingsOpen &&
						bootstrap !== null &&
						snapshot.activeConversation?.kind === "channel" && (
							<>
								<ResizablePanelHandle
									className="commonspace-settings-resizer relative z-20"
									ariaLabel="Resize settings"
									value={panelWidth}
									min={COMMONSPACE_RESIZABLE_PANEL.min}
									max={COMMONSPACE_RESIZABLE_PANEL.max}
									step={COMMONSPACE_RESIZABLE_PANEL.step}
									onChange={setPanelWidth}
									onStartResize={startPanelResize}
									onReset={resetPanelWidth}
								/>
								<ChannelSettingsPane
									bootstrap={bootstrap}
									id={snapshot.activeConversation.id}
									store={store}
									onClose={() => {
										setContextSettingsOpen(false);
										onSettingsClosed?.();
									}}
								/>
							</>
						)}
					{contextSettingsOpen &&
						bootstrap !== null &&
						snapshot.activeConversation?.kind === "dm" && (
							<>
								<ResizablePanelHandle
									className="commonspace-settings-resizer relative z-20"
									ariaLabel="Resize settings"
									value={panelWidth}
									min={COMMONSPACE_RESIZABLE_PANEL.min}
									max={COMMONSPACE_RESIZABLE_PANEL.max}
									step={COMMONSPACE_RESIZABLE_PANEL.step}
									onChange={setPanelWidth}
									onStartResize={startPanelResize}
									onReset={resetPanelWidth}
								/>
								<AgentSettingsPane
									bootstrap={bootstrap}
									id={snapshot.activeConversation.id}
									store={store}
									onClose={() => {
										setContextSettingsOpen(false);
										onSettingsClosed?.();
									}}
								/>
							</>
						)}
				</div>
			)}
		</main>
	);
}
