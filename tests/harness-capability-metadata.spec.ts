// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	inspectMcpMetadata,
	inspectResourceDirectories,
	inspectUserSkills,
} from "../server/src/adapters/capability-metadata.ts";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function writeDirectoryEntries(
	root: string,
	count: number,
): Promise<void> {
	await mkdir(root, { recursive: true });
	for (let start = 0; start < count; start += 100) {
		await Promise.all(
			Array.from({ length: Math.min(100, count - start) }, (_, offset) =>
				writeFile(join(root, `entry-${start + offset}`), ""),
			),
		);
	}
}

it("rejects special files and oversized configuration without waiting for input", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-mcp-bounds-"));
	roots.push(root);
	const fifo = join(root, "config.fifo");
	execFileSync("mkfifo", [fifo]);
	expect(
		await inspectMcpMetadata([fifo], "mcp", "Native metadata"),
	).toMatchObject({
		status: "error",
		items: [],
	});
	const oversized = join(root, "oversized.json");
	await writeFile(oversized, " ".repeat(1024 * 1024 + 1));
	expect(
		await inspectMcpMetadata([oversized], "mcp", "Native metadata"),
	).toMatchObject({
		status: "error",
		items: [],
	});
	expect(
		await inspectMcpMetadata([root], "mcp", "Native metadata"),
	).toMatchObject({
		status: "error",
		items: [],
	});
});

it("projects JSONC MCP names and disabled state without connection details", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-mcp-metadata-"));
	roots.push(root);
	const config = join(root, "opencode.jsonc");
	await writeFile(
		config,
		`{
		// Native JSONC permits comments and trailing commas.
		"mcp": {"catalog": {"enabled": false, "command": ["private-command"], "environment": {"TOKEN": "private-token"}},},
	}`,
	);
	const result = await inspectMcpMetadata(
		[config],
		"mcp",
		"Native user metadata",
	);
	expect(result).toMatchObject({
		status: "available",
		items: [{ name: "catalog", status: "disabled" }],
	});
	expect(JSON.stringify(result)).not.toMatch(
		/private-command|private-token|TOKEN/u,
	);
	await writeFile(config, '{"mcp":');
	expect(
		await inspectMcpMetadata([config], "mcp", "Native user metadata"),
	).toMatchObject({ status: "error", items: [] });
});

it("merges MCP metadata in path order so later files override prior state", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-mcp-merge-"));
	roots.push(root);
	const first = join(root, "first.json");
	const second = join(root, "second.json");
	await Promise.all([
		writeFile(
			first,
			JSON.stringify({
				mcpServers: { shared: { enabled: false }, first: {} },
			}),
		),
		writeFile(
			second,
			JSON.stringify({
				mcpServers: { shared: { enabled: true }, second: { enabled: false } },
			}),
		),
	]);

	expect(
		(await inspectMcpMetadata([first, second], "mcpServers", "Native metadata"))
			.items,
	).toEqual([
		{ name: "shared", status: "configured" },
		{ name: "first", status: "configured" },
		{ name: "second", status: "disabled" },
	]);
});

it("lists only marked skill folders, supports native links, and never reads skill bodies", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-skill-metadata-"));
	roots.push(root);
	const skills = join(root, "skills");
	await mkdir(join(skills, "review"), { recursive: true });
	await mkdir(join(skills, "unrelated"));
	await writeFile(
		join(skills, "review", "SKILL.md"),
		"secret skill body and /private/native/path",
	);
	await symlink(join(skills, "review"), join(skills, "linked-review"));
	const result = await inspectUserSkills(
		[skills, join(root, "missing")],
		"Native user metadata",
	);
	expect(result).toMatchObject({
		status: "available",
		items: [
			{ name: "linked-review", status: "configured" },
			{ name: "review", status: "configured" },
		],
	});
	expect(JSON.stringify(result)).not.toMatch(/secret|\/private|unrelated/u);
});

it("distinguishes absent skill directories from inspection failures", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-skill-metadata-"));
	roots.push(root);
	expect(
		await inspectUserSkills([join(root, "missing")], "Native user metadata"),
	).toMatchObject({ status: "available", items: [] });
	await mkdir(join(root, "bad"));
	await symlink("SKILL.md", join(root, "bad", "SKILL.md"));
	expect(await inspectUserSkills([root], "Native user metadata")).toMatchObject(
		{ status: "error", items: [] },
	);
});

it("shares the resource inventory limit across every configured root", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-resource-bounds-"));
	roots.push(root);
	const first = join(root, "first");
	const second = join(root, "second");
	await Promise.all([
		writeDirectoryEntries(first, 1_000),
		writeDirectoryEntries(second, 1_001),
	]);

	expect(
		await inspectResourceDirectories([first, second], {
			id: "agents",
			extension: ".md",
			source: "Native metadata",
			notice: "Native resource names only.",
		}),
	).toMatchObject({ status: "error", items: [] });
});
