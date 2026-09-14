import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { URL } from "node:url";

const sessionId =
	process.env.FAKE_ACP_SESSION_ID ?? "123e4567-e89b-42d3-a456-426614174000";
const logPath = process.env.FAKE_ACP_LOG;
const mcpServersBySession = new Map();
const loadedSessionIds = new Set();
let processMcpServers;
const pendingPrompts = new Map();
let pendingPermissionPrompt;
let selectedModel = "default";

async function writeFrame(frame) {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

async function record(frame) {
	if (logPath) await appendFile(logPath, `${JSON.stringify(frame)}\n`);
}

function sessionSettings() {
	if (process.env.FAKE_ACP_DYNAMIC_SETTINGS === "1") {
		return {
			configOptions: [
				{
					id: "model",
					category: "model",
					name: "Model",
					type: "select",
					currentValue: selectedModel,
					options: [
						{ value: "default", name: "Default" },
						{ value: "gpt-test", name: "Test" },
					],
				},
				{
					id: "effort",
					category: "thought_level",
					name: "Effort",
					type: "select",
					currentValue: "medium",
					options: [
						{
							value: selectedModel === "gpt-test" ? "max" : "high",
							name: "Supported effort",
						},
					],
				},
			],
		};
	}
	if (process.env.FAKE_ACP_HERMES_SETTINGS === "1") {
		return {
			modes: {
				currentModeId: "accept_edits",
				availableModes: [
					{ id: "default", name: "Default" },
					{ id: "accept_edits", name: "Accept edits" },
					{ id: "dont_ask", name: "Don't ask" },
				],
			},
			models: {
				currentModelId: "openai:profile-default",
				availableModels: [
					{ modelId: "openai:profile-default", name: "Profile default" },
					{ modelId: "openai:hermes-test", name: "Hermes test" },
				],
			},
		};
	}
	if (process.env.FAKE_ACP_SETTINGS !== "1") return {};
	return {
		modes: {
			currentModeId: "read-only",
			availableModes: [
				{ id: "read-only", name: "Read only" },
				{ id: "agent", name: "Agent" },
				{ id: "agent-full-access", name: "Agent full access" },
				{ id: "acceptEdits", name: "Accept edits" },
				{ id: "bypassPermissions", name: "Bypass permissions" },
			],
		},
		configOptions: [
			{
				id: "model",
				name: "Model",
				type: "select",
				currentValue: "default",
				options: [{ value: "gpt-test", name: "GPT Test" }],
			},
			{
				id: "reasoning_effort",
				name: "Reasoning",
				type: "select",
				currentValue: "medium",
				options: [{ value: "high", name: "High" }],
			},
			{
				id: "effort",
				name: "Effort",
				type: "select",
				currentValue: "medium",
				options: [{ value: "high", name: "High" }],
			},
		],
	};
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

if (process.env.FAKE_ACP_SHUTDOWN_DELAY_MS !== undefined) {
	let stopping = false;
	const flushAndStop = async () => {
		if (stopping) return;
		stopping = true;
		await new Promise((resolve) =>
			setTimeout(resolve, Number(process.env.FAKE_ACP_SHUTDOWN_DELAY_MS)),
		);
		await record({ event: "native-flushed" });
		process.exit(0);
	};
	process.on("SIGTERM", flushAndStop);
	lines.on("close", flushAndStop);
}

for await (const line of lines) {
	const frame = JSON.parse(line);
	if (
		frame.method === "session/cancel" &&
		process.env.FAKE_ACP_DELAY_CANCEL_MS
	) {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(process.env.FAKE_ACP_DELAY_CANCEL_MS)),
		);
	}
	await record(frame);
	if (frame.method === process.env.FAKE_ACP_DELAY_METHOD) {
		await new Promise((resolve) =>
			setTimeout(resolve, Number(process.env.FAKE_ACP_SETUP_DELAY_MS ?? 0)),
		);
	}

	if (frame.id === "permission-1" && pendingPermissionPrompt !== undefined) {
		const pending = pendingPermissionPrompt;
		pendingPermissionPrompt = undefined;
		await writeFrame({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: pending.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `Echo: ${pending.text}` },
				},
			},
		});
		await writeFrame({
			jsonrpc: "2.0",
			id: pending.promptId,
			result: { stopReason: "end_turn" },
		});
		continue;
	}

	if (frame.method === "initialize") {
		if (process.env.FAKE_ACP_HANG_INITIALIZE === "1") continue;
		if (process.env.FAKE_ACP_CAPTURE_ENV === "1") {
			await record({
				event: "environment",
				opencodePermission: process.env.OPENCODE_PERMISSION ?? null,
				noBrowser: process.env.NO_BROWSER ?? null,
				argv: process.argv.slice(2),
				codexConfig:
					process.env.CODEX_CONFIG === undefined
						? null
						: JSON.parse(process.env.CODEX_CONFIG),
			});
		}
		const agentCapabilities = { loadSession: true };
		if (process.env.FAKE_ACP_NO_MCP !== "1")
			agentCapabilities.mcpCapabilities = { http: true, sse: true };
		await writeFrame({
			jsonrpc: "2.0",
			id: frame.id,
			result: {
				protocolVersion: 1,
				agentCapabilities,
				agentInfo: {
					name: "fake-acp-agent",
					version: process.env.FAKE_ACP_VERSION ?? "1.0.0",
				},
			},
		});
		continue;
	}

	if (frame.method === "session/new") {
		mcpServersBySession.set(sessionId, frame.params.mcpServers ?? []);
		processMcpServers ??= frame.params.mcpServers ?? [];
		await writeFrame({
			jsonrpc: "2.0",
			id: frame.id,
			result: { sessionId, ...sessionSettings() },
		});
		continue;
	}

	if (frame.method === "session/load") {
		mcpServersBySession.set(
			frame.params.sessionId,
			frame.params.mcpServers ?? [],
		);
		processMcpServers ??= frame.params.mcpServers ?? [];
		if (process.env.FAKE_ACP_LOAD_ERROR !== undefined) {
			await writeFrame({
				jsonrpc: "2.0",
				id: frame.id,
				error: { code: -32000, message: process.env.FAKE_ACP_LOAD_ERROR },
			});
			continue;
		}
		if (process.env.FAKE_ACP_REPLAY_ON_LOAD === "1") {
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "Old history must stay native." },
					},
				},
			});
		}
		await writeFrame({
			jsonrpc: "2.0",
			id: frame.id,
			result: sessionSettings(),
		});
		loadedSessionIds.add(frame.params.sessionId);
		continue;
	}

	if (frame.method === "session/set_mode") {
		await writeFrame({ jsonrpc: "2.0", id: frame.id, result: {} });
		continue;
	}

	if (frame.method === "session/set_model") {
		await writeFrame({ jsonrpc: "2.0", id: frame.id, result: {} });
		continue;
	}

	if (frame.method === "session/set_config_option") {
		if (process.env.FAKE_ACP_DYNAMIC_SETTINGS === "1") {
			const option = sessionSettings().configOptions.find(
				(candidate) => candidate.id === frame.params.configId,
			);
			if (
				!option.options.some(
					(candidate) => candidate.value === frame.params.value,
				)
			) {
				await writeFrame({
					jsonrpc: "2.0",
					id: frame.id,
					error: {
						code: -32602,
						message: "Setting not advertised by current model",
					},
				});
				continue;
			}
			if (frame.params.configId === "model") selectedModel = frame.params.value;
		}
		await writeFrame({
			jsonrpc: "2.0",
			id: frame.id,
			result: { configOptions: sessionSettings().configOptions ?? [] },
		});
		continue;
	}

	if (frame.method === "session/prompt") {
		if (process.env.FAKE_ACP_NATIVE_MODEL_UPDATE === "1") {
			selectedModel = "default";
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "config_option_update",
						configOptions: sessionSettings().configOptions,
					},
				},
			});
		}
		if (process.env.FAKE_ACP_HANG_PROMPT === "1") {
			pendingPrompts.set(frame.params.sessionId, frame.id);
			continue;
		}
		if (process.env.FAKE_ACP_PROMPT_ERROR === "1") {
			await writeFrame({
				jsonrpc: "2.0",
				id: frame.id,
				error: {
					code: -32000,
					message: `provider failed for sessionId=${frame.params.sessionId}`,
				},
			});
			continue;
		}
		if (process.env.FAKE_ACP_PERMISSION_REQUEST === "1") {
			await writeFrame({
				jsonrpc: "2.0",
				id: "permission-1",
				method: "session/request_permission",
				params: {
					sessionId: frame.params.sessionId,
					toolCall: {
						toolCallId: "sensitive-call",
						title: "Sensitive operation",
						kind: "execute",
						status: "pending",
					},
					options: [
						{ optionId: "allow", name: "Allow", kind: "allow_once" },
						{ optionId: "reject", name: "Reject", kind: "reject_once" },
					],
				},
			});
			const promptText = frame.params.prompt
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
			pendingPermissionPrompt = {
				promptId: frame.id,
				sessionId: frame.params.sessionId,
				text: promptText,
			};
			continue;
		}
		const promptDelayMs = Number(process.env.FAKE_ACP_PROMPT_DELAY_MS ?? 0);
		if (Number.isFinite(promptDelayMs) && promptDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, promptDelayMs));
		}
		const promptText = frame.params.prompt
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("");
		if (
			process.env.FAKE_ACP_EMPTY_AFTER_LOAD === "1" &&
			loadedSessionIds.has(frame.params.sessionId)
		) {
			await writeFrame({
				jsonrpc: "2.0",
				id: frame.id,
				result: { stopReason: "end_turn" },
			});
			continue;
		}
		const configuredInferenceResponse = promptText.includes(
			"bounded routing classifier",
		)
			? process.env.FAKE_ACP_INFERENCE_RESPONSE
			: promptText.includes("compact bounded shared workspace context")
				? process.env.FAKE_ACP_COMPACTION_RESPONSE
				: undefined;
		const text =
			configuredInferenceResponse ??
			(process.env.FAKE_ACP_LARGE_CHUNK === undefined
				? promptText
				: "x".repeat(Number(process.env.FAKE_ACP_LARGE_CHUNK)));
		let contextPrefix = "";
		if (process.env.FAKE_ACP_USE_MCP === "1") {
			const mcpServers =
				process.env.FAKE_ACP_PROCESS_MCP === "1"
					? processMcpServers
					: mcpServersBySession.get(frame.params.sessionId);
			const mcpServer = mcpServers?.[0];
			if (mcpServer?.type !== "http")
				throw new Error("Commonspace MCP server was not attached");
			const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all(
				[
					import("@modelcontextprotocol/sdk/client/index.js"),
					import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
				],
			);
			const headers = Object.fromEntries(
				mcpServer.headers.map((header) => [header.name, header.value]),
			);
			const client = new Client({ name: "fake-acp-agent", version: "1.0.0" });
			await client.connect(
				new StreamableHTTPClientTransport(new URL(mcpServer.url), {
					requestInit: { headers },
				}),
			);
			const result = await client.callTool({
				name: "commonspace_get_context",
				arguments: {},
			});
			const handoffTrigger = process.env.FAKE_ACP_HANDOFF_TRIGGER;
			const handoffTarget = process.env.FAKE_ACP_HANDOFF_TARGET;
			const handoffRequest = process.env.FAKE_ACP_HANDOFF_REQUEST;
			if (
				handoffTrigger !== undefined &&
				handoffTarget !== undefined &&
				handoffRequest !== undefined &&
				promptText.includes(handoffTrigger)
			) {
				await client.callTool({
					name: "commonspace_handoff",
					arguments: {
						targetAgentId: handoffTarget,
						request: handoffRequest,
					},
				});
			}
			await client.close();
			const context = result.structuredContent;
			contextPrefix =
				process.env.FAKE_ACP_THREAD_CONTEXT === "1"
					? `Context thread: ${context.thread.id}; root: ${context.messages[0].text}\n`
					: `Context: ${context.conversation.name}; instructions: ${context.instructions}\n`;
		}
		if (process.env.FAKE_ACP_TRACE === "1") {
			if (process.env.FAKE_ACP_COMPACTION_TRACE === "1") {
				for (const [status, text] of [
					["in_progress", "Compacting context"],
					["completed", "Context compaction complete"],
				]) {
					await writeFrame({
						jsonrpc: "2.0",
						method: "session/update",
						params: {
							sessionId: frame.params.sessionId,
							update: {
								sessionUpdate: "agent_thought_chunk",
								messageId: "123e4567-e89b-42d3-a456-426614174001",
								_meta: {
									"hermes.dev/compaction": { status },
								},
								content: { type: "text", text },
							},
						},
					});
				}
			}
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "agent_thought_chunk",
						content: { type: "text", text: "Inspecting the workspace. " },
					},
				},
			});
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "agent_thought_chunk",
						content: {
							type: "text",
							text: "Choosing the smallest safe change.",
						},
					},
				},
			});
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "plan",
						entries: [
							{
								content: "Inspect the relevant files",
								priority: "high",
								status: "completed",
							},
							{
								content: "Implement and verify the change",
								priority: "high",
								status: "in_progress",
							},
						],
					},
				},
			});
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "tool_call",
						toolCallId: "call-1",
						title: "Read package metadata",
						name: "read_file",
						kind: "read",
						status: "in_progress",
						rawInput: {
							path:
								process.env.FAKE_ACP_TRACE_PATH ??
								"/private/project/package.json",
						},
					},
				},
			});
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "call-1",
						status: "completed",
						content: [
							{
								type: "content",
								content: { type: "text", text: "Package metadata loaded." },
							},
						],
						rawOutput: { ok: true },
					},
				},
			});
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: { sessionUpdate: "usage_update", used: 640, size: 128000 },
				},
			});
		}
		if (process.env.FAKE_ACP_RESOURCE_URI !== undefined) {
			await writeFrame({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: frame.params.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "resource_link",
							name: process.env.FAKE_ACP_RESOURCE_NAME ?? "generated-file",
							uri: process.env.FAKE_ACP_RESOURCE_URI,
							mimeType:
								process.env.FAKE_ACP_RESOURCE_MIME ??
								"application/octet-stream",
						},
					},
				},
			});
		}
		await writeFrame({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: frame.params.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `${contextPrefix}Echo: ` },
				},
			},
		});
		await writeFrame({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: frame.params.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text },
				},
			},
		});
		await writeFrame({
			jsonrpc: "2.0",
			id: frame.id,
			result: { stopReason: "end_turn" },
		});
		continue;
	}

	if (frame.method === "session/cancel") {
		const promptId = pendingPrompts.get(frame.params.sessionId);
		if (promptId !== undefined) {
			pendingPrompts.delete(frame.params.sessionId);
			await writeFrame({
				jsonrpc: "2.0",
				id: promptId,
				result: { stopReason: "cancelled" },
			});
		}
	}
}
