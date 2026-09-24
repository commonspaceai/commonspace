import type { CommonspaceWorkspaceArchive } from "@commonspace/shared";
import type { JsonValue } from "./json.js";

const MEBIBYTE = 1024 * 1024;

type SerializableArchive = CommonspaceWorkspaceArchive | JsonValue;
type SerializableProjectMappings = Readonly<Record<string, readonly string[]>>;

export class WorkspacePortabilitySizeError extends Error {}

/** Maximum UTF-8 JSON size of a generated workspace archive. */
const MAX_WORKSPACE_ARCHIVE_BYTES = 48 * MEBIBYTE;

/** Compatibility ceiling for importing supported workspace archives. */
export const MAX_WORKSPACE_IMPORT_ARCHIVE_BYTES = 64 * MEBIBYTE;

/** Maximum UTF-8 JSON size of explicit destination Project mappings. */
export const MAX_WORKSPACE_PROJECT_MAPPINGS_BYTES = 8 * MEBIBYTE;

/** HTTP envelope budget: archive, mappings, and JSON framing. */
export const MAX_WORKSPACE_IMPORT_BODY_BYTES = 80 * MEBIBYTE;

function serializedBytes(
	value: SerializableArchive | SerializableProjectMappings,
): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function sizeLabel(bytes: number): string {
	return `${String(bytes / MEBIBYTE)} MiB`;
}

function assertSerializedSize(
	archive: SerializableArchive,
	maxBytes: number,
	recovery: string,
): void {
	assertByteCount(serializedBytes(archive), maxBytes, recovery);
}

function assertByteCount(
	bytes: number,
	maxBytes: number,
	recovery: string,
): void {
	if (bytes <= maxBytes) return;
	throw new WorkspacePortabilitySizeError(
		`workspace archive exceeds the supported ${sizeLabel(maxBytes)} limit; ${recovery}`,
	);
}

export function assertWorkspaceExportPlanSize(
	archive: CommonspaceWorkspaceArchive,
	maxBytes = MAX_WORKSPACE_ARCHIVE_BYTES,
): void {
	const encodedAttachmentBytes = archive.attachments.reduce(
		(total, attachment) => total + 4 * Math.ceil(attachment.size / 3),
		0,
	);
	assertByteCount(
		serializedBytes(archive) + encodedAttachmentBytes,
		maxBytes,
		"apply retention or remove attachments before exporting",
	);
}

export function assertWorkspaceExportSize(
	archive: SerializableArchive,
	maxBytes = MAX_WORKSPACE_ARCHIVE_BYTES,
): void {
	assertSerializedSize(
		archive,
		maxBytes,
		"apply retention or remove attachments before exporting",
	);
}

export function assertWorkspaceImportSize(
	archive: SerializableArchive,
	maxBytes = MAX_WORKSPACE_IMPORT_ARCHIVE_BYTES,
): void {
	assertSerializedSize(archive, maxBytes, "choose a smaller workspace archive");
}

export function assertWorkspaceProjectMappingsSize(
	projectMappings: SerializableProjectMappings,
	maxBytes = MAX_WORKSPACE_PROJECT_MAPPINGS_BYTES,
): void {
	if (serializedBytes(projectMappings) <= maxBytes) return;
	throw new WorkspacePortabilitySizeError(
		`Project mappings exceed the supported ${sizeLabel(maxBytes)} limit`,
	);
}
