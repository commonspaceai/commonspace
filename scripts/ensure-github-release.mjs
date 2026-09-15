import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseReleaseVersion } from "./release-version.mjs";

export function releaseCreationRequired(status, release, tag) {
	if (status === 404) return true;
	if (status !== 200)
		throw new Error(`Cannot inspect GitHub release ${tag}: HTTP ${status}`);
	if (release?.tag_name !== tag || release.draft !== false)
		throw new Error(
			`GitHub release ${tag} is not a published release for this tag`,
		);
	return false;
}

async function main() {
	const { GH_TOKEN, GITHUB_REPOSITORY, RELEASE_TAG, SOURCE_SHA } = process.env;
	if (!GH_TOKEN || !GITHUB_REPOSITORY || !RELEASE_TAG || !SOURCE_SHA)
		throw new Error(
			"GH_TOKEN, GITHUB_REPOSITORY, RELEASE_TAG, and SOURCE_SHA are required",
		);
	if (!RELEASE_TAG.startsWith("v"))
		throw new Error("Release tag must start with v");
	const { prerelease } = parseReleaseVersion(RELEASE_TAG.slice(1));
	const response = await fetch(
		`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`,
		{
			headers: {
				Authorization: `Bearer ${GH_TOKEN}`,
				Accept: "application/vnd.github+json",
			},
			signal: globalThis.AbortSignal.timeout(30_000),
		},
	);
	const release = response.status === 200 ? await response.json() : null;
	if (!releaseCreationRequired(response.status, release, RELEASE_TAG)) {
		process.stdout.write(
			`GitHub release ${RELEASE_TAG} is already published; preserving it.\n`,
		);
		return;
	}
	const { stdout } = await promisify(execFile)("gh", [
		"release",
		"create",
		RELEASE_TAG,
		"--repo",
		GITHUB_REPOSITORY,
		"--target",
		SOURCE_SHA,
		"--verify-tag",
		`--prerelease=${String(prerelease)}`,
		"--title",
		`Commonspace ${RELEASE_TAG}`,
		"--notes-file",
		`docs/releases/${RELEASE_TAG}.md`,
	]);
	process.stdout.write(stdout);
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	void main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
