import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type ClassifierRequest,
	manageLocalClassifier,
	type RunningClassifier,
	startLocalClassifier,
} from "../server/src/local-classifier.ts";

const request: ClassifierRequest = {
	state: "synthetic request",
	instruction: "Choose its owner.",
	options: [
		{ id: "frontend", description: "Interface work" },
		{ id: "backend", description: "Server work" },
	],
};

describe("managed ONNX classifier", () => {
	let root: string,
		assetDirectory: string,
		runtimeDirectory: string,
		modelDirectory: string;
	const running: RunningClassifier[] = [];
	const fetchModel = vi.fn<typeof fetch>(
		async () => new Response("synthetic model"),
	);
	beforeAll(async () => {
		vi.stubGlobal("fetch", fetchModel);
		vi.stubEnv("COMMONSPACE_TEST_SECRET", "synthetic credential");
		root = await mkdtemp(join(tmpdir(), "commonspace classifier lifecycle "));
		assetDirectory = join(root, "assets");
		runtimeDirectory = join(root, "cache");
		await mkdir(assetDirectory);
		await writeFile(
			join(assetDirectory, "worker.js"),
			await readFile(
				new URL("./fixtures/local-classifier-worker.mjs", import.meta.url),
			),
		);
		const checksum = createHash("sha256")
			.update("synthetic model")
			.digest("hex");
		const manifest = JSON.stringify({
			repository: "inferenceprince/laya-onnx-int8",
			revision: "a".repeat(40),
			files: Object.fromEntries(
				[
					"model.onnx",
					"model.onnx.data",
					"rl_agent_config.json",
					"tokenizer/tokenizer.json",
					"tokenizer/tokenizer_config.json",
				].map((name) => [name, checksum]),
			),
		});
		await writeFile(join(assetDirectory, "model.json"), manifest);
		modelDirectory = join(
			runtimeDirectory,
			createHash("sha256").update(manifest).digest("hex"),
		);
	});
	afterAll(async () => {
		for (const classifier of running) await classifier.close();
		await rm(root, { recursive: true, force: true });
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
	async function start() {
		const classifier = await startLocalClassifier({
			runtimeDirectory,
			assetDirectory,
		});
		running.push(classifier);
		return classifier;
	}
	it("verifies and atomically publishes downloads, reuses them, and stops the owned process on EOF", async () => {
		const first = await start();
		const pid = Number(await readFile(join(modelDirectory, "pid"), "utf8"));
		expect(fetchModel).toHaveBeenCalledTimes(5);
		expect(
			(await readdir(runtimeDirectory)).some((name) =>
				name.startsWith(".download"),
			),
		).toBe(false);
		await first.close();
		expect(() => process.kill(pid, 0)).toThrow();
		expect(await readFile(join(modelDirectory, "stopped"), "utf8")).toBe(
			"clean EOF shutdown",
		);
		const next = await start();
		expect(fetchModel).toHaveBeenCalledTimes(5);
		await next.close();
	});
	it("rejects substituted options and terminalizes that worker", async () => {
		const classifier = await start();
		await expect(
			classifier.classify({ ...request, state: "wrong-option" }),
		).rejects.toThrow("did not match its request");
		await expect(classifier.classify(request)).rejects.toThrow(
			"did not match its request",
		);
		await classifier.close();
	});
	it("reserves a cancelled request until its late reply and handles unsupported input", async () => {
		const classifier = await start(),
			controller = new AbortController();
		const rejected = expect(
			classifier.classify({ ...request, state: "late" }, controller.signal),
		).rejects.toThrow("cancelled by caller");
		controller.abort(new Error("cancelled by caller"));
		await rejected;
		expect(await classifier.classify(request)).toBeNull();
		await vi.waitFor(async () =>
			expect(await classifier.classify(request)).toEqual([
				{ id: "frontend", score: 0.5 },
				{ id: "backend", score: 0.5 },
			]),
		);
		expect(
			await classifier.classify({ ...request, state: "unsupported" }),
		).toBeNull();
		await classifier.close();
	});
	it("bounds busy work and enforces a short routing deadline", async () => {
		const classifier = await start();
		const before = performance.now();
		const waiting = expect(
			classifier.classify({ ...request, state: "wait" }),
		).rejects.toThrow("timed out");
		expect(await classifier.classify(request)).toBeNull();
		await waiting;
		expect(performance.now() - before).toBeLessThan(1500);
		await classifier.close();
	});
	it("settles pending work when the app closes", async () => {
		const classifier = await start();
		const waiting = expect(
			classifier.classify({ ...request, state: "wait" }),
		).rejects.toThrow("closed");
		await classifier.close();
		await waiting;
	});
	it("does not retain an incomplete or checksum-mismatched model", async () => {
		fetchModel.mockResolvedValueOnce(new Response("damaged download"));
		const failedCache = join(root, "failed-cache");
		await expect(
			startLocalClassifier({ runtimeDirectory: failedCache, assetDirectory }),
		).rejects.toThrow("checksum mismatch");
		expect(await readdir(failedCache)).toEqual([]);
	});
	it("skips model download where the pinned native runtime has no binding", async () => {
		const platform = Object.getOwnPropertyDescriptor(process, "platform");
		const arch = Object.getOwnPropertyDescriptor(process, "arch");
		if (platform === undefined || arch === undefined)
			throw new Error("Missing process platform descriptors");
		Object.defineProperty(process, "platform", { value: "darwin" });
		Object.defineProperty(process, "arch", { value: "x64" });
		try {
			fetchModel.mockClear();
			await expect(
				startLocalClassifier({
					runtimeDirectory: join(root, "intel"),
					assetDirectory,
				}),
			).rejects.toThrow("unavailable on Intel Macs");
			expect(fetchModel).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(process, "platform", platform);
			Object.defineProperty(process, "arch", arch);
		}
	});
	it("stops a worker cancelled while warming", async () => {
		await rm(join(modelDirectory, "pid"));
		await writeFile(join(modelDirectory, "slow-ready"), "");
		const controller = new AbortController();
		const starting = startLocalClassifier({
			runtimeDirectory,
			assetDirectory,
			signal: controller.signal,
		});
		const rejected = expect(starting).rejects.toThrow("startup cancelled");
		let pid = 0;
		try {
			await vi.waitFor(async () => {
				pid = Number(await readFile(join(modelDirectory, "pid"), "utf8"));
				expect(pid).toBeGreaterThan(0);
			});
			controller.abort(new Error("startup cancelled"));
			await rejected;
			expect(() => process.kill(pid, 0)).toThrow();
		} finally {
			controller.abort(new Error("startup cancelled"));
			await rejected;
			await rm(join(modelDirectory, "slow-ready"));
		}
	});
	it("keeps startup and routing available when preparation fails", async () => {
		const log = vi.fn();
		fetchModel.mockRejectedValueOnce(new Error("Network unavailable"));
		const classifier = manageLocalClassifier({
			runtimeDirectory: join(root, "offline"),
			assetDirectory,
			log,
		});
		running.push(classifier);
		expect(await classifier.classify(request)).toBeNull();
		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("Local classifier unavailable"),
			),
		);
		expect(await classifier.classify(request)).toBeNull();
		await classifier.close();
	});
	it("automatically begins classifying after background startup", async () => {
		const classifier = manageLocalClassifier({
			runtimeDirectory,
			assetDirectory,
		});
		running.push(classifier);
		expect(await classifier.classify(request)).toBeNull();
		await vi.waitFor(async () =>
			expect(await classifier.classify(request)).not.toBeNull(),
		);
		await classifier.close();
	});
});
