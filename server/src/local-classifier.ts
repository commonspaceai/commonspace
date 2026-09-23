import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

export interface ClassifierRequest {
	state: string;
	instruction: string;
	options: readonly { id: string; description: string }[];
}
const scoreSchema = z.strictObject({
	id: z.string().min(1).max(128),
	score: z.number().min(0).max(1),
});
export type ClassifierScores = z.infer<typeof scoreSchema>;
export interface RunningClassifier {
	classify(
		request: ClassifierRequest,
		signal?: AbortSignal,
	): Promise<ClassifierScores[] | null>;
	close(): Promise<void>;
}
const replySchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("ready") }),
	z.strictObject({
		type: z.literal("result"),
		id: z.number().int().nonnegative(),
		scores: z.array(scoreSchema).min(2).max(10),
	}),
	z.strictObject({
		type: z.literal("unsupported"),
		id: z.number().int().nonnegative(),
		reason: z.string().max(256),
	}),
]);
export type ClassifierReply = z.infer<typeof replySchema>;

const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const manifestSchema = z.strictObject({
	repository: z.literal("inferenceprince/laya-onnx-int8"),
	revision: z.string().regex(/^[a-f0-9]{40}$/u),
	files: z.strictObject({
		"model.onnx": checksum,
		"model.onnx.data": checksum,
		"rl_agent_config.json": checksum,
		"tokenizer/tokenizer.json": checksum,
		"tokenizer/tokenizer_config.json": checksum,
	}),
});

async function prepareModel(options: {
	runtimeDirectory: string;
	assetDirectory: string;
	log: (message: string) => void;
	signal?: AbortSignal;
}): Promise<string> {
	const { runtimeDirectory, assetDirectory, log, signal } = options;
	signal?.throwIfAborted();
	const contents = await readFile(join(assetDirectory, "model.json"));
	const manifest = manifestSchema.parse(JSON.parse(contents.toString()));
	const revision = createHash("sha256").update(contents).digest("hex");
	await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
	const directory = join(runtimeDirectory, revision);
	const complete = async () => {
		if ((await readFile(join(directory, "complete"), "utf8")) !== revision)
			throw new Error("Classifier model cache is incomplete");
	};
	try {
		await complete();
		return directory;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	const staging = await mkdtemp(join(runtimeDirectory, ".download-"));
	try {
		log("Downloading the pinned Laya ONNX model (613 MB, first launch only).");
		for (const [name, expected] of Object.entries(manifest.files)) {
			const timeout = AbortSignal.timeout(600_000);
			const cancellation =
				signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
			const response = await fetch(
				`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${name}`,
				{ signal: cancellation },
			);
			if (!response.ok)
				throw new Error("Unable to download the classifier model");
			await downloadModelFile(
				response,
				join(staging, name),
				expected,
				cancellation,
			);
		}
		signal?.throwIfAborted();
		await writeFile(join(staging, "complete"), revision, { mode: 0o600 });
		try {
			await rename(staging, directory);
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					(error.code === "EEXIST" || error.code === "ENOTEMPTY")
				)
			)
				throw error;
			await complete();
		}
		return directory;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function downloadModelFile(
	response: Response,
	destination: string,
	expected: string,
	signal: AbortSignal,
): Promise<void> {
	if (!response.body) throw new Error("Classifier download has no body");
	await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
	const digest = createHash("sha256");
	await pipeline(
		response.body,
		async function* (source) {
			for await (const chunk of source) {
				digest.update(chunk);
				yield chunk;
			}
		},
		createWriteStream(destination, { mode: 0o600 }),
		{ signal },
	);
	if (digest.digest("hex") !== expected)
		throw new Error("Classifier model checksum mismatch");
}

interface PendingClassification {
	ids: readonly string[];
	resolve(scores: ClassifierScores[] | null): void;
	reject(error: Error): void;
	dispose(): void;
}

class LocalClassifier implements RunningClassifier {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly exited: Promise<void>;
	private readonly pending = new Map<number, PendingClassification>();
	private nextId = 0;
	private buffer = "";
	private failure: Error | undefined;
	private closing: Promise<void> | undefined;
	private readiness:
		| { resolve(): void; reject(error: Error): void }
		| undefined;
	private readonly readyTimer: ReturnType<typeof setTimeout>;
	readonly ready: Promise<void>;

	constructor(assetDirectory: string, modelDirectory: string) {
		this.ready = new Promise((resolve, reject) => {
			this.readiness = { resolve, reject };
		});
		this.child = spawn(
			process.execPath,
			[join(assetDirectory, "worker.js"), modelDirectory],
			{
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
				env: {
					TMPDIR: process.env.TMPDIR,
					LANG: "en_US.UTF-8",
					HF_HUB_DISABLE_TELEMETRY: "1",
					SYSTEMROOT: process.env.SYSTEMROOT,
				},
			},
		);
		this.exited = new Promise((resolve) =>
			this.child.once("close", () => resolve()),
		);
		this.readyTimer = setTimeout(
			() =>
				this.fail(
					new Error("Local classifier did not become ready within 120 seconds"),
				),
			120_000,
		);
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => this.receive(chunk));
		// Never copy worker diagnostics, which could include conversation text, into host logs.
		this.child.stderr.resume();
		this.child.stdin.on("error", () =>
			this.fail(new Error("Local classifier input closed")),
		);
		this.child.on("error", () =>
			this.fail(new Error("Unable to launch the local classifier")),
		);
		this.child.on("close", () =>
			this.fail(new Error("Local classifier stopped")),
		);
	}

	async classify(
		request: ClassifierRequest,
		signal?: AbortSignal,
	): Promise<ClassifierScores[] | null> {
		signal?.throwIfAborted();
		if (this.failure !== undefined) throw this.failure;
		const { state, instruction, options } = request;
		if (
			this.pending.size >= 1 ||
			state.length > 8_000 ||
			instruction.length > 2_000 ||
			options.length < 2 ||
			options.length > 10 ||
			new Set(options.map((option) => option.id)).size !== options.length ||
			options.some(
				(option) =>
					option.id.length === 0 ||
					option.id.length > 128 ||
					option.description.length > 2_000,
			)
		)
			return null;
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => this.fail(new Error("Local classifier request timed out")),
				750,
			);
			const onAbort = () => reject(signal?.reason);
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				ids: options.map((option) => option.id),
				resolve,
				reject,
				dispose: () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				},
			});
			// Cancellation releases the caller; the slot remains bounded until its reply arrives.
			this.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
		});
	}

	close(): Promise<void> {
		this.closing ??= this.stop();
		return this.closing;
	}

	private async stop(): Promise<void> {
		this.rejectWork(new Error("Local classifier is closed"));
		this.child.stdin.end();
		const terminate = setTimeout(() => this.child.kill("SIGTERM"), 2_000);
		const kill = setTimeout(() => this.child.kill("SIGKILL"), 4_000);
		await this.exited;
		clearTimeout(terminate);
		clearTimeout(kill);
	}

	private rejectWork(error: Error): void {
		this.failure ??= error;
		clearTimeout(this.readyTimer);
		this.readiness?.reject(error);
		this.readiness = undefined;
		for (const pending of this.pending.values()) {
			pending.dispose();
			pending.reject(error);
		}
		this.pending.clear();
	}

	private fail(error: Error): void {
		if (this.failure !== undefined) return;
		this.rejectWork(error);
		void this.close();
	}

	private receive(chunk: string): void {
		if (this.failure !== undefined) return;
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) > 64 * 1024) {
			this.fail(new Error("Local classifier response exceeded its size limit"));
			return;
		}
		let newline = this.buffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			let raw: unknown;
			try {
				raw = JSON.parse(line);
			} catch {
				this.fail(new Error("Local classifier returned invalid JSON"));
				return;
			}
			const parsed = replySchema.safeParse(raw);
			if (!parsed.success) {
				this.fail(new Error("Local classifier returned an invalid response"));
				return;
			}
			this.accept(parsed.data);
			if (this.failure !== undefined) return;
			newline = this.buffer.indexOf("\n");
		}
	}

	private accept(reply: z.infer<typeof replySchema>): void {
		if (reply.type === "ready") {
			if (this.readiness === undefined) {
				this.fail(
					new Error("Local classifier sent an unexpected readiness response"),
				);
				return;
			}
			clearTimeout(this.readyTimer);
			this.readiness.resolve();
			this.readiness = undefined;
		} else {
			const pending = this.pending.get(reply.id);
			if (
				pending === undefined ||
				this.readiness !== undefined ||
				(reply.type === "result" &&
					(reply.scores.length !== pending.ids.length ||
						reply.scores.some(
							(score, index) => score.id !== pending.ids[index],
						)))
			) {
				this.fail(
					new Error("Local classifier response did not match its request"),
				);
				return;
			}
			this.pending.delete(reply.id);
			pending.dispose();
			pending.resolve(reply.type === "unsupported" ? null : reply.scores);
		}
	}
}

export async function startLocalClassifier({
	runtimeDirectory,
	assetDirectory,
	log = () => undefined,
	signal,
}: {
	runtimeDirectory: string;
	assetDirectory: string;
	log?: (message: string) => void;
	signal?: AbortSignal;
}): Promise<RunningClassifier> {
	// The pinned onnxruntime-node package has no macOS x64 native binding.
	if (process.platform === "darwin" && process.arch === "x64")
		throw new Error("Local classifier is unavailable on Intel Macs");
	const setup: Parameters<typeof prepareModel>[0] = {
		runtimeDirectory,
		assetDirectory,
		log,
	};
	if (signal !== undefined) setup.signal = signal;
	const modelDirectory = await prepareModel(setup);
	signal?.throwIfAborted();
	const classifier = new LocalClassifier(assetDirectory, modelDirectory);
	const onAbort = () => {
		void classifier.close();
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		if (signal?.aborted) onAbort();
		await classifier.ready;
		signal?.throwIfAborted();
		log("Local Laya classifier is ready on ONNX CPU.");
		return classifier;
	} catch (error) {
		await classifier.close();
		signal?.throwIfAborted();
		throw error;
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
}

/** Setup and warm-up never hold the app's startup or a routing request. */
export function manageLocalClassifier(
	options: Omit<Parameters<typeof startLocalClassifier>[0], "signal">,
): RunningClassifier {
	const lifetime = new AbortController();
	let worker: RunningClassifier | undefined;
	const preparation = startLocalClassifier({
		...options,
		signal: lifetime.signal,
	})
		.then((ready) => {
			worker = ready;
		})
		.catch(() => {
			if (!lifetime.signal.aborted)
				options.log?.(
					"Local classifier unavailable; Commonspace will use the configured inference Agent. Check network access before the next launch.",
				);
		});
	return {
		classify: (request, signal) => {
			signal?.throwIfAborted();
			if (lifetime.signal.aborted || worker === undefined)
				return Promise.resolve(null);
			return worker.classify(request, signal);
		},
		close: async () => {
			lifetime.abort();
			await preparation;
			await worker?.close();
		},
	};
}
