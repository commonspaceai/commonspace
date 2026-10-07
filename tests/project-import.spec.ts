// @vitest-environment node
import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ImportGitHubProjectRequest,
	ImportGitHubProjectRequestSchema,
	ImportGitHubProjectResponseSchema,
} from "../packages/shared/src/project-import.ts";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import {
	importGitHubProject,
	type ProjectImportGitOptions,
	type ProjectImportOptions,
} from "../server/src/project-import.ts";
import { CommonspaceHostService } from "../server/src/service.ts";

const execFileAsync = promisify(execFile);
const repositoryUrl = "https://github.com/commonspace-test/fixture.git";
const roots: string[] = [];
const services: CommonspaceHostService[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function fixture() {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "commonspace-project-import-")),
	);
	roots.push(root);
	const source = join(root, "source");
	const bare = join(root, "fixture.git");
	const globalConfig = join(root, "gitconfig");
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: globalConfig,
	};
	await mkdir(source);
	await writeFile(globalConfig, "");
	const git = async (cwd: string, args: string[]) => {
		const { stdout } = await execFileAsync(
			"git",
			["-c", "core.hooksPath=/dev/null", ...args],
			{ cwd, env, encoding: "utf8", timeout: 10_000 },
		);
		return stdout.trim();
	};
	await git(source, ["init", "--template=", "-b", "main"]);
	await git(source, ["config", "user.email", "commonspace@example.test"]);
	await git(source, ["config", "user.name", "Commonspace Fixture"]);
	await writeFile(join(source, "README.md"), "The default branch.\n");
	await writeFile(join(source, ".gitattributes"), "README.md filter=review\n");
	await writeFile(
		join(source, "package.json"),
		JSON.stringify({ scripts: { postinstall: "touch scripts-ran.marker" } }),
	);
	await git(source, [
		"add",
		"--",
		"README.md",
		".gitattributes",
		"package.json",
	]);
	await git(source, ["commit", "-m", "fixture: default branch"]);
	await git(source, ["checkout", "-b", "feature/import"]);
	await writeFile(join(source, "README.md"), "The selected branch.\n");
	await git(source, ["add", "--", "README.md"]);
	await git(source, ["commit", "-m", "fixture: selected branch"]);
	await git(source, ["tag", "v1-fixture"]);
	await git(source, ["checkout", "main"]);
	await git(root, [
		"clone",
		"--quiet",
		"--bare",
		"--template=",
		"--",
		source,
		bare,
	]);
	const service = new CommonspaceHostService(
		{},
		{ root: join(root, "host") },
		{ discoverAgents: async () => [] },
	);
	await service.initialize();
	services.push(service);
	const calls: { args: string[]; options: ProjectImportGitOptions }[] = [];
	const executeGit = async (
		args: string[],
		options: ProjectImportGitOptions,
	) => {
		calls.push({ args, options });
		const localArgs = args.map((arg) =>
			arg === repositoryUrl ||
			arg === "git@github.com:commonspace-test/fixture.git"
				? bare
				: arg,
		);
		const { stdout } = await execFileAsync(
			"git",
			["-c", "protocol.file.allow=always", ...localArgs],
			{
				...options,
				env: {
					...options.env,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: globalConfig,
				},
			},
		);
		return stdout;
	};
	const destination = join(
		service.root,
		"projects",
		"commonspace-test",
		"fixture",
	);
	return { root, service, git, globalConfig, destination, executeGit, calls };
}

async function importFixture(
	value: Awaited<ReturnType<typeof fixture>>,
	request: { branch?: string; name?: string; repositoryUrl?: string } = {},
	options: ProjectImportOptions = {},
) {
	return value.service.importGitHubProject(
		{ repositoryUrl, name: "Imported App", ...request },
		{ executeGit: value.executeGit, ...options },
	);
}

async function remainingImports(root: string): Promise<string[]> {
	return (await readdir(join(root, "projects"))).filter((name) =>
		name.startsWith(".import-"),
	);
}

describe("GitHub Project source validation", () => {
	it.each([
		"https://github.com/commonspace-test/fixture",
		"https://github.com/commonspace-test/fixture.git",
		"git@github.com:commonspace-test/fixture",
	])("accepts a repository URL without other URL capabilities %s", (url) => {
		expect(
			ImportGitHubProjectRequestSchema.parse({
				repositoryUrl: url,
				name: "  Imported   App  ",
			}),
		).toEqual({
			repositoryUrl: `${url.replace(/\.git$/u, "")}.git`,
			name: "Imported App",
		});
	});

	it.each([
		"https://synthetic-token@github.com/commonspace-test/fixture.git",
		"https://github.com/commonspace-test/fixture.git?token=synthetic-secret",
		"https://github.com/commonspace-test/fixture.git#main",
		"https://github.com:443/commonspace-test/fixture.git",
		"https://github.com.evil.test/commonspace-test/fixture.git",
		"https://example.test/commonspace-test/fixture.git",
		"http://github.com/commonspace-test/fixture.git",
		"file:///tmp/fixture.git",
		"ext::synthetic-command",
		"git@github.com:commonspace-test/../fixture.git",
		"https://github.com/commonspace-test/..",
		"https://github.com/commonspace-test/.git",
		"https://github.com/commonspace-test/fixture/tree/main",
	])("rejects unsupported repository capabilities %s", (url) => {
		expect(
			ImportGitHubProjectRequestSchema.safeParse({
				repositoryUrl: url,
				name: "App",
			}).success,
		).toBe(false);
	});

	it.each([
		"-main",
		"HEAD",
		"HEAD~1",
		"../main",
		"main.lock",
		".hidden",
		"main..next",
		"main@{1}",
		"main branch",
		"main\nnext",
		"main//next",
		"main/",
		"@",
	])("rejects option, revision, and malformed branch input %s", (branch) => {
		expect(
			ImportGitHubProjectRequestSchema.safeParse({
				repositoryUrl,
				branch,
				name: "App",
			}).success,
		).toBe(false);
	});

	it("rejects invalid source input before running Git or changing Project state", async () => {
		const value = await fixture();
		const before = value.service.snapshot();
		await expect(
			importFixture(value, { repositoryUrl: "file:///tmp/private-repository" }),
		).rejects.toMatchObject({
			status: 400,
			code: "project_import_invalid",
		});
		expect(value.calls).toEqual([]);
		expect(value.service.snapshot()).toEqual(before);
		await expect(
			stat(join(value.service.root, "projects")),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("host-owned GitHub Project import", () => {
	it.each([undefined, "feature/import"])(
		"clones the actual %s branch and registers only its completed checkout",
		async (branch) => {
			const value = await fixture();
			const mutate = value.service.mutate.bind(value.service);
			const host = {
				root: value.service.root,
				signal: new AbortController().signal,
				discardUnregisteredCheckout: async () => false,
				snapshot: () => value.service.snapshot(),
				mutate: async (mutation: Parameters<typeof mutate>[0]) => {
					expect(
						await readFile(join(value.destination, "README.md"), "utf8"),
					).toBe(
						branch === undefined
							? "The default branch.\n"
							: "The selected branch.\n",
					);
					expect(
						await value.git(value.destination, [
							"symbolic-ref",
							"--short",
							"HEAD",
						]),
					).toBe(branch ?? "main");
					return mutate(mutation);
				},
			};
			const request: ImportGitHubProjectRequest = {
				repositoryUrl,
				name: "Imported App",
			};
			if (branch !== undefined) request.branch = branch;
			const response = await importGitHubProject(host, request, {
				executeGit: value.executeGit,
			});
			expect(ImportGitHubProjectResponseSchema.parse(response)).toEqual(
				response,
			);
			expect(value.service.snapshot().projects).toEqual([
				expect.objectContaining({
					id: response.projectId,
					name: "Imported App",
					paths: [value.destination],
				}),
			]);
			expect(response.state.projects).toEqual([
				expect.objectContaining({
					id: response.projectId,
					name: "Imported App",
					paths: ["Working folder"],
				}),
			]);
			expect(response.state.dmSessions).toEqual({});
			expect(response.state.agentSessions).toEqual({});
			expect(JSON.stringify(response)).not.toContain(value.root);
			expect((await stat(value.destination)).mode & 0o777).toBe(0o700);
			expect(await remainingImports(value.service.root)).toEqual([]);
			await expect(
				readFile(join(value.destination, "scripts-ran.marker")),
			).rejects.toMatchObject({ code: "ENOENT" });
			const clone = value.calls.find((call) => call.args.includes("clone"));
			expect(clone?.options).toMatchObject({
				timeout: 120_000,
				maxBuffer: 256 * 1024,
			});
			expect(clone?.options.env).toMatchObject({
				GIT_TERMINAL_PROMPT: "0",
				GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
			});
		},
	);

	it("uses a host-managed checkout for the canonical SSH source", async () => {
		const value = await fixture();
		const response = await importFixture(value, {
			repositoryUrl: "git@github.com:commonspace-test/fixture",
		});
		expect(response.state.projects[0]?.id).toBe(response.projectId);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
	});

	it("does not overwrite an existing empty or populated checkout", async () => {
		for (const populated of [false, true]) {
			const value = await fixture();
			await mkdir(value.destination, { recursive: true });
			if (populated)
				await writeFile(
					join(value.destination, "keep.txt"),
					"Preserve these bytes.\n",
				);
			await expect(importFixture(value)).rejects.toMatchObject({
				status: 409,
				code: "project_import_conflict",
			});
			expect(await readdir(value.destination)).toEqual(
				populated ? ["keep.txt"] : [],
			);
			if (populated)
				expect(
					await readFile(join(value.destination, "keep.txt"), "utf8"),
				).toBe("Preserve these bytes.\n");
			expect(value.calls).toEqual([]);
			expect(value.service.snapshot().projects).toEqual([]);
		}
	});

	it("lets only one concurrent import finalize the same repository", async () => {
		const value = await fixture();
		const [main, branch] = await Promise.allSettled([
			importFixture(value, { name: "Parallel main" }),
			importFixture(value, {
				name: "Parallel branch",
				branch: "feature/import",
			}),
		]);
		expect(
			[main, branch].filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const failure = main.status === "rejected" ? main : branch;
		if (failure.status !== "rejected")
			throw new Error("missing conflicting import");
		expect(failure.reason).toMatchObject({
			status: 409,
			code: "project_import_conflict",
		});
		expect(value.service.snapshot().projects).toHaveLength(1);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			main.status === "fulfilled"
				? "The default branch.\n"
				: "The selected branch.\n",
		);
		expect(await remainingImports(value.service.root)).toEqual([]);
	});

	it("rejects an existing Project name before cloning and preserves its folder", async () => {
		const value = await fixture();
		const existing = join(value.root, "existing");
		await mkdir(existing);
		await writeFile(join(existing, "keep.txt"), "Existing Project.\n");
		await value.service.mutate({
			action: "create-project",
			name: "Imported App",
			paths: [existing],
		});
		const before = value.service.snapshot();
		await expect(
			importFixture(value, { name: "imported-app" }),
		).rejects.toMatchObject({ status: 409 });
		expect(value.service.snapshot()).toEqual(before);
		expect(await readFile(join(existing, "keep.txt"), "utf8")).toBe(
			"Existing Project.\n",
		);
		expect(value.calls).toEqual([]);
	});

	it.each(["missing-branch", "v1-fixture"])(
		"does not register a missing branch or tag %s",
		async (branch) => {
			const value = await fixture();
			await expect(importFixture(value, { branch })).rejects.toMatchObject({
				status: 502,
				code: "project_import_clone_failed",
			});
			expect(value.service.snapshot().projects).toEqual([]);
			await expect(stat(value.destination)).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(await remainingImports(value.service.root)).toEqual([]);
		},
	);

	it("cleans partial clone bytes and redacts Git errors", async () => {
		const value = await fixture();
		await expect(
			importFixture(
				value,
				{},
				{
					executeGit: async (_args, options) => {
						await mkdir(join(options.cwd, "checkout"));
						await writeFile(
							join(options.cwd, "checkout", "partial.txt"),
							"Partial clone.\n",
						);
						throw new Error(
							`fatal: ${value.root} synthetic-token-do-not-return`,
						);
					},
				},
			),
		).rejects.toMatchObject({
			status: 502,
			code: "project_import_clone_failed",
			message:
				"Could not clone the GitHub repository. Check the URL, branch, network, and Git access on the host. Imports do not prompt for credentials.",
		});
		expect(value.service.snapshot().projects).toEqual([]);
		await expect(stat(value.destination)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await remainingImports(value.service.root)).toEqual([]);
	});

	it("retains completed checkout bytes if the response fails after the Project was persisted", async () => {
		const value = await fixture();
		const before = value.service.snapshot();
		const snapshot = vi
			.spyOn(value.service, "snapshot")
			.mockImplementationOnce(() => before)
			.mockImplementationOnce(() => {
				throw new Error(`synthetic response failure ${value.root}`);
			});
		try {
			await expect(importFixture(value)).rejects.toMatchObject({
				status: 500,
				code: "project_import_registration_failed",
			});
		} finally {
			snapshot.mockRestore();
		}
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
		expect(
			await value.git(value.destination, [
				"rev-parse",
				"--is-inside-work-tree",
			]),
		).toBe("true");
		expect(value.service.snapshot().projects[0]?.paths).toEqual([
			value.destination,
		]);
		expect(
			await readFile(join(value.service.root, "state.json"), "utf8"),
		).toContain(value.destination);
		expect(await remainingImports(value.service.root)).toEqual([]);
	});

	it("removes a definitely unregistered checkout after a failed save so import can be retried", async () => {
		const value = await fixture();
		const primary = await readFile(
			join(value.service.root, "state.json"),
			"utf8",
		);
		const backup = join(value.service.root, "state.backup.json");
		await mkdir(backup);
		await expect(importFixture(value)).rejects.toMatchObject({
			status: 500,
			code: "project_import_registration_failed",
			message:
				"The Project could not be registered. The unregistered checkout was removed. Check host storage and retry.",
		});
		expect(await readFile(join(value.service.root, "state.json"), "utf8")).toBe(
			primary,
		);
		expect(value.service.snapshot().projects).toEqual([]);
		await expect(stat(value.destination)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await remainingImports(value.service.root)).toEqual([]);
		await rm(backup, { recursive: true });
		const response = await importFixture(value);
		expect(response.state.projects[0]?.id).toBe(response.projectId);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
	});

	it("retains the checkout when saved Project references cannot be validated without data loss", async () => {
		const value = await fixture();
		const primary = JSON.stringify({
			...value.service.snapshot(),
			projects: [{ paths: [value.destination] }],
		});
		await writeFile(join(value.service.root, "state.json"), primary);
		await mkdir(join(value.service.root, "state.backup.json"));
		await expect(importFixture(value)).rejects.toMatchObject({
			status: 500,
			code: "project_import_registration_failed",
			message:
				"The checkout is complete, but Project registration could not be confirmed. Refresh Projects before retrying. The host retained the checkout.",
		});
		expect(await readFile(join(value.service.root, "state.json"), "utf8")).toBe(
			primary,
		);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
		expect(value.service.snapshot().projects).toEqual([]);
		expect(await remainingImports(value.service.root)).toEqual([]);
	});

	it("registers canonical checkout paths when the host root uses a filesystem alias", async () => {
		const value = await fixture();
		await value.service.close();
		const alias = join(value.root, "host-alias");
		await symlink(value.service.root, alias);
		const service = new CommonspaceHostService(
			{},
			{ root: alias },
			{ discoverAgents: async () => [] },
		);
		await service.initialize();
		services.push(service);
		const response = await service.importGitHubProject(
			{ repositoryUrl, name: "Aliased host" },
			{ executeGit: value.executeGit },
		);
		expect(service.snapshot().projects[0]?.paths).toEqual([value.destination]);
		expect(response.state.projects[0]?.paths).toEqual(["Working folder"]);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
		expect(JSON.stringify(response)).not.toContain(alias);
	});

	it("cancels an in-flight clone and settles cleanup before releasing the host workspace", async () => {
		const value = await fixture();
		await value.service.close();
		const running = await startCommonspaceServer({
			root: value.service.root,
			port: 0,
			logger: { warn: () => undefined, info: () => undefined },
		});
		servers.push(running);
		const started = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const settle = Promise.withResolvers<void>();
		const importing = running.service.importGitHubProject(
			{ repositoryUrl, name: "Stopped import" },
			{
				executeGit: async (args, options) => {
					const output = await value.executeGit(args, options);
					if (!args.includes("clone")) return output;
					const command = execFileAsync(
						"git",
						["hash-object", "--stdin"],
						options,
					);
					started.resolve();
					try {
						await command;
					} finally {
						aborted.resolve();
						await settle.promise;
					}
					return output;
				},
			},
		);
		const outcome = importing.catch((error: Error) => error);
		await started.promise;
		const closing = running.close();
		try {
			await aborted.promise;
			expect(running.service.isClosed).toBe(false);
			expect(running.service.snapshot().projects).toEqual([]);
			expect(await remainingImports(running.service.root)).toHaveLength(1);
			await expect(
				startCommonspaceServer({ root: running.service.root, port: 0 }),
			).rejects.toThrow("already");
		} finally {
			settle.resolve();
		}
		expect(await outcome).toMatchObject({
			status: 503,
			code: "project_import_cancelled",
		});
		await closing;
		expect(running.service.isClosed).toBe(true);
		await expect(stat(value.destination)).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await remainingImports(running.service.root)).toEqual([]);
		const replacement = await startCommonspaceServer({
			root: running.service.root,
			port: 0,
		});
		servers.push(replacement);
		expect(replacement.service.snapshot().projects).toEqual([]);
	});

	it("does not execute host Git filters or copied template hooks during checkout", async () => {
		const value = await fixture();
		const marker = join(value.root, "git-code-ran.marker");
		const command = join(value.root, "git-command.sh");
		await writeFile(command, `#!/bin/sh\nprintf executed > '${marker}'\ncat\n`);
		await chmod(command, 0o700);
		const template = join(value.root, "template");
		await mkdir(join(template, "hooks"), { recursive: true });
		await writeFile(
			join(template, "hooks", "post-checkout"),
			`#!/bin/sh\nprintf executed > '${marker}'\n`,
		);
		await chmod(join(template, "hooks", "post-checkout"), 0o700);
		await writeFile(
			value.globalConfig,
			[
				'[filter "review"]',
				`\tsmudge = ${command}`,
				`\tclean = ${command}`,
				"\trequired = true",
				"[init]",
				`\ttemplateDir = ${template}`,
				"[core]",
				`\thooksPath = ${join(template, "hooks")}`,
			].join("\n"),
		);
		await importFixture(value);
		expect(await readFile(join(value.destination, "README.md"), "utf8")).toBe(
			"The default branch.\n",
		);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("refuses a symlinked managed storage boundary", async () => {
		const value = await fixture();
		const outside = join(value.root, "outside");
		await mkdir(outside);
		await writeFile(join(outside, "keep.txt"), "Outside managed storage.\n");
		await symlink(outside, join(value.service.root, "projects"));
		await expect(importFixture(value)).rejects.toMatchObject({
			status: 500,
			code: "project_import_storage_unavailable",
		});
		expect(await readdir(outside)).toEqual(["keep.txt"]);
		expect(value.calls).toEqual([]);
	});
});
