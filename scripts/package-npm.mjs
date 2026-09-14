import { execFile } from "node:child_process";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parseReleaseVersion } from "./release-version.mjs";
import { npmCommand } from "./tool-command.mjs";

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function requiredString(value, field) {
	if (typeof value !== "string" || value === "")
		throw new Error(`${field} must be a non-empty string`);
	return value;
}

function requiredRecord(value, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${field} must be an object`);
	return value;
}

function requiredStringArray(value, field) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((item) => typeof item !== "string" || item === "")
	)
		throw new Error(`${field} must be a non-empty string array`);
	return value;
}

export function createNpmPackageManifest(cliManifest, serverManifest) {
	const name = requiredString(cliManifest.name, "cli/package.json name");
	const version = requiredString(
		cliManifest.version,
		"cli/package.json version",
	);
	parseReleaseVersion(version);
	if (serverManifest.version !== version)
		throw new Error(`server/package.json version must be ${version}`);
	const dependencies = {};
	for (const [dependency, specifier] of Object.entries(
		requiredRecord(
			serverManifest.dependencies,
			"server/package.json dependencies",
		),
	).sort(([left], [right]) => left.localeCompare(right))) {
		if (dependency === "@commonspace/shared") continue;
		if (typeof specifier !== "string" || specifier.startsWith("workspace:"))
			throw new Error(`cannot publish workspace dependency ${dependency}`);
		dependencies[dependency] = specifier;
	}
	const cliDependencies = requiredRecord(
		cliManifest.dependencies,
		"cli/package.json dependencies",
	);
	for (const [dependency, specifier] of Object.entries(dependencies)) {
		if (cliDependencies[dependency] !== specifier)
			throw new Error(
				`cli/package.json dependency ${dependency} must match server/package.json`,
			);
	}
	for (const dependency of Object.keys(cliDependencies)) {
		if (!(dependency in dependencies))
			throw new Error(
				`cli/package.json dependency ${dependency} is not a server runtime dependency`,
			);
	}
	return {
		name,
		version,
		description: requiredString(
			cliManifest.description,
			"cli/package.json description",
		),
		type: "module",
		bin: requiredRecord(cliManifest.bin, "cli/package.json bin"),
		files: ["dist", "ui-dist"],
		license: requiredString(cliManifest.license, "cli/package.json license"),
		keywords: requiredStringArray(
			cliManifest.keywords,
			"cli/package.json keywords",
		),
		repository: requiredRecord(
			cliManifest.repository,
			"cli/package.json repository",
		),
		homepage: requiredString(cliManifest.homepage, "cli/package.json homepage"),
		bugs: requiredRecord(cliManifest.bugs, "cli/package.json bugs"),
		engines: requiredRecord(cliManifest.engines, "cli/package.json engines"),
		dependencies,
		publishConfig: { access: "public" },
	};
}

export async function stageNpmPackage(source, target, manifest) {
	await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
	await Promise.all([
		cp(join(source, "cli/dist"), join(target, "dist"), { recursive: true }),
		cp(join(source, "ui/dist"), join(target, "ui-dist"), { recursive: true }),
		cp(join(source, "README.md"), join(target, "README.md")),
		cp(join(source, "LICENSE"), join(target, "LICENSE")),
	]);
	await chmod(join(target, "dist/index.js"), 0o755);
	await writeFile(
		join(target, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function releaseManifests() {
	const [root, shared, server, ui, cli] = await Promise.all(
		[
			"package.json",
			"packages/shared/package.json",
			"server/package.json",
			"ui/package.json",
			"cli/package.json",
		].map((path) => readJson(join(repoRoot, path))),
	);
	for (const [path, manifest] of [
		["packages/shared/package.json", shared],
		["server/package.json", server],
		["ui/package.json", ui],
		["cli/package.json", cli],
	]) {
		if (manifest.version !== root.version)
			throw new Error(`${path} version must be ${String(root.version)}`);
	}
	return { root, server, cli };
}

async function main() {
	const { values } = parseArgs({
		options: {
			output: { type: "string" },
			"check-tag": { type: "string" },
		},
	});
	const { root, server, cli } = await releaseManifests();
	const { prerelease } = parseReleaseVersion(root.version);
	if (values["check-tag"] !== undefined) {
		if (values["check-tag"] !== `v${String(root.version)}`)
			throw new Error(`Release tag must be v${String(root.version)}`);
		process.stdout.write(`prerelease=${String(prerelease)}\n`);
		return;
	}
	const manifest = createNpmPackageManifest(cli, server);
	const output = resolve(values.output ?? join(repoRoot, "artifacts/npm"));
	await mkdir(output, { recursive: true });
	const temporary = await mkdtemp(join(tmpdir(), "commonspace-npm-package-"));
	try {
		const staging = join(temporary, "package");
		await stageNpmPackage(repoRoot, staging, manifest);
		const npm = npmCommand([
			"pack",
			staging,
			"--pack-destination",
			output,
			"--json",
		]);
		const { stdout } = await run(npm.command, npm.args, {
			cwd: repoRoot,
			maxBuffer: 8 * 1024 * 1024,
		});
		const [packed] = JSON.parse(stdout);
		if (typeof packed?.filename !== "string")
			throw new Error("npm pack did not report an output file");
		process.stdout.write(`${join(output, basename(packed.filename))}\n`);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
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
