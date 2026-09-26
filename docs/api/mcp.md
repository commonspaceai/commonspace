# Agent context tools over MCP

`POST /api/mcp` is implemented by [`CommonspaceMcpGateway`](../../server/src/commonspace-mcp.ts) and registered in [`server/src/app.ts`](../../server/src/app.ts) when the gateway is available. It accepts a JSON-RPC MCP request with a bearer capability issued to a native ACP session. The server-owned [CommonspaceMcpScope](../../server/src/commonspace-mcp.ts) limits each credential to its conversation, Thread, and Project context.

The response follows the MCP Streamable HTTP JSON response protocol, including JSON-RPC results or errors. Requests without a valid bearer capability return `401` [CommonspaceApiError](../../packages/shared/src/contracts.ts); methods other than `POST` return `405`. Tool names, input schemas, and current behavior are registered in [`server/src/commonspace-mcp.ts`](../../server/src/commonspace-mcp.ts). This transport is for scoped native agent clients, rather than the browser workspace API.
