import type {
	ProjectDirectoryResponse,
	ProjectFileEntry,
} from "@commonspace/shared";
import {
	FileIcon,
	FileLock2Icon,
	FileSearchIcon,
	FileTextIcon,
	FolderIcon,
	ImageIcon,
	VideoIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { ResourceActionMenu } from "@/design-system/ResourceActionMenu";
import {
	fetchProjectJson,
	fetchProjectText,
	folderName,
	formatFileSize,
	projectApiUrl,
} from "./project-files-api.ts";

export interface CommonspaceProjectFilesProps {
	projectId: string;
	roots: readonly string[];
	targetFile?: { rootIndex: number; path: string } | null;
	fetcher?: typeof globalThis.fetch;
}

function entryIcon(entry: ProjectFileEntry): ReactNode {
	if (entry.kind === "directory") return <FolderIcon />;
	if (entry.preview === "image") return <ImageIcon />;
	if (entry.preview === "video") return <VideoIcon />;
	if (entry.preview === "text") return <FileTextIcon />;
	if (entry.preview === "blocked") return <FileLock2Icon />;
	return <FileIcon />;
}

export function CommonspaceProjectFiles({
	projectId,
	roots,
	targetFile = null,
	fetcher = globalThis.fetch,
}: CommonspaceProjectFilesProps) {
	const [rootIndex, setRootIndex] = useState(targetFile?.rootIndex ?? 0);
	const [directoryPath, setDirectoryPath] = useState(
		targetFile?.path.split("/").slice(0, -1).join("/") ?? "",
	);
	const [listing, setListing] = useState<ProjectDirectoryResponse | null>(null);
	const [selected, setSelected] = useState<ProjectFileEntry | null>(null);
	const [text, setText] = useState<string | null>(null);
	const [listingError, setListingError] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);

	useEffect(() => {
		if (targetFile === null) return;
		setRootIndex(targetFile.rootIndex);
		setDirectoryPath(targetFile.path.split("/").slice(0, -1).join("/"));
		setSelected(null);
	}, [targetFile]);

	useEffect(() => {
		const controller = new AbortController();
		setListing(null);
		setListingError(null);
		setSelected(null);
		setText(null);
		void fetchProjectJson<ProjectDirectoryResponse>(
			projectApiUrl(projectId, "files", rootIndex, directoryPath),
			controller.signal,
			fetcher,
		)
			.then(setListing)
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setListingError(
						cause instanceof Error ? cause.message : String(cause),
					);
			});
		return () => {
			controller.abort();
		};
	}, [directoryPath, fetcher, projectId, rootIndex]);

	useEffect(() => {
		setText(null);
		setPreviewError(null);
		if (selected?.kind !== "file" || selected.preview !== "text") return;
		const controller = new AbortController();
		void fetchProjectText(
			projectApiUrl(projectId, "file", rootIndex, selected.path),
			controller.signal,
			fetcher,
		)
			.then(setText)
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setPreviewError(
						cause instanceof Error ? cause.message : String(cause),
					);
			});
		return () => {
			controller.abort();
		};
	}, [fetcher, projectId, rootIndex, selected]);

	useEffect(() => {
		if (
			targetFile === null ||
			listing === null ||
			listing.rootIndex !== targetFile.rootIndex
		)
			return;
		const match = listing.entries.find(
			(entry) => entry.kind === "file" && entry.path === targetFile.path,
		);
		if (match !== undefined) setSelected(match);
	}, [listing, targetFile]);

	const breadcrumbs = useMemo(() => {
		const segments = directoryPath === "" ? [] : directoryPath.split("/");
		return segments.map((name, index) => ({
			name,
			path: segments.slice(0, index + 1).join("/"),
		}));
	}, [directoryPath]);

	if (roots.length === 0) {
		return (
			<Empty className="h-full rounded-none border-0">
				<EmptyHeader>
					<EmptyMedia variant="icon" className="size-10 rounded-md">
						<FolderIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No project folder</EmptyTitle>
					<EmptyDescription>
						Add a local folder to browse files.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const mediaUrl =
		selected?.kind === "file"
			? projectApiUrl(projectId, "file", rootIndex, selected.path)
			: null;

	return (
		<section
			className="grid h-full min-h-0 min-w-0 text-foreground grid-cols-[330px_minmax(0,1fr)] max-[780px]:grid-cols-1 max-[780px]:grid-rows-[minmax(300px,42dvh)_minmax(360px,1fr)]"
			aria-label="Project files"
		>
			<aside className="min-h-0 min-w-0 overflow-y-auto border-r bg-[color-mix(in_oklch,var(--background)_55%,var(--muted))] max-[780px]:border-r-0 max-[780px]:border-b">
				<header className="grid min-h-[58px] grid-cols-[48px_minmax(0,1fr)] items-center gap-2 border-b px-3 py-2">
					<div>
						<strong className="block text-[13px]">Files</strong>
						<small className="hidden">Read-only project browser</small>
					</div>
					<NativeSelect
						className="min-w-0"
						aria-label="Project folder"
						title="Choose a project folder"
						value={rootIndex}
						onChange={(event) => {
							setRootIndex(Number(event.target.value));
							setDirectoryPath("");
						}}
					>
						{roots.map((root, index) => (
							<option key={root} value={index}>
								{folderName(root)}
							</option>
						))}
					</NativeSelect>
				</header>

				<nav
					className="flex min-h-[54px] items-center gap-1 overflow-x-auto border-b px-3 text-xs whitespace-nowrap"
					aria-label="File path"
				>
					<button
						className="min-h-10 rounded-sm border-0 bg-transparent px-2 hover:bg-muted aria-[current=page]:bg-muted"
						type="button"
						aria-current={directoryPath === "" ? "page" : undefined}
						onClick={() => {
							setDirectoryPath("");
						}}
					>
						{folderName(roots[rootIndex] ?? "")}
					</button>
					{breadcrumbs.map((crumb) => (
						<span key={crumb.path} className="flex items-center gap-1">
							<i
								className="text-muted-foreground not-italic"
								aria-hidden="true"
							>
								/
							</i>
							<button
								className="min-h-10 rounded-sm border-0 bg-transparent px-2 hover:bg-muted aria-[current=page]:bg-muted"
								type="button"
								aria-current={crumb.path === directoryPath ? "page" : undefined}
								onClick={() => {
									setDirectoryPath(crumb.path);
								}}
							>
								{crumb.name}
							</button>
						</span>
					))}
				</nav>

				<div aria-live="polite">
					{listing === null && listingError === null && (
						<div className="p-5 text-xs text-muted-foreground">
							Reading folder…
						</div>
					)}
					{listingError !== null && (
						<div className="p-5 text-xs text-destructive">{listingError}</div>
					)}
					{listing?.entries.map((entry) => {
						const openEntry = () => {
							if (entry.kind === "directory") setDirectoryPath(entry.path);
							else setSelected(entry);
						};
						return (
							<div
								key={entry.path}
								className="group grid grid-cols-[minmax(0,1fr)_44px] items-center border-b"
							>
								<button
									type="button"
									className="grid min-h-12 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent px-3 py-1 text-left hover:bg-muted aria-pressed:bg-muted"
									aria-label={`${entry.kind === "directory" ? "Open folder" : "Open file"} ${entry.name}`}
									aria-pressed={
										entry.kind === "file" && selected?.path === entry.path
									}
									onClick={openEntry}
								>
									<span
										className="grid size-7 place-items-center rounded-sm bg-muted text-muted-foreground [&_svg]:size-4"
										aria-hidden="true"
									>
										{entryIcon(entry)}
									</span>
									<span className="truncate text-xs font-semibold">
										{entry.name}
									</span>
									<small className="text-xs text-muted-foreground">
										{entry.kind === "directory"
											? "Folder"
											: formatFileSize(entry.size)}
									</small>
								</button>
								<ResourceActionMenu
									kind={entry.kind === "directory" ? "folder" : "file"}
									label={entry.name}
									meta={entry.kind === "directory" ? "Folder" : "File"}
									onOpen={openEntry}
									onCopy={() => {
										void navigator.clipboard
											?.writeText(entry.name)
											.catch(() => undefined);
									}}
								/>
							</div>
						);
					})}
					{listing?.entries.length === 0 && (
						<div className="p-5 text-xs text-muted-foreground">
							Folder is empty.
						</div>
					)}
					{listing?.truncated === true && (
						<div className="px-3 py-2.5 text-xs text-muted-foreground">
							Showing first 500 entries.
						</div>
					)}
				</div>
			</aside>

			<div className="min-h-0 min-w-0 overflow-auto bg-background">
				{selected === null ? (
					<Empty className="min-h-full rounded-none border-0 bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--muted)_55%,transparent),transparent_42%)]">
						<EmptyHeader className="rounded-xl border bg-background/85 px-10 py-9 shadow-sm backdrop-blur-sm">
							<EmptyMedia
								variant="icon"
								className="size-12 rounded-xl border bg-background text-primary shadow-sm [&_svg]:size-5"
							>
								<FileSearchIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Select a file to preview</EmptyTitle>
							<EmptyDescription>
								Text, images, and videos render here.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						<header className="flex min-h-[66px] items-center justify-between gap-3 border-b px-3 py-2">
							<div className="min-w-0">
								<strong className="block truncate text-[13px]">
									{selected.name}
								</strong>
								<small className="block truncate text-xs text-muted-foreground">
									{selected.path} · {formatFileSize(selected.size)}
								</small>
							</div>
							<span className="text-xs text-muted-foreground">
								{selected.preview ?? "binary"}
							</span>
						</header>
						<div className="p-5">
							{previewError !== null && (
								<div className="text-xs text-destructive">{previewError}</div>
							)}
							{previewError === null &&
								selected.preview === "text" &&
								text === null && (
									<div className="text-xs text-muted-foreground">
										Reading file…
									</div>
								)}
							{previewError === null &&
								selected.preview === "text" &&
								text !== null && (
									<pre className="overflow-auto rounded-md border bg-muted p-4 font-mono text-xs leading-[1.55]">
										<code>{text}</code>
									</pre>
								)}
							{previewError === null &&
								selected.preview === "image" &&
								mediaUrl !== null && (
									<img
										className="mx-auto max-h-[70vh] rounded-sm border"
										src={mediaUrl}
										alt={`Preview ${selected.name}`}
									/>
								)}
							{previewError === null &&
								selected.preview === "video" &&
								mediaUrl !== null && (
									<video
										className="mx-auto max-h-[70vh] rounded-sm border"
										src={mediaUrl}
										aria-label={`Preview ${selected.name}`}
										controls
										muted
										playsInline
										preload="metadata"
									/>
								)}
							{previewError === null && selected.preview === "binary" && (
								<div className="py-12 text-center">
									<strong>Preview unavailable</strong>
									<p className="mt-1 text-xs text-muted-foreground">
										Commonspace renders text, raster images, and videos only.
									</p>
								</div>
							)}
							{previewError === null && selected.preview === "blocked" && (
								<div className="py-12 text-center">
									<strong>Sensitive file</strong>
									<p className="mt-1 text-xs text-muted-foreground">
										Commonspace does not render credential-bearing files.
									</p>
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</section>
	);
}
