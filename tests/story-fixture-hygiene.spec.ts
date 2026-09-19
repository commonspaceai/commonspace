import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const storiesRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"../ui/src/stories",
);

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
		}),
	);
	return files.flat();
}

const privateFixturePatterns = [
	{ label: "personal author identity", pattern: /\bralph\b/i },
	{ label: "macOS or Linux home path", pattern: /\/(?:Users|home)\/[^/\s"']+/ },
	{ label: "Windows home path", pattern: /[A-Za-z]:\\Users\\[^\\\s"']+/ },
	{
		label: "native-session-shaped fixture identifier",
		pattern: /\b(?:dm|agent)-session-[a-z0-9_-]+\b/i,
	},
	{
		label: "forbidden sample brand",
		pattern: new RegExp(["gat", "dam"].join(""), "i"),
	},
] as const;

describe("Storybook fixture hygiene", () => {
	it("keeps every story source free of personal and host-specific sample data", async () => {
		const violations: string[] = [];
		for (const path of await sourceFiles(storiesRoot)) {
			const source = await readFile(path, "utf8");
			for (const { label, pattern } of privateFixturePatterns) {
				if (pattern.test(source)) {
					violations.push(`${relative(storiesRoot, path)}: ${label}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
