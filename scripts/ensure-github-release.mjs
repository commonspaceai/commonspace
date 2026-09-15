import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseReleaseVersion } from "./release-version.mjs";

export function releaseCreationRequired(status, release, tag) {
	if (status !== 200)
		throw new Error(`Cannot inspect GitHub release ${tag}: HTTP ${status}`);
	if (release === null) return true;
	if (release?.tagName !== tag || release.isDraft !== false)
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
	const [owner, name] = GITHUB_REPOSITORY.split("/");
	const response = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${GH_TOKEN}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query:
				"query($owner: String!, $name: String!, $tag: String!) { repository(owner: $owner, name: $name) { release(tagName: $tag) { tagName isDraft } } }",
			variables: { owner, name, tag: RELEASE_TAG },
		}),
		signal: globalThis.AbortSignal.timeout(30_000),
	});
	if (response.status !== 200)
		throw new Error(
			`Cannot inspect GitHub release ${RELEASE_TAG}: HTTP ${response.status}`,
		);
	const result = await response.json();
	if (result.errors || !result.data?.repository)
		throw new Error(`Cannot inspect GitHub releases for ${GITHUB_REPOSITORY}`);
	const release = result.data.repository.release;
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
