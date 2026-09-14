// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type RunningCommonspaceServer,
	startCommonspaceServer,
} from "../server/src/index.ts";

const roots: string[] = [];
const servers: RunningCommonspaceServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("unified search API", () => {
	it("searches nested project files with filters and stable file targets", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-unified-search-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(join(workspace, "docs"), { recursive: true });
		await writeFile(
			join(workspace, "docs", "release-checklist.md"),
			"# Release checklist\n",
		);
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

		const url = new URL("/api/search", running.url);
		url.searchParams.set("q", "release checklist");
		url.searchParams.set("types", "file");
		url.searchParams.set("project", project.id);
		const response = await fetch(url, { headers: { origin: running.url } });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			query: "release checklist",
			results: [
				{
					kind: "file",
					title: "release-checklist.md",
					target: {
						kind: "project-file",
						projectId: project.id,
						rootIndex: 0,
						path: "docs/release-checklist.md",
					},
				},
			],
			appliedFilters: { kinds: ["file"], projectId: project.id },
			truncated: false,
		});
		url.searchParams.set("q", "Viewer");
		url.searchParams.set("types", "project");
		const projectResponse = await fetch(url, {
			headers: { origin: running.url },
		});
		expect(projectResponse.status).toBe(200);
		const projectResults: unknown = await projectResponse.json();
		expect(projectResults).toMatchObject({
			results: [
				{
					kind: "project",
					title: "Viewer",
					target: { kind: "project", projectId: project.id },
				},
			],
			appliedFilters: { kinds: ["project"], projectId: project.id },
		});
		expect(JSON.stringify(projectResults)).not.toContain(workspace);
	});
});
