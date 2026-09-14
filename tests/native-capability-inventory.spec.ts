import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseNamedJsonInventory } from "../server/src/adapters/capability-inventory.ts";
import { createClaudeCodeAdapter } from "../server/src/adapters/claude-code.ts";
import { createCodexAdapter } from "../server/src/adapters/codex.ts";
import { createHermesAdapter } from "../server/src/adapters/hermes.ts";

const roots: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("native capability inventory", () => {
	it("reads Claude agent definition filenames without executing its native session listing", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-claude-metadata-"));
		roots.push(root);
		vi.stubEnv("CLAUDE_CONFIG_DIR", root);
		await mkdir(join(root, "agents"));
		await writeFile(
			join(root, "agents", "reviewer.md"),
			"PRIVATE_AGENT_PROMPT",
		);
		await writeFile(join(root, "agents", "unrelated.json"), "PRIVATE_CONFIG");
		await mkdir(join(root, "agents", "directory.md"));
		const executable = join(root, "claude.mjs");
		const logPath = join(root, "commands.jsonl");
		await writeFile(
			executable,
			`#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('[]');\n`,
			{ mode: 0o700 },
		);
		const groups = await createClaudeCodeAdapter({
			claudeCodePath: executable,
		}).inspectCapabilities({
			id: "claude-code",
			adapter: "claude-code",
			displayName: "Claude Code",
			model: null,
			createdAt: "2026-09-14T00:00:00.000Z",
		});
		expect(groups.find((group) => group.id === "agents")).toMatchObject({
			status: "available",
			items: [{ name: "reviewer", status: "configured" }],
		});
		expect(await readFile(logPath, "utf8")).toBe(
			'["plugin","list","--json"]\n',
		);
		expect(JSON.stringify(groups)).not.toMatch(
			/PRIVATE_|unrelated|directory\.md/u,
		);
		expect(JSON.stringify(groups)).not.toContain(root);
	});
	it("keeps only browser-safe names and native state from JSON", () => {
		const output = JSON.stringify({
			installed: [
				{
					name: "browser",
					enabled: true,
					source: { path: "/private/alice" },
					token: "secret",
				},
				{ name: "/private/alice", enabled: true },
				{ id: "disabled@example", enabled: false, installPath: "/secret" },
			],
		});
		expect(parseNamedJsonInventory(output)).toEqual([
			{ name: "browser", status: "enabled" },
			{ name: "disabled@example", status: "disabled" },
		]);
	});

	it("reports the Hermes ACP tool surface without executing inventory commands", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-capabilities-"));
		roots.push(root);
		const executable = join(root, "hermes");
		const log = join(root, "args.log");
		await writeFile(
			executable,
			`#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nprintf '✓ enabled  fixture\\n'\n`,
		);
		await chmod(executable, 0o755);
		const groups = await createHermesAdapter({
			hermesPath: executable,
		}).inspectCapabilities({
			id: "reviewer",
			displayName: "Reviewer",
			adapter: "hermes",
			model: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(groups).toHaveLength(6);
		expect(groups.find((group) => group.id === "tools")).toMatchObject({
			status: "available",
			source: "Hermes ACP default surface",
			items: expect.arrayContaining([
				{ name: "read_file", status: "configured" },
				{ name: "terminal", status: "configured" },
				{ name: "browser_exec", status: "configured" },
				{ name: "skills_list", status: "configured" },
				{ name: "delegate_task", status: "configured" },
			]),
		});
		expect(groups.filter((group) => group.status === "available")).toHaveLength(
			1,
		);
		await expect(readFile(log, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("isolates failed categories and never exposes raw Codex configuration", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-capabilities-"));
		roots.push(root);
		const executable = join(root, "codex");
		await writeFile(
			executable,
			`#!/bin/sh\nif [ "$1" = "mcp" ]; then printf '%s' '[{"name":"catalog","enabled":true,"transport":{"command":"/private/secret","args":["TOKEN=secret"]}}]'; exit 0; fi\nprintf '%s' 'credential failure at /private/secret' >&2\nexit 1\n`,
		);
		await chmod(executable, 0o755);
		const groups = await createCodexAdapter({
			codexPath: executable,
		}).inspectCapabilities({
			id: "codex",
			displayName: "Codex",
			adapter: "codex",
			model: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(groups.find((group) => group.id === "mcp")).toMatchObject({
			status: "available",
			items: [{ name: "catalog", status: "enabled" }],
		});
		expect(groups.find((group) => group.id === "plugins")).toMatchObject({
			status: "error",
			items: [],
		});
		expect(JSON.stringify(groups)).not.toMatch(
			/private\/secret|TOKEN=|credential failure/u,
		);
	});
});
