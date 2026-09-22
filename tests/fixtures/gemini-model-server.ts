import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { z } from "zod";
import type { ModelReply, ModelRequest } from "./anthropic-model-server.ts";

const requestSchema = z.object({
	contents: z.array(z.json()),
	tools: z
		.array(
			z.object({
				functionDeclarations: z
					.array(z.looseObject({ name: z.string() }))
					.optional(),
			}),
		)
		.optional(),
});

async function readGeminiBody(request: IncomingMessage, url: URL) {
	if (
		request.headers["x-goog-api-key"] !== "commonspace-local-model-test" &&
		url.searchParams.get("key") !== "commonspace-local-model-test"
	)
		throw new Error("Only the synthetic Gemini credential is accepted");
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString();
}

function writeGeminiReply(
	response: ServerResponse,
	model: string,
	output: ModelReply,
	stream: boolean,
) {
	const part =
		output.type === "text"
			? { text: output.text }
			: { functionCall: { name: output.name, args: output.input } };
	const result = {
		candidates: [
			{
				content: { role: "model", parts: [part] },
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 100,
			candidatesTokenCount: 10,
			totalTokenCount: 110,
		},
		modelVersion: model,
	};
	if (stream) {
		response.setHeader("content-type", "text/event-stream");
		response.end(`data: ${JSON.stringify(result)}\n\n`);
	} else {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify(result));
	}
}

/** The real Gemini CLI handles ACP and tools; only Google's model API is replaced. */
export async function startGeminiModelServer(
	reply: (request: ModelRequest) => ModelReply,
) {
	const requests: ModelRequest[] = [];
	const errors: string[] = [];
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			const body = await readGeminiBody(request, url);
			if (url.pathname.endsWith(":countTokens")) {
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ totalTokens: 100 }));
				return;
			}
			const route =
				/\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(
					url.pathname,
				);
			if (request.method !== "POST" || route?.[1] === undefined)
				throw new Error(
					`Unexpected Gemini API request: ${request.method} ${url.pathname}`,
				);
			const input = requestSchema.parse(JSON.parse(body));
			const normalized: ModelRequest = {
				model: decodeURIComponent(route[1]),
				messages: input.contents,
				tools:
					input.tools?.flatMap((group) => group.functionDeclarations ?? []) ??
					[],
			};
			requests.push(normalized);
			const output = reply(normalized);
			writeGeminiReply(
				response,
				normalized.model,
				output,
				route[2] === "streamGenerateContent",
			);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
			response.writeHead(500, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					error: { code: 500, message: "Local Gemini fixture failed" },
				}),
			);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Missing local Gemini address");
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
