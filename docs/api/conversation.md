# Conversation and run control

Requests are validated in [`server/src/app.ts`](../../server/src/app.ts). Mutations use the [CommonspaceMutationSchema](../../packages/shared/src/mutation.ts) at the HTTP boundary.

| Method and path               | Request                                                            | Success response                                                          |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /api/mutate`            | [CommonspaceMutation](../../packages/shared/src/contracts.ts)      | `200` [CommonspaceBootstrap](../../packages/shared/src/contracts.ts)      |
| `POST /api/send`              | [SendMessageRequest](../../packages/shared/src/contracts.ts)       | `202` [SendMessageResponse](../../packages/shared/src/contracts.ts)       |
| `POST /api/reroute`           | [RerouteAssignmentRequest](../../packages/shared/src/contracts.ts) | `202` [RerouteAssignmentResponse](../../packages/shared/src/contracts.ts) |
| `POST /api/routing/retry`     | [RetryRoutingRequest](../../packages/shared/src/contracts.ts)      | `202` [RetryRoutingResponse](../../packages/shared/src/contracts.ts)      |
| `POST /api/stop`              | [StopAgentRunsRequest](../../packages/shared/src/contracts.ts)     | `200` [StopAgentRunsResponse](../../packages/shared/src/contracts.ts)     |
| `POST /api/followups/reorder` | [ReorderFollowupRequest](../../packages/shared/src/contracts.ts)   | `200` [FollowupQueueResponse](../../packages/shared/src/contracts.ts)     |
| `POST /api/followups/remove`  | [RemoveFollowupRequest](../../packages/shared/src/contracts.ts)    | `200` [FollowupQueueResponse](../../packages/shared/src/contracts.ts)     |

`/api/send` accepts a message before routing or execution finishes. A `202` response records acceptance; later results arrive through bootstrap refreshes and the [event stream](state.md). `SendMessageRequest` can include base64 image and file attachments, so this route has a larger JSON body limit than the other conversation routes.
