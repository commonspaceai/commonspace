import { COMMONSPACE_EXPORT_VERSION } from "@commonspace/shared";
import { describe, expect, it } from "vitest";
import { parseWorkspaceImport } from "../ui/src/workspace-import.ts";

const archive = {
	format: "commonspace-workspace",
	version: 1,
	exportedAt: "2026-09-03T10:00:00.000Z",
	workspace: {
		projects: [
			{
				id: "project-commonspace",
				name: "Commonspace",
				rootCount: 2,
			},
		],
	},
	attachments: [],
};

describe("workspace import manifest decoding", () => {
	it("proves UI mapping metadata while preserving the original archive for server validation", () => {
		expect(parseWorkspaceImport(JSON.stringify(archive))).toEqual({
			source: { value: archive },
			projects: [
				{
					id: "project-commonspace",
					name: "Commonspace",
					rootCount: 2,
				},
			],
		});
		const currentArchive = { ...archive, version: COMMONSPACE_EXPORT_VERSION };
		expect(parseWorkspaceImport(JSON.stringify(currentArchive))).toEqual({
			source: { value: currentArchive },
			projects: [
				{
					id: "project-commonspace",
					name: "Commonspace",
					rootCount: 2,
				},
			],
		});
	});

	it("rejects malformed and duplicate Project mapping metadata", () => {
		expect(parseWorkspaceImport("not-json")).toBeNull();
		expect(
			parseWorkspaceImport(
				JSON.stringify({
					...archive,
					workspace: {
						projects: [{ name: "Missing id", rootCount: 1 }],
					},
				}),
			),
		).toBeNull();
		expect(
			parseWorkspaceImport(
				JSON.stringify({
					...archive,
					workspace: {
						projects: [
							{ id: "duplicate", name: "First", rootCount: 1 },
							{ id: "duplicate", name: "Second", rootCount: 1 },
						],
					},
				}),
			),
		).toBeNull();
	});
});
