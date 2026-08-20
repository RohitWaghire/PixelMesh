# ADR 0006: Autonomous Agent Cryptographic Self-Registration (Zero-Human Login)

## Status
Accepted

## Context
PixelMesh is designed as a pure **Agent-First** infrastructure platform. Requiring traditional human credentials (email/password/OAuth) creates unnecessary friction for autonomous agents discovering and consuming tools over the wire.

## Decision
We implement a **Pure Autonomous Cryptographic Registration Flow**:
1. **Agent Self-Enrollment**: An agent generates its own Ed25519 or RSA keypair locally.
2. **Proof-of-Ownership Knock**: The agent sends a POST request to `/api/auth/register` with:
   - `public_key`: The raw PEM/base64 public key.
   - `agent_name`: A descriptive string (e.g., `Claude-Design-Worker-1`).
   - `signature`: A cryptographic signature of the registration payload (`agent_name + timestamp`) using its private key (proving it possesses the private key).
3. **Instant Credit Grant**: The server verifies the signature, calculates the `SHA256` key fingerprint, assigns the default **100 free credits**, and writes the record to `.keys/authorized_keys.json`.
4. **Immediate Tool Access**: The response returns the server's MCP capabilities, endpoint URL, and remaining balance. The agent can immediately start executing tools via `/api/mcp`.

## Consequences
- **Positive**: 100% agent-native onboarding with zero human intervention, passwords, or emails.
- **Trade-off**: IP-based rate-limiting is enforced on `/api/auth/register` to prevent Sybil credit-farming.
