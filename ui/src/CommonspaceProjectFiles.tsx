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
	RefreshCwIcon,
	VideoIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
	fetchProjectBlob,
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The cohesive file browser keeps directory, selection, and preview resource ownership together.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The cohesive file browser avoids splitting tightly coupled request and object-URL lifecycles across prop-heavy wrappers.
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
	const [mediaUrl, setMediaUrl] = useState<string | null>(null);
	const [listingError, setListingError] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewAttempt, setPreviewAttempt] = useState(0);
	const [imageSizing, setImageSizing] = useState<"fit" | "actual">("fit");
	const targetRootIndex = targetFile?.rootIndex;
	const targetPath = targetFile?.path;
	const selectedPath = selected?.path;
	const selectedFilePath =
		selected?.kind === "file" ? selected.path : undefined;
	const selectedPreview =
		selected?.kind === "file" ? selected.preview : undefined;

	useEffect(() => {
		if (targetRootIndex === undefined || targetPath === undefined) return;
		setRootIndex(targetRootIndex);
		setDirectoryPath(targetPath.split("/").slice(0, -1).join("/"));
		setSelected(null);
	}, [targetPath, targetRootIndex]);

	useEffect(() => {
		void selectedPath;
		setImageSizing("fit");
	}, [selectedPath]);

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
		void previewAttempt;
		setText(null);
		setPreviewError(null);
		if (selectedFilePath === undefined || selectedPreview !== "text") return;
		const controller = new AbortController();
		void fetchProjectText(
			projectApiUrl(projectId, "file", rootIndex, selectedFilePath),
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
	}, [
		fetcher,
		previewAttempt,
		projectId,
		rootIndex,
		selectedFilePath,
		selectedPreview,
	]);

	useEffect(() => {
		void previewAttempt;
		setMediaUrl(null);
		setPreviewError(null);
		if (
			selectedFilePath === undefined ||
			(selectedPreview !== "image" && selectedPreview !== "video")
		)
			return;
		const controller = new AbortController();
		let objectUrl: string | null = null;
		const previewKind = selectedPreview;
		void fetchProjectBlob(
			projectApiUrl(projectId, "file", rootIndex, selectedFilePath),
			controller.signal,
			previewKind === "image" ? "image/*" : "video/*",
			fetcher,
		)
			.then((blob) => {
				if (controller.signal.aborted) return;
				if (blob.type !== "" && !blob.type.startsWith(`${previewKind}/`))
					throw new Error(`File is not a supported ${previewKind}.`);
				objectUrl = URL.createObjectURL(blob);
				setMediaUrl(objectUrl);
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setPreviewError(
						cause instanceof Error ? cause.message : String(cause),
					);
			});
		return () => {
			controller.abort();
			if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
		};
	}, [
		fetcher,
		previewAttempt,
		projectId,
		rootIndex,
		selectedFilePath,
		selectedPreview,
	]);

	useEffect(() => {
		if (
			targetRootIndex === undefined ||
			targetPath === undefined ||
			listing === null ||
			listing.rootIndex !== targetRootIndex
		)
			return;
		const match = listing.entries.find(
			(entry) => entry.kind === "file" && entry.path === targetPath,
		);
		if (match !== undefined) setSelected(match);
	}, [listing, targetPath, targetRootIndex]);

	const breadcrumbs = useMemo(() => {
		const segments = directoryPath === "" ? [] : directoryPath.split("/");
		let path = "";
		return segments.map((name) => {
			path = path === "" ? name : `${path}/${name}`;
			return { name, path };
		});
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

	return (
		<section
			className="grid h-full min-h-0 min-w-0 text-foreground grid-cols-[280px_minmax(0,1fr)] max-[780px]:grid-cols-1 max-[780px]:grid-rows-[minmax(300px,42dvh)_minmax(360px,1fr)]"
			aria-label="Project files"
		>
			<aside className="min-h-0 min-w-0 overflow-y-auto border-r bg-card max-[780px]:border-r-0 max-[780px]:border-b">
				<header className="grid min-h-14 grid-cols-[48px_minmax(0,1fr)] items-center gap-2 border-b px-3 py-2">
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
					className="flex min-h-10 items-center gap-1 overflow-x-auto border-b px-3 text-xs whitespace-nowrap"
					aria-label="File path"
				>
					<button
						className="min-h-10 rounded-sm border-0 bg-transparent px-2 hover:text-foreground aria-[current=page]:text-foreground"
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
								className="min-h-10 rounded-sm border-0 bg-transparent px-2 hover:text-foreground aria-[current=page]:text-foreground"
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
								className="group grid grid-cols-[minmax(0,1fr)_32px] items-center"
							>
								<button
									type="button"
									className="grid min-h-11 w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 border-0 bg-transparent px-3 py-1 text-left hover:bg-hover aria-pressed:bg-selection"
									aria-label={`${entry.kind === "directory" ? "Open folder" : "Open file"} ${entry.name}`}
									aria-pressed={
										entry.kind === "file" && selected?.path === entry.path
									}
									onClick={openEntry}
								>
									<span
										className="grid size-7 place-items-center rounded-sm bg-transparent text-muted-foreground [&_svg]:size-4"
										aria-hidden="true"
									>
										{entryIcon(entry)}
									</span>
									<span className="min-w-0 leading-tight">
										<span className="block truncate text-[13px] font-medium">
											{entry.name}
										</span>
										<small className="mt-0.5 block truncate text-xs text-muted-foreground">
											{entry.kind === "directory"
												? "Folder"
												: formatFileSize(entry.size)}
										</small>
									</span>
								</button>
								<ResourceActionMenu
									kind={entry.kind === "directory" ? "folder" : "file"}
									label={entry.name}
									meta={entry.kind === "directory" ? "Folder" : "File"}
									{...(entry.kind === "file" && selected?.path === entry.path
										? { triggerClassName: "opacity-100" }
										: {})}
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
					<Empty className="min-h-full rounded-none border-0">
						<EmptyHeader className="px-10 py-9">
							<EmptyMedia
								variant="icon"
								className="size-12 rounded-xl bg-muted text-muted-foreground [&_svg]:size-5"
							>
								<FileSearchIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Select a file to preview</EmptyTitle>
							<EmptyDescription>
								Browse text, images, and video. Files are read only.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						<header className="flex min-h-14 items-center justify-between gap-3 border-b px-3 py-2">
							<div className="min-w-0">
								<strong className="block truncate text-[13px]">
									{selected.name}
								</strong>
								<small className="block truncate text-[13px] text-muted-foreground">
									{selected.path === selected.name
										? formatFileSize(selected.size)
										: `${selected.path} · ${formatFileSize(selected.size)}`}
								</small>
							</div>
							<span className="text-xs text-muted-foreground">
								{selected.preview ?? "binary"}
							</span>
						</header>
						<div className="p-5">
							{previewError !== null && (
								<div
									className="grid min-h-[420px] place-items-center border-y bg-muted/15 px-6 py-12 text-center"
									role="alert"
								>
									<div className="max-w-sm">
										<strong>Preview unavailable</strong>
										<p className="mt-1 text-sm text-destructive">
											{previewError}
										</p>
										<p className="mt-2 text-xs leading-5 text-muted-foreground">
											Retry this file, or choose another file without losing
											your place.
										</p>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="mt-4"
											onClick={() => {
												setPreviewAttempt((attempt) => attempt + 1);
											}}
										>
											<RefreshCwIcon
												data-icon="inline-start"
												aria-hidden="true"
											/>
											Retry preview
										</Button>
									</div>
								</div>
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
								(selected.preview === "image" ||
									selected.preview === "video") &&
								mediaUrl === null && (
									<div className="text-xs text-muted-foreground">
										Loading preview…
									</div>
								)}
							{previewError === null &&
								selected.preview === "image" &&
								mediaUrl !== null && (
									<section aria-label={`${selected.name} image viewer`}>
										<div className="mb-3 flex items-center justify-end gap-1">
											<Button
												type="button"
												variant={imageSizing === "fit" ? "secondary" : "ghost"}
												size="sm"
												aria-pressed={imageSizing === "fit"}
												onClick={() => setImageSizing("fit")}
											>
												Fit
											</Button>
											<Button
												type="button"
												variant={
													imageSizing === "actual" ? "secondary" : "ghost"
												}
												size="sm"
												aria-pressed={imageSizing === "actual"}
												onClick={() => setImageSizing("actual")}
											>
												Actual size
											</Button>
										</div>
										<div className="flex min-h-[min(62vh,600px)] items-center justify-center overflow-auto border-y bg-muted/15 p-6">
											<img
												className={
													imageSizing === "fit"
														? "max-h-[58vh] max-w-full object-contain"
														: "max-w-none"
												}
												src={mediaUrl}
												alt={`Preview ${selected.name}`}
												onError={() => {
													setPreviewError("Preview could not be rendered.");
												}}
											/>
										</div>
									</section>
								)}
							{previewError === null &&
								selected.preview === "video" &&
								mediaUrl !== null && (
									<section
										aria-label={`${selected.name} video viewer`}
										className="flex min-h-[min(62vh,600px)] items-center justify-center overflow-hidden border-y bg-black/90 p-6"
									>
										<video
											className="max-h-[58vh] w-full max-w-[960px] bg-black"
											src={mediaUrl}
											aria-label={`Preview ${selected.name}`}
											controls
											muted
											playsInline
											preload="metadata"
											onError={() => {
												setPreviewError("Preview could not be rendered.");
											}}
										/>
									</section>
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
