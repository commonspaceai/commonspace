import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { npmCommand } from "./tool-command.mjs";

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
	const npm = npmCommand([
		"view",
		`${name}@${version}`,
		"--json",
		"--registry=https://registry.npmjs.org",
	]);
	const { stdout } = await promisify(execFile)(npm.command, npm.args, {
		maxBuffer: 1024 * 1024,
	});
	verifyPublishedPackage(JSON.parse(stdout), { name, version, integrity });
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
