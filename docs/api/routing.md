# Routing configuration

The request validator is [RoutingConfigurationRequest](../../server/src/routing-configuration.ts). It accepts the shared [UpdateRoutingConfigurationRequest](../../packages/shared/src/contracts.ts) shape with a configured harness Agent ID.

| Method and path              | Request                                                                     | Success response                                                                |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/routing`           | None                                                                        | `200` [CommonspaceRoutingConfiguration](../../packages/shared/src/contracts.ts) |
| `PUT /api/routing`           | [UpdateRoutingConfigurationRequest](../../packages/shared/src/contracts.ts) | `200` [CommonspaceRoutingConfiguration](../../packages/shared/src/contracts.ts) |
| `POST /api/routing/validate` | [UpdateRoutingConfigurationRequest](../../packages/shared/src/contracts.ts) | `200` [CommonspaceInferenceDiagnostics](../../packages/shared/src/contracts.ts) |

`PUT /api/routing` persists the selection. `POST /api/routing/validate` checks the candidate without saving it. Neither request accepts extra JSON fields.
