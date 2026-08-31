# 04: Live Signature Inspector & Claude/Cursor MCP Configuration Hub

**What to build:**
A real-time telemetry and auditing tab in the dashboard showing incoming cryptographic requests to `/api/mcp` alongside a 1-click configuration exporter for connecting Claude Desktop, Cursor, and Antigravity agents.

**Blocked by:** 03 (Authenticated WebMCP Streamable Endpoint & Credit Metering)

**Status:** ready-for-agent

- [ ] Live Request Inspector tab streaming real-time request audits (Agent Fingerprint, Method, Timestamp Drift, Nonce, Signature Status, Latency)
- [ ] Expandable raw JSON-RPC inspector showing exact tool arguments and execution telemetry
- [ ] Connect Agent Modal / Hub with 1-click copyable config snippets for `claude_desktop_config.json`, `.cursor/mcp.json`, and Python/Node MCP clients
- [ ] Simulated agent signed request runner in the UI playground allowing users to pick an agent key and test signing headers directly from the browser
