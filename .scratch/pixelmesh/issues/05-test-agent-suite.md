# 05: Standalone Agent Test Runner & End-to-End Verification Suite

**What to build:**
A standalone client script and test suite verifying the complete agent journey from key generation to multi-step tool execution against the live server.

**Blocked by:** 04 (Live Signature Inspector & Claude/Cursor MCP Configuration Hub)

**Status:** resolved

- [x] Executable test runner script (`scripts/test-agent-client.ts`) demonstrating autonomous Ed25519 key generation, self-registration at `/api/auth/register`, header signing, and `/api/mcp` tool execution
- [x] End-to-end integration tests verifying:
  - Correct filter image output bytes and dimensions
  - Signature tampering rejection (`-32001 Unauthorized Signature`)
  - Timestamp drift rejection (> 60s)
  - Nonce replay rejection
  - Credit exhaustion rejection (`-32002 Insufficient Credits`)
- [x] Verification of local server build (`npm run build` and `npm run dev`)
