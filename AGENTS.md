# PixelMesh Project Agent Operating Rules

### Project Overview & Architecture
PixelMesh is an AI Agent-First image tool mesh and cryptographic WebMCP gateway with 22+ native Sharp image processing tools, BullMQ asynchronous compute offloading, S3/Cloudflare R2 object storage transport, and zero-human autonomous registration.

- **Stack**: Next.js 15 (App Router), React 19, TypeScript, Sharp (libvips), Prisma ORM (PostgreSQL), Redis (Upstash / ioredis), BullMQ, AWS S3 / Cloudflare R2 SDK.
- **Working Directory**: `Web MCP App/`

### Build & Verification Commands
- **Run Tests**: `npm test` (uses `--test-concurrency=1` due to shared mock state).
- **Run Build**: `npm run build` (verifies Next.js compilation across all static and dynamic routes).
- **Database Seed**: `npm run prisma:seed` (provisions default dev organization and test keys).

### Security & Protocol Invariants
1. **Zero-Knowledge Private Keys**: The server strictly never stores, transmits, or exposes agent private keys (`privateKeyPem`). Private keys are held exclusively by agent clients.
2. **Fail-Closed Asymmetric Auth**: Every mutating or compute request requires valid `X-Agent-Key-Fingerprint`, `X-Agent-Timestamp`, `X-Agent-Nonce`, and `X-Agent-Signature` headers with clock drift $\le$60s.
3. **Atomic Billing & Zero-Loss**: Deduct credits only upon successful tool or job completion. Failed operations, syntax errors (`isError: true`), or cancelled jobs must deduct 0 credits.
4. **Anti-Replay Defense**: Single-use UUIDv4 nonces verified against atomic Redis cache (`SET EX 60 NX`).

### Key Endpoints & Routing
- `POST /api/auth/register`: Autonomous agent self-enrollment via signed proof-of-possession (grants 100 starter credits).
- `GET /api/auth/keys`: Public key registry and metadata query (strictly 0 private keys returned).
- `POST /api/mcp`: Synchronous MCP JSON-RPC 2.0 endpoint (`tools/list`, `tools/call`, `resources/list`).
- `POST /api/mcp/jobs`: Asynchronous compute task submission for heavy image pipelines.
- `GET /api/mcp/jobs/[id]` & `/stream`: Job status polling and Server-Sent Events (SSE) progress streams.
- `POST /api/mcp/upload-url`: Direct-to-storage pre-signed PUT URL generation for large image payloads.

### Context Pointers
- **Domain Terminology**: See [CONTEXT.md](file:///d:/Antigravity/Web%20MCP%20App/CONTEXT.md).
- **Project Status & Roadmap**: See [PROJECT_STATUS_AND_ROADMAP.md](file:///d:/Antigravity/Web%20MCP%20App/PROJECT_STATUS_AND_ROADMAP.md).

