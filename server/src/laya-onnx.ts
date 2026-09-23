import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PreTrainedTokenizer } from "@huggingface/transformers";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { z } from "zod";
import type {
	ClassifierRequest,
	ClassifierScores,
} from "./local-classifier.js";

const configSchema = z.object({
	max_len: z.number().int().positive(),
	head_max_len: z.number().int().positive(),
	temperature: z.array(z.number().positive()).min(1),
	temperature_by_options: z.record(z.string(), z.number().positive()),
});

/** One complete Laya graph with large matrix weights stored as INT8. */
export class LayaOnnx {
	private constructor(
		private readonly tokenizer: PreTrainedTokenizer,
		private readonly config: z.infer<typeof configSchema>,
		private readonly session: InferenceSession,
	) {}

	static async load(directory: string): Promise<LayaOnnx> {
		const tokenizer = new PreTrainedTokenizer(
			JSON.parse(
				await readFile(join(directory, "tokenizer/tokenizer.json"), "utf8"),
			),
			JSON.parse(
				await readFile(
					join(directory, "tokenizer/tokenizer_config.json"),
					"utf8",
				),
			),
		);
		const config = configSchema.parse(
			JSON.parse(
				await readFile(join(directory, "rl_agent_config.json"), "utf8"),
			),
		);
		const session = await InferenceSession.create(
			join(directory, "model.onnx"),
			{
				executionProviders: ["cpu"],
				intraOpNumThreads: 2,
				interOpNumThreads: 1,
			},
		);
		return new LayaOnnx(tokenizer, config, session);
	}

	async classify(
		request: ClassifierRequest,
	): Promise<ClassifierScores[] | null> {
		if (
			[
				request.state,
				request.instruction,
				...request.options.map((option) => option.description),
			].some((text) =>
				[...text].some(
					(character) =>
						/\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character),
				),
			)
		)
			return null;
		const encode = (text: string) =>
			this.tokenizer.encode(text.replaceAll("[MASK]", " "), {
				add_special_tokens: false,
			});
		const cls = this.tokenizer.convert_tokens_to_ids("[CLS]");
		const sep = this.tokenizer.convert_tokens_to_ids("[SEP]");
		const mask = this.tokenizer.convert_tokens_to_ids("[MASK]");
		if (![cls, sep, mask].every(Number.isInteger))
			throw new Error("Laya tokenizer is missing required special tokens");
		const head = encode(`choice question: ${request.instruction}`);
		const options = request.options.map((option, index) =>
			encode(` option_${String(index)}: ${option.description}`),
		);
		// Reject inputs instead of silently truncating a responsibility, correction, or request.
		if (
			options.some((option) => option.length > 48) ||
			head.length +
				options.reduce((sum, option) => sum + option.length + 1, 0) >
				this.config.head_max_len
		)
			return null;
		const tokens = [cls, ...head, sep];
		const markers: number[] = [];
		for (const option of options) {
			markers.push(tokens.length);
			tokens.push(mask, ...option);
		}
		tokens.push(sep, ...encode(request.state), sep);
		if (tokens.length > this.config.max_len) return null;
		const result = await this.session.run({
			input_ids: new Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [
				1,
				tokens.length,
			]),
			attention_mask: new Tensor(
				"int64",
				new BigInt64Array(tokens.length).fill(1n),
				[1, tokens.length],
			),
			marker_pos: new Tensor("int64", BigInt64Array.from(markers.map(BigInt)), [
				1,
				markers.length,
			]),
			marker_mask: new Tensor("bool", new Uint8Array(markers.length).fill(1), [
				1,
				markers.length,
			]),
			qtype: new Tensor("int64", BigInt64Array.of(0n), [1]),
		});
		const logits = result.logits;
		if (
			!logits ||
			!(logits.data instanceof Float32Array) ||
			logits.data.length !== options.length
		)
			throw new Error("Laya returned invalid logits");
		const bucket =
			options.length <= 2 ? "2" : options.length <= 5 ? "3-5" : "6-10";
		const temperature =
			this.config.temperature_by_options[`choice:${bucket}`] ??
			this.config.temperature[0];
		if (temperature === undefined)
			throw new Error("Laya temperature is missing");
		const scaled = [...logits.data].map(
			(value) => value / Math.max(0.5, Math.min(5, temperature)),
		);
		const max = Math.max(...scaled);
		const exp = scaled.map((value) => Math.exp(value - max));
		const sum = exp.reduce((a, b) => a + b, 0);
		return request.options.map((option, index) => ({
			id: option.id,
			score: (exp[index] ?? 0) / sum,
		}));
	}

	async close(): Promise<void> {
		await this.session.release();
	}
}
