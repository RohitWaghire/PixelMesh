# 03: Authenticated WebMCP Streamable Endpoint (`/api/mcp`) & Credit Metering

**What to build:**
The official Model Context Protocol (MCP) JSON-RPC endpoint at `/api/mcp`. External AI agents connect and invoke image filter tools by providing Ed25519 cryptographic signature headers. The server verifies signatures, enforces credit deductions, and returns MCP-standard `isError: true` responses on parameter validation errors so agents can self-correct without losing credits.

**Blocked by:** 01 (Project Scaffold & Cryptographic Auth Gateway), 02 (Core Image Filter Engine & Direct Studio Playground)

**Status:** ready-for-agent

- [ ] Complete `@modelcontextprotocol/sdk` tool registration with strict schemas for all 21+ filters
- [ ] `/api/mcp/route.ts` handling JSON-RPC requests (`tools/list`, `tools/call`, `resources/list`)
- [ ] Cryptographic signature verification middleware on `/api/mcp` rejecting expired timestamps, replayed nonces, or invalid signatures
- [ ] Credit metering: deduct 1 credit per filter, 3 credits per batch pipeline, and return `X-Agent-Credits-Remaining` header
- [ ] Non-fatal MCP error contract: return `{ isError: true, content: [{ type: "text", text: "..." }] }` on parameter failures with zero credit penalty
