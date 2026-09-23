import { createInterface } from "node:readline";
import { z } from "zod";
import { LayaOnnx } from "./laya-onnx.js";
import type { ClassifierReply } from "./local-classifier.js";

const requestSchema = z.strictObject({
	id: z.number().int().nonnegative(),
	state: z.string().min(1).max(8_000),
	instruction: z.string().min(1).max(2_000),
	options: z
		.array(
			z.strictObject({
				id: z.string().min(1).max(128),
				description: z.string().min(1).max(2_000),
			}),
		)
		.min(2)
		.max(10),
});
const send = (value: ClassifierReply) =>
	process.stdout.write(`${JSON.stringify(value)}\n`);
async function main(): Promise<void> {
	const directory = process.argv[2];
	if (directory === undefined)
		throw new Error("Classifier model directory required");
	const model = await LayaOnnx.load(directory);
	try {
		await model.classify({
			state: "A routing warmup.",
			instruction: "Which option?",
			options: [
				{ id: "a", description: "First" },
				{ id: "b", description: "Second" },
			],
		});
		send({ type: "ready" });
		const lines = createInterface({
			input: process.stdin,
			crlfDelay: Infinity,
		});
		for await (const line of lines) {
			if (Buffer.byteLength(line) > 256 * 1024)
				throw new Error("Classifier request exceeds its limit");
			const request = requestSchema.parse(JSON.parse(line));
			const scores = await model.classify(request);
			send(
				scores === null
					? { type: "unsupported", id: request.id, reason: "token_limit" }
					: { type: "result", id: request.id, scores },
			);
		}
	} finally {
		await model.close();
	}
}
void main().catch(() => {
	// Inference exceptions can contain input data; only report a fixed diagnostic.
	process.stderr.write("Local classifier worker failed.\n");
	process.exitCode = 1;
});
