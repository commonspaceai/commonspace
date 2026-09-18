import type {
	CommonspaceAgentProfile,
	CommonspaceChannel,
	CommonspaceRetentionPreview,
} from "@commonspace/shared";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { CommonspaceStore } from "./commonspace-store";

interface ConversationRetentionProps {
	store: Pick<CommonspaceStore, "previewRetention" | "applyRetention">;
	channels: readonly CommonspaceChannel[];
	agents: readonly CommonspaceAgentProfile[];
}

enum RetentionStatus {
	Choosing = "choosing",
	Loading = "loading",
	Preview = "preview",
	Deleting = "deleting",
	Failed = "failed",
	Deleted = "deleted",
}

type RetentionState =
	| {
			status:
				| RetentionStatus.Choosing
				| RetentionStatus.Loading
				| RetentionStatus.Deleted;
	  }
	| {
			status: RetentionStatus.Preview | RetentionStatus.Deleting;
			preview: CommonspaceRetentionPreview;
	  }
	| { status: RetentionStatus.Failed; message: string };

function RetentionForm({
	store,
	channels,
	agents,
	onClose,
}: ConversationRetentionProps & { onClose: () => void }) {
	const conversationId = useId();
	const [conversation, setConversation] = useState("");
	const [state, setState] = useState<RetentionState>({
		status: RetentionStatus.Choosing,
	});
	const pending =
		state.status === RetentionStatus.Loading ||
		state.status === RetentionStatus.Deleting;

	const preview = async () => {
		const separator = conversation.indexOf(":");
		const kind = conversation.slice(0, separator);
		const id = conversation.slice(separator + 1);
		if ((kind !== "channel" && kind !== "dm") || id === "" || pending) return;
		setState({ status: RetentionStatus.Loading });
		try {
			const result = await store.previewRetention({ kind, id });
			setState({ status: RetentionStatus.Preview, preview: result });
		} catch (error) {
			setState({
				status: RetentionStatus.Failed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const remove = async () => {
		if (state.status !== RetentionStatus.Preview) return;
		setState({ status: RetentionStatus.Deleting, preview: state.preview });
		try {
			await store.applyRetention(state.preview);
			setState({ status: RetentionStatus.Deleted });
		} catch (error) {
			// A failed or stale preview must be reviewed again before another deletion.
			setState({
				status: RetentionStatus.Failed,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	if (state.status === RetentionStatus.Deleted) {
		return (
			<div className="grid gap-5 p-5">
				<p role="status">Conversation history deleted.</p>
				<Button
					variant="outline"
					className="justify-self-end"
					onClick={onClose}
				>
					Done
				</Button>
			</div>
		);
	}

	return (
		<div className="grid gap-5 p-5">
			<label
				htmlFor={conversationId}
				className="grid gap-2 text-xs font-medium"
			>
				Conversation
				<NativeSelect
					id={conversationId}
					value={conversation}
					disabled={pending}
					onChange={(event) => {
						setConversation(event.target.value);
						setState({ status: RetentionStatus.Choosing });
					}}
				>
					<option value="">Choose a conversation…</option>
					{channels.map((channel) => (
						<option key={channel.id} value={`channel:${channel.id}`}>
							#{channel.name}
						</option>
					))}
					{agents.map((agent) => (
						<option key={agent.id} value={`dm:${agent.id}`}>
							DM · {agent.displayName}
						</option>
					))}
				</NativeSelect>
			</label>
			{state.status === RetentionStatus.Failed ? (
				<p role="alert" className="text-sm text-destructive">
					{state.message}
				</p>
			) : null}
			{state.status === RetentionStatus.Preview ||
			state.status === RetentionStatus.Deleting ? (
				<section
					aria-label="Deletion preview"
					className="grid gap-3 rounded-md border bg-muted/40 p-4"
				>
					<p className="text-sm font-medium">This will permanently delete</p>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
						<div className="flex justify-between gap-2">
							<dt>Messages</dt>
							<dd className="font-medium tabular-nums">
								{state.preview.messages}
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt>Threads</dt>
							<dd className="font-medium tabular-nums">
								{state.preview.threads}
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt>Attachments</dt>
							<dd className="font-medium tabular-nums">
								{state.preview.attachments}
							</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt>Pins</dt>
							<dd className="font-medium tabular-nums">{state.preview.pins}</dd>
						</div>
						{state.preview.permissions > 0 ? (
							<div className="col-span-2 flex justify-between gap-2">
								<dt>Permission requests</dt>
								<dd className="font-medium tabular-nums">
									{state.preview.permissions}
								</dd>
							</div>
						) : null}
					</dl>
					<p className="border-t pt-3 text-xs text-muted-foreground">
						This cannot be undone. Export your workspace first if you need a
						copy.
					</p>
				</section>
			) : null}
			<div className="flex justify-end gap-2 border-t pt-4">
				<Button
					type="button"
					variant="outline"
					onClick={onClose}
					disabled={pending}
				>
					Cancel
				</Button>
				{state.status === RetentionStatus.Preview ||
				state.status === RetentionStatus.Deleting ? (
					<Button
						type="button"
						variant="destructive"
						disabled={pending}
						onClick={() => {
							void remove();
						}}
					>
						{state.status === RetentionStatus.Deleting
							? "Deleting…"
							: "Delete history permanently"}
					</Button>
				) : (
					<Button
						type="button"
						variant="secondary"
						disabled={conversation === "" || pending}
						onClick={() => {
							void preview();
						}}
					>
						{state.status === RetentionStatus.Loading
							? "Reviewing…"
							: "Review deletion"}
					</Button>
				)}
			</div>
		</div>
	);
}

export function ConversationRetention(props: ConversationRetentionProps) {
	const [open, setOpen] = useState(false);
	return (
		<section
			aria-label="Conversation retention"
			className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t pt-5"
		>
			<div className="min-w-0">
				<h3 className="text-[13px] font-semibold">
					Delete conversation history
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					Permanently remove messages and files from a channel or direct
					message.
				</p>
			</div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger render={<Button type="button" variant="outline" />}>
					Choose conversation…
				</DialogTrigger>
				<DialogContent className="sm:max-w-[480px]">
					<DialogHeader className="border-b p-5 pr-12">
						<DialogTitle>Delete conversation history</DialogTitle>
						<DialogDescription className="text-xs leading-5">
							Choose a conversation to review what will be removed.
						</DialogDescription>
					</DialogHeader>
					{open ? (
						<RetentionForm
							{...props}
							onClose={() => {
								setOpen(false);
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</section>
	);
}
