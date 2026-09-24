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
import {
	parseCodexMcpInventory,
	parseNamedJsonInventory,
	parseOpenCodeMcpAuthList,
} from "../server/src/adapters/capability-inventory.ts";
import { createClaudeCodeAdapter } from "../server/src/adapters/claude-code.ts";
import { createCodexAdapter } from "../server/src/adapters/codex.ts";
import { createHermesAdapter } from "../server/src/adapters/hermes.ts";
import { createOpenCodeAdapter } from "../server/src/adapters/opencode.ts";

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

	it("reports Codex MCP authentication without exposing connection details", () => {
		const output = JSON.stringify([
			{
				name: "signed-in",
				enabled: true,
				auth_status: "logged_in",
				transport: { url: "https://private.example/token" },
			},
			{ name: "needs-login", auth_status: "not_logged_in" },
			{ name: "local", auth_status: "unsupported" },
			{ name: "uncertain", auth_status: "future_native_status" },
			{ name: "/private/invalid", auth_status: "logged_in" },
		]);
		expect(parseCodexMcpInventory(output)).toEqual([
			{ name: "signed-in", status: "enabled", authentication: "authenticated" },
			{
				name: "needs-login",
				status: "unknown",
				authentication: "not_authenticated",
			},
			{ name: "local", status: "unknown", authentication: "unsupported" },
			{ name: "uncertain", status: "unknown", authentication: "unknown" },
		]);
		expect(JSON.stringify(parseCodexMcpInventory(output))).not.toContain(
			"private.example",
		);
	});

	it("keeps only OpenCode OAuth states from its native status listing", () => {
		const output = [
			"┌  MCP OAuth Status",
			"●  ✓ catalog \u001b[90mauthenticated",
			"│      \u001b[90mhttps://private.example/token",
			"●  ⚠ expired \u001b[90mexpired",
			"│      \u001b[90mhttps://private.example/expired",
			"●  ✗ needs-login \u001b[90mnot authenticated",
			"│      \u001b[90mhttps://private.example/login",
			"└  3 OAuth-capable server(s)",
		].join("\n");
		const urls = new Map([
			["catalog", "https://private.example/token"],
			["expired", "https://private.example/expired"],
			["needs-login", "https://private.example/login"],
		]);
		expect([...parseOpenCodeMcpAuthList(output, urls)]).toEqual([
			["catalog", "authenticated"],
			["expired", "expired"],
			["needs-login", "not_authenticated"],
		]);
		expect(() =>
			parseOpenCodeMcpAuthList(
				output.replace("3 OAuth-capable", "4 OAuth-capable"),
				urls,
			),
		).toThrow();
		expect(
			parseOpenCodeMcpAuthList(
				output.replace(
					"https://private.example/token",
					"https://other.example/token",
				),
				urls,
			).has("catalog"),
		).toBe(false);
		expect(
			[
				...parseOpenCodeMcpAuthList(
					output.replace("catalog", "4 OAuth-capable server(s)"),
					new Map([
						...urls,
						["4 OAuth-capable server(s)", "https://private.example/token"],
					]),
				),
			].length,
		).toBe(3);
	});

	it("reports and renews OpenCode OAuth without exposing URLs or starting MCP servers", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-opencode-auth-"));
		roots.push(root);
		const configRoot = join(root, "opencode");
		await mkdir(configRoot);
		vi.stubEnv("HOME", root);
		vi.stubEnv("XDG_CONFIG_HOME", root);
		vi.stubEnv("XDG_DATA_HOME", join(root, "native-data"));
		const statusPath = join(root, "status");
		const callsPath = join(root, "calls");
		const probePath = join(root, "probe-env.json");
		const nativeUrlPath = join(root, "native-url");
		const cli = join(root, "opencode-fixture");
		await writeFile(statusPath, "authenticated");
		await writeFile(callsPath, "");
		await writeFile(
			join(configRoot, "opencode.json"),
			JSON.stringify({
				mcp: {
					catalog: {
						type: "remote",
						url: "https://private.example/token",
						headers: { Authorization: "Bearer PRIVATE_HEADER" },
						oauth: { clientSecret: "PRIVATE_CLIENT_SECRET" },
					},
					expired: { type: "remote", url: "https://private.example/expired" },
					local: { type: "local", command: ["/private/never-run"] },
					templated: {
						type: "remote",
						url: "https://{env:MCP_HOST}/mcp",
					},
				},
			}),
		);
		await writeFile(
			cli,
			`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
if (args[0] === 'mcp' && args[1] === 'auth' && args[2] === 'list') {
  fs.writeFileSync(${JSON.stringify(probePath)}, JSON.stringify({ home: process.env.HOME, configHome: process.env.XDG_CONFIG_HOME, dataHome: process.env.XDG_DATA_HOME, content: process.env.OPENCODE_CONFIG_CONTENT }));
  for (const directory of [path.join(process.env.XDG_CONFIG_HOME, 'opencode'), path.join(process.env.HOME, '.opencode')]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '.gitignore'), 'native startup side effect');
  }
  const status = fs.readFileSync(${JSON.stringify(statusPath)}, 'utf8');
  const catalogUrl = process.env.OPENCODE_CONFIG_CONTENT || !fs.existsSync(${JSON.stringify(nativeUrlPath)}) ? 'https://private.example/token' : fs.readFileSync(${JSON.stringify(nativeUrlPath)}, 'utf8');
  console.log('┌  MCP OAuth Status\\n●  ✓ catalog \\x1b[90m' + status + '\\n│      ' + catalogUrl + '\\n●  ⚠ expired \\x1b[90mexpired\\n│      https://private.example/expired\\n└  2 OAuth-capable server(s)');
} else if (args[0] === 'mcp' && args[1] === 'auth' && args[2] === 'catalog') {
  process.stdout.write('◆  catalog already has valid credentials. Re-authenticate?\\n');
  process.stdin.on('data', (input) => {
    if (input.includes(13)) { console.log('Authentication successful!'); process.exit(0); }
  });
} else if (args[0] === 'mcp' && args[1] === 'auth' && args[2] === 'expired') {
  console.log('Authentication failed');
} else {
  process.exitCode = 1;
}
`,
			{ mode: 0o700 },
		);
		const adapter = createOpenCodeAdapter({ opencodePath: cli });
		const groups = await adapter.inspectCapabilities({
			id: "opencode",
			adapter: "opencode",
			displayName: "OpenCode",
			model: null,
			createdAt: "2026-09-24T00:00:00.000Z",
		});
		expect(groups.find((group) => group.id === "mcp")).toMatchObject({
			status: "available",
			items: [
				{ name: "catalog", authentication: "authenticated" },
				{ name: "expired", authentication: "expired" },
				{ name: "local", status: "configured" },
				{ name: "templated", status: "configured" },
			],
		});
		expect(groups.find((group) => group.id === "mcp")?.notice).toContain(
			"URLs using variable substitution",
		);
		expect(JSON.stringify(groups)).not.toMatch(/private\.example|never-run/u);
		const probe = JSON.parse(await readFile(probePath, "utf8"));
		expect(probe.home).not.toBe(root);
		expect(probe.configHome).not.toBe(root);
		expect(probe.dataHome).toBe(join(root, "native-data"));
		expect(JSON.parse(probe.content)).toEqual({
			mcp: {
				catalog: { type: "remote", url: "https://private.example/token" },
				expired: { type: "remote", url: "https://private.example/expired" },
			},
		});
		await expect(
			readFile(join(configRoot, ".gitignore")),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(
			readFile(join(root, ".opencode", ".gitignore")),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
		const callsBeforeLocal = await readFile(callsPath, "utf8");
		expect(await adapter.authenticateMcp?.("local")).toBe(false);
		expect(await adapter.authenticateMcp?.("templated")).toBe(false);
		expect(await readFile(callsPath, "utf8")).toBe(callsBeforeLocal);
		expect(await adapter.authenticateMcp?.("catalog")).toBe(true);
		await expect(adapter.authenticateMcp?.("expired")).rejects.toThrow();
		const calls = await readFile(callsPath, "utf8");
		expect(calls).not.toContain("/private/never-run");
		expect(calls).toContain('["mcp","auth","catalog","--pure"]');
		await writeFile(nativeUrlPath, "https://different.example/mcp");
		const authCallsBefore = (
			(await readFile(callsPath, "utf8")).match(
				/\["mcp","auth","catalog","--pure"\]/gu,
			) ?? []
		).length;
		expect(await adapter.authenticateMcp?.("catalog")).toBe(false);
		expect(
			(
				(await readFile(callsPath, "utf8")).match(
					/\["mcp","auth","catalog","--pure"\]/gu,
				) ?? []
			).length,
		).toBe(authCallsBefore);
		vi.stubEnv("OPENCODE_CONFIG_DIR", join(root, "override"));
		const overridden = createOpenCodeAdapter({ opencodePath: cli });
		expect(
			(
				await overridden.inspectCapabilities({
					id: "opencode",
					adapter: "opencode",
					displayName: "OpenCode",
					model: null,
					createdAt: "2026-09-24T00:00:00.000Z",
				})
			).find((group) => group.id === "mcp")?.items[0],
		).not.toHaveProperty("authentication");
		expect(await overridden.authenticateMcp?.("catalog")).toBe(false);
		vi.stubEnv("OPENCODE_CONFIG_DIR", undefined);
		vi.stubEnv("OPENCODE_CONFIG_CONTENT", '{"mcp":{}}');
		const contentOverridden = createOpenCodeAdapter({ opencodePath: cli });
		expect(await contentOverridden.authenticateMcp?.("catalog")).toBe(false);
		expect(
			(
				await contentOverridden.inspectCapabilities({
					id: "opencode",
					adapter: "opencode",
					displayName: "OpenCode",
					model: null,
					createdAt: "2026-09-24T00:00:00.000Z",
				})
			).find((group) => group.id === "mcp")?.items[0],
		).not.toHaveProperty("authentication");

		vi.stubEnv("OPENCODE_CONFIG_CONTENT", undefined);
		await writeFile(join(configRoot, "opencode.json"), '{"mcp":{}}');
		await writeFile(callsPath, "");
		await createOpenCodeAdapter({ opencodePath: cli }).inspectCapabilities({
			id: "opencode",
			adapter: "opencode",
			displayName: "OpenCode",
			model: null,
			createdAt: "2026-09-24T00:00:00.000Z",
		});
		expect(await readFile(callsPath, "utf8")).toBe("");
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
