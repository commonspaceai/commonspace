# Channel and Thread context

These routes are registered in [`server/src/app.ts`](../../server/src/app.ts). `:channelId` and `:threadId` are URL path parameters. Compaction routes take no JSON body.

| Method and path                                 | Request                                                               | Success response                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/channels/:channelId/context`          | None                                                                  | `200` [CommonspaceChannelMemory](../../packages/shared/src/contracts.ts) |
| `PUT /api/channels/:channelId/context`          | [UpdateChannelContextRequest](../../packages/shared/src/contracts.ts) | `200` [CommonspaceChannelMemory](../../packages/shared/src/contracts.ts) |
| `POST /api/channels/:channelId/context/compact` | No body                                                               | `200` [CommonspaceChannelMemory](../../packages/shared/src/contracts.ts) |
| `GET /api/threads/:threadId/context`            | None                                                                  | `200` [CommonspaceThreadContext](../../packages/shared/src/contracts.ts) |
| `PUT /api/threads/:threadId/context`            | [UpdateThreadContextRequest](../../packages/shared/src/contracts.ts)  | `200` [CommonspaceThreadContext](../../packages/shared/src/contracts.ts) |
| `POST /api/threads/:threadId/context/compact`   | No body                                                               | `200` [CommonspaceThreadContext](../../packages/shared/src/contracts.ts) |

An update body contains `summary: string` and optional `decisions: string[]` and `openQuestions: string[]`. The Thread context response also contains the captured Channel snapshot. See [Context model](../specs/product-spec.md#7-context-model) for the product rules behind compaction.
