import { homedir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { HistoryEmbedder } from "./semantic-history.js";

export const HISTORY_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const HISTORY_EMBEDDING_REVISION =
	"751bff37182d3f1213fa05d7196b954e230abad9";
const replySchema = z.discriminatedUnion("status", [
	z.object({
		id: z.number().int(),
		status: z.literal("ok"),
		vectors: z.array(z.array(z.number())),
	}),
	z.object({ id: z.number().int(), status: z.literal("error") }),
]);

// Inference and tokenization run outside the server event loop. Only public model
// artifacts are downloaded; the worker never makes an inference HTTP request.
const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
let pipeline;
let tail = Promise.resolve();
parentPort.on("message", ({ id, texts }) => {
  tail = tail.then(async () => {
    try {
      if (!pipeline) {
        const { pipeline: createPipeline, env } = await import(workerData.moduleUrl);
        env.allowLocalModels = false;
        pipeline = await createPipeline("feature-extraction", workerData.model, {
          revision: workerData.revision, dtype: "q8", device: "cpu",
          cache_dir: workerData.cacheDirectory,
          session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
        });
      }
      const output = await pipeline(texts, { pooling: "mean", normalize: true });
      parentPort.postMessage({ id, status: "ok", vectors: output.tolist() });
    } catch {
      parentPort.postMessage({ id, status: "error" });
    }
  });
});
`;

interface PendingEmbedding {
	resolve(vectors: number[][]): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export class LocalHistoryEmbeddings implements HistoryEmbedder {
	private worker: Worker | undefined;
	private readonly pending = new Map<number, PendingEmbedding>();
	private nextId = 0;
	private closed = false;
	private retryAfter = 0;
	constructor(
		private readonly cacheDirectory = join(
			homedir(),
			".cache",
			"commonspace",
			"embeddings",
		),
	) {}

	embed(texts: readonly string[]): Promise<number[][]> {
		if (this.closed || Date.now() < this.retryAfter)
			return Promise.reject(new Error("Local history embeddings unavailable"));
		if (
			!texts.length ||
			texts.length > 8 ||
			texts.some((text) => text.length > 900) ||
			this.pending.size >= 32
		)
			return Promise.reject(
				new Error("Local history embedding work exceeds its bounded queue"),
			);
		const worker = this.worker ?? this.start();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => this.fail(worker), 120_000);
			this.pending.set(id, { resolve, reject, timer });
			worker.postMessage({ id, texts });
		});
	}

	async close(): Promise<void> {
		this.closed = true;
		const worker = this.worker;
		if (worker) await this.fail(worker);
	}

	private start(): Worker {
		const worker = new Worker(workerSource, {
			eval: true,
			// The worker is plain CommonJS; parent TS loaders or --input-type flags
			// must not change how its bootstrap is interpreted.
			execArgv: [],
			workerData: {
				moduleUrl: import.meta.resolve("@huggingface/transformers"),
				model: HISTORY_EMBEDDING_MODEL,
				revision: HISTORY_EMBEDDING_REVISION,
				cacheDirectory: this.cacheDirectory,
			},
		});
		this.worker = worker;
		worker.on("message", (data) => {
			const parsed = replySchema.safeParse(data);
			if (!parsed.success || parsed.data.status === "error") {
				void this.fail(worker);
				return;
			}
			const reply = parsed.data;
			const pending = this.pending.get(reply.id);
			if (!pending) return;
			this.pending.delete(reply.id);
			clearTimeout(pending.timer);
			pending.resolve(reply.vectors);
		});
		worker.on("error", () => {
			void this.fail(worker);
		});
		worker.on("exit", () => {
			void this.fail(worker);
		});
		return worker;
	}

	private async fail(worker: Worker): Promise<void> {
		if (this.worker !== worker) return;
		this.worker = undefined;
		this.retryAfter = Date.now() + 60_000;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(
				new Error(
					"Local history embeddings unavailable; lexical search remains available.",
				),
			);
		}
		this.pending.clear();
		await worker.terminate();
	}
}
