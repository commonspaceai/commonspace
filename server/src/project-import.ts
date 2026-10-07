import { execFile } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type ImportGitHubProjectRequest,
	ImportGitHubProjectRequestSchema,
	type ImportGitHubProjectResponse,
	projectTagName,
} from "@commonspace/shared";
import type { CommonspaceHostService } from "./service.js";

const MAX_GIT_OUTPUT_BYTES = 256 * 1024;
const CLONE_TIMEOUT_MS = 120_000;

export interface ProjectImportGitOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	encoding: "utf8";
	maxBuffer: number;
	timeout: number;
	windowsHide: boolean;
	signal: AbortSignal;
}

export interface ProjectImportHost
	extends Pick<CommonspaceHostService, "root" | "snapshot" | "mutate"> {
	signal: AbortSignal;
	discardUnregisteredCheckout(path: string): Promise<boolean>;
}

export interface ProjectImportOptions {
	executeGit?: (
		args: string[],
		options: ProjectImportGitOptions,
	) => Promise<string>;
}

export class ProjectImportError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ProjectImportError";
	}
}

function gitEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_NAMESPACE",
		"GIT_SHALLOW_FILE",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_PARAMETERS",
	])
		delete env[key];
	return {
		...env,
		GIT_TERMINAL_PROMPT: "0",
		GCM_INTERACTIVE: "never",
		GIT_ASKPASS: "/usr/bin/false",
		SSH_ASKPASS: "/usr/bin/false",
		SSH_ASKPASS_REQUIRE: "never",
		GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
	};
}

function gitFailure(error: Error): ProjectImportError {
	if ("code" in error && error.code === "ENOENT")
		return new ProjectImportError(
			503,
			"project_import_git_unavailable",
			"Git is unavailable on the host. Install Git before importing a repository.",
		);
	if (
		"killed" in error &&
		error.killed === true &&
		!("code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
	)
		return new ProjectImportError(
			504,
			"project_import_timeout",
			"The GitHub import timed out. Check the host network and retry.",
		);
	return new ProjectImportError(
		502,
		"project_import_clone_failed",
		"Could not clone the GitHub repository. Check the URL, branch, network, and Git access on the host. Imports do not prompt for credentials.",
	);
}

async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink())
		throw new ProjectImportError(
			500,
			"project_import_storage_unavailable",
			"The host's managed Project storage is unavailable.",
		);
	await chmod(path, 0o700);
}

function destinationConflict(): ProjectImportError {
	return new ProjectImportError(
		409,
		"project_import_conflict",
		"This repository already has a managed checkout on the host. Use its existing Project.",
	);
}

async function destinationExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return false;
		throw error;
	}
}

async function finalizeCheckout(
	checkout: string,
	destination: string,
): Promise<void> {
	try {
		await mkdir(destination, { mode: 0o700 });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			throw destinationConflict();
		throw error;
	}
	try {
		await rename(checkout, destination);
	} catch (error) {
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
}

function requestedProjectImport(
	// biome-ignore lint/plugin: This parser owns untrusted GitHub import input.
	input: unknown,
	projects: ReturnType<ProjectImportHost["snapshot"]>["projects"],
): ImportGitHubProjectRequest {
	const parsed = ImportGitHubProjectRequestSchema.safeParse(input);
	if (!parsed.success)
		throw new ProjectImportError(
			400,
			"project_import_invalid",
			"Enter a GitHub repository URL, a valid branch, and a Project name.",
		);
	const request = parsed.data;
	const tag = projectTagName(request.name);
	if (projects.some((project) => projectTagName(project.name) === tag))
		throw new ProjectImportError(
			409,
			"project_import_conflict",
			"A Project with this name already exists. Choose another name.",
		);
	return request;
}

async function cloneCheckout(
	request: ImportGitHubProjectRequest,
	temporary: string,
	execute: NonNullable<ProjectImportOptions["executeGit"]>,
	signal: AbortSignal,
): Promise<string> {
	const checkout = join(temporary, "checkout");
	const hooks = join(temporary, "hooks");
	await mkdir(hooks, { mode: 0o700 });
	const env = gitEnvironment();
	const baseArgs = [
		"-c",
		"core.fsmonitor=false",
		"-c",
		`core.hooksPath=${hooks}`,
		"-c",
		"submodule.recurse=false",
		"-c",
		"protocol.allow=never",
		"-c",
		"protocol.https.allow=always",
		"-c",
		"protocol.ssh.allow=always",
	];
	const runGit = async (args: string[], cwd: string, timeout = 10_000) => {
		try {
			checkImportActive(signal);
			return await execute([...baseArgs, ...args], {
				cwd,
				env,
				encoding: "utf8",
				maxBuffer: MAX_GIT_OUTPUT_BYTES,
				timeout,
				windowsHide: true,
				signal,
			});
		} catch (error) {
			checkImportActive(signal);
			throw gitFailure(
				error instanceof Error ? error : new Error("Git command failed."),
			);
		}
	};
	const cloneArgs = [
		"clone",
		"--quiet",
		"--no-checkout",
		"--no-recurse-submodules",
		`--template=${hooks}`,
	];
	if (request.branch !== undefined) cloneArgs.push("--branch", request.branch);
	cloneArgs.push("--", request.repositoryUrl, checkout);
	await runGit(cloneArgs, temporary, CLONE_TIMEOUT_MS);
	if (request.branch !== undefined)
		await runGit(["symbolic-ref", "--quiet", "HEAD"], checkout);
	const configuration = await runGit(
		["config", "--null", "--name-only", "--list"],
		checkout,
	);
	const filterOverrides: string[] = [];
	for (const key of new Set(configuration.split("\0"))) {
		if (/^filter\..+\.(?:clean|smudge|process|required)$/iu.test(key))
			filterOverrides.push(
				"-c",
				`${key}=${key.toLowerCase().endsWith(".required") ? "false" : ""}`,
			);
	}
	await runGit([...filterOverrides, "reset", "--hard", "HEAD"], checkout);
	await chmod(checkout, 0o700);
	return checkout;
}

function checkImportActive(signal: AbortSignal): void {
	if (signal.aborted)
		throw new ProjectImportError(
			503,
			"project_import_cancelled",
			"GitHub import was canceled while the host was stopping. Start hosting and retry.",
		);
}

function executeGit(
	args: string[],
	options: ProjectImportGitOptions,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let result = "";
		let failure: Error | null = null;
		const child = execFile("git", args, options, (error, stdout) => {
			failure = error;
			result = stdout;
		});
		child.once("close", () => {
			if (failure !== null) reject(failure);
			else resolve(result);
		});
	});
}

export async function importGitHubProject(
	service: ProjectImportHost,
	// biome-ignore lint/plugin: The import owns validation of untrusted HTTP JSON.
	input: unknown,
	options: ProjectImportOptions = {},
): Promise<ImportGitHubProjectResponse> {
	checkImportActive(service.signal);
	const request = requestedProjectImport(input, service.snapshot().projects);
	const tag = projectTagName(request.name);
	const sourcePath = request.repositoryUrl
		.replace(/^(?:https:\/\/github\.com\/|git@github\.com:)/u, "")
		.replace(/\.git$/u, "")
		.toLowerCase();
	const managedRoot = join(service.root, "projects");
	let destination = join(managedRoot, sourcePath);
	let temporary: string | undefined;
	let phase: "cloning" | "finalized" | "registering" = "cloning";
	try {
		await privateDirectory(managedRoot);
		destination = join(await realpath(managedRoot), sourcePath);
		await privateDirectory(dirname(destination));
		if (await destinationExists(destination)) throw destinationConflict();
		temporary = await mkdtemp(join(managedRoot, ".import-"));
		const checkout = await cloneCheckout(
			request,
			temporary,
			options.executeGit ?? executeGit,
			service.signal,
		);
		checkImportActive(service.signal);
		await finalizeCheckout(checkout, destination);
		phase = "finalized";
		checkImportActive(service.signal);
		phase = "registering";
		const state = await service.mutate({
			action: "create-project",
			name: request.name,
			paths: [destination],
		});
		const project = state.projects.find(
			(item) => projectTagName(item.name) === tag,
		);
		if (project === undefined)
			throw new ProjectImportError(
				500,
				"project_import_registration_failed",
				"The checkout is complete, but Project registration could not be confirmed. Refresh Projects before retrying. The host retained the checkout.",
			);
		return { projectId: project.id, state };
	} catch (error) {
		const discarded =
			phase !== "cloning" &&
			(await service.discardUnregisteredCheckout(destination));
		if (phase === "registering")
			throw new ProjectImportError(
				500,
				"project_import_registration_failed",
				discarded
					? "The Project could not be registered. The unregistered checkout was removed. Check host storage and retry."
					: "The checkout is complete, but Project registration could not be confirmed. Refresh Projects before retrying. The host retained the checkout.",
			);
		if (error instanceof ProjectImportError) throw error;
		throw new ProjectImportError(
			500,
			"project_import_storage_unavailable",
			"The host could not prepare managed Project storage. Check disk space and permissions.",
		);
	} finally {
		if (temporary !== undefined)
			await rm(temporary, { recursive: true, force: true }).catch(
				() => undefined,
			);
	}
}
