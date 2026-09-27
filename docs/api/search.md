# Search

`GET /api/search` is registered in [`server/src/app.ts`](../../server/src/app.ts). It accepts query parameters and returns `200` [CommonspaceSearchResponse](../../packages/shared/src/search.ts).

| Query parameter | Shared request field | Meaning                                                                             |
| --------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `q`             | `query`              | Search text; empty string is allowed                                                |
| `types`         | `kinds`              | Comma-separated [CommonspaceSearchKind](../../packages/shared/src/search.ts) values |
| `project`       | `projectId`          | Optional Project ID filter                                                          |
| `limit`         | `limit`              | Decimal digits; defaults to `24` and is clamped to `1` through `100`                |

The shared [CommonspaceSearchRequest](../../packages/shared/src/search.ts) describes the internal request shape after HTTP query parsing. Invalid query values return a `400` [CommonspaceApiError](../../packages/shared/src/contracts.ts).
