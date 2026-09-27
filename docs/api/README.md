# HTTP API reference

This reference maps the local HTTP routes in [`server/src/app.ts`](../../server/src/app.ts) to their request and response contracts. Follow the linked types for field definitions. [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts) is the public cross-process contract entry point; server-owned validators used at the HTTP boundary are authoritative for accepted input. The routes are intended for Commonspace's own browser and scoped local agent clients.

| Group                                       | Endpoints                                                          |
| ------------------------------------------- | ------------------------------------------------------------------ |
| [State and events](state.md)                | Health, bootstrap, diagnostics, notifications, and event stream    |
| [Conversation](conversation.md)             | Mutations, sends, rerouting, run control, and follow-up queue      |
| [Messages](messages.md)                     | Edit and delete                                                    |
| [Context](context.md)                       | Channel and Thread context reads, updates, and compaction          |
| [Routing](routing.md)                       | Routing configuration and validation                               |
| [Pins and permissions](pins-permissions.md) | Pins and native permission responses                               |
| [Project files](projects.md)                | Directory browsing, file preview, editor open, Git status and diff |
| [Attachments](attachments.md)               | Stored image and file bytes                                        |
| [Workspace data](workspace-data.md)         | Export, import, and retention                                      |
| [Search](search.md)                         | Workspace search                                                   |
| [Agents](agents.md)                         | Discovery, capabilities, MCP sign-in, and directory picker         |
| [Agent context tools](mcp.md)               | Authenticated MCP transport                                        |

## Transport rules

- The server listens on loopback. `/api` rejects non-loopback clients. Except for `GET /api/health` and the bearer-protected `POST /api/mcp`, routes also require a same-origin request. See [`requestIsSameOrigin`](../../server/src/app.ts) for the accepted `Origin`, `Referer`, or `Sec-Fetch-Site` signals.
- JSON is the normal request and response format. The default JSON body limit is 128 KiB, `/api/send` allows 24 MiB, and `/api/import` uses the workspace import limit. Binary and server-sent event responses are identified on their pages. API responses use `Cache-Control: no-store`.
- Failure responses from the app's HTTP boundary normally use [CommonspaceApiError](../../packages/shared/src/contracts.ts): `{ "code": string, "error": string }`. Each route owns its success status and error mapping in `app.ts`. A missing route returns `404` with `code: "not_found"`. MCP protocol failures can instead use JSON-RPC errors.
- `:id` segments in paths are URL path parameters. Query parameters are written after `?`. These pages describe the current source contract, not a public versioned API guarantee.
- State responses use the shared [CommonspaceState](../../packages/shared/src/contracts.ts) shape. The server's [public snapshot](../../server/src/service.ts) clears native-session maps and replaces private Project paths before returning it.

## Generated shared contracts

Run `pnpm docs:contracts` from the repository root. TypeDoc writes browsable HTML to `artifacts/docs/contracts/index.html` and a machine-readable reflection to `artifacts/docs/contracts.json`. These ignored outputs are generated from the shared package, so the linked TypeScript declarations remain authoritative. The JSON is a TypeDoc reflection, not an OpenAPI document.
