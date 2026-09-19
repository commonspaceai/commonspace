import type {
	ProjectGitDiffResponse,
	ProjectGitFileChange,
	ProjectGitStatusResponse,
} from "@commonspace/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchProjectJson, projectApiUrl } from "./project-files-api.ts";

export interface CommonspaceProjectChangesProps {
	projectId: string;
	fetcher?: typeof globalThis.fetch;
}

function statusMark(change: ProjectGitFileChange): string {
	if (change.status === "untracked") return "?";
	if (change.status === "conflicted") return "!";
	if (change.status === "renamed") return "R";
	if (change.status === "deleted") return "D";
	if (change.status === "added") return "A";
	return "M";
}

function Diff({ diff }: { diff: ProjectGitDiffResponse }) {
	if (diff.binary)
		return (
			<div className="py-12 text-center">
				<strong>Binary change</strong>
				<p className="mt-1 text-xs text-muted-foreground">
					Git cannot produce a text patch for this file.
				</p>
			</div>
		);
	if (diff.patch === "")
		return (
			<div className="py-12 text-center">
				<strong>No text difference</strong>
				<p className="mt-1 text-xs text-muted-foreground">
					Working file matches HEAD.
				</p>
			</div>
		);
	return (
		<section
			className="overflow-hidden rounded-sm border font-mono text-xs"
			aria-label={`Diff ${diff.path}`}
		>
			{diff.patch.split("\n").map((line, index) => {
				const kind =
					line.startsWith("+++") || line.startsWith("---")
						? "meta"
						: line.startsWith("+")
							? "add"
							: line.startsWith("-")
								? "remove"
								: line.startsWith("@@")
									? "hunk"
									: "context";
				return (
					<code
						key={`${String(index)}:${line}`}
						className={cn(
							"block min-h-6 whitespace-pre-wrap px-3 py-1",
							kind === "add" &&
								"bg-[color-mix(in_oklch,var(--status-success)_10%,var(--background))]",
							kind === "remove" &&
								"bg-[color-mix(in_oklch,var(--destructive)_10%,var(--background))]",
							kind === "meta" && "text-muted-foreground",
							kind === "hunk" && "bg-muted text-primary",
						)}
					>
						{line === "" ? " " : line}
					</code>
				);
			})}
			{diff.truncated && (
				<div className="px-3 py-2.5 text-xs text-muted-foreground">
					Patch truncated after 2,000 lines.
				</div>
			)}
		</section>
	);
}

export function CommonspaceProjectChanges({
	projectId,
	fetcher = globalThis.fetch,
}: CommonspaceProjectChangesProps) {
	const [refresh, setRefresh] = useState(0);
	const [status, setStatus] = useState<ProjectGitStatusResponse | null>(null);
	const [selected, setSelected] = useState<ProjectGitFileChange | null>(null);
	const [diff, setDiff] = useState<ProjectGitDiffResponse | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [diffError, setDiffError] = useState<string | null>(null);

	useEffect(() => {
		void refresh;
		const controller = new AbortController();
		setStatus(null);
		setStatusError(null);
		setSelected(null);
		setDiff(null);
		void fetchProjectJson<ProjectGitStatusResponse>(
			projectApiUrl(projectId, "changes", 0),
			controller.signal,
			fetcher,
		)
			.then((result) => {
				setStatus(result);
				if (result.available && result.files[0] !== undefined)
					setSelected(result.files[0]);
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setStatusError(
						cause instanceof Error ? cause.message : String(cause),
					);
			});
		return () => {
			controller.abort();
		};
	}, [fetcher, projectId, refresh]);

	useEffect(() => {
		setDiff(null);
		setDiffError(null);
		if (selected === null) return;
		const controller = new AbortController();
		void fetchProjectJson<ProjectGitDiffResponse>(
			projectApiUrl(projectId, "diff", 0, selected.path),
			controller.signal,
			fetcher,
		)
			.then(setDiff)
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setDiffError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			controller.abort();
		};
	}, [fetcher, projectId, selected]);

	const mediaUrl =
		selected === null
			? null
			: projectApiUrl(projectId, "file", 0, selected.path);

	return (
		<section
			className="grid h-full min-h-0 min-w-0 grid-cols-[280px_minmax(0,1fr)] max-[780px]:grid-cols-1 max-[780px]:grid-rows-[minmax(300px,42dvh)_minmax(360px,1fr)]"
			aria-label="Project changes"
		>
			<aside className="min-h-0 min-w-0 overflow-y-auto border-r bg-card max-[780px]:border-r-0 max-[780px]:border-b">
				<header className="flex min-h-14 items-center gap-3 border-b px-3 py-2">
					<div className="min-w-0 flex-1">
						<strong className="block truncate text-[13px]">
							Working changes
						</strong>
						<small className="block truncate text-[13px] text-muted-foreground">
							{status?.available === true ? (
								<>
									<span>{status.branch ?? "Detached HEAD"}</span> ·{" "}
									<span>{status.head ?? "No commit"}</span>
								</>
							) : (
								"Compared with HEAD"
							)}
						</small>
					</div>
					<button
						type="button"
						className="grid size-9 place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Refresh changes"
						onClick={() => {
							setRefresh((value) => value + 1);
						}}
					>
						↻
					</button>
				</header>
				<div className="border-b px-4 py-3">
					{status?.available === true && (
						<>
							<strong className="block text-[13px]">
								{status.clean
									? "Clean"
									: `${String(status.files.length)} changed`}
							</strong>
							<span className="mt-1 block text-xs text-muted-foreground">
								Working tree compared with HEAD
							</span>
						</>
					)}
					{status === null && statusError === null && (
						<span className="text-xs text-muted-foreground">
							Reading Git status…
						</span>
					)}
				</div>
				<div aria-live="polite">
					{statusError !== null && (
						<div className="p-5 text-xs text-destructive">{statusError}</div>
					)}
					{status?.available === false && (
						<div className="p-5">
							<strong>Git unavailable</strong>
							<p className="mt-1 text-xs text-muted-foreground">
								{status.reason}
							</p>
						</div>
					)}
					{status?.available === true && status.clean && (
						<div className="p-5">
							<strong>Working tree clean</strong>
							<p className="mt-1 text-xs text-muted-foreground">
								No differences from HEAD.
							</p>
						</div>
					)}
					{status?.available === true &&
						status.files.map((change) => (
							<button
								key={`${change.oldPath ?? ""}:${change.path}`}
								type="button"
								className="grid min-h-11 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent px-3 py-1 text-left hover:bg-hover aria-pressed:bg-selection"
								aria-label={`Open change ${change.path}`}
								aria-pressed={selected?.path === change.path}
								onClick={() => {
									setSelected(change);
								}}
							>
								<span
									className="grid size-7 place-items-center font-mono text-xs text-muted-foreground"
									aria-hidden="true"
								>
									{statusMark(change)}
								</span>
								<span className="min-w-0">
									<strong className="block truncate text-[13px]">
										{change.path.split("/").at(-1)}
									</strong>
									<small className="block truncate text-[13px] text-muted-foreground">
										{change.oldPath === undefined
											? change.path
											: `${change.oldPath} → ${change.path}`}
									</small>
								</span>
								<span className="flex gap-1 font-mono text-xs">
									{change.additions === null ? (
										<i className="text-muted-foreground not-italic">—</i>
									) : (
										<b className="text-[var(--status-success)]">
											+{change.additions}
										</b>
									)}
									{change.deletions === null ? (
										<i className="text-muted-foreground not-italic">—</i>
									) : (
										<em className="text-destructive not-italic">
											−{change.deletions}
										</em>
									)}
								</span>
							</button>
						))}
					{status?.available === true && status.truncated && (
						<div className="px-3 py-2.5 text-xs text-muted-foreground">
							Showing first 500 changed files.
						</div>
					)}
				</div>
			</aside>

			<div className="min-h-0 min-w-0 overflow-auto bg-background">
				{selected === null ? (
					<div className="grid min-h-full place-items-center text-center">
						<div>
							<span
								className="font-mono text-muted-foreground"
								aria-hidden="true"
							>
								±
							</span>
							<strong className="mt-3 block text-[13px]">
								Select a change
							</strong>
							<p className="mt-1 text-xs text-muted-foreground">
								Review exact working-tree differences from HEAD.
							</p>
						</div>
					</div>
				) : (
					<>
						<header className="flex min-h-14 items-center justify-between gap-3 border-b px-3 py-2">
							<div className="min-w-0">
								<strong className="block truncate text-[13px]">
									{selected.path}
								</strong>
								<small className="block truncate text-[13px] text-muted-foreground">
									{selected.status} · working tree vs HEAD
								</small>
							</div>
							<span className="font-mono text-xs text-muted-foreground">
								{statusMark(selected)}
							</span>
						</header>
						<div className="p-5">
							{selected.status !== "deleted" &&
								selected.preview === "image" &&
								mediaUrl !== null && (
									<div className="mb-4">
										<small className="text-xs text-muted-foreground">
											Current image
										</small>
										<img
											className="mt-2 max-h-[50vh] rounded-sm border"
											src={mediaUrl}
											alt={`Preview ${selected.path}`}
										/>
									</div>
								)}
							{selected.status !== "deleted" &&
								selected.preview === "video" &&
								mediaUrl !== null && (
									<div className="mb-4">
										<small className="text-xs text-muted-foreground">
											Current video
										</small>
										<video
											className="mt-2 max-h-[50vh] rounded-sm border"
											src={mediaUrl}
											aria-label={`Preview ${selected.path}`}
											controls
											muted
											playsInline
											preload="metadata"
										/>
									</div>
								)}
							{diffError !== null && (
								<div className="text-xs text-destructive">{diffError}</div>
							)}
							{diffError === null && diff === null && (
								<div className="text-xs text-muted-foreground">
									Reading diff…
								</div>
							)}
							{diffError === null && diff !== null && <Diff diff={diff} />}
						</div>
					</>
				)}
			</div>
		</section>
	);
}
