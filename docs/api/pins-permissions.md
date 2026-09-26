# Pins and permissions

The request validators and status mappings are in [`server/src/app.ts`](../../server/src/app.ts).

| Method and path                               | Request                                                 | Success response                                                             |
| --------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/pins`                              | [AddPinRequest](../../packages/shared/src/contracts.ts) | `201` [CommonspacePin](../../packages/shared/src/contracts.ts)               |
| `POST /api/pins/:pinId/remove`                | No body                                                 | `200` removed [CommonspacePin](../../packages/shared/src/contracts.ts)       |
| `POST /api/permissions/:permissionId/respond` | `{ "optionId": string }`                                | `200` [CommonspacePermissionRequest](../../packages/shared/src/contracts.ts) |

`AddPinRequest` is a union of message, attachment, and note pins. The permission `optionId` must identify one of the current request's [CommonspacePermissionOption](../../packages/shared/src/contracts.ts) entries.
