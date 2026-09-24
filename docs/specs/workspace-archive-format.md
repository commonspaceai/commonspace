# Workspace archive format

A Commonspace workspace archive is a self-contained JSON export of conversation data and attachments. Use it to transfer data into a clean workspace. It does not transfer running agent sessions or replace a full local backup for a version downgrade.

This is the developer reference for archive validation. For export, import, and cleanup steps, see [Operations](../guides/operations.md#export-import-and-retention).

## Version 1 envelope

The following example shows the envelope and workspace field names. Empty settings objects abbreviate the full contracts; use an application-generated export for a complete importable document.

```json
{
  "format": "commonspace-workspace",
  "version": 1,
  "exportedAt": "2026-08-31T00:00:00.000Z",
  "workspace": {
    "inboxReadAt": null,
    "inboxReadMessageIds": [],
    "inboxUnreadMessageIds": [],
    "inboxSavedItemIds": [],
    "followedSessionIds": [],
    "mutedSessionIds": [],
    "notifications": {},
    "defaults": {},
    "agents": [],
    "projects": [],
    "channels": [],
    "threads": [],
    "schedules": [],
    "pins": [],
    "permissions": [],
    "messages": {}
  },
  "attachments": []
}
```

`format` and `version` identify the archive contract. Archive version 1 is independent of the internal persisted-state version. `exportedAt` and other timestamps use ISO 8601. IDs are opaque strings, and records refer to each other by those IDs. Detailed workspace shapes are defined in [`packages/shared/src/contracts.ts`](../../packages/shared/src/contracts.ts).

### Projects

Each Project contains `id`, `name`, `rootCount`, and `createdAt`. Absolute roots are omitted. Import requires exactly `rootCount` existing local directories for each Project, supplied in an explicit mapping outside the archive.

### Schedules

Each schedule contains its Channel ID, title, message text, paused state, and either a one-time ISO timestamp or a five-field cron expression with an IANA time zone. It also stores the next and last run timestamps. Older version-1 archives may omit `schedules`; import treats that as an empty list. Schedules for missing Channels are discarded during state sanitization.

### Attachments

Each attachment contains `kind` (`image` or `file`), `id`, `name`, `mimeType`, `size`, and padded base64 `data`. Every attachment referenced by a message must have exactly one matching byte entry. Its metadata, decoded size, and canonical base64 encoding must agree.

### Size contract

All limits below measure UTF-8 JSON size:

| Value | Maximum | Purpose |
| --- | --- | --- |
| Generated version-1 archive | 48 MiB | Keeps supported exports within the HTTP restoration workflow. |
| Imported version-1 archive value | 64 MiB | Accepts earlier exports as well as current ones. |
| Explicit Project mappings | 8 MiB | Maps archived Projects to local directories. |
| Complete HTTP import request | 80 MiB | Includes the archive, mappings, and JSON framing. This does not increase the archive limit. |

Before reading attachment bytes, export projects each exact Base64 length from validated stored metadata and combines it with the complete archive metadata size. It aborts an oversized plan, then verifies the final serialized size after reading exact bytes. An oversized export therefore stops with an actionable error before loading every attachment or downloading an archive that the supported HTTP workflow cannot restore.

Import rejects oversized request bodies before archive validation. It rejects oversized archive or mapping values before attachment or workspace writes.

## Privacy boundary

Commonspace-managed fields omit native harness credentials and transcript stores, opaque native-session references, ephemeral MCP capabilities, and absolute Commonspace, projectless-workspace, and Project-root paths.

Pending native permission requests export as interrupted because the original harness request cannot survive a transfer. Attachment bytes remain exact: Commonspace does not scan or rewrite their contents. An attached file may therefore contain paths or secrets supplied by its author.

The archive is unencrypted and includes conversation text and attachment bytes. Treat it as private user data. Sanitizing Commonspace-managed metadata does not make user-authored content safe to publish.

## Import rules

Import restores data into an empty destination and does not merge workspaces:

1. The destination must be empty. Import never merges with or overwrites an existing workspace.
2. Commonspace validates the envelope version, workspace structure, Projects, attachment metadata, and bytes before activating the imported state.
3. Every Project root requires an explicit local directory mapping. Unknown, missing, duplicate, non-directory, or surplus mappings fail validation.
4. Native-session references start empty. Imported conversations remain visible, and the next harness turn establishes new native continuity.
5. Attachment bytes and state are committed together. If persistence fails, newly copied bytes are removed.
6. The archive and explicit Project mappings must fit the documented size contract.

Unknown archive versions are rejected. A future format change must increment `version` and document its migration behavior here.

## Retention

Commonspace keeps accepted messages until the owner explicitly cleans up a Channel or Direct Message. There is no automatic expiry.

A retention preview reports the affected messages, Threads, attachments, pins, and permission records. It is tied to the current state revision. Any intervening state change requires a new preview before cleanup can proceed.

Applying retention removes that conversation's transcript, attachment bytes, associated Threads, native-session mappings, pins, permission records, and derived Channel/routing memory. It preserves the Channel or Agent identity and leaves other conversations intact. Active work blocks cleanup.
