import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type {
	CommonspaceRunFileChange,
	CommonspaceRunRootAttribution,
} from "@commonspace/shared";

const execFileAsync = promisify(execFile);
const MAX_PATCH_LINES = 2_000;
const MAX_PATCH_CHARS = 128_000;
const MAX_SNAPSHOT_FILE_BYTES = 2 * 1024 * 1024;

interface FileStatusChange {
	path: string;
	status: CommonspaceRunFileChange["status"];
}

interface SnapshotChange extends FileStatusChange {
	content: string | null;
}

interface BoundedPatch {
	patch?: string;
	patchTruncated?: boolean;
}

interface RunComparison {
	before: RunSnapshot;
	after: RunSnapshot;
	beforeByPath: ReadonlyMap<string, SnapshotChange>;
	afterByPath: ReadonlyMap<string, SnapshotChange>;
	committedByPath: ReadonlyMap<string, FileStatusChange>;
}

export interface RunSnapshot {
	available: boolean;
	reason?: string;
	root: string;
	branch: string | null;
	head: string | null;
	changes: SnapshotChange[];
}

async function git(root: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["-c", "color.ui=false", "-c", "core.quotepath=false", "-C", root, ...args],
		{
			encoding: "utf8",
			maxBuffer: 8 * 1024 * 1024,
			timeout: 5_000,
		},
	);
	return stdout;
}

async function optionalGit(
	root: string,
	args: string[],
): Promise<string | null> {
	try {
		return (await git(root, args)).trim();
	} catch {
		return null;
	}
}

function statusOf(code: string): CommonspaceRunFileChange["status"] {
	if (code === "??") return "untracked";
	if (code.includes("U") || code === "AA" || code === "DD") return "conflicted";
	if (code.includes("R")) return "renamed";
	if (code.includes("D")) return "deleted";
	if (code.includes("A") || code.includes("C")) return "added";
	return "modified";
}

function parseStatus(output: string): FileStatusChange[] {
	const records = output.split("\0");
	const changes: FileStatusChange[] = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record === undefined || record.length < 4) continue;
		const code = record.slice(0, 2);
		const path = record.slice(3);
		const renamed = code.includes("R") || code.includes("C");
		if (renamed) index += 1;
		changes.push({ path, status: statusOf(code) });
	}
	return changes;
}

function sensitive(path: string): boolean {
	const name = basename(path).toLocaleLowerCase();
	return (
		name === ".env" ||
		name.startsWith(".env.") ||
		name === ".netrc" ||
		name === ".npmrc" ||
		name === ".pypirc" ||
		/^(?:auth|credential|credentials|secret|secrets)(?:\.[^.]+)*$/u.test(
			name,
		) ||
		/^(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)$/u.test(name) ||
		/\.(?:key|pem|p12|pfx)$/u.test(name)
	);
}

async function textFile(path: string): Promise<string | null> {
	try {
		if (sensitive(path)) return null;
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_SNAPSHOT_FILE_BYTES) return null;
		const content = await readFile(path);
		if (content.includes(0)) return null;
		return new TextDecoder("utf-8", { fatal: true }).decode(content);
	} catch {
		return null;
	}
}

export async function captureRunSnapshot(root: string): Promise<RunSnapshot> {
	let canonical: string;
	try {
		canonical = await realpath(root);
	} catch {
		return {
			available: false,
			reason: "Working folder is unavailable.",
			root,
			branch: null,
			head: null,
			changes: [],
		};
	}
	const gitRoot = await optionalGit(canonical, [
		"rev-parse",
		"--show-toplevel",
	]);
	if (gitRoot === null || (await realpath(gitRoot)) !== canonical) {
		return {
			available: false,
			reason: "Working folder is not a standalone Git repository.",
			root: canonical,
			branch: null,
			head: null,
			changes: [],
		};
	}
	const [status, branch, head] = await Promise.all([
		git(canonical, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		optionalGit(canonical, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
		optionalGit(canonical, ["rev-parse", "HEAD"]),
	]);
	const changes = await Promise.all(
		parseStatus(status).map(async (change) => ({
			...change,
			content:
				change.status === "deleted"
					? null
					: await textFile(join(canonical, ...change.path.split("/"))),
		})),
	);
	return { available: true, root: canonical, branch, head, changes };
}

async function contentAtHead(
	root: string,
	head: string | null,
	path: string,
): Promise<string | null> {
	if (head === null || sensitive(path)) return null;
	try {
		return await git(root, ["show", `${head}:${path}`]);
	} catch {
		return null;
	}
}

async function unifiedPatch(
	path: string,
	before: string | null,
	after: string | null,
): Promise<BoundedPatch> {
	if (before === null && after === null) return {};
	const directory = await mkdtemp(join(tmpdir(), "commonspace-run-diff-"));
	try {
		const beforePath = join(directory, "before");
		const afterPath = join(directory, "after");
		await writeFile(beforePath, before ?? "");
		await writeFile(afterPath, after ?? "");
		let output = "";
		try {
			output = await git(directory, [
				"diff",
				"--no-index",
				"--no-color",
				"--unified=5",
				"--",
				beforePath,
				afterPath,
			]);
		} catch (error) {
			output =
				typeof error === "object" && error !== null && "stdout" in error
					? String(error.stdout)
					: "";
		}
		return normalizePatch(path, before, after, output);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function normalizePatch(
	path: string,
	before: string | null,
	after: string | null,
	output: string,
): BoundedPatch {
	const lines = output.split("\n");
	if (lines[0]?.startsWith("diff --git "))
		lines[0] = `diff --git a/${path} b/${path}`;
	const oldLine = lines.findIndex((line) => line.startsWith("--- "));
	const newLine = lines.findIndex((line) => line.startsWith("+++ "));
	if (oldLine >= 0)
		lines[oldLine] = before === null ? "--- /dev/null" : `--- a/${path}`;
	if (newLine >= 0)
		lines[newLine] = after === null ? "+++ /dev/null" : `+++ b/${path}`;
	const full = lines.join("\n");
	const patch = lines
		.slice(0, MAX_PATCH_LINES)
		.join("\n")
		.slice(0, MAX_PATCH_CHARS);
	if (patch === "") return {};
	return patch.length < full.length
		? { patch, patchTruncated: true }
		: { patch };
}

function counts(patch: string | undefined): {
	additions: number | null;
	deletions: number | null;
} {
	if (patch === undefined) return { additions: null, deletions: null };
	let additions = 0;
	let deletions = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
		if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
	}
	return { additions, deletions };
}

async function committedChanges(
	before: RunSnapshot,
	after: RunSnapshot,
): Promise<FileStatusChange[]> {
	if (before.head === null || after.head === null || before.head === after.head)
		return [];
	const output = await git(after.root, [
		"diff",
		"--name-status",
		"-z",
		before.head,
		after.head,
	]);
	const tokens = output.split("\0");
	const changes: FileStatusChange[] = [];
	for (let index = 0; index < tokens.length; ) {
		const code = tokens[index++];
		if (code === undefined || code === "") continue;
		const firstPath = tokens[index++];
		if (firstPath === undefined || firstPath === "") continue;
		const renamed = code.startsWith("R") || code.startsWith("C");
		const path = renamed ? tokens[index++] : firstPath;
		if (path === undefined || path === "") continue;
		changes.push({ path, status: statusOf(code) });
	}
	return changes;
}

async function observedChange(
	path: string,
	comparison: RunComparison,
): Promise<CommonspaceRunFileChange | undefined> {
	const prior = comparison.beforeByPath.get(path);
	const current = comparison.afterByPath.get(path);
	const committed = comparison.committedByPath.get(path);
	const beforeContent =
		prior === undefined
			? await contentAtHead(
					comparison.before.root,
					comparison.before.head,
					path,
				)
			: prior.content;
	const afterContent =
		current?.content ??
		(current?.status === "deleted" || committed?.status === "deleted"
			? null
			: await textFile(join(comparison.after.root, ...path.split("/"))));
	if (prior?.status === current?.status && beforeContent === afterContent)
		return undefined;
	const patch = await unifiedPatch(path, beforeContent, afterContent);
	return {
		path,
		status:
			current?.status === "untracked" && prior === undefined
				? "added"
				: (current?.status ?? committed?.status ?? "deleted"),
		preExisting: prior !== undefined,
		...counts(patch.patch),
		...patch,
	};
}

export async function completeRunAttribution(
	root: string,
	before: RunSnapshot,
	rootIndex: number,
): Promise<CommonspaceRunRootAttribution> {
	if (!before.available)
		return {
			available: false,
			rootIndex,
			reason: before.reason ?? "Git unavailable.",
		};
	const after = await captureRunSnapshot(root);
	if (!after.available)
		return {
			available: false,
			rootIndex,
			reason: after.reason ?? "Git unavailable.",
		};
	const beforeByPath = new Map(
		before.changes.map((change) => [change.path, change]),
	);
	const afterByPath = new Map(
		after.changes.map((change) => [change.path, change]),
	);
	const committedByPath = new Map(
		(await committedChanges(before, after)).map((change) => [
			change.path,
			change,
		]),
	);
	const paths = [
		...new Set([
			...beforeByPath.keys(),
			...afterByPath.keys(),
			...committedByPath.keys(),
		]),
	].sort();
	const comparison: RunComparison = {
		before,
		after,
		beforeByPath,
		afterByPath,
		committedByPath,
	};
	const observed: CommonspaceRunFileChange[] = [];
	for (const path of paths) {
		const change = await observedChange(path, comparison);
		if (change !== undefined) observed.push(change);
	}
	return {
		available: true,
		rootIndex,
		branch: after.branch,
		headBefore: before.head,
		headAfter: after.head,
		preExisting: before.changes.map((change) => ({
			path: change.path,
			status: change.status,
		})),
		observed,
	};
}
