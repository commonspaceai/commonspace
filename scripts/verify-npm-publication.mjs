import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

export function publicationRetryDelay(status, remainingMs) {
	if (status === 200) return null;
	if (status === 404 && remainingMs > 0) return Math.min(10_000, remainingMs);
	if (status === 404)
		throw new Error(
			"npm publication did not become visible within five minutes",
		);
	throw new Error(`npm registry returned HTTP ${status}`);
}

export function verifyPublishedPackage(metadata, expected) {
	if (metadata?.name !== expected.name || metadata.version !== expected.version)
		throw new Error(`npm did not return ${expected.name}@${expected.version}`);
	if (metadata.dist?.integrity !== expected.integrity)
		throw new Error(
			`npm ${expected.name}@${expected.version} differs from the tested tarball`,
		);
}

async function main() {
	const { name, version } = JSON.parse(
		await readFile(new URL("../cli/package.json", import.meta.url), "utf8"),
	);
	const archive = new URL(
		`../artifacts/npm/${name}-${version}.tgz`,
		import.meta.url,
	);
	const integrity = `sha512-${createHash("sha512")
		.update(await readFile(archive))
		.digest("base64")}`;
	const deadline = Date.now() + 300_000;
	for (;;) {
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0)
			throw new Error(
				"npm publication did not become visible within five minutes",
			);
		const response = await fetch(
			`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
			{
				cache: "no-store",
				signal: globalThis.AbortSignal.timeout(Math.min(30_000, remainingMs)),
			},
		);
		const delay = publicationRetryDelay(response.status, deadline - Date.now());
		if (delay === null) {
			verifyPublishedPackage(await response.json(), {
				name,
				version,
				integrity,
			});
			break;
		}
		await response.body?.cancel();
		process.stdout.write(
			`Waiting for npm to make ${name}@${version} available.\n`,
		);
		await setTimeout(delay);
	}
	process.stdout.write(
		`Verified npm ${name}@${version} matches the tested tarball (${integrity}).\n`,
	);
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
