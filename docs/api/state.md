# State and events

These routes are registered in [`server/src/app.ts`](../../server/src/app.ts).

| Method and path                  | Request | Success response                                                                    |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `GET /api/health`                | None    | `200` JSON `{ "status": "ok" }`                                                     |
| `GET /api/bootstrap`             | None    | `200` [CommonspaceBootstrap](../../packages/shared/src/contracts.ts)                |
| `GET /api/diagnostics`           | None    | `200` [CommonspaceDiagnostics](../../packages/shared/src/contracts.ts)              |
| `POST /api/notifications/verify` | No body | `200` [CommonspaceNotificationVerification](../../packages/shared/src/contracts.ts) |
| `GET /api/events`                | None    | `200` `text/event-stream`                                                           |

`GET /api/events` sends a `revision` event with `{ revision: number }`, an `activity` event with `{ activities: CommonspaceLiveAgentActivity[], queuedFollowups: CommonspaceQueuedFollowup[] }`, and `routing-changed` with `{}`. The activity and follow-up types live in [shared contracts](../../packages/shared/src/contracts.ts). The stream starts with the current revision and activity, then sends updates until the connection closes.
