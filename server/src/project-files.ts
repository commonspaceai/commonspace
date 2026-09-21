import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
	type FileHandle,
	open,
	readdir,
	realpath,
	stat,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type {
	CommonspaceState,
	ProjectDirectoryResponse,
	ProjectFileEntry,
	ProjectFilePreview,
	ProjectGitDiffResponse,
	ProjectGitFileChange,
	ProjectGitFileStatus,
	ProjectGitStatusResponse,
} from "@commonspace/shared";
import { z } from "zod";
import { credentialBearingFileName } from "./credential-files.js";

const execFileAsync = promisify(execFile);
const MAX_DIRECTORY_ENTRIES = 500;
const MAX_GIT_FILES = 500;
const MAX_PATCH_LINES = 2_000;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 25 * 1024 * 1024;
const GIT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const TEXT_NAMES = new Set([
	".editorconfig",
	".gitattributes",
	".gitignore",
	".npmrc",
	".prettierignore",
	".prettierrc",
	"dockerfile",
	"license",
	"makefile",
	"procfile",
	"readme",
]);
const TEXT_EXTENSIONS = new Set([
	".c",
	".cc",
	".conf",
	".cpp",
	".cs",
	".css",
	".csv",
	".diff",
	".env",
	".go",
	".graphql",
	".h",
	".hpp",
	".htm",
	".html",
	".ini",
	".java",
	".js",
	".json",
	".jsonc",
	".jsx",
	".kt",
	".less",
	".log",
	".lua",
	".md",
	".mdx",
	".mjs",
	".mts",
	".patch",
	".php",
	".plist",
	".properties",
	".py",
	".rb",
	".rs",
	".sass",
	".scss",
	".sh",
	".sql",
	".svelte",
	".svg",
	".swift",
	".toml",
	".ts",
	".tsx",
	".txt",
	".vue",
	".xml",
	".yaml",
	".yml",
	".zsh",
]);
const IMAGE_CONTENT_TYPES = new Map([
	[".avif", "image/avif"],
	[".gif", "image/gif"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
]);
const VIDEO_CONTENT_TYPES = new Map([
	[".avi", "video/x-msvideo"],
	[".m4v", "video/x-m4v"],
	[".mkv", "video/x-matroska"],
	[".mov", "video/quicktime"],
	[".mp4", "video/mp4"],
	[".ogv", "video/ogg"],
	[".webm", "video/webm"],
]);
export class ProjectFileError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

interface ProjectPath {
	root: string;
	absolutePath: string;
	relativePath: string;
}

interface ProjectPathLookup {
	readonly projectId: string;
	readonly rootIndex: number;
	readonly path: string;
	readonly allowRoot: boolean;
}

export interface OpenProjectFile extends ProjectPath {
	/** Caller closes this descriptor after preview or diff consumption. */
	handle: FileHandle;
	name: string;
	size: number;
	preview: ProjectFilePreview;
	contentType: string;
}

export const ProjectEditorTarget = z.strictObject({
	path: z.string(),
	rootIndex: z.number(),
	line: z.number(),
});
export type ProjectEditorTarget = z.infer<typeof ProjectEditorTarget>;

export async function openProjectFileInEditor(
	state: CommonspaceState,
	projectId: string,
	{ rootIndex, path, line }: ProjectEditorTarget,
	editorPath = process.env.COMMONSPACE_EDITOR_PATH ?? "code",
): Promise<{ opened: true }> {
	if (!Number.isSafeInteger(line) || line < 1 || line > 10_000_000) {
		throw new ProjectFileError(
			400,
			"invalid_project_line",
			"Editor line must be a positive integer",
		);
	}
	const target = await resolveProjectPath(state, {
		projectId,
		rootIndex,
		path,
		allowRoot: false,
	});
	const info = await stat(target.absolutePath);
	if (!info.isFile())
		throw new ProjectFileError(
			400,
			"project_path_not_file",
			"Project path is not a file",
		);
	await execFileAsync(
		editorPath,
		["--goto", `${target.absolutePath}:${String(line)}`],
		{ timeout: 10_000 },
	);
	return { opened: true };
}

interface FileClassification {
	preview: ProjectFilePreview;
	contentType: string;
}

interface ParsedGitChange {
	path: string;
	oldPath?: string;
	indexStatus: string;
	worktreeStatus: string;
	status: ProjectGitFileStatus;
}

type GitLineCounts = Pick<ProjectGitFileChange, "additions" | "deletions">;

function safeRelativePath(value: string, allowRoot: boolean): string {
	if (value === "" && allowRoot) return "";
	if (
		value === "" ||
		value.length > 4_096 ||
		value.includes("\0") ||
		value.includes("\\") ||
		isAbsolute(value)
	) {
		throw new ProjectFileError(
			400,
			"invalid_project_path",
			"Project path must be a relative path",
		);
	}
	const segments = value.split("/");
	if (
		segments.some(
			(segment) =>
				segment === "" ||
				segment === "." ||
				segment === ".." ||
				segment.toLocaleLowerCase() === ".git",
		)
	) {
		throw new ProjectFileError(
			400,
			"invalid_project_path",
			"Project path contains an invalid segment",
		);
	}
	return segments.join("/");
}

function insideRoot(root: string, target: string): boolean {
	const offset = relative(root, target);
	return (
		offset === "" ||
		(!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset))
	);
}

async function resolveProjectPath(
	state: CommonspaceState,
	{ projectId, rootIndex, path, allowRoot }: ProjectPathLookup,
): Promise<ProjectPath> {
	const project = state.projects.find(
		(candidate) => candidate.id === projectId,
	);
	if (project === undefined)
		throw new ProjectFileError(404, "project_not_found", "Project not found");
	const configuredRoot = project.paths[rootIndex];
	if (configuredRoot === undefined)
		throw new ProjectFileError(
			400,
			"invalid_project_root",
			"Project folder not found",
		);
	const relativePath = safeRelativePath(path, allowRoot);
	const root = await realpath(configuredRoot);
	const candidate =
		relativePath === "" ? root : join(root, ...relativePath.split("/"));
	let absolutePath: string;
	try {
		absolutePath = await realpath(candidate);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new ProjectFileError(
				404,
				"project_path_not_found",
				"Project path not found",
			);
		}
		throw error;
	}
	if (!insideRoot(root, absolutePath)) {
		throw new ProjectFileError(
			403,
			"project_path_outside_root",
			"Project path resolves outside its folder",
		);
	}
	safeRelativePath(relative(root, absolutePath), allowRoot);
	return { root, absolutePath, relativePath };
}

function assertSafeFileName(path: string): void {
	if (credentialBearingFileName(basename(path))) {
		throw new ProjectFileError(
			403,
			"project_file_sensitive",
			"Sensitive files cannot be previewed",
		);
	}
}

function namedClassification(name: string): FileClassification {
	const lowerName = name.toLocaleLowerCase();
	if (credentialBearingFileName(basename(lowerName)))
		return { preview: "blocked", contentType: "application/octet-stream" };
	const extension = extname(lowerName);
	const image = IMAGE_CONTENT_TYPES.get(extension);
	if (image !== undefined) return { preview: "image", contentType: image };
	const video = VIDEO_CONTENT_TYPES.get(extension);
	if (video !== undefined) return { preview: "video", contentType: video };
	const basenameWithoutExtension =
		extension === "" ? lowerName : lowerName.slice(0, -extension.length);
	if (
		TEXT_EXTENSIONS.has(extension) ||
		TEXT_NAMES.has(lowerName) ||
		TEXT_NAMES.has(basenameWithoutExtension) ||
		lowerName.startsWith(".env")
	) {
		if (extension === ".md" || extension === ".mdx")
			return { preview: "text", contentType: "text/markdown; charset=utf-8" };
		if (extension === ".json" || extension === ".jsonc")
			return {
				preview: "text",
				contentType: "application/json; charset=utf-8",
			};
		return { preview: "text", contentType: "text/plain; charset=utf-8" };
	}
	return { preview: "binary", contentType: "application/octet-stream" };
}

async function inspectClassification(
	path: string,
	name: string,
	size: number,
): Promise<FileClassification> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		return await classifyOpenFile(handle, name, size);
	} finally {
		await handle.close();
	}
}

async function classifyOpenFile(
	handle: FileHandle,
	name: string,
	size: number,
): Promise<FileClassification> {
	const named = namedClassification(name);
	if (named.preview !== "binary" || size === 0) {
		return size === 0 && named.preview === "binary"
			? { preview: "text", contentType: "text/plain; charset=utf-8" }
			: named;
	}
	try {
		const probe = Buffer.alloc(Math.min(size, 1_024));
		const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
		const bytes = probe.subarray(0, bytesRead);
		if (bytes.includes(0)) return named;
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { preview: "text", contentType: "text/plain; charset=utf-8" };
	} catch (error) {
		if (error instanceof TypeError) return named;
		throw error;
	}
}

export async function listProjectFiles(
	state: CommonspaceState,
	projectId: string,
	rootIndex: number,
	path: string,
): Promise<ProjectDirectoryResponse> {
	const resolved = await resolveProjectPath(state, {
		projectId,
		rootIndex,
		path,
		allowRoot: true,
	});
	const directory = await stat(resolved.absolutePath);
	if (!directory.isDirectory())
		throw new ProjectFileError(
			400,
			"project_path_not_directory",
			"Project path is not a directory",
		);
	const children = (
		await readdir(resolved.absolutePath, { withFileTypes: true })
	)
		.filter((entry) => entry.name !== ".git" && !entry.isSymbolicLink())
		.sort((left, right) => {
			if (left.isDirectory() !== right.isDirectory())
				return left.isDirectory() ? -1 : 1;
			return left.name.localeCompare(right.name, undefined, {
				sensitivity: "base",
				numeric: true,
			});
		});
	const visible = children.slice(0, MAX_DIRECTORY_ENTRIES);
	const entries = (
		await Promise.all(
			visible.map(async (entry): Promise<ProjectFileEntry | null> => {
				const entryPath =
					resolved.relativePath === ""
						? entry.name
						: `${resolved.relativePath}/${entry.name}`;
				if (entry.isDirectory())
					return { name: entry.name, path: entryPath, kind: "directory" };
				if (!entry.isFile()) return null;
				try {
					const file = await stat(join(resolved.absolutePath, entry.name));
					const classification = await inspectClassification(
						join(resolved.absolutePath, entry.name),
						entry.name,
						file.size,
					);
					return {
						name: entry.name,
						path: entryPath,
						kind: "file",
						size: file.size,
						preview: classification.preview,
						contentType: classification.contentType,
					};
				} catch {
					return null;
				}
			}),
		)
	).filter((entry): entry is ProjectFileEntry => entry !== null);
	return {
		projectId,
		rootIndex,
		path: resolved.relativePath,
		entries,
		truncated: children.length > visible.length,
	};
}

export async function openProjectFile(
	state: CommonspaceState,
	projectId: string,
	rootIndex: number,
	path: string,
): Promise<OpenProjectFile> {
	const resolved = await resolveProjectPath(state, {
		projectId,
		rootIndex,
		path,
		allowRoot: false,
	});
	assertSafeFileName(resolved.relativePath);
	assertSafeFileName(resolved.absolutePath);
	const handle = await open(
		resolved.absolutePath,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const file = await handle.stat();
		const canonical = await realpath(resolved.absolutePath);
		const current = await stat(resolved.absolutePath);
		if (
			canonical !== resolved.absolutePath ||
			current.dev !== file.dev ||
			current.ino !== file.ino
		) {
			throw new ProjectFileError(
				409,
				"project_file_changed",
				"Project file changed while opening; retry the preview",
			);
		}
		if (!file.isFile())
			throw new ProjectFileError(
				400,
				"project_path_not_file",
				"Project path is not a file",
			);
		const name = basename(resolved.relativePath);
		const classification = await classifyOpenFile(handle, name, file.size);
		if (classification.preview === "blocked") {
			throw new ProjectFileError(
				403,
				"project_file_sensitive",
				"Sensitive files cannot be previewed",
			);
		}
		if (classification.preview === "binary") {
			throw new ProjectFileError(
				415,
				"project_file_not_previewable",
				"Only text, image, and video files can be previewed",
			);
		}
		if (
			classification.preview === "text" &&
			file.size > MAX_TEXT_PREVIEW_BYTES
		) {
			throw new ProjectFileError(
				413,
				"project_file_too_large",
				"Text preview exceeds 1 MiB",
			);
		}
		if (
			classification.preview === "image" &&
			file.size > MAX_IMAGE_PREVIEW_BYTES
		) {
			throw new ProjectFileError(
				413,
				"project_file_too_large",
				"Image preview exceeds 25 MiB",
			);
		}
		return {
			...resolved,
			handle,
			name,
			size: file.size,
			preview: classification.preview,
			contentType: classification.contentType,
		};
	} catch (error) {
		await handle.close();
		throw error;
	}
}

function byteRange(
	value: string,
	size: number,
): { start: number; end: number } {
	const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
	if (match === null || (match[1] === "" && match[2] === "")) {
		throw new ProjectFileError(
			416,
			"invalid_range",
			"Requested byte range is invalid",
		);
	}
	const first = match[1] ?? "";
	const second = match[2] ?? "";
	let start: number;
	let end: number;
	if (first === "") {
		const suffix = Number(second);
		if (!Number.isSafeInteger(suffix) || suffix < 1)
			throw new ProjectFileError(
				416,
				"invalid_range",
				"Requested byte range is invalid",
			);
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(first);
		end = second === "" ? size - 1 : Math.min(Number(second), size - 1);
	}
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= size ||
		end < start
	) {
		throw new ProjectFileError(
			416,
			"invalid_range",
			"Requested byte range is outside the file",
		);
	}
	return { start, end };
}

export async function streamProjectFile(
	req: IncomingMessage,
	res: ServerResponse,
	file: OpenProjectFile,
): Promise<void> {
	res.setHeader("accept-ranges", file.preview === "video" ? "bytes" : "none");
	res.setHeader("content-type", file.contentType);
	res.setHeader(
		"content-disposition",
		`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
	);
	res.setHeader("x-content-type-options", "nosniff");
	let start = 0;
	let end = file.size - 1;
	if (
		file.preview === "video" &&
		req.headers.range !== undefined &&
		file.size > 0
	) {
		const range = byteRange(req.headers.range, file.size);
		start = range.start;
		end = range.end;
		res.statusCode = 206;
		res.setHeader(
			"content-range",
			`bytes ${String(start)}-${String(end)}/${String(file.size)}`,
		);
	}
	const length = file.size === 0 ? 0 : end - start + 1;
	res.setHeader("content-length", String(length));
	if (length === 0) {
		res.end();
		return;
	}
	await pipeline(
		file.handle.createReadStream({ start, end, autoClose: false }),
		res,
	);
}

async function runGit(root: string, args: string[]): Promise<string> {
	const baseArgs = [
		"-c",
		"color.ui=false",
		"-c",
		"core.quotepath=false",
		"-c",
		"core.fsmonitor=false",
		"--no-optional-locks",
		"-C",
		root,
	];
	const options = {
		encoding: "utf8" as const,
		maxBuffer: GIT_MAX_BUFFER_BYTES,
		timeout: 5_000,
		windowsHide: true,
	};
	// Read names only: never collect credential-bearing configuration values.
	const config = await execFileAsync(
		"git",
		[...baseArgs, "config", "--null", "--name-only", "--list"],
		options,
	);
	const filterOverrides: string[] = [];
	for (const key of new Set(config.stdout.split("\0"))) {
		if (/^filter\..+\.(?:clean|smudge|process|required)$/iu.test(key)) {
			const value = key.toLocaleLowerCase().endsWith(".required")
				? "false"
				: "";
			filterOverrides.push("-c", `${key}=${value}`);
		}
	}
	const { stdout } = await execFileAsync(
		"git",
		[...baseArgs, ...filterOverrides, ...args],
		options,
	);
	return stdout;
}

async function optionalGit(
	root: string,
	args: string[],
): Promise<string | null> {
	try {
		return (await runGit(root, args)).trim();
	} catch {
		return null;
	}
}

async function exactGitRoot(root: string): Promise<string | null> {
	const discovered = await optionalGit(root, ["rev-parse", "--show-toplevel"]);
	if (discovered === null || discovered === "") return null;
	try {
		return (await realpath(discovered)) === (await realpath(root))
			? await realpath(root)
			: null;
	} catch {
		return null;
	}
}

function gitStatus(code: string): ProjectGitFileStatus {
	const index = code[0] ?? " ";
	const worktree = code[1] ?? " ";
	if (code === "??") return "untracked";
	if (index === "U" || worktree === "U" || code === "AA" || code === "DD")
		return "conflicted";
	if (index === "R" || worktree === "R") return "renamed";
	if (index === "D" || worktree === "D") return "deleted";
	if (index === "A" || worktree === "A" || index === "C" || worktree === "C")
		return "added";
	return "modified";
}

function parseGitStatus(output: string): ParsedGitChange[] {
	const records = output.split("\0");
	const changes: ParsedGitChange[] = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record === undefined || record.length < 3) continue;
		const code = record.slice(0, 2);
		if (code === "!!") continue;
		const path = record.slice(3);
		const renamed = /[RC]/u.test(code);
		const oldPath = renamed ? records[index + 1] : undefined;
		if (renamed) index += 1;
		const change: ParsedGitChange = {
			path,
			indexStatus: code[0] ?? " ",
			worktreeStatus: code[1] ?? " ",
			status: gitStatus(code),
		};
		if (oldPath !== undefined && oldPath !== "") change.oldPath = oldPath;
		changes.push(change);
	}
	return changes;
}

function parseNumstat(output: string): Map<string, GitLineCounts> {
	const counts = new Map<string, GitLineCounts>();
	for (const line of output.split("\n")) {
		if (line === "") continue;
		const firstTab = line.indexOf("\t");
		const secondTab = line.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) continue;
		const added = line.slice(0, firstTab);
		const deleted = line.slice(firstTab + 1, secondTab);
		const path = line.slice(secondTab + 1);
		counts.set(path, {
			additions: added === "-" ? null : Number(added),
			deletions: deleted === "-" ? null : Number(deleted),
		});
	}
	return counts;
}

function lineCount(text: string): number {
	if (text === "") return 0;
	const lines = text.split("\n").length;
	return text.endsWith("\n") ? lines - 1 : lines;
}

async function untrackedTextCounts(
	state: CommonspaceState,
	projectId: string,
	rootIndex: number,
	path: string,
): Promise<GitLineCounts> {
	try {
		const file = await openProjectFile(state, projectId, rootIndex, path);
		try {
			return {
				additions: lineCount(await readProjectText(file)),
				deletions: 0,
			};
		} finally {
			await file.handle.close();
		}
	} catch {
		return { additions: null, deletions: 0 };
	}
}

export async function projectGitStatus(
	state: CommonspaceState,
	projectId: string,
	rootIndex: number,
): Promise<ProjectGitStatusResponse> {
	const resolved = await resolveProjectPath(state, {
		projectId,
		rootIndex,
		path: "",
		allowRoot: true,
	});
	const gitRoot = await exactGitRoot(resolved.root);
	if (gitRoot === null)
		return {
			available: false,
			reason: "Working folder is not a standalone Git repository.",
			files: [],
		};
	const [statusOutput, branch, head] = await Promise.all([
		runGit(gitRoot, [
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
		]),
		optionalGit(gitRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
		optionalGit(gitRoot, ["rev-parse", "--short=10", "HEAD"]),
	]);
	const parsed = parseGitStatus(statusOutput);
	const numstat =
		head === null
			? new Map<string, GitLineCounts>()
			: parseNumstat(
					await runGit(gitRoot, [
						"diff",
						"--no-ext-diff",
						"--no-textconv",
						"--numstat",
						"HEAD",
						"--",
					]),
				);
	const files = await Promise.all(
		parsed
			.slice(0, MAX_GIT_FILES)
			.map(async (change): Promise<ProjectGitFileChange> => {
				const preview =
					change.oldPath !== undefined &&
					credentialBearingFileName(basename(change.oldPath))
						? "blocked"
						: namedClassification(change.path).preview;
				let counts: GitLineCounts;
				if (change.status !== "untracked") {
					counts = numstat.get(change.path) ?? {
						additions: null,
						deletions: null,
					};
				} else if (preview === "text") {
					counts = await untrackedTextCounts(
						state,
						projectId,
						rootIndex,
						change.path,
					);
				} else {
					counts = { additions: null, deletions: null };
				}
				const file: ProjectGitFileChange = {
					path: change.path,
					status: change.status,
					indexStatus: change.indexStatus,
					worktreeStatus: change.worktreeStatus,
					additions: counts.additions,
					deletions: counts.deletions,
					preview,
				};
				if (change.oldPath !== undefined) file.oldPath = change.oldPath;
				return file;
			}),
	);
	return {
		available: true,
		branch,
		head,
		clean: parsed.length === 0,
		files,
		truncated: parsed.length > files.length,
	};
}

function truncatePatch(patch: string): { patch: string; truncated: boolean } {
	const lines = patch.split("\n");
	if (lines.length <= MAX_PATCH_LINES) return { patch, truncated: false };
	return { patch: lines.slice(0, MAX_PATCH_LINES).join("\n"), truncated: true };
}

async function readProjectText(file: OpenProjectFile): Promise<string> {
	if (file.preview !== "text" || file.size > MAX_TEXT_PREVIEW_BYTES)
		throw new ProjectFileError(
			415,
			"project_file_not_previewable",
			"Only bounded text files can be read as text",
		);
	const buffer = Buffer.alloc(file.size + 1);
	let offset = 0;
	while (offset < buffer.length) {
		const { bytesRead } = await file.handle.read(
			buffer,
			offset,
			buffer.length - offset,
			offset,
		);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	if (offset !== file.size || (await file.handle.stat()).size !== file.size)
		throw new ProjectFileError(
			409,
			"project_file_changed",
			"Project file changed while reading; retry the preview",
		);
	return buffer.subarray(0, offset).toString("utf8");
}

async function untrackedPatch(
	file: OpenProjectFile,
	path: string,
): Promise<ProjectGitDiffResponse> {
	if (file.preview !== "text")
		return { path, patch: "", binary: true, truncated: false };
	const text = await readProjectText(file);
	const contentLines = text === "" ? [] : text.replace(/\n$/u, "").split("\n");
	const patch = [
		"--- /dev/null",
		`+++ b/${path}`,
		`@@ -0,0 +1,${String(contentLines.length)} @@`,
		...contentLines.map((line) => `+${line}`),
		"",
	].join("\n");
	return { path, ...truncatePatch(patch), binary: false };
}

export async function projectGitDiff(
	state: CommonspaceState,
	projectId: string,
	rootIndex: number,
	path: string,
): Promise<ProjectGitDiffResponse> {
	const relativePath = safeRelativePath(path, false);
	assertSafeFileName(relativePath);
	const status = await projectGitStatus(state, projectId, rootIndex);
	if (!status.available)
		throw new ProjectFileError(409, "git_unavailable", status.reason);
	const change = status.files.find(
		(candidate) => candidate.path === relativePath,
	);
	if (change === undefined)
		throw new ProjectFileError(
			404,
			"git_change_not_found",
			"Changed file not found",
		);
	if (change.oldPath !== undefined) assertSafeFileName(change.oldPath);
	const resolved = await resolveProjectPath(state, {
		projectId,
		rootIndex,
		path: "",
		allowRoot: true,
	});
	if (change.status === "untracked" || status.head === null) {
		const file = await openProjectFile(
			state,
			projectId,
			rootIndex,
			relativePath,
		);
		try {
			return await untrackedPatch(file, relativePath);
		} finally {
			await file.handle.close();
		}
	}
	const patch = await runGit(resolved.root, [
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--find-renames",
		"--unified=5",
		"HEAD",
		"--",
		relativePath,
	]);
	const bounded = truncatePatch(patch);
	return {
		path: relativePath,
		patch: bounded.patch,
		binary: /(^|\n)Binary files /u.test(patch),
		truncated: bounded.truncated,
	};
}
