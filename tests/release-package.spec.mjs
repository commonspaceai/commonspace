import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createNpmPackageManifest,
	stageNpmPackage,
} from "../scripts/package-npm.mjs";
import { parseReleaseVersion } from "../scripts/release-version.mjs";

const roots = [];
const npmKeywords = [
	"agent-client-protocol",
	"ai-agents",
	"coding-agents",
	"collaboration",
	"developer-tools",
	"local-first",
	"mcp",
	"nodejs",
	"react",
	"typescript",
];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

function cliManifest(version = "0.0.1") {
	return {
		name: "commonspace",
		version,
		description: "Local-first agent workspace",
		type: "module",
		bin: { commonspace: "dist/index.js" },
		license: "MIT",
		keywords: npmKeywords,
		repository: {
			type: "git",
			url: "git+ssh://git@github.com/commonspaceai/commonspace.git",
			directory: "cli",
		},
		homepage: "https://github.com/commonspaceai/commonspace#readme",
		bugs: { url: "https://github.com/commonspaceai/commonspace/issues" },
		engines: { node: ">=22" },
		dependencies: {
			"@agentclientprotocol/codex-acp": "1.6.2",
			express: "^5.1.0",
		},
		private: true,
		scripts: { build: "private build command" },
		devDependencies: { esbuild: "0.28.2" },
	};
}

function serverManifest(version = "0.0.1") {
	return {
		version,
		dependencies: {
			"@commonspace/shared": "workspace:*",
			"@agentclientprotocol/codex-acp": "1.6.2",
			express: "^5.1.0",
		},
	};
}

describe("release version", () => {
	it("accepts SemVer releases and rejects unsafe package versions", () => {
		expect(parseReleaseVersion("0.0.1")).toEqual({
			version: "0.0.1",
			prerelease: false,
		});
		expect(parseReleaseVersion("0.2.0-beta.1+build.7")).toEqual({
			version: "0.2.0-beta.1+build.7",
			prerelease: true,
		});
		for (const version of [
			"../private",
			"v0.0.1",
			"01.2.3",
			"0.1",
			"0.0.1/extra",
			"0.0.1-rc.01",
			"0.0.1+build..1",
			"0.0.1\n",
		])
			expect(() => parseReleaseVersion(version)).toThrow("version");
	});
});

describe("npm release package", () => {
	it("publishes one CLI package with external runtime dependencies", () => {
		expect(createNpmPackageManifest(cliManifest(), serverManifest())).toEqual({
			name: "commonspace",
			version: "0.0.1",
			description: "Local-first agent workspace",
			type: "module",
			bin: { commonspace: "dist/index.js" },
			files: ["dist", "ui-dist"],
			license: "MIT",
			keywords: npmKeywords,
			repository: {
				type: "git",
				url: "git+ssh://git@github.com/commonspaceai/commonspace.git",
				directory: "cli",
			},
			homepage: "https://github.com/commonspaceai/commonspace#readme",
			bugs: { url: "https://github.com/commonspaceai/commonspace/issues" },
			engines: { node: ">=22" },
			dependencies: {
				"@agentclientprotocol/codex-acp": "1.6.2",
				express: "^5.1.0",
			},
			publishConfig: { access: "public" },
		});
	});

	it("rejects version drift and unresolved workspace dependencies", () => {
		expect(() =>
			createNpmPackageManifest(cliManifest(), serverManifest("0.0.2")),
		).toThrow("server/package.json version must be 0.0.1");
		expect(() =>
			createNpmPackageManifest(cliManifest(), {
				...serverManifest(),
				dependencies: {
					...serverManifest().dependencies,
					"@other/workspace": "workspace:*",
				},
			}),
		).toThrow("cannot publish workspace dependency @other/workspace");
		expect(() =>
			createNpmPackageManifest(
				{
					...cliManifest(),
					dependencies: {
						...cliManifest().dependencies,
						express: "4.0.0",
					},
				},
				serverManifest(),
			),
		).toThrow(
			"cli/package.json dependency express must match server/package.json",
		);
		expect(() =>
			createNpmPackageManifest(
				{ ...cliManifest(), keywords: ["", "ai-agents"] },
				serverManifest(),
			),
		).toThrow("cli/package.json keywords must be a non-empty string array");
	});

	it("stages only npm runtime assets", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-npm-stage-test-"));
		roots.push(root);
		const source = join(root, "source");
		const target = join(root, "package");
		const files = {
			"cli/dist/classifier/worker.js": "classifier worker",
			"cli/dist/classifier/model.json": "pinned model manifest",
			".commonspace/classifier/model.onnx.data":
				"downloaded model must stay out of npm",
			"cli/dist/index.js": "#!/usr/bin/env node\n",
			"ui/dist/index.html": "<html>Commonspace</html>",
			"ui/dist/assets/client.js": "client",
			"server/src/private.ts": "source must stay private",
			".commonspace/state.json": "workspace must stay private",
			"README.md": "readme",
			LICENSE: "MIT",
		};
		for (const [path, contents] of Object.entries(files)) {
			await mkdir(dirname(join(source, path)), { recursive: true });
			await writeFile(join(source, path), contents);
		}

		const manifest = createNpmPackageManifest(cliManifest(), serverManifest());
		await stageNpmPackage(source, target, manifest);

		expect((await readdir(target)).sort()).toEqual([
			"LICENSE",
			"README.md",
			"dist",
			"package.json",
			"ui-dist",
		]);
		expect(await readFile(join(target, "dist/index.js"), "utf8")).toContain(
			"#!/usr/bin/env node",
		);
		expect(
			await readFile(join(target, "ui-dist/assets/client.js"), "utf8"),
		).toBe("client");
		expect(
			await readFile(join(target, "dist/classifier/worker.js"), "utf8"),
		).toBe("classifier worker");
		expect((await readdir(join(target, "dist/classifier"))).sort()).toEqual([
			"model.json",
			"worker.js",
		]);
		expect(
			JSON.parse(await readFile(join(target, "package.json"), "utf8")),
		).toEqual(manifest);
	});
});
