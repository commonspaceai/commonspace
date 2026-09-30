// @vitest-environment node
import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";
import {
	openProjectFile,
	streamProjectFile,
} from "../server/src/project-files.ts";

const execFileAsync = promisify(execFile);
const listingSchema = z.object({
	entries: z.array(
		z.object({ name: z.string(), preview: z.string().optional() }),
	),
});
const diffSchema = z.object({ patch: z.string() });
const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function git(cwd: string, args: string[]): Promise<void> {
	await execFileAsync("git", args, { cwd });
}

async function fixture(): Promise<{
	running: RunningCommonspaceServer;
	projectId: string;
	workspace: string;
	outside: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "commonspace-project-files-"));
	roots.push(root);
	const workspace = join(root, "workspace");
	const outside = join(root, "outside.txt");
	await mkdir(join(workspace, "src"), { recursive: true });
	await writeFile(join(workspace, "README.md"), "before\nsame\n");
	await writeFile(
		join(workspace, "src", "index.ts"),
		"export const answer = 42\n",
	);
	await writeFile(
		join(workspace, "cover.png"),
		Buffer.from([0x89, 0x50, 0x4e, 0x47]),
	);
	await writeFile(
		join(workspace, "demo.mp4"),
		Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
	);
	await writeFile(join(workspace, "blob.bin"), Buffer.from([0, 1, 2]));
	await writeFile(
		join(workspace, "NOTICE"),
		"plain text without an extension\n",
	);
	await writeFile(join(workspace, ".env.local"), "API_KEY=do-not-render\n");
	await writeFile(
		join(workspace, "id_rsa"),
		"-----BEGIN OPENSSH PRIVATE KEY-----\ndo-not-render\n",
	);
	await writeFile(
		join(workspace, "credentials.json"),
		'{"token":"do-not-render"}\n',
	);
	await writeFile(outside, "host private\n");
	await symlink(outside, join(workspace, "outside-link.txt"));

	await git(workspace, ["init", "-b", "main"]);
	await git(workspace, ["config", "user.email", "commonspace@example.test"]);
	await git(workspace, ["config", "user.name", "Commonspace Test"]);
	await git(workspace, [
		"add",
		"README.md",
		"src/index.ts",
		"cover.png",
		"demo.mp4",
		"blob.bin",
	]);
	await git(workspace, ["commit", "-m", "test: baseline"]);
	await writeFile(join(workspace, "README.md"), "after\nsame\n");
	await writeFile(join(workspace, "notes.txt"), "new note\n");

	const running = await startCommonspaceServer({
		root: join(root, "state"),
		port: 0,
		logger: { warn: () => undefined, info: () => undefined },
	});
	servers.push(running);
	await running.service.mutate({
		action: "create-project",
		name: "Viewer",
		paths: [workspace],
	});
	const project = running.service.snapshot().projects[0];
	if (project === undefined) throw new Error("project fixture missing");
	return { running, projectId: project.id, workspace, outside };
}

function projectUrl(
	running: RunningCommonspaceServer,
	projectId: string,
	endpoint: string,
	query: Record<string, string> = {},
): string {
	const url = new URL(
		`/api/projects/${encodeURIComponent(projectId)}/${endpoint}`,
		running.url,
	);
	for (const [name, value] of Object.entries(query))
		url.searchParams.set(name, value);
	return url.toString();
}

describe("project file API", () => {
	it("streams the validated descriptor when its path is replaced before delivery", async () => {
		const { running, projectId, workspace, outside } = await fixture();
		const file = await openProjectFile(
			running.service.snapshot(),
			projectId,
			0,
			"README.md",
		);
		const server = createServer((req, res) => {
			void streamProjectFile(req, res, file).catch(() => res.destroy());
		});
		try {
			await rename(
				join(workspace, "README.md"),
				join(workspace, "original.md"),
			);
			await symlink(outside, join(workspace, "README.md"));
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (address === null || typeof address === "string")
				throw new Error("missing listener");
			const response = await fetch(`http://127.0.0.1:${String(address.port)}`);
			expect(response.status).toBe(200);
			await expect(response.text()).resolves.toBe("after\nsame\n");
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await file.handle.close();
		}
	});

	it("blocks credential aliases inside the Project root", async () => {
		const { running, projectId, workspace } = await fixture();
		await symlink(".env.local", join(workspace, "innocent.txt"));
		for (const endpoint of ["file", "diff"]) {
			const response = await fetch(
				projectUrl(running, projectId, endpoint, { path: "innocent.txt" }),
				{ headers: { origin: running.url } },
			);
			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				code: "project_file_sensitive",
			});
		}
	});

	it("blocks tracked, deleted, and renamed credential diffs", async () => {
		const { running, projectId, workspace } = await fixture();
		await mkdir(join(workspace, "config"));
		await writeFile(
			join(workspace, "config", "auth.json"),
			"SYNTHETIC_SECRET\n",
		);
		await git(workspace, [
			"add",
			".env.local",
			"credentials.json",
			"config/auth.json",
		]);
		await git(workspace, ["commit", "-m", "test: synthetic credentials"]);
		await writeFile(join(workspace, ".env.local"), "SYNTHETIC_CHANGED\n");
		await rm(join(workspace, "credentials.json"));
		await git(workspace, ["mv", "config/auth.json", "config/notes.txt"]);
		for (const path of [".env.local", "credentials.json", "config/notes.txt"]) {
			const response = await fetch(
				projectUrl(running, projectId, "diff", { path }),
				{
					headers: { origin: running.url },
				},
			);
			expect(response.status, path).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				code: "project_file_sensitive",
			});
		}
	});

	it.each([
		"diff.review.textconv",
		"filter.review.clean",
		"filter.review.process",
		"core.fsmonitor",
	])(
		"does not execute configured %s commands during previews",
		async (setting) => {
			const { running, projectId, workspace } = await fixture();
			const converter = join(workspace, "converter.sh");
			const marker = join(workspace, "executed.marker");
			await writeFile(
				converter,
				'#!/bin/sh\nprintf executed > "$(dirname "$0")/executed.marker"\nprintf converted\n',
			);
			await chmod(converter, 0o755);
			await writeFile(
				join(workspace, ".gitattributes"),
				"*.md diff=review filter=review\n",
			);
			await git(workspace, ["config", setting, converter]);
			if (setting.startsWith("filter."))
				await git(workspace, ["config", "filter.review.required", "true"]);
			const response = await fetch(
				projectUrl(running, projectId, "diff", { path: "README.md" }),
				{
					headers: { origin: running.url },
				},
			);
			expect(response.status).toBe(200);
			const diff = diffSchema.parse(await response.json());
			expect(diff.patch).toContain("+after");
			await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
		},
	);

	it("opens a validated project file at a requested line in the configured editor", async () => {
		const { running, projectId, workspace } = await fixture();
		const editorLog = join(workspace, "editor.log");
		const editor = join(workspace, "fake-editor.sh");
		await writeFile(
			editor,
			`#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(editorLog)}\n`,
		);
		await chmod(editor, 0o755);
		vi.stubEnv("COMMONSPACE_EDITOR_PATH", editor);

		const response = await fetch(projectUrl(running, projectId, "open"), {
			method: "POST",
			headers: { origin: running.url, "content-type": "application/json" },
			body: JSON.stringify({ rootIndex: 0, path: "src/index.ts", line: 12 }),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ opened: true });
		expect(await readFile(editorLog, "utf8")).toBe(
			`--goto\n${await realpath(join(workspace, "src", "index.ts"))}:12\n`,
		);
	});

	it("lists project files and serves text, images, and ranged video without exposing symlinks", async () => {
		const { running, projectId } = await fixture();
		const headers = { origin: running.url };

		const listingResponse = await fetch(
			projectUrl(running, projectId, "files"),
			{ headers },
		);
		expect(listingResponse.status).toBe(200);
		await expect(listingResponse.json()).resolves.toMatchObject({
			projectId,
			rootIndex: 0,
			path: "",
			truncated: false,
			entries: expect.arrayContaining([
				expect.objectContaining({
					name: "src",
					path: "src",
					kind: "directory",
				}),
				expect.objectContaining({
					name: "README.md",
					path: "README.md",
					kind: "file",
					preview: "text",
					contentType: "text/markdown; charset=utf-8",
				}),
				expect.objectContaining({
					name: "cover.png",
					path: "cover.png",
					kind: "file",
					preview: "image",
					contentType: "image/png",
				}),
				expect.objectContaining({
					name: "demo.mp4",
					path: "demo.mp4",
					kind: "file",
					preview: "video",
					contentType: "video/mp4",
				}),
				expect.objectContaining({
					name: "blob.bin",
					path: "blob.bin",
					kind: "file",
					preview: "binary",
				}),
				expect.objectContaining({
					name: "NOTICE",
					path: "NOTICE",
					kind: "file",
					preview: "text",
					contentType: "text/plain; charset=utf-8",
				}),
			]),
		});
		const listing = listingSchema.parse(
			await (
				await fetch(projectUrl(running, projectId, "files"), { headers })
			).json(),
		);
		expect(listing.entries.some((entry) => entry.name === ".git")).toBe(false);
		expect(
			listing.entries.some((entry) => entry.name === "outside-link.txt"),
		).toBe(false);

		const textResponse = await fetch(
			projectUrl(running, projectId, "file", { path: "README.md" }),
			{ headers },
		);
		expect(textResponse.status).toBe(200);
		expect(textResponse.headers.get("content-type")).toBe(
			"text/markdown; charset=utf-8",
		);
		await expect(textResponse.text()).resolves.toBe("after\nsame\n");

		const imageResponse = await fetch(
			projectUrl(running, projectId, "file", { path: "cover.png" }),
			{ headers },
		);
		expect(imageResponse.status).toBe(200);
		expect(imageResponse.headers.get("content-type")).toBe("image/png");

		const videoResponse = await fetch(
			projectUrl(running, projectId, "file", { path: "demo.mp4" }),
			{
				headers: { ...headers, range: "bytes=2-5" },
			},
		);
		expect(videoResponse.status).toBe(206);
		expect(videoResponse.headers.get("content-range")).toBe("bytes 2-5/8");
		expect([...new Uint8Array(await videoResponse.arrayBuffer())]).toEqual([
			2, 3, 4, 5,
		]);
	});

	it("rejects traversal and symlink file reads", async () => {
		const { running, projectId, workspace } = await fixture();
		const headers = { origin: running.url };
		const sibling = `${workspace}-extra.txt`;
		await writeFile(sibling, "host private\n");
		await symlink(sibling, join(workspace, "sibling-link.txt"));

		const traversal = await fetch(
			projectUrl(running, projectId, "file", { path: "../outside.txt" }),
			{ headers },
		);
		expect(traversal.status).toBe(400);
		await expect(traversal.json()).resolves.toMatchObject({
			code: "invalid_project_path",
		});

		const gitMetadata = await fetch(
			projectUrl(running, projectId, "file", { path: ".git/config" }),
			{ headers },
		);
		expect(gitMetadata.status).toBe(400);
		await expect(gitMetadata.json()).resolves.toMatchObject({
			code: "invalid_project_path",
		});

		const outsideSymlink = await fetch(
			projectUrl(running, projectId, "file", { path: "outside-link.txt" }),
			{ headers },
		);
		expect(outsideSymlink.status).toBe(403);
		await expect(outsideSymlink.json()).resolves.toMatchObject({
			code: "project_path_outside_root",
		});

		const siblingSymlink = await fetch(
			projectUrl(running, projectId, "file", {
				path: "sibling-link.txt",
			}),
			{ headers },
		);
		expect(siblingSymlink.status).toBe(403);
		await expect(siblingSymlink.json()).resolves.toMatchObject({
			code: "project_path_outside_root",
		});
	});

	it("reports working-tree changes and returns a bounded unified text diff", async () => {
		const { running, projectId } = await fixture();
		const headers = { origin: running.url };

		const changesResponse = await fetch(
			projectUrl(running, projectId, "changes"),
			{ headers },
		);
		expect(changesResponse.status).toBe(200);
		await expect(changesResponse.json()).resolves.toMatchObject({
			available: true,
			branch: "main",
			clean: false,
			files: expect.arrayContaining([
				expect.objectContaining({
					path: "README.md",
					status: "modified",
					additions: 1,
					deletions: 1,
					preview: "text",
				}),
				expect.objectContaining({
					path: "notes.txt",
					status: "untracked",
					additions: 1,
					deletions: 0,
					preview: "text",
				}),
			]),
		});

		const diffResponse = await fetch(
			projectUrl(running, projectId, "diff", { path: "README.md" }),
			{ headers },
		);
		expect(diffResponse.status).toBe(200);
		await expect(diffResponse.json()).resolves.toMatchObject({
			path: "README.md",
			binary: false,
			truncated: false,
			patch: expect.stringContaining("-before"),
		});
		const diff = diffSchema.parse(
			await (
				await fetch(
					projectUrl(running, projectId, "diff", { path: "README.md" }),
					{ headers },
				)
			).json(),
		);
		expect(diff.patch).toContain("+after");
	});

	it("lists sensitive files without allowing their contents to be previewed", async () => {
		const { running, projectId } = await fixture();
		const headers = { origin: running.url };
		const listing = listingSchema.parse(
			await (
				await fetch(projectUrl(running, projectId, "files"), { headers })
			).json(),
		);

		expect(listing.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: ".env.local", preview: "blocked" }),
				expect.objectContaining({ name: "id_rsa", preview: "blocked" }),
				expect.objectContaining({
					name: "credentials.json",
					preview: "blocked",
				}),
			]),
		);
		for (const path of [".env.local", "id_rsa", "credentials.json"]) {
			const response = await fetch(
				projectUrl(running, projectId, "file", { path }),
				{ headers },
			);
			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				code: "project_file_sensitive",
			});
		}
	});
});
