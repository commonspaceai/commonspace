import type {
	CommonspaceRunAttribution,
	CommonspaceRunFileChange,
} from "@commonspace/shared";
import { useId, useState } from "react";

interface RunAttributionProps {
	attribution: CommonspaceRunAttribution;
	authorName: string;
	messageId: string;
	projectId: string;
}

function firstChangedLine(patch: string | undefined): number {
	const match = patch?.match(/^@@ -\d+(?:,\d+)? \+(\d+)/mu);
	return match?.[1] === undefined ? 1 : Number(match[1]);
}

function fileAnchor(
	messageId: string,
	rootIndex: number,
	path: string,
): string {
	return `run-${encodeURIComponent(messageId)}-${String(rootIndex)}-${encodeURIComponent(path)}`;
}

async function openInEditor(
	projectId: string,
	rootIndex: number,
	change: CommonspaceRunFileChange,
): Promise<void> {
	await fetch(`/api/projects/${encodeURIComponent(projectId)}/open`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			rootIndex,
			path: change.path,
			line: firstChangedLine(change.patch),
		}),
	});
}

export function RunAttribution({
	attribution,
	authorName,
	messageId,
	projectId,
}: RunAttributionProps) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const panelId = useId();
	const available = attribution.roots.filter((root) => root.available);
	const observedCount = available.reduce(
		(total, root) => total + root.observed.length,
		0,
	);
	const preExistingCount = available.reduce(
		(total, root) => total + root.preExisting.length,
		0,
	);
	const fileLabel = `${String(observedCount)} file${observedCount === 1 ? "" : "s"} changed`;

	return (
		<div className="mt-3 overflow-hidden rounded-md">
			<button
				type="button"
				className="grid min-h-9 w-full grid-cols-[18px_auto_minmax(0,1fr)_18px] items-center gap-2 border-0 bg-transparent px-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
				aria-expanded={open}
				aria-controls={panelId}
				aria-label={`${open ? "Hide" : "Show"} run evidence for ${authorName}`}
				onClick={() => {
					setOpen((value) => !value);
				}}
			>
				<span aria-hidden="true">±</span>
				<span>Run evidence</span>
				<span
					className="truncate"
					title={`${fileLabel} · ${String(preExistingCount)} pre-existing`}
				>
					{fileLabel} · {String(preExistingCount)} pre-existing
				</span>
				<span aria-hidden="true">⌄</span>
			</button>
			{open && (
				<section
					id={panelId}
					className="border-t py-3"
					aria-label={`${authorName} run evidence`}
				>
					{attribution.roots.map((root) =>
						root.available ? (
							<div
								key={root.rootIndex}
								className="min-w-0 [&+&]:mt-4 [&+&]:border-t [&+&]:pt-4"
							>
								<header className="flex items-center justify-between gap-2 text-xs">
									<strong>Folder {String(root.rootIndex + 1)}</strong>
									<span className="font-mono text-muted-foreground">
										{root.branch ?? "detached HEAD"}
									</span>
								</header>
								{root.preExisting.length > 0 && (
									<div className="mt-2 grid gap-1 text-xs text-muted-foreground">
										<strong>Present before run</strong>
										<span className="break-words">
											{root.preExisting.map((change) => change.path).join(", ")}
										</span>
									</div>
								)}
								{root.observed.length === 0 ? (
									<p className="mt-3 text-xs text-muted-foreground">
										No repository changes observed during this run.
									</p>
								) : (
									<ul className="mt-3 grid gap-1">
										{root.observed.map((change) => {
											const anchor = fileAnchor(
												messageId,
												root.rootIndex,
												change.path,
											);
											const expanded = selected === anchor;
											return (
												<li key={anchor} id={anchor}>
													<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 text-xs">
														<a
															className="col-span-2 min-w-0 break-words font-medium leading-5 text-foreground underline-offset-4 hover:underline"
															href={`#${anchor}`}
															aria-expanded={expanded}
															onClick={() => {
																setSelected(expanded ? null : anchor);
															}}
														>
															{change.path}
														</a>
														<span className="min-w-0 text-muted-foreground">
															{change.status}
															{change.preExisting ? " · also pre-existing" : ""}
															{" · "}
															<span className="whitespace-nowrap">
																+{change.additions ?? "–"} / −
																{change.deletions ?? "–"}
															</span>
														</span>
														<button
															type="button"
															className="min-h-8 whitespace-nowrap text-muted-foreground hover:text-foreground"
															aria-label={`Open ${change.path} in editor`}
															onClick={() => {
																void openInEditor(
																	root.projectId ?? projectId,
																	root.projectRootIndex ?? root.rootIndex,
																	change,
																);
															}}
														>
															Open in editor
														</button>
													</div>
													{expanded && change.patch !== undefined && (
														<pre className="overflow-x-auto rounded-sm border bg-muted p-3 font-mono text-xs">
															<code>{change.patch}</code>
														</pre>
													)}
												</li>
											);
										})}
									</ul>
								)}
							</div>
						) : (
							<p key={root.rootIndex} className="text-xs text-muted-foreground">
								Folder {String(root.rootIndex + 1)}: {root.reason}
							</p>
						),
					)}
				</section>
			)}
		</div>
	);
}
