import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertSessionIsolationControl,
	runSessionIsolationScenario,
	type SessionIsolationPair,
	SessionIsolationScenario,
	summarizeSessionIsolationPairs,
} from "./session-isolation-harness.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function configuredRepetitions(): number {
	const repetitions = Number(
		process.env.COMMONSPACE_SESSION_ISOLATION_REPETITIONS ?? "5",
	);
	if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 20)
		throw new Error(
			"COMMONSPACE_SESSION_ISOLATION_REPETITIONS must be an integer from 1 to 20",
		);
	return repetitions;
}

async function sourceProvenance() {
	const files = [
		"scripts/benchmark-session-isolation.ts",
		"scripts/session-isolation-harness.ts",
		"server/src/service.ts",
		"package.json",
	];
	return {
		commit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repositoryRoot,
			encoding: "utf8",
		}).trim(),
		worktreeChanges: execFileSync(
			"git",
			["status", "--porcelain", "--untracked-files=all"],
			{ cwd: repositoryRoot, encoding: "utf8" },
		)
			.split("\n")
			.filter(Boolean),
		benchmarkFiles: await Promise.all(
			files.map(async (path) => ({
				path,
				sha256: createHash("sha256")
					.update(await readFile(join(repositoryRoot, path)))
					.digest("hex"),
			})),
		),
	};
}

async function runPair(): Promise<SessionIsolationPair> {
	const baseline = await runSessionIsolationScenario(
		SessionIsolationScenario.Baseline,
	);
	const contended = await runSessionIsolationScenario(
		SessionIsolationScenario.Contended,
	);
	assertSessionIsolationControl(contended.control);
	if (
		JSON.stringify(baseline.fixtureCounts) !==
		JSON.stringify(contended.fixtureCounts)
	)
		throw new Error("Baseline and contended fixture counts differ");
	return { baseline, contended };
}

const repetitions = configuredRepetitions();
const source = await sourceProvenance();
const startedAt = new Date().toISOString();
process.stderr.write("Warm-up: one discarded baseline/contended pair\n");
await runPair();
const pairs: SessionIsolationPair[] = [];
for (let repetition = 0; repetition < repetitions; repetition += 1) {
	process.stderr.write(
		`Sample: ${String(repetition + 1)}/${String(repetitions)} paired runs\n`,
	);
	pairs.push(await runPair());
}

process.stdout.write(
	`${JSON.stringify(
		{
			methodology: {
				source,
				startedAt,
				completedAt: new Date().toISOString(),
				node: process.version,
				platform: process.platform,
				osRelease: release(),
				arch: process.arch,
				cpu: cpus()[0]?.model ?? "unknown",
				logicalCpuCount: cpus().length,
				totalMemoryBytes: totalmem(),
				repetitions,
				fixture:
					"synthetic provider-free service with one configured Codex Agent and one Channel; each scenario starts with no Threads or messages",
				baseline:
					"one fast root request through CommonspaceHostService.send and durable reply persistence",
				contended:
					"hold a slow root run, queue its same-Thread follow-up, then require a fast root in a distinct Thread to start and persist before releasing the slow run",
				synchronization:
					"deferred worker gates and service revision subscriptions; bounded timeouts are failure guards, never timing controls",
				sessionControls:
					"distinct Thread session names, exact slow native-session resumption, serialized same-Thread follow-up, unique source/reply messages, and source-Thread reply containment",
				responsiveness:
					"fast request start through send acceptance, worker start, and durable reply visibility; contended-minus-baseline deltas are paired by repetition",
				warmup: "one discarded baseline/contended pair",
				dispersion:
					"raw paired samples plus min/median/max; no latency threshold or pass/fail performance assertion",
				limits:
					"local synthetic fixture excludes real providers, credentials, routing inference, subprocesses, network latency, and workspace data",
			},
			summary: summarizeSessionIsolationPairs(pairs),
			pairs,
		},
		null,
		2,
	)}\n`,
);
