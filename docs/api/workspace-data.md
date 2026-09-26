# Workspace data

The routes are in [`server/src/app.ts`](../../server/src/app.ts). The [workspace archive format](../specs/workspace-archive-format.md) describes portability and privacy rules.

| Method and path               | Request                                                                                   | Success response                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/export`             | None                                                                                      | `200` [CommonspaceWorkspaceArchive](../../packages/shared/src/contracts.ts), downloaded as `commonspace-export.json` |
| `POST /api/import`            | `{ "archive": CommonspaceWorkspaceArchive, "projectMappings": Record<string, string[]> }` | `200` [CommonspaceState](../../packages/shared/src/contracts.ts)                                                     |
| `POST /api/retention/preview` | `{ "conversation": ConversationRef }`                                                     | `200` [CommonspaceRetentionPreview](../../packages/shared/src/contracts.ts)                                          |
| `POST /api/retention/apply`   | [ApplyRetentionRequest](../../packages/shared/src/contracts.ts)                           | `200` [CommonspaceRetentionPreview](../../packages/shared/src/contracts.ts)                                          |

`/api/import` parses `archive` as JSON, then validates the archive and Project folder mappings before restoring an empty target workspace. See [CommonspaceWorkspaceArchive](../../packages/shared/src/contracts.ts) and [ConversationRef](../../packages/shared/src/contracts.ts) for the linked fields. `expectedRevision` in `ApplyRetentionRequest` must match the preview revision.
