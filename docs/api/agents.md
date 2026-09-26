# Agents and local discovery

These routes are registered in [`server/src/app.ts`](../../server/src/app.ts). Capability browsing is ephemeral and does not add private native configuration to bootstrap or exports.

| Method and path                                | Request                                                         | Success response                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/discover-agents`                    | [DiscoverAgentsRequest](../../packages/shared/src/contracts.ts) | `200` [CommonspaceBootstrap](../../packages/shared/src/contracts.ts)                  |
| `POST /api/select-directory`                   | No body                                                         | `200` [SelectDirectoryResponse](../../packages/shared/src/contracts.ts)               |
| `GET /api/agents/:agentId/capabilities`        | None                                                            | `200` [HarnessCapabilityInventory](../../packages/shared/src/harness-capabilities.ts) |
| `POST /api/agents/:agentId/mcp-authentication` | `{ "serverName": string }`                                      | `200` JSON `{ "status": "complete" }`                                                 |

The MCP sign-in route uses a server-owned request schema and is rate limited. It may return `404` for an unknown Agent or `409` when native sign-in is unavailable. Capability errors use [CommonspaceApiError](../../packages/shared/src/contracts.ts).
