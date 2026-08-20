# Domain Context: WebMCP Image Studio

## Domain Terms

### Agent Key
An asymmetric cryptographic keypair (specifically Ed25519 or RSA-2048) uniquely identifying an autonomous AI agent. The **Public Key** is registered in the WebMCP server keyring, while the **Private Key** is held exclusively by the agent to cryptographically sign HTTP request payloads.

### Key Fingerprint
A unique, canonical SHA-256 digest of an Agent Public Key (format: `SHA256:<hex/base64>`) used in request headers (`X-Agent-Key-Fingerprint`) to identify the calling agent without transmitting the full public key on every request.

### Signed Request Nonce
A single-use UUIDv4 or random cryptographic nonce generated per request (`X-Agent-Nonce`), checked against an anti-replay cache within a rolling time window (e.g., 60 seconds) to prevent replay attacks.

### Filter Tool
A discrete, standardized image transformation capability exposed via Model Context Protocol (MCP) tool schema (e.g., `adjust_brightness`, `crop_image`, `circle_crop`, `make_sepia_tone`). Each filter accepts parameter arguments and a Base64-encoded image, performing deterministic pixel manipulations.

### Filter Pipeline
An ordered, sequential Directed Acyclic Graph (DAG) or chain of multiple Filter Tools applied progressively to an image (e.g., `[Circle Crop] -> [Exposure +1.5] -> [Glow Effect]`).

### Scope
A permission boundary associated with an Agent Key restricting which Filter Tools or administrative operations the agent is allowed to invoke (e.g., `all-tools`, `filters:*`, `geometry:*`, `export-only`).

### Credit Balance & Metering
The remaining processing credits allocated to an Agent Key. Each tool call decrements this balance (1 credit for standard filters, 3 for batch/composite pipelines). Execution is blocked with JSON-RPC error `-32002` if the balance is exhausted.

### Autonomous Self-Registration
The machine-to-machine onboarding process where an AI agent registers its public key at `/api/auth/register` using a cryptographic proof-of-ownership signature, instantly receiving its initial 100 free credits with zero human email/password forms required.

### Tool Execution Error (`isError: true`)
A non-fatal, context-preserving error response adhering to the MCP standard that explains why an operation failed (e.g., parameter out of bounds) without breaking the JSON-RPC session, allowing the LLM agent to autonomously self-correct and retry without losing credits.

### Playground
The integrated human-in-the-loop interactive workspace in the web dashboard where users can upload images, manually test or chain filter tools, compare before/after visual results, and inspect live agent execution logs.
