import type {
	CommonspaceBootstrap,
	CommonspaceSchedule,
	CommonspaceScheduleTiming,
} from "@commonspace/shared";
import { Clock3Icon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { WorkspaceHeader } from "@/design-system/WorkspaceHeader";
import type { CommonspaceStore } from "./commonspace-store.ts";

interface CommonspaceScheduledProps {
	bootstrap: CommonspaceBootstrap;
	store: CommonspaceStore;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
});
const fieldClass =
	"min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

function localDateTime(value: string): string {
	const date = new Date(value);
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleDescription(schedule: CommonspaceSchedule): string {
	if (schedule.nextRunAt === null) {
		return schedule.lastRunAt === null
			? "Completed"
			: `Sent ${dateFormatter.format(new Date(schedule.lastRunAt))}`;
	}
	if (schedule.paused) return "Paused";
	return `Next run ${dateFormatter.format(new Date(schedule.nextRunAt))}`;
}

function ScheduleEditor({
	channels,
	onClose,
	schedule,
	store,
}: {
	channels: CommonspaceBootstrap["state"]["channels"];
	onClose: () => void;
	schedule: CommonspaceSchedule | null;
	store: CommonspaceStore;
}) {
	const [title, setTitle] = useState(schedule?.title ?? "");
	const [channelId, setChannelId] = useState(
		schedule?.channelId ?? channels[0]?.id ?? "",
	);
	const [text, setText] = useState(schedule?.text ?? "");
	const [kind, setKind] = useState<CommonspaceScheduleTiming["kind"]>(
		schedule?.timing.kind ?? "once",
	);
	const [runAt, setRunAt] = useState(
		localDateTime(
			schedule?.timing.kind === "once"
				? schedule.timing.runAt
				: new Date(Date.now() + 60 * 60_000).toISOString(),
		),
	);
	const [expression, setExpression] = useState(
		schedule?.timing.kind === "cron" ? schedule.timing.expression : "0 9 * * *",
	);
	const [timeZone, setTimeZone] = useState(
		schedule?.timing.kind === "cron"
			? schedule.timing.timeZone
			: Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (saving) return;
		let timing: CommonspaceScheduleTiming;
		if (kind === "once") {
			const date = new Date(runAt);
			if (!Number.isFinite(date.getTime())) {
				setError("Choose a valid send time.");
				return;
			}
			timing = { kind: "once", runAt: date.toISOString() };
		} else {
			timing = { kind: "cron", expression, timeZone };
		}
		setSaving(true);
		setError(null);
		await store.mutate(
			schedule === null
				? { action: "create-schedule", title, channelId, text, timing }
				: {
						action: "update-schedule",
						id: schedule.id,
						title,
						channelId,
						text,
						timing,
					},
		);
		setSaving(false);
		const requestError = store.getSnapshot().error;
		if (requestError !== null) {
			setError(requestError);
			return;
		}
		onClose();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<DialogContent
				closeLabel="Close schedule editor"
				className="sm:max-w-[640px]"
			>
				<DialogHeader className="border-b px-6 py-5">
					<DialogTitle>
						{schedule === null ? "New schedule" : "Edit schedule"}
					</DialogTitle>
					<DialogDescription>
						Send this message as a new conversation in a Channel.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={(event) => void save(event)}>
					<div className="grid gap-5 px-6 py-6">
						<label className="grid gap-1.5 text-sm font-medium">
							Title
							<input
								autoFocus
								className={fieldClass}
								maxLength={120}
								required
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="Morning check-in"
							/>
						</label>
						<label className="grid gap-1.5 text-sm font-medium">
							Channel
							<select
								className={fieldClass}
								required
								value={channelId}
								onChange={(event) => setChannelId(event.target.value)}
							>
								{channels.map((channel) => (
									<option key={channel.id} value={channel.id}>
										#{channel.name}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1.5 text-sm font-medium">
							Message
							<textarea
								className={`${fieldClass} min-h-32 resize-y leading-6`}
								maxLength={16_000}
								required
								value={text}
								onChange={(event) => setText(event.target.value)}
								placeholder="What should the Channel's agents work on?"
							/>
						</label>
						<div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
							<label className="grid gap-1.5 text-sm font-medium">
								Frequency
								<select
									className={fieldClass}
									value={kind}
									onChange={(event) =>
										setKind(event.target.value === "cron" ? "cron" : "once")
									}
								>
									<option value="once">One time</option>
									<option value="cron">Repeat</option>
								</select>
							</label>
							{kind === "once" ? (
								<label className="grid gap-1.5 text-sm font-medium">
									Send at
									<input
										className={fieldClass}
										type="datetime-local"
										required
										value={runAt}
										onChange={(event) => setRunAt(event.target.value)}
									/>
								</label>
							) : (
								<label className="grid gap-1.5 text-sm font-medium">
									Cron expression
									<input
										className={`${fieldClass} font-mono`}
										required
										value={expression}
										onChange={(event) => setExpression(event.target.value)}
									/>
								</label>
							)}
						</div>
						{kind === "cron" && (
							<label className="grid gap-1.5 text-sm font-medium">
								Time zone
								<input
									className={fieldClass}
									required
									value={timeZone}
									onChange={(event) => setTimeZone(event.target.value)}
								/>
								<span className="text-xs font-normal text-muted-foreground">
									Five fields: minute, hour, day, month, weekday.
								</span>
							</label>
						)}
						{error !== null && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</div>
					<div className="flex justify-end gap-2 border-t bg-muted/30 px-6 py-4">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={saving}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={saving || channels.length === 0}>
							{saving ? "Saving…" : "Save schedule"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function CommonspaceScheduled({
	bootstrap,
	store,
}: CommonspaceScheduledProps) {
	const { channels, schedules } = bootstrap.state;
	const [editingId, setEditingId] = useState<string | "new" | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const active = schedules
		.filter((schedule) => !schedule.paused && schedule.nextRunAt !== null)
		.toSorted((left, right) =>
			(left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""),
		);
	const inactive = schedules.filter(
		(schedule) => schedule.paused || schedule.nextRunAt === null,
	);
	const editing =
		editingId === "new"
			? null
			: (schedules.find((schedule) => schedule.id === editingId) ?? null);
	const deleting = schedules.find((schedule) => schedule.id === deletingId);

	const changePaused = async (schedule: CommonspaceSchedule) => {
		setBusyId(schedule.id);
		setError(null);
		await store.mutate({
			action: "set-schedule-paused",
			id: schedule.id,
			paused: !schedule.paused,
		});
		setError(store.getSnapshot().error);
		setBusyId(null);
	};
	const deleteSchedule = async (schedule: CommonspaceSchedule) => {
		setBusyId(schedule.id);
		setError(null);
		await store.mutate({ action: "delete-schedule", id: schedule.id });
		const requestError = store.getSnapshot().error;
		setError(requestError);
		setBusyId(null);
		if (requestError === null) setDeletingId(null);
	};

	const renderRows = (items: CommonspaceSchedule[]) => (
		<ol className="divide-y border-y">
			{items.map((schedule) => {
				const channel = channels.find((item) => item.id === schedule.channelId);
				return (
					<li
						key={schedule.id}
						className="flex min-h-24 items-center gap-4 px-2 py-4 hover:bg-hover"
					>
						<span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
							<Clock3Icon className="size-[19px]" aria-hidden="true" />
						</span>
						<button
							type="button"
							className="min-w-0 flex-1 border-0 bg-transparent text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							onClick={() => setEditingId(schedule.id)}
							aria-label={`Edit schedule ${schedule.title}`}
						>
							<strong className="block truncate text-[15px] font-semibold">
								{schedule.title}
							</strong>
							<span className="mt-1 block truncate text-sm text-muted-foreground">
								{schedule.text}
							</span>
							<span className="mt-1.5 block text-xs text-muted-foreground">
								#{channel?.name ?? schedule.channelId} ·{" "}
								{scheduleDescription(schedule)}
								{schedule.timing.kind === "cron"
									? ` · ${schedule.timing.expression} (${schedule.timing.timeZone})`
									: ""}
							</span>
						</button>
						<div className="flex shrink-0 items-center gap-1">
							{schedule.nextRunAt !== null && (
								<Button
									type="button"
									variant="ghost"
									size="compact"
									disabled={busyId === schedule.id}
									onClick={() => void changePaused(schedule)}
								>
									{schedule.paused ? "Resume" : "Pause"}
								</Button>
							)}
							<Button
								type="button"
								variant="ghost"
								size="compact"
								onClick={() => setEditingId(schedule.id)}
							>
								Edit
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="compact"
								onClick={() => setDeletingId(schedule.id)}
							>
								Delete
							</Button>
						</div>
					</li>
				);
			})}
		</ol>
	);

	return (
		<main
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label="Scheduled"
		>
			<WorkspaceHeader
				title="Scheduled"
				subtitle="Messages that will start a new Channel conversation."
				mark={<Clock3Icon className="size-[17px]" aria-hidden="true" />}
				actions={
					<Button
						onClick={() => setEditingId("new")}
						disabled={channels.length === 0}
					>
						<PlusIcon className="size-4" aria-hidden="true" />
						New schedule
					</Button>
				}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
				<div className="mx-auto max-w-[1080px]">
					{error !== null && (
						<p role="alert" className="mb-5 text-sm text-destructive">
							{error}
						</p>
					)}
					{schedules.length === 0 ? (
						<Empty className="min-h-80 border-0">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<Clock3Icon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No scheduled messages</EmptyTitle>
								<EmptyDescription>
									{channels.length === 0
										? "Create a Channel to schedule a message."
										: "Choose a Channel and a time to send a message later."}
								</EmptyDescription>
							</EmptyHeader>
							{channels.length > 0 && (
								<Button variant="outline" onClick={() => setEditingId("new")}>
									Create a schedule
								</Button>
							)}
						</Empty>
					) : (
						<div className="grid gap-10">
							{active.length > 0 && (
								<section aria-label="Upcoming schedules">
									<h2 className="mb-3 text-sm font-semibold">Upcoming</h2>
									{renderRows(active)}
								</section>
							)}
							{inactive.length > 0 && (
								<section aria-label="Inactive schedules">
									<h2 className="mb-3 text-sm font-semibold">
										Paused and completed
									</h2>
									{renderRows(inactive)}
								</section>
							)}
						</div>
					)}
				</div>
			</div>
			{(editingId === "new" || editing !== null) && (
				<ScheduleEditor
					key={editingId}
					channels={channels}
					schedule={editing}
					store={store}
					onClose={() => setEditingId(null)}
				/>
			)}
			{deleting !== undefined && (
				<Dialog
					open
					onOpenChange={(open) => {
						if (!open && busyId === null) setDeletingId(null);
					}}
				>
					<DialogContent className="sm:max-w-[440px]">
						<DialogHeader className="px-6 pt-6">
							<DialogTitle>Delete {deleting.title}?</DialogTitle>
							<DialogDescription>
								Future messages from this schedule will stop. Messages already
								sent stay in the Channel.
							</DialogDescription>
						</DialogHeader>
						<div className="flex justify-end gap-2 px-6 pb-6 pt-5">
							<Button
								variant="outline"
								onClick={() => setDeletingId(null)}
								disabled={busyId !== null}
							>
								Cancel
							</Button>
							<Button
								variant="destructive"
								onClick={() => void deleteSchedule(deleting)}
								disabled={busyId !== null}
							>
								Delete schedule
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			)}
		</main>
	);
}
