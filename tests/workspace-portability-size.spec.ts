import { describe, expect, it } from "vitest";
import {
	assertWorkspaceExportPlanSize,
	assertWorkspaceExportSize,
	assertWorkspaceImportSize,
	assertWorkspaceProjectMappingsSize,
	MAX_WORKSPACE_IMPORT_ARCHIVE_BYTES,
	MAX_WORKSPACE_IMPORT_BODY_BYTES,
	MAX_WORKSPACE_PROJECT_MAPPINGS_BYTES,
} from "../server/src/workspace-portability.ts";

describe("workspace portability size contract", () => {
	it("reserves HTTP framing space beyond archive and mapping ceilings", () => {
		expect(
			MAX_WORKSPACE_IMPORT_BODY_BYTES -
				MAX_WORKSPACE_IMPORT_ARCHIVE_BYTES -
				MAX_WORKSPACE_PROJECT_MAPPINGS_BYTES,
		).toBeGreaterThanOrEqual(1024 * 1024);
	});

	it("counts the complete UTF-8 archive including Base64 data and metadata", () => {
		const archive = {
			format: "commonspace-workspace",
			version: 1,
			workspace: { messages: {} },
			attachments: [
				{ id: "one", name: "one.bin", data: "YQ==" },
				{ id: "two", name: "two.bin", data: "YmI=" },
			],
		};
		const exactBytes = new TextEncoder().encode(JSON.stringify(archive)).length;

		expect(() => assertWorkspaceExportSize(archive, exactBytes)).not.toThrow();
		expect(() => assertWorkspaceExportSize(archive, exactBytes - 1)).toThrow(
			"workspace archive exceeds the supported",
		);
		expect(() => assertWorkspaceImportSize(archive, exactBytes - 1)).toThrow(
			"choose a smaller workspace archive",
		);
	});

	it("projects Base64 expansion before attachment data is loaded", () => {
		const archive = {
			format: "commonspace-workspace" as const,
			version: 2 as const,
			exportedAt: "2026-01-01T00:00:00.000Z",
			workspace: {
				inboxReadAt: null,
				inboxReadMessageIds: [],
				inboxUnreadMessageIds: [],
				inboxSavedItemIds: [],
				followedSessionIds: [],
				mutedSessionIds: [],
				notifications: {
					enabled: false,
					replies: true,
					mentions: true,
					permissions: true,
					failures: true,
					sound: false,
				},
				defaults: {
					maxAgentsPerTurn: 4,
					memoryThreads: 12,
				},
				agents: [],
				projects: [],
				channels: [],
				threads: [],
				pins: [],
				permissions: [],
				messages: {},
			},
			attachments: [
				{
					kind: "file" as const,
					id: "one",
					name: "one.bin",
					mimeType: "application/octet-stream",
					size: 4,
					data: "",
				},
				{
					kind: "file" as const,
					id: "two",
					name: "two.bin",
					mimeType: "application/octet-stream",
					size: 5,
					data: "",
				},
			],
		};
		const metadataBytes = new TextEncoder().encode(
			JSON.stringify(archive),
		).length;
		const projectedBytes = metadataBytes + 8 + 8;

		expect(() =>
			assertWorkspaceExportPlanSize(archive, projectedBytes),
		).not.toThrow();
		expect(() =>
			assertWorkspaceExportPlanSize(archive, projectedBytes - 1),
		).toThrow("workspace archive exceeds the supported");
	});

	it("bounds explicit Project mappings independently from archive bytes", () => {
		const mappings = {
			"project-one": ["/mapped/working-copy", "/mapped/reference-copy"],
		};
		const exactBytes = new TextEncoder().encode(
			JSON.stringify(mappings),
		).length;

		expect(() =>
			assertWorkspaceProjectMappingsSize(mappings, exactBytes),
		).not.toThrow();
		expect(() =>
			assertWorkspaceProjectMappingsSize(mappings, exactBytes - 1),
		).toThrow("Project mappings exceed the supported");
	});
});
