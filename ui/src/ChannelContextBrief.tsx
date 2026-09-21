import type { CommonspaceChannel } from "@commonspace/shared";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CommonspaceStore } from "./commonspace-store.ts";

const MessageMarkdown = lazy(async () => ({
	default: (await import("./MessageMarkdown.tsx")).MessageMarkdown,
}));

interface BriefProps {
	channel: CommonspaceChannel;
	store: CommonspaceStore;
}

type ChannelMemory = CommonspaceChannel["memory"];

function hasContextBrief(memory: ChannelMemory): boolean {
	return memory.origin === "inference" || memory.origin === "user";
}

function contextBriefStatus(memory: ChannelMemory, busy: boolean): string {
	if (busy) return "Updating from the conversation…";
	if (memory.status === "failed")
		return "The last update failed. Refresh to try again.";
	if (memory.status === "stale") return "Recent changes are not yet included.";
	if (hasContextBrief(memory)) return "Up to date with the conversation.";
	return "Context will appear as the conversation develops.";
}

export function ChannelContextBrief({ channel, store }: BriefProps) {
	const [editing, setEditing] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const memory = channel.memory;
	const busy = refreshing || memory.status === "compacting";

	async function refresh() {
		if (busy) return;
		setRefreshing(true);
		setError(null);
		try {
			await store.compactChannelContext(channel.id);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<section className="mt-7 border-t pt-6" aria-label="Context brief">
			<ContextBriefHeader>
				{editing ? null : (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => setEditing(true)}
					>
						Edit context
					</Button>
				)}
			</ContextBriefHeader>
			{editing ? (
				<ContextCorrectionEditor
					channel={channel}
					store={store}
					onClose={() => setEditing(false)}
				/>
			) : (
				<ContextBriefViewer
					memory={memory}
					busy={busy}
					error={error}
					onRefresh={() => {
						void refresh();
					}}
				/>
			)}
		</section>
	);
}

function ContextBriefHeader({ children }: { children?: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div>
				<h3 className="font-heading text-sm font-semibold">Context brief</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					What agents need to carry the work forward.
				</p>
			</div>
			{children ?? null}
		</div>
	);
}

function ContextBriefViewer({
	memory,
	busy,
	error,
	onRefresh,
}: {
	memory: ChannelMemory;
	busy: boolean;
	error: string | null;
	onRefresh: () => void;
}) {
	const hasBrief = hasContextBrief(memory);
	return (
		<>
			<div className="mt-4 space-y-5 rounded-lg border bg-background p-4">
				<div>
					<h4 className="text-xs font-semibold text-muted-foreground">
						Current work
					</h4>
					{hasBrief && memory.summary !== "" ? (
						<Suspense
							fallback={
								<p className="mt-2 whitespace-pre-wrap text-sm">
									{memory.summary}
								</p>
							}
						>
							<MessageMarkdown text={memory.summary} />
						</Suspense>
					) : (
						<p className="mt-2 text-sm text-muted-foreground">
							No work context recorded yet.
						</p>
					)}
				</div>
				<BriefList
					title="Decisions"
					items={hasBrief ? memory.decisions : []}
					empty="No decisions recorded."
				/>
				<BriefList
					title="Open questions"
					items={hasBrief ? memory.openQuestions : []}
					empty="No unresolved questions recorded."
				/>
			</div>
			<div className="mt-3 flex items-center justify-between gap-3">
				<div className="text-xs text-muted-foreground">
					<p role="status">{contextBriefStatus(memory, busy)}</p>
					<p className="mt-1">
						{memory.origin === "user"
							? "Corrected by you"
							: "Maintained automatically"}{" "}
						· {memory.sourceMessageCount ?? 0} source messages
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy || (memory.sourceMessageCount ?? 0) === 0}
					onClick={onRefresh}
				>
					{busy ? "Updating…" : "Refresh brief"}
				</Button>
			</div>
			{memory.origin === "user" ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Your corrections are preserved. Refresh the brief to reconcile them
					with newer conversation.
				</p>
			) : null}
			{error === null ? null : (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{error}
				</p>
			)}
		</>
	);
}

function BriefList({
	title,
	items,
	empty,
}: {
	title: string;
	items: string[];
	empty: string;
}) {
	return (
		<div>
			<h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
			{items.length === 0 ? (
				<p className="mt-2 text-sm text-muted-foreground">{empty}</p>
			) : (
				<ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed">
					{items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ContextCorrectionEditor({
	channel,
	store,
	onClose,
}: BriefProps & { onClose: () => void }) {
	const hasBrief = hasContextBrief(channel.memory);
	const [summary, setSummary] = useState(
		hasBrief ? channel.memory.summary : "",
	);
	const [decisions, setDecisions] = useState(
		hasBrief ? channel.memory.decisions.join("\n") : "",
	);
	const [questions, setQuestions] = useState(
		hasBrief ? channel.memory.openQuestions.join("\n") : "",
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function save() {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await store.mutate({
				action: "set-channel-memory",
				channelId: channel.id,
				summary,
				decisions: lines(decisions),
				openQuestions: lines(questions),
			});
			onClose();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	}
	return (
		<fieldset
			disabled={saving}
			className="mt-4 grid gap-3 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs [&_label]:font-semibold [&_textarea]:min-h-24 [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:bg-background [&_textarea]:p-3"
		>
			<label>
				Current work
				<textarea
					aria-label="Channel summary"
					value={summary}
					onChange={(event) => setSummary(event.target.value)}
				/>
			</label>
			<label>
				Decisions
				<textarea
					aria-label="Channel decisions"
					value={decisions}
					onChange={(event) => setDecisions(event.target.value)}
				/>
			</label>
			<label>
				Open questions
				<textarea
					aria-label="Channel open questions"
					value={questions}
					onChange={(event) => setQuestions(event.target.value)}
				/>
			</label>
			<p className="text-xs text-muted-foreground">
				One decision or question per line. Corrections change shared context,
				not the conversation.
			</p>
			{error === null ? null : (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onClose}>
					Cancel edit
				</Button>
				<Button
					type="button"
					onClick={() => {
						void save();
					}}
				>
					{saving ? "Saving…" : "Save corrections"}
				</Button>
			</div>
		</fieldset>
	);
}

function lines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}
