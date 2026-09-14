import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	CommonspaceMutation,
	ConversationRef,
	DiscoverAgentsRequest,
	SendMessageRequest,
} from "@commonspace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { startAnthropicModelServer } from "./fixtures/anthropic-model-server.ts";
import { startGeminiModelServer } from "./fixtures/gemini-model-server.ts";
import { hasModelToolResult } from "./fixtures/model-tool-results.ts";

type NativeTestAdapter = "claude-code" | "gemini" | "opencode";

const require = createRequire(
	new URL("../server/package.json", import.meta.url),
);
const roots: string[] = [];
const hosts: ChildProcess[] = [];
const hostLogs = new Map<string, () => string>();
const modelServers: Awaited<ReturnType<typeof startAnthropicModelServer>>[] =
	[];
const bootstrapSchema = z.object({
	state: z.object({
		messages: z.record(
			z.string(),
			z.array(z.looseObject({ authorType: z.string(), text: z.string() })),
		),
		permissions: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				status: z.string(),
				options: z.array(z.object({ optionId: z.string(), kind: z.string() })),
			}),
		),
	}),
});
const sessionsSchema = z.object({
	agentSessions: z.record(z.string(), z.record(z.string(), z.string())),
});

async function stopHost(child: ChildProcess) {
	if (
		child.pid === undefined ||
		child.exitCode !== null ||
		child.signalCode !== null
	)
		return;
	const exited = once(child, "exit");
	child.kill("SIGTERM");
	const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
	try {
		await exited;
	} finally {
		clearTimeout(force);
	}
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map(stopHost));
	await Promise.all(modelServers.splice(0).map((server) => server.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
	hostLogs.clear();
});

async function startHost(
	root: string,
	modelUrl: string,
	adapter: NativeTestAdapter,
) {
	await mkdir(join(root, "tmp"), { recursive: true });
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		TMPDIR: join(root, "tmp"),
		NO_BROWSER: "1",
	};
	if (adapter === "claude-code") {
		Object.assign(env, {
			CLAUDE_CONFIG_DIR: join(root, "claude"),
			ANTHROPIC_BASE_URL: modelUrl,
			ANTHROPIC_AUTH_TOKEN: "commonspace-local-model-test",
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			DISABLE_AUTOUPDATER: "1",
		});
	} else if (adapter === "gemini") {
		const geminiHome = join(root, "gemini");
		await mkdir(join(geminiHome, ".gemini"), { recursive: true });
		await writeFile(
			join(geminiHome, ".gemini/settings.json"),
			JSON.stringify({
				security: {
					auth: { selectedType: "gemini-api-key" },
					folderTrust: { enabled: false },
				},
				model: { name: "gemini-2.5-flash" },
				telemetry: { enabled: false },
				general: { enableAutoUpdate: false },
			}),
		);
		if (process.env.COMMONSPACE_TEST_GEMINI_PATH !== undefined)
			env.COMMONSPACE_TEST_GEMINI_PATH =
				process.env.COMMONSPACE_TEST_GEMINI_PATH;
		Object.assign(env, {
			GEMINI_CLI_HOME: geminiHome,
			GEMINI_CLI_NO_RELAUNCH: "true",
			GEMINI_API_KEY: "commonspace-local-model-test",
			GOOGLE_GEMINI_BASE_URL: modelUrl,
			GEMINI_TELEMETRY_ENABLED: "false",
		});
	} else {
		Object.assign(env, {
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_DATA_HOME: join(root, "data"),
			XDG_CACHE_HOME: join(root, "cache"),
			XDG_STATE_HOME: join(root, "state"),
			OPENCODE_CONFIG_DIR: join(root, "config/opencode"),
			OPENCODE_DISABLE_MODELS_FETCH: "true",
			OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
			OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
			OPENCODE_DISABLE_CLAUDE_CODE: "true",
			OPENCODE_CONFIG_CONTENT: JSON.stringify({
				model: "fixture/test-model",
				small_model: "fixture/test-model",
				enabled_providers: ["fixture"],
				autoupdate: false,
				share: "disabled",
				snapshot: false,
				permission: "ask",
				provider: {
					fixture: {
						npm: "@ai-sdk/anthropic",
						name: "Local fixture",
						options: {
							baseURL: `${modelUrl}/v1`,
							apiKey: "commonspace-local-model-test",
						},
						models: {
							"test-model": {
								name: "Fixture",
								limit: { context: 200000, output: 4096 },
							},
						},
					},
				},
			}),
		});
	}
	const child = fork(
		fileURLToPath(
			new URL("./fixtures/native-agent-test-host.mjs", import.meta.url),
		),
		[join(root, "workspace"), adapter],
		{
			execArgv: ["--import", require.resolve("tsx")],
			env,
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	hosts.push(child);
	let stderr = "";
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-8_000);
	});
	const ready = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Local native host did not start: ${stderr}`)),
			15_000,
		);
		child.once("message", (message) => {
			clearTimeout(timer);
			const parsed = z.object({ url: z.string().url() }).safeParse(message);
			if (parsed.success) resolve(parsed.data.url);
			else reject(new Error("Invalid local host readiness message"));
		});
		child.once("exit", () => {
			clearTimeout(timer);
			reject(new Error(`Local host exited: ${stderr}`));
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
	hostLogs.set(ready, () => stderr);
	return { url: ready, child };
}

type IntegrationRequest =
	| CommonspaceMutation
	| DiscoverAgentsRequest
	| SendMessageRequest
	| { optionId: string };

async function post(url: string, path: string, body: IntegrationRequest) {
	const response = await fetch(`${url}${path}`, {
		method: "POST",
		headers: { origin: url, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(await response.text());
	return response.json();
}

async function bootstrap(url: string) {
	const response = await fetch(`${url}/api/bootstrap`, {
		headers: { origin: url },
	});
	if (!response.ok) throw new Error(await response.text());
	return bootstrapSchema.parse(await response.json());
}

async function waitForReply(url: string, conversation: string, text: string) {
	try {
		await expect
			.poll(
				async () => {
					const snapshot = await bootstrap(url);
					return snapshot.state.messages[conversation]?.some(
						(message) =>
							message.authorType === "agent" && message.text === text,
					);
				},
				{ timeout: 15_000, interval: 100 },
			)
			.toBe(true);
	} catch (error) {
		const snapshot = await bootstrap(url);
		throw new Error(
			JSON.stringify({
				messages: snapshot.state.messages[conversation],
				permissions: snapshot.state.permissions,
				stderr: hostLogs.get(url)?.(),
			}),
			{ cause: error },
		);
	}
}

async function waitForReplyCount(
	url: string,
	conversation: string,
	count: number,
) {
	try {
		await expect
			.poll(
				async () =>
					(await bootstrap(url)).state.messages[conversation]?.filter(
						(message) => message.authorType === "agent",
					).length,
				{ timeout: 15_000 },
			)
			.toBe(count);
	} catch (error) {
		const snapshot = await bootstrap(url);
		throw new Error(
			JSON.stringify({
				messages: snapshot.state.messages[conversation],
				permissions: snapshot.state.permissions,
				stderr: hostLogs.get(url)?.(),
			}),
			{ cause: error },
		);
	}
}

async function addHarness(url: string, adapter: NativeTestAdapter) {
	await post(url, "/api/discover-agents", { adapter });
	await post(url, "/api/mutate", {
		action: "add-discovered-agent",
		agentId: adapter,
		adapter,
	});
}

async function readSession(root: string, adapter: NativeTestAdapter) {
	const saved = sessionsSchema.parse(
		JSON.parse(await readFile(join(root, "workspace/state.json"), "utf8")),
	);
	return saved.agentSessions[adapter]?.["Bot Chat"];
}

describe.each([
	{ adapter: "claude-code", label: "Claude Code" },
	{ adapter: "gemini", label: "Gemini CLI" },
	{ adapter: "opencode", label: "OpenCode" },
] as const)(
	"$label integration without provider credentials",
	({ adapter, label }) => {
		const startModelServer =
			adapter === "gemini" ? startGeminiModelServer : startAnthropicModelServer;
		if (adapter === "gemini") {
			it.runIf(process.env.COMMONSPACE_GEMINI_RESUME_STRESS === "1")(
				"keeps longer native history replay out of the resumed Gemini reply",
				async () => {
					const root = await mkdtemp(
						join(tmpdir(), "commonspace-gemini-replay-"),
					);
					roots.push(root);
					const model = await startModelServer((request) => ({
						type: "text",
						text: JSON.stringify(request.messages).includes(
							"Continue after restart.",
						)
							? "Native resumed."
							: "Native initial.",
					}));
					modelServers.push(model);
					const first = await startHost(root, model.url, adapter);
					await addHarness(first.url, adapter);
					const conversation: ConversationRef = { kind: "dm", id: adapter };
					for (let index = 0; index < 6; index += 1) {
						await post(first.url, "/api/send", {
							conversation,
							text: `Remember NATIVE_HISTORY_SENTINEL ${index}.`,
						});
						await waitForReplyCount(first.url, `dm:${adapter}`, index + 1);
					}
					await expect
						.poll(() => readSession(root, adapter))
						.toEqual(expect.any(String));
					const session = await readSession(root, adapter);
					await stopHost(first.child);
					const resumed = await startHost(root, model.url, adapter);
					await post(resumed.url, "/api/send", {
						conversation,
						text: "Continue after restart.",
					});
					await waitForReplyCount(resumed.url, `dm:${adapter}`, 7);
					expect(await readSession(root, adapter)).toBe(session);
					const replies = (await bootstrap(resumed.url)).state.messages[
						`dm:${adapter}`
					]?.filter((message) => message.authorType === "agent");
					expect(model.errors).toEqual([]);
					expect(replies?.at(-1)?.text).toBe("Native resumed.");
				},
				90_000,
			);
		}
		it("inspects real native capability sources without a model turn or configuration changes", async () => {
			const root = await mkdtemp(
				join(tmpdir(), `commonspace-${adapter}-inventory-`),
			);
			roots.push(root);
			const model = await startModelServer(() => {
				throw new Error("Inventory must not call a model");
			});
			modelServers.push(model);
			const host = await startHost(root, model.url, adapter);
			await addHarness(host.url, adapter);
			const nativeRoot =
				adapter === "claude-code"
					? join(root, "claude")
					: adapter === "gemini"
						? join(root, "gemini", ".gemini")
						: join(root, "config", "opencode");
			await mkdir(join(nativeRoot, "skills", "fixture-review"), {
				recursive: true,
			});
			const skillPath = join(
				nativeRoot,
				"skills",
				"fixture-review",
				"SKILL.md",
			);
			await writeFile(skillPath, "PRIVATE_NATIVE_PROMPT_BODY");
			let agentPath: string | undefined;
			if (adapter === "claude-code") {
				await mkdir(join(nativeRoot, "agents"), { recursive: true });
				agentPath = join(nativeRoot, "agents", "fixture-reviewer.md");
				await writeFile(agentPath, "PRIVATE_NATIVE_AGENT_PROMPT_BODY");
			}
			const statePath = join(root, "workspace", "state.json");
			const stateBefore = await readFile(statePath, "utf8");
			const response = await fetch(
				`${host.url}/api/agents/${adapter}/capabilities`,
				{ headers: { origin: host.url } },
			);
			expect(response.status).toBe(200);
			const inventory = z
				.looseObject({
					groups: z.array(
						z.looseObject({
							id: z.string(),
							status: z.string(),
							items: z.array(
								z.looseObject({ name: z.string(), status: z.string() }),
							),
						}),
					),
				})
				.parse(await response.json());
			expect(inventory.groups).toHaveLength(6);
			expect(
				inventory.groups.filter((group) => group.status === "error"),
			).toEqual([]);
			expect(
				inventory.groups.find((group) => group.id === "skills"),
			).toMatchObject({
				status: "available",
				items: expect.arrayContaining([
					{ name: "fixture-review", status: "configured" },
				]),
			});
			expect(JSON.stringify(inventory)).not.toContain(root);
			expect(JSON.stringify(inventory)).not.toContain(
				"PRIVATE_NATIVE_AGENT_PROMPT_BODY",
			);
			if (agentPath !== undefined) {
				expect(
					inventory.groups.find((group) => group.id === "agents"),
				).toMatchObject({
					status: "available",
					items: [{ name: "fixture-reviewer", status: "configured" }],
				});
				expect(await readFile(agentPath, "utf8")).toBe(
					"PRIVATE_NATIVE_AGENT_PROMPT_BODY",
				);
			}
			expect(JSON.stringify(inventory)).not.toContain(
				"PRIVATE_NATIVE_PROMPT_BODY",
			);
			expect(await readFile(skillPath, "utf8")).toBe(
				"PRIVATE_NATIVE_PROMPT_BODY",
			);
			expect(await readFile(statePath, "utf8")).toBe(stateBefore);
			expect(model.requests).toEqual([]);
			expect(model.errors).toEqual([]);
		}, 45_000);
		it("uses the real CLI and ACP transport to resume native context after restart and clear it on reset", async () => {
			const root = await mkdtemp(
				join(tmpdir(), `commonspace-${adapter}-integration-`),
			);
			roots.push(root);
			const model = await startModelServer((request) => {
				const transcript = JSON.stringify(request.messages);
				const text = transcript.includes("Start a fresh conversation.")
					? "Native fresh."
					: transcript.includes("Continue after restart.")
						? "Native resumed."
						: "Native initial.";
				return { type: "text", text };
			});
			modelServers.push(model);
			const first = await startHost(root, model.url, adapter);
			await addHarness(first.url, adapter);
			const conversation: ConversationRef = { kind: "dm", id: adapter };
			await post(first.url, "/api/send", {
				conversation,
				text: "Remember NATIVE_HISTORY_SENTINEL.",
			});
			await waitForReply(first.url, `dm:${adapter}`, "Native initial.");
			// The reply can become visible before the atomic state write completes.
			await expect
				.poll(() => readSession(root, adapter))
				.toEqual(expect.any(String));
			const session = await readSession(root, adapter);
			await stopHost(first.child);
			const resumed = await startHost(root, model.url, adapter);
			await post(resumed.url, "/api/send", {
				conversation,
				text: "Continue after restart.",
			});
			await waitForReply(resumed.url, `dm:${adapter}`, "Native resumed.");
			const resumedRequest = model.requests.find(
				(request) =>
					JSON.stringify(request.messages).includes(
						"Continue after restart.",
					) &&
					JSON.stringify(request.messages).includes("NATIVE_HISTORY_SENTINEL"),
			);
			expect(JSON.stringify(resumedRequest?.messages)).toContain(
				"NATIVE_HISTORY_SENTINEL",
			);
			await waitForReplyCount(resumed.url, `dm:${adapter}`, 2);
			expect(await readSession(root, adapter)).toBe(session);
			await post(resumed.url, "/api/mutate", {
				action: "reset-dm",
				agentId: adapter,
			});
			await post(resumed.url, "/api/send", {
				conversation,
				text: "Start a fresh conversation.",
			});
			await waitForReply(resumed.url, `dm:${adapter}`, "Native fresh.");
			const freshRequests = model.requests.filter((request) =>
				JSON.stringify(request.messages).includes(
					"Start a fresh conversation.",
				),
			);
			expect(freshRequests.length).toBeGreaterThan(0);
			expect(JSON.stringify(freshRequests)).not.toContain(
				"NATIVE_HISTORY_SENTINEL",
			);
			await waitForReplyCount(resumed.url, `dm:${adapter}`, 3);
			expect(model.errors).toEqual([]);
		}, 90_000);

		it("runs real scoped MCP context and progress tools through the native CLI", async () => {
			const root = await mkdtemp(
				join(tmpdir(), `commonspace-${adapter}-mcp-integration-`),
			);
			roots.push(root);
			const model = await startModelServer((request) => {
				if (hasModelToolResult(request, "commonspace_post_progress"))
					return { type: "text", text: "Native MCP completed." };
				if (
					!request.tools?.some((tool) =>
						tool.name.endsWith("commonspace_get_context"),
					)
				)
					return { type: "text", text: "Auxiliary fixture reply." };
				const hasContext = hasModelToolResult(
					request,
					"commonspace_get_context",
				);
				const suffix = hasContext
					? "commonspace_post_progress"
					: "commonspace_get_context";
				const tool = request.tools?.find((candidate) =>
					candidate.name.endsWith(suffix),
				);
				if (tool === undefined)
					throw new Error(`Native CLI did not advertise ${suffix}`);
				return {
					type: "tool_use",
					name: tool.name,
					input: hasContext ? { text: "NATIVE_MCP_PROGRESS" } : {},
				};
			});
			modelServers.push(model);
			const host = await startHost(root, model.url, adapter);
			await addHarness(host.url, adapter);
			const channelSchema = z.object({
				state: z.object({ channels: z.array(z.object({ id: z.string() })) }),
			});
			const created = channelSchema.parse(
				await post(host.url, "/api/mutate", {
					action: "create-channel",
					name: "native-context",
					agentIds: [adapter],
				}),
			);
			const channelId = created.state.channels[0]?.id;
			if (channelId === undefined) throw new Error("Expected the test Channel");
			await post(host.url, "/api/mutate", {
				action: "set-channel-context",
				channelId,
				instructions: "SCOPED_CONTEXT_SENTINEL",
			});
			const other = channelSchema.parse(
				await post(host.url, "/api/mutate", {
					action: "create-channel",
					name: "unrelated-context",
					agentIds: [adapter],
				}),
			);
			const otherId = other.state.channels.find(
				(channel) => channel.id !== channelId,
			)?.id;
			if (otherId === undefined)
				throw new Error("Expected the unrelated Channel");
			await post(host.url, "/api/mutate", {
				action: "set-channel-context",
				channelId: otherId,
				instructions: "UNRELATED_CONTEXT_SENTINEL",
			});
			await post(host.url, "/api/send", {
				conversation: { kind: "channel", id: channelId },
				text: `@${label.replaceAll(" ", "-")} read shared context and post progress.`,
			});
			await expect
				.poll(
					async () => {
						const snapshot = await bootstrap(host.url);
						for (const permission of snapshot.state.permissions.filter(
							(candidate) => candidate.status === "pending",
						)) {
							if (!permission.title.toLowerCase().includes("commonspace"))
								throw new Error("Unexpected native tool permission");
							const option = permission.options.find(
								(candidate) => candidate.kind === "allow_once",
							);
							if (option === undefined)
								throw new Error("Native permission did not offer allow once");
							await post(
								host.url,
								`/api/permissions/${permission.id}/respond`,
								{
									optionId: option.optionId,
								},
							);
						}
						return snapshot.state.messages[`channel:${channelId}`]?.some(
							(message) =>
								message.authorType === "agent" &&
								message.text === "Native MCP completed.",
						);
					},
					{ timeout: 30_000, interval: 100 },
				)
				.toBe(true);
			const snapshot = await bootstrap(host.url);
			expect(
				snapshot.state.messages[`channel:${channelId}`]
					?.filter((message) => message.authorType === "agent")
					.map((message) => message.text),
			).toEqual(["NATIVE_MCP_PROGRESS", "Native MCP completed."]);
			expect(JSON.stringify(model.requests[0]?.messages)).not.toContain(
				"SCOPED_CONTEXT_SENTINEL",
			);
			expect(
				JSON.stringify(
					model.requests.find((request) =>
						hasModelToolResult(request, "commonspace_get_context"),
					)?.messages,
				),
			).toContain("SCOPED_CONTEXT_SENTINEL");
			expect(JSON.stringify(model.requests)).not.toContain(
				"UNRELATED_CONTEXT_SENTINEL",
			);
			expect(model.errors).toEqual([]);
		}, 60_000);
	},
);
