import { randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { z } from "zod";

const modelRequestSchema = z.object({
	model: z.string(),
	messages: z.array(z.json()),
	stream: z.boolean().optional(),
	tools: z.array(z.looseObject({ name: z.string() })).optional(),
});

export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelReply =
	| { type: "text"; text: string }
	| { type: "tool_use"; name: string; input: Record<string, string> };

async function readAnthropicBody(request: IncomingMessage) {
	if (
		request.headers.authorization !== "Bearer commonspace-local-model-test" &&
		request.headers["x-api-key"] !== "commonspace-local-model-test"
	)
		throw new Error("Only the synthetic gateway credential is accepted");
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString();
}

function writeAnthropicReply(
	response: ServerResponse,
	input: ModelRequest,
	output: ModelReply,
) {
	const block =
		output.type === "text"
			? output
			: { ...output, id: `toolu_${randomUUID()}` };
	const stopReason = output.type === "text" ? "end_turn" : "tool_use";
	const message = {
		id: `msg_${randomUUID()}`,
		type: "message",
		role: "assistant",
		model: input.model,
		content: [block],
		stop_reason: stopReason,
		stop_sequence: null,
		usage: { input_tokens: 100, output_tokens: 10 },
	};
	if (input.stream !== true) {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify(message));
		return;
	}
	response.setHeader("content-type", "text/event-stream");
	const contentStart =
		output.type === "text"
			? { type: "text", text: "" }
			: { ...block, input: {} };
	const delta =
		output.type === "text"
			? { type: "text_delta", text: output.text }
			: {
					type: "input_json_delta",
					partial_json: JSON.stringify(output.input),
				};
	const events = [
		{
			type: "message_start",
			message: {
				...message,
				content: [],
				stop_reason: null,
				usage: { input_tokens: 100, output_tokens: 0 },
			},
		},
		{ type: "content_block_start", index: 0, content_block: contentStart },
		{ type: "content_block_delta", index: 0, delta },
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: 10 },
		},
		{ type: "message_stop" },
	];
	for (const event of events)
		response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
	response.end();
}

/** Only model responses are simulated; the CLI, ACP, native sessions, and MCP are real. */
export async function startAnthropicModelServer(
	reply: (request: ModelRequest) => ModelReply,
) {
	const requests: ModelRequest[] = [];
	const errors: string[] = [];
	const server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
			if (request.method === "HEAD" && path === "/api/hello") {
				response.writeHead(404).end();
				return;
			}
			const body = await readAnthropicBody(request);
			if (path === "/v1/messages/count_tokens") {
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ input_tokens: 100 }));
				return;
			}
			if (request.method !== "POST" || path !== "/v1/messages")
				throw new Error(`Unexpected model request: ${request.method} ${path}`);
			const input = modelRequestSchema.parse(JSON.parse(body));
			requests.push(input);
			const output = reply(input);
			writeAnthropicReply(response, input, output);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
			response.writeHead(500, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					type: "error",
					error: { type: "api_error", message: "Local model fixture failed" },
				}),
			);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Missing local model address");
	return {
		url: `http://127.0.0.1:${address.port}`,
		requests,
		errors,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) =>
					error === undefined ? resolve() : reject(error),
				),
			);
		},
	};
}
