# Attachments

The byte-serving routes are in [`server/src/app.ts`](../../server/src/app.ts). Attachment metadata is part of the shared message contract.

| Method and path                      | Request | Success response                                                                                                                    |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/attachments/:attachmentId` | None    | `200` image bytes with the MIME type from [CommonspaceImageAttachment](../../packages/shared/src/contracts.ts)                      |
| `GET /api/files/:fileId`             | None    | `200` file bytes with MIME type and attachment disposition from [CommonspaceFileAttachment](../../packages/shared/src/contracts.ts) |

Both responses set `X-Content-Type-Options: nosniff`. An unknown attachment returns `404` [CommonspaceApiError](../../packages/shared/src/contracts.ts).
