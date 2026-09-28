import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parseReleaseVersion } from "./release-version.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const platforms = ["linux", "macos", "windows"];

export function prepareNightly({ version, sha, date, runNumber, attempt }) {
	parseReleaseVersion(version);
	if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error("Invalid source commit");
	if (!/^[1-9]\d*$/u.test(runNumber) || !/^[1-9]\d*$/u.test(attempt))
		throw new Error("Invalid workflow run identity");
	const day = date.toISOString().slice(0, 10);
	const shortSha = sha.slice(0, 7);
	return {
		sha,
		tag: `nightly-${day}-${shortSha}-${runNumber}-${attempt}`,
		version: `${version.split(/[-+]/u)[0]}-nightly.${day.replaceAll("-", "")}.g${shortSha}.${runNumber}.${attempt}`,
	};
}

export function classifyNightly(release, checks) {
	if (
		!/^nightly-\d{4}-\d{2}-\d{2}-[a-f0-9]{7}-[1-9]\d*-[1-9]\d*$/u.test(
			release.tag,
		) ||
		!/^\d+\.\d+\.\d+-nightly\.\d{8}\.g[a-f0-9]{7}\.[1-9]\d*\.[1-9]\d*$/u.test(
			release.version,
		) ||
		!/^[a-f0-9]{40}$/u.test(release.sha)
	)
		throw new Error("Invalid nightly metadata");
	if (
		Object.keys(checks).sort().join(",") !==
			platforms.slice().sort().join(",") ||
		Object.values(checks).some(
			(result) => !["success", "failure"].includes(result),
		)
	)
		throw new Error("Every nightly platform must report its checks");
	const status = Object.values(checks).every((result) => result === "success")
		? "nightly-green"
		: "nightly-broken";
	return {
		...release,
		checks,
		status,
		tag:
			status === "nightly-broken"
				? release.tag.replace(/^nightly-/u, "nightly-broken-")
				: release.tag,
	};
}

export function isLaterNightly(currentTag, previousTag) {
	const sequence = (tag) => {
		const match =
			/^nightly-\d{4}-\d{2}-\d{2}-[a-f0-9]{7}-([1-9]\d*)-([1-9]\d*)$/u.exec(
				tag,
			);
		if (!match) throw new Error("Invalid recommended nightly tag");
		return [BigInt(match[1]), BigInt(match[2])];
	};
	const [currentRun, currentAttempt] = sequence(currentTag);
	const [previousRun, previousAttempt] = sequence(previousTag);
	return (
		currentRun > previousRun ||
		(currentRun === previousRun && currentAttempt > previousAttempt)
	);
}

export function parseRecommendedNightly(notes) {
	const match =
		/^Recommended build: `(nightly-\d{4}-\d{2}-\d{2}-[a-f0-9]{7}-[1-9]\d*-[1-9]\d*)` at `([a-f0-9]{40})`\.$/mu.exec(
			notes,
		);
	if (!match) throw new Error("Invalid recommended nightly notes");
	return { tag: match[1], sha: match[2] };
}

export function nightlyNotes(release, repository, filename, checksum) {
	const download = `https://github.com/${repository}/releases/download/${release.tag}/${filename}`;
	return [
		`# Commonspace ${release.version}`,
		"",
		`**${release.status}** from [${release.sha.slice(0, 7)}](https://github.com/${repository}/commit/${release.sha}).`,
		"",
		...(release.status === "nightly-broken"
			? [
					"> [!WARNING]",
					"> Required checks failed. This package is for debugging and is not the recommended nightly.",
					"",
				]
			: []),
		"Back up your Commonspace data before trying a nightly.",
		"",
		`- Linux checks: ${release.checks.linux}`,
		`- macOS checks: ${release.checks.macos}`,
		`- Windows checks: ${release.checks.windows}`,
		`- [Build and test logs](${release.runUrl})`,
		"",
		"The same npm tarball passed clean-install and runtime smoke checks on Linux and Windows.",
		"Run it with Node.js 22 or newer:",
		"",
		"```bash",
		`npm exec --yes --package="${download}" -- commonspace`,
		"```",
		"",
		`[Download the tarball](${download}) · SHA-256: \`${checksum}\``,
		"",
	].join("\n");
}

async function main() {
	if (process.argv[2] === "is-later") {
		process.stdout.write(
			`${String(isLaterNightly(process.argv[3], process.argv[4]))}\n`,
		);
		return;
	}
	if (process.argv[2] === "read-pointer") {
		const pointer = parseRecommendedNightly(
			await readFile(process.argv[3], "utf8"),
		);
		process.stdout.write(`${pointer.tag} ${pointer.sha}\n`);
		return;
	}
	const output = process.env.GITHUB_OUTPUT;
	if (!output) throw new Error("GITHUB_OUTPUT is required");
	await mkdir("artifacts/nightly", { recursive: true });
	if (process.argv[2] === "prepare") {
		const version = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		).version;
		const release = prepareNightly({
			version,
			sha: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: repoRoot,
				encoding: "utf8",
			}).trim(),
			date: new Date(),
			runNumber: process.env.GITHUB_RUN_NUMBER,
			attempt: process.env.GITHUB_RUN_ATTEMPT,
		});
		release.runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
		writeFileSync(
			"artifacts/nightly/release.json",
			`${JSON.stringify(release, null, 2)}\n`,
		);
		await appendFile(output, `version=${release.version}\n`);
		return;
	}
	if (process.argv[2] !== "classify")
		throw new Error(
			"Usage: node scripts/nightly-release.mjs prepare|classify|is-later|read-pointer",
		);
	const release = classifyNightly(
		JSON.parse(await readFile("artifacts/nightly/release.json", "utf8")),
		{
			linux: process.env.LINUX_CHECKS,
			macos: process.env.MACOS_CHECKS,
			windows: process.env.WINDOWS_CHECKS,
		},
	);
	const name = JSON.parse(
		await readFile(new URL("../cli/package.json", import.meta.url), "utf8"),
	).name;
	const filename = `${name}-${release.version}.tgz`;
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(
		resolve("artifacts/npm", filename),
	))
		hash.update(chunk);
	const checksum = hash.digest("hex");
	await Promise.all([
		writeFile(
			"artifacts/nightly/release.json",
			`${JSON.stringify(release, null, 2)}\n`,
		),
		writeFile("artifacts/nightly/SHA256SUMS.txt", `${checksum}  ${filename}\n`),
		writeFile(
			"artifacts/nightly/notes.md",
			nightlyNotes(release, process.env.GITHUB_REPOSITORY, filename, checksum),
		),
	]);
	if (release.status === "nightly-green") {
		const pointer = {
			tag: release.tag,
			sha: release.sha,
			version: release.version,
			url: `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${release.tag}`,
		};
		await writeFile(
			"artifacts/nightly/recommended-notes.md",
			`# Latest recommended nightly\n\nRecommended build: \`${pointer.tag}\` at \`${pointer.sha}\`.\n\n[Download ${pointer.version}](${pointer.url}). Linux, macOS, and Windows checks passed.\n`,
		);
	}
	await appendFile(output, `tag=${release.tag}\nstatus=${release.status}\n`);
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
