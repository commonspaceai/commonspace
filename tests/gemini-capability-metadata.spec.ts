import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGeminiAdapter } from "../server/src/adapters/gemini.ts";

const roots: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function nativeHome() {
	const root = await mkdtemp(join(tmpdir(), "commonspace-gemini-metadata-"));
	roots.push(root);
	vi.stubEnv("GEMINI_CLI_HOME", root);
	return join(root, ".gemini");
}

function inspect() {
	return createGeminiAdapter({
		geminiPath: "must-not-execute",
	}).inspectCapabilities({
		id: "gemini",
		displayName: "Gemini CLI",
		adapter: "gemini",
		model: null,
		createdAt: "2026-09-14T00:00:00.000Z",
	});
}

it("requires file markers, includes linked Gemini resources, and keeps bodies private", async () => {
	const root = await nativeHome();
	await mkdir(join(root, "skills", "review"), { recursive: true });
	await writeFile(
		join(root, "skills", "review", "SKILL.md"),
		"PRIVATE_SKILL_BODY",
	);
	await symlink(
		join(root, "skills", "review"),
		join(root, "skills", "linked-review"),
		"junction",
	);
	await mkdir(join(root, "skills", "not-a-skill", "SKILL.md"), {
		recursive: true,
	});
	await mkdir(join(root, "extensions", "catalog"), { recursive: true });
	await writeFile(
		join(root, "extensions", "catalog", "gemini-extension.json"),
		'{"token":"PRIVATE_EXTENSION_BODY"}',
	);
	const groups = await inspect();
	expect(groups.find((group) => group.id === "skills")).toMatchObject({
		status: "available",
		items: [
			{ name: "linked-review", status: "configured" },
			{ name: "review", status: "configured" },
		],
	});
	expect(groups.find((group) => group.id === "plugins")).toMatchObject({
		status: "available",
		items: [{ name: "catalog", status: "configured" }],
	});
	expect(JSON.stringify(groups)).not.toMatch(/PRIVATE_|not-a-skill/u);
	expect(JSON.stringify(groups)).not.toContain(root);
});

it.skipIf(process.platform === "win32")(
	"reports failed Gemini marker inspection separately from missing resources",
	async () => {
		const root = await nativeHome();
		await mkdir(join(root, "skills", "broken"), { recursive: true });
		await symlink("SKILL.md", join(root, "skills", "broken", "SKILL.md"));
		const groups = await inspect();
		expect(groups.find((group) => group.id === "skills")).toMatchObject({
			status: "error",
			items: [],
		});
		expect(groups.find((group) => group.id === "plugins")).toMatchObject({
			status: "available",
			items: [],
		});
	},
);

it("reports a malformed resource root as a read failure rather than empty inventory", async () => {
	const root = await nativeHome();
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "skills"), "not a resource directory");
	expect(
		(await inspect()).find((group) => group.id === "skills"),
	).toMatchObject({ status: "error", items: [] });
});

it("bounds Gemini directory scans without returning a partial inventory", async () => {
	const root = await nativeHome();
	const extensions = join(root, "extensions");
	await mkdir(extensions, { recursive: true });
	for (let index = 0; index <= 2000; index += 1) {
		await writeFile(join(extensions, `unrelated-${index}`), "");
	}
	expect(
		(await inspect()).find((group) => group.id === "plugins"),
	).toMatchObject({ status: "error", items: [] });
});
