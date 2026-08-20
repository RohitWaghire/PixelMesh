# ADR 0001: SSH-Style Asymmetric Cryptographic Authentication for AI Agents

## Status
Accepted

## Context
Standard web APIs and MCP endpoints typically authenticate via shared secret tokens (Bearer API keys) or basic user sessions. However, in an autonomous multi-agent environment where agents interact programmatically across network boundaries:
1. Shared API keys carry high blast radius if intercepted or leaked in logs.
2. Traditional user passwords/sessions are poorly suited for headless machine-to-machine interactions.
3. We require zero-trust cryptographic proof of agent identity with anti-replay guarantees.

## Decision
We adopt SSH-style public/private key asymmetric cryptography (Ed25519 as primary, RSA as fallback) for agent authentication:
- Agents register their **Public Key** with assigned scopes in the server's keyring.
- Every HTTP request to `/api/mcp` is cryptographically signed by the agent's **Private Key** using canonical headers:
  - `X-Agent-Key-Fingerprint`: SHA256 digest of the agent public key
  - `X-Agent-Timestamp`: Current UTC epoch in seconds (rejecting drift > 60s)
  - `X-Agent-Nonce`: Unique UUIDv4 per request
  - `X-Agent-Signature`: Base64 signature of `METHOD + PATH + TIMESTAMP + NONCE + SHA256(BODY)`
- The server validates the signature and checks the nonce against a sliding-window replay cache before tool execution.

## Consequences
- **Positive**: Zero shared secrets over the wire; tamper-proof payloads; built-in replay protection; instant key revocation without resetting passwords.
- **Trade-off**: Requires external agents to implement cryptographic signing headers (provided via helper SDK/script).
