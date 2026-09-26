# Message history

Both routes are registered in [`server/src/app.ts`](../../server/src/app.ts). `:messageId` identifies the message to change.

| Method and path                        | Request                                                                                                                          | Success response                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /api/messages/:messageId/edit`   | `text: string`, optional `projectIds: string[]`, the body fields of [EditMessageRequest](../../packages/shared/src/contracts.ts) | `202` [SendMessageResponse](../../packages/shared/src/contracts.ts)        |
| `POST /api/messages/:messageId/delete` | No body                                                                                                                          | `200` deleted [CommonspaceMessage](../../packages/shared/src/contracts.ts) |

The edit path supplies `messageId`, so the JSON body omits that field. Edit and delete errors use [CommonspaceApiError](../../packages/shared/src/contracts.ts).
