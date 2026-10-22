# PixelMesh Documentation Portal

Welcome to the technical documentation repository for **PixelMesh**. Below is the complete index of guides, specifications, and architecture decisions.

---

## 📚 Guides & Specifications

- **[Autonomous Agent Quickstart](agent-quickstart.md)**: Zero-human machine self-enrollment, Ed25519 keypair generation, and request signing in TypeScript and Python.
- **[API Reference Index](api-reference.md)**: Consolidated specification for REST endpoints, MCP JSON-RPC 2.0 tools, and client-side WebMCP schemas.
- **[GitHub App & Webhooks Guide](webhooks-guide.md)**: Inbound webhook gateway, HMAC-SHA256 signature verification, and delivery idempotency.
- **[Troubleshooting & Diagnostics](troubleshooting.md)**: Solutions for Sharp native compilation, NTP clock skew, Chrome 149+ WebMCP flags, and Redis fallbacks.
- **[Technical Roadmap](roadmap.md)**: Maintained delivery sequence across completed phases and upcoming milestones.
- **[Design Contract](design-contract.md)**: UI and interaction specifications for the Web Studio canvas.
- **[WebMCP Challenge Submission](webmcp-challenge.md)**: Submission record and judge verification runbook.

---

## 🛡️ Governance & Security

- **[Security Policy](../SECURITY.md)**: Supported versions, cryptographic invariants, key rotation steps, and vulnerability disclosure contacts.
- **[Contributor Guidelines](../CONTRIBUTING.md)**: Local development setup, code quality gates (`test`, `typecheck`, `lint`), and PR conventions.

---

## 🏛️ Architectural Decision Records (ADRs)

Review our accepted architectural decision records in [`docs/adr/`](adr/):
- **[ADR 0001: SSH-Style Asymmetric Auth](adr/0001-agent-key-asymmetric-auth.md)**
- **[ADR 0002: Base64 JSON-RPC Image Transport](adr/0002-base64-jsonrpc-image-transport.md)**
- **[ADR 0003: Unified Next.js Sharp Engine](adr/0003-unified-nextjs-sharp-engine.md)**
- **[ADR 0004: Persistence Limits & Formats](adr/0004-persistence-limits-formats.md)**
- **[ADR 0005: Branding & Credit Metering](adr/0005-pixelmesh-branding-and-monetization.md)**
- **[ADR 0006: Autonomous Agent Registration](adr/0006-autonomous-agent-registration.md)**
- **[ADR 0007: MCP Tool Error Handling Contract](adr/0007-mcp-tool-error-handling.md)**
- **[ADR 0008: GitHub App & Webhook Inbound Integration](adr/0008-github-app-webhook-integration.md)**
