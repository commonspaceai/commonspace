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

HTTP requests require `submissionId`. Reuse that ID and the unchanged payload after losing an acceptance response. The host saves a private receipt with the accepted message and returns the same message ID on retry, including after restart. It does not rerun routing or execution. Reusing an ID for different content returns `409`; retrying after the accepted content was removed returns `410`. A new or edited draft uses a new ID. Submission receipts are absent from browser snapshots and portable exports.
