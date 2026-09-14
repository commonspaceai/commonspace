import { constants, type Dir, type Dirent } from "node:fs";
import { type FileHandle, open, opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessCapabilityGroup } from "@commonspace/shared";
import { type ParseError, parse } from "jsonc-parser";
import { z } from "zod";

const serverEntrySchema = z.looseObject({ enabled: z.boolean().optional() });
const serverMetadataSchema = z.looseObject({
	mcpServers: z.record(z.string(), serverEntrySchema).optional(),
	mcp: z.record(z.string(), serverEntrySchema).optional(),
});

/** Fixed native configuration sources, never commands, arguments, URLs, or credentials. */
export async function inspectMcpMetadata(
	paths: readonly string[],
	key: "mcp" | "mcpServers",
	source: string,
): Promise<HarnessCapabilityGroup> {
	try {
		const servers = new Map<string, "configured" | "disabled">();
		for (const path of paths) {
			let file: FileHandle;
			try {
				file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
			} catch (error) {
				if (error instanceof Error && isMissingMetadata(error)) continue;
				throw error;
			}
			try {
				if (!(await file.stat()).isFile())
					throw new Error("Not a configuration file");
				const buffer = Buffer.alloc(1024 * 1024 + 1);
				const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
				if (bytesRead === buffer.length)
					throw new Error("Configuration exceeds limit");
				const errors: ParseError[] = [];
				const raw: unknown = parse(
					buffer.toString("utf8", 0, bytesRead),
					errors,
					{
						allowTrailingComma: key === "mcp",
						disallowComments: key !== "mcp",
					},
				);
				if (errors.length > 0) throw new Error("Invalid native configuration");
				const metadata = serverMetadataSchema.parse(raw);
				for (const [name, value] of Object.entries(metadata[key] ?? {})) {
					if (/^[\p{L}\p{N}][\p{L}\p{N} ._:@()+-]{0,119}$/u.test(name))
						servers.set(
							name,
							value.enabled === false ? "disabled" : "configured",
						);
				}
			} finally {
				await file.close();
			}
		}
		return {
			id: "mcp",
			status: "available",
			source,
			notice:
				"User configuration metadata only. Project overrides are not included. Servers are not started or health checked; connection details remain private.",
			items: [...servers].map(([name, status]) => ({ name, status })),
		};
	} catch {
		return {
			id: "mcp",
			status: "error",
			source,
			notice:
				"Native configuration could not be fully inspected; no raw configuration is exposed.",
			items: [],
		};
	}
}

/** Enumerates native skill markers without reading prompts or following arbitrary trees. */
export async function inspectUserSkills(
	roots: readonly string[],
	source: string,
): Promise<HarnessCapabilityGroup> {
	return inspectResourceDirectories(roots, {
		id: "skills",
		marker: "SKILL.md",
		source,
		notice:
			"User skill folders containing SKILL.md. Project and plugin skills are not included; runtime loading and enabled state are not verified. Skill contents remain private.",
	});
}

/** Bounded native resource labels; only stat markers, never read or execute them. */
type ResourceMetadata = {
	id: "skills" | "plugins" | "agents";
	source: string;
	notice: string;
} & ({ marker: string } | { extension: ".md" });

function resourceEntry(
	entry: Dirent,
	root: string,
	metadata: ResourceMetadata,
) {
	if ("marker" in metadata) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) return undefined;
		return { name: entry.name, path: join(root, entry.name, metadata.marker) };
	}
	if (!entry.name.endsWith(metadata.extension)) return undefined;
	if (!entry.isFile() && !entry.isSymbolicLink()) return undefined;
	return {
		name: entry.name.slice(0, -metadata.extension.length),
		path: join(root, entry.name),
	};
}

export async function inspectResourceDirectories(
	roots: readonly string[],
	metadata: ResourceMetadata,
): Promise<HarnessCapabilityGroup> {
	const names = new Set<string>();
	let inspected = 0;
	try {
		for (const root of roots) {
			let directory: Dir;
			try {
				directory = await opendir(root);
			} catch (error) {
				if (error instanceof Error && isMissingMetadata(error)) continue;
				throw error;
			}
			for await (const entry of directory) {
				inspected += 1;
				if (inspected > 2_000)
					throw new Error("Resource inventory exceeds limit");
				const resource = resourceEntry(entry, root, metadata);
				if (resource === undefined) continue;
				if (!/^[\p{L}\p{N}][\p{L}\p{N} ._@()+-]{0,119}$/u.test(resource.name))
					continue;
				try {
					if ((await stat(resource.path)).isFile()) names.add(resource.name);
				} catch (error) {
					if (!(error instanceof Error && isMissingMetadata(error)))
						throw error;
				}
			}
		}
		return {
			id: metadata.id,
			status: "available",
			source: metadata.source,
			notice: metadata.notice,
			items: [...names].sort().map((name) => ({ name, status: "configured" })),
		};
	} catch {
		return {
			id: metadata.id,
			status: "error",
			source: metadata.source,
			notice: "User resource metadata could not be fully inspected.",
			items: [],
		};
	}
}

function isMissingMetadata(error: Error): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
