import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommonspaceCli } from "../../server/src/index.js";
import {
	manageLocalClassifier,
	type RunningClassifier,
} from "../../server/src/local-classifier.js";
import { COMMONSPACE_VERSION } from "../../server/src/version.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const noClassifier = args.includes("--no-classifier");
	const [command = "start", ...rest] = args.filter(
		(arg) => arg !== "--no-classifier",
	);
	const usage =
		"Usage: commonspace [start] [--no-classifier] | --version | --help";
	if (
		rest.length > 0 ||
		!["start", "--version", "--help"].includes(command) ||
		args.filter((arg) => arg === "--no-classifier").length > 1
	)
		throw new Error(usage);
	if (command === "--version") {
		process.stdout.write(`${COMMONSPACE_VERSION}\n`);
		return;
	}
	if (command === "--help") {
		process.stdout.write(
			`${usage}\nStarts Commonspace at http://127.0.0.1:3100.\nA local Laya ONNX classifier sidecar prepares in the background; the first launch downloads its model.\nUse --no-classifier for harness-only routing.\nSet COMMONSPACE_PORT or COMMONSPACE_HOME to override runtime defaults.\n`,
		);
		return;
	}
	process.env.NODE_ENV = "production";
	process.env.COMMONSPACE_UI_ROOT ??= fileURLToPath(
		new URL("../ui-dist", import.meta.url),
	);
	const startup = new AbortController();
	const cancelStartup = () => startup.abort();
	process.once("SIGINT", cancelStartup);
	process.once("SIGTERM", cancelStartup);
	process.once("disconnect", cancelStartup);
	let classifier: RunningClassifier | undefined;
	try {
		if (!noClassifier) {
			classifier = manageLocalClassifier({
				assetDirectory: fileURLToPath(new URL("./classifier", import.meta.url)),
				runtimeDirectory: join(
					process.env.COMMONSPACE_HOME ?? join(homedir(), ".commonspace"),
					"classifier",
				),
				log: (message) => process.stderr.write(`${message}\n`),
			});
		}
		const options: { signal: AbortSignal; classifier?: RunningClassifier } = {
			signal: startup.signal,
		};
		if (classifier !== undefined) options.classifier = classifier;
		await runCommonspaceCli(options);
	} catch (error) {
		await classifier?.close();
		if (startup.signal.aborted) return;
		throw error;
	} finally {
		process.off("SIGINT", cancelStartup);
		process.off("SIGTERM", cancelStartup);
		process.off("disconnect", cancelStartup);
	}
}

void main().catch((error: Error) => {
	process.stderr.write(`${error.message}\n`);
	process.exitCode = 1;
});
