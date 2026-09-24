import type {
	HarnessCapabilityGroup,
	HarnessCapabilityItem,
} from "@commonspace/shared";
import { McpAuthenticationStatus } from "@commonspace/shared";
import { z } from "zod";
import { readHarnessCommand } from "./discovery.js";

export type CapabilityId = HarnessCapabilityGroup["id"];

interface CapabilityProbe {
	id: CapabilityId;
	args: readonly string[];
	source: string;
	notice: string;
	parse: (output: string) => HarnessCapabilityItem[];
}

const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._:@()+-]{0,119}$/u;
const inventoryEntrySchema = z.looseObject({
	name: z.string().optional(),
	id: z.string().optional(),
	enabled: z.boolean().optional(),
	installed: z.boolean().optional(),
});
const inventorySchema = z.union([
	z.array(inventoryEntrySchema),
	z.object({ installed: z.array(inventoryEntrySchema) }),
]);
const codexMcpInventorySchema = z.array(
	z.looseObject({
		name: z.string(),
		enabled: z.boolean().optional(),
		auth_status: z.string().optional(),
	}),
);

function safeItem(
	name: string | undefined,
	status: HarnessCapabilityItem["status"],
): HarnessCapabilityItem | undefined {
	if (typeof name !== "string") return undefined;
	const clean = name.trim();
	if (!SAFE_NAME.test(clean)) return undefined;
	return { name: clean, status };
}

export function parseNamedJsonInventory(
	output: string,
): HarnessCapabilityItem[] {
	const value = inventorySchema.parse(JSON.parse(output));
	const entries = Array.isArray(value) ? value : value.installed;
	return entries.flatMap((entry) => {
		const status =
			entry.enabled === true
				? "enabled"
				: entry.enabled === false
					? "disabled"
					: entry.installed === true
						? "configured"
						: "unknown";
		const item = safeItem(entry.name ?? entry.id, status);
		return item === undefined ? [] : [item];
	});
}

export function parseCodexMcpInventory(
	output: string,
): HarnessCapabilityItem[] {
	const entries = codexMcpInventorySchema.parse(JSON.parse(output));
	return entries.flatMap((entry) => {
		const item = safeItem(
			entry.name,
			entry.enabled === true
				? "enabled"
				: entry.enabled === false
					? "disabled"
					: "unknown",
		);
		if (item === undefined) return [];
		let authentication: McpAuthenticationStatus;
		switch (entry.auth_status) {
			case "logged_in":
				authentication = McpAuthenticationStatus.Authenticated;
				break;
			case "not_logged_in":
				authentication = McpAuthenticationStatus.NotAuthenticated;
				break;
			case "unsupported":
				authentication = McpAuthenticationStatus.Unsupported;
				break;
			default:
				authentication = McpAuthenticationStatus.Unknown;
		}
		return [{ ...item, authentication }];
	});
}

export function unavailableGroup(
	id: CapabilityId,
	source: string,
	notice: string,
): HarnessCapabilityGroup {
	return { id, status: "unavailable", source, notice, items: [] };
}

export async function inspectCommandCapabilities(
	command: string,
	probes: readonly CapabilityProbe[],
	fallbacks: readonly HarnessCapabilityGroup[],
): Promise<HarnessCapabilityGroup[]> {
	const inspected = await Promise.all(
		probes.map(async (probe): Promise<HarnessCapabilityGroup> => {
			try {
				return {
					id: probe.id,
					status: "available",
					source: probe.source,
					notice: probe.notice,
					items: probe.parse(
						await readHarnessCommand(command, probe.args, undefined, {
							COLUMNS: "240",
							NO_COLOR: "1",
						}),
					),
				};
			} catch {
				return {
					id: probe.id,
					status: "error",
					source: probe.source,
					notice:
						"Native metadata inspection failed; no command output was exposed.",
					items: [],
				};
			}
		}),
	);
	const byId = new Map(
		[...fallbacks, ...inspected].map((group) => [group.id, group]),
	);
	return (
		["tools", "mcp", "skills", "plugins", "memory", "agents"] as const
	).map((id) => {
		const group = byId.get(id);
		if (group === undefined) throw new Error(`Missing capability group: ${id}`);
		return group;
	});
}
