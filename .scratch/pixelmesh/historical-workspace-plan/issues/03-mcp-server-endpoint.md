# Issue 03: WebMCP Protocol Server Endpoint (`/api/mcp`) & Tool Registration

Status: ready-for-agent

## Description
Expose all 21+ image filter tools through an official Model Context Protocol (MCP) Streamable HTTP endpoint (`/api/mcp`) with cryptographic auth verification, credit metering, and MCP schema validation.

## Acceptance Criteria
- `lib/mcp/server.ts` & `lib/mcp/registry.ts`: Register all 21+ tools with strict Zod / JSON schemas.
- `/api/mcp/route.ts`: Handle POST JSON-RPC requests (`tools/list`, `tools/call`, `resources/list`).
- Middleware verification: Validate cryptographic signature headers, check anti-replay nonce, verify key status, and check credit balance.
- Atomically deduct credits (1 for filter, 3 for batch) on successful execution and inject `X-Agent-Credits-Remaining` header.
- Return JSON-RPC error `-32001` on invalid signature, `-32002` on insufficient balance, or `{ result: ..., isError: true }` on tool parameter failure.
