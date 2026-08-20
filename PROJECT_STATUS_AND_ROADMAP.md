# ⚡ PIXELMESH: Project Status, Architectural Audit & Production SaaS Roadmap

## Executive Summary

**PixelMesh** is an AI Agent-First Image Tool Mesh and Cryptographic WebMCP Gateway. Unlike conventional web applications designed exclusively for human graphical interaction, PixelMesh treats autonomous AI agents as primary, first-class operators. Autonomous agents can generate asymmetric cryptographic keypairs (Ed25519/RSA), self-register without human credentials, sign HTTP request payloads, and execute a catalog of 22+ deterministic image manipulation tools via the Model Context Protocol (MCP JSON-RPC 2.0).

---

# Part 1: "Where Are We Right Now?" (Current Codebase Audit)

### 1.1 Architecture & Core Components Audit

| Component | Current Implementation | Status | Technical Detail |
| :--- | :--- | :--- | :--- |
| **Framework & Engine** | Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS | ✅ Operational | Unified full-stack app with native C++ `sharp` (libvips) image processing engine. |
| **Agent Authentication** | Asymmetric Cryptography (Ed25519 & RSA-2048) | ✅ Operational | `lib/auth/agent-crypto.ts`: Canonical signature string `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)` signed with agent private key. SHA256 key fingerprints (`SHA256:<base64url>`). |
| **Anti-Replay Defense** | Sliding-Window Nonce Cache | ⚠️ MVP Working (In-Memory) | `lib/auth/nonce-cache.ts`: In-memory `Map` verifying nonces within a 60-second rolling window and pruning every 30s. |
| **Key Persistence & Keyring** | File-backed JSON Store | ⚠️ MVP Working (Flat File) | `lib/auth/key-store.ts`: Reads/writes `.keys/authorized_keys.json`. Auto-provisions initial Dev Admin keypair (500 credits). |
| **Autonomous Self-Registration** | Zero-Human Onboarding | ✅ Operational | `POST /api/auth/register`: Verifies proof-of-ownership signature, assigns 100 free credits, and enrolls key into keyring. |
| **MCP Protocol Endpoint** | Streamable JSON-RPC 2.0 Endpoint | ✅ Operational | `POST /api/mcp`: Implements `tools/list`, `tools/call`, and `resources/list`. Handles key lookup, signature validation, scope enforcement, and credit billing. |
| **Image Tool Catalog** | 22+ Native Filter Tools | ✅ Operational | `lib/image/tools-catalog.ts` & `lib/image/engine.ts`: Geometry (Crop, Circle Crop, Flip, Rotate, Straighten), Exposure (Brightness, Lighten, Darken, Exposure, Contrast, Gamma), Color (Grayscale, B&W, Sepia, Invert, Hue, Saturation, Vibrance, HSL, Color Clip), Effects (Sharpen, Blur, Noise, Posterize, Glow), plus `batch_filter_pipeline` and `get_image_metadata`. |
| **Studio & Playground UI** | Precision Cyber Dark Interface | ✅ Operational | `components/studio/*`: 3-column layout (Sidebar, Canvas with interactive Before/After split slider & zoom/pan, Parameter Inspector, Pipeline DAG history, preset sample photos). |
| **Keyring & Telemetry UI** | Key Manager & Stream Inspector | ✅ Operational | `components/dashboard/*`: Table of registered keys, instant keypair generator modal, credit balance top-up, revocation, real-time telemetry stream auto-refreshing every 2.5s. |
| **Agent Integration Hub** | 1-Click Config Exporter | ✅ Operational | `components/dashboard/ConfigHub.tsx`: Ready-to-copy configs for Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`), and Python client scripts. |

---

### 1.2 Accepted Architectural Decision Records (ADRs)

1. **ADR 0001: SSH-Style Asymmetric Cryptographic Auth**: Replaced shared API keys with Ed25519/RSA signature verification over HTTP headers (`X-Agent-Key-Fingerprint`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`).
2. **ADR 0002: Base64 JSON-RPC Image Transport**: Inline Base64 Data URI strings for arguments and returns, eliminating external bucket dependencies for local development.
3. **ADR 0003: Unified Full-Stack Next.js 15 with Native Sharp**: Single codebase serving both headless MCP endpoints and human-in-the-loop dashboard.
4. **ADR 0004: Key Persistence, High-Res Limits & Format Preservation**: File-backed storage, 50MB payload threshold, and automatic source format preservation (JPEG/PNG/WebP).
5. **ADR 0005: Product Branding & Credit-Based Metering**: PixelMesh name and 1-credit standard, 3-credit batch pipeline, 5-credit high-res (>20MB) pricing policy with `X-Agent-Credits-Remaining` headers.
6. **ADR 0006: Autonomous Agent Cryptographic Self-Registration**: Machine-to-machine onboarding via signed proof-of-ownership request to `/api/auth/register` with 100 free credits.
7. **ADR 0007: MCP Tool Error Handling & Self-Correction Contract**: Defensive execution returning non-fatal `isError: true` with explanatory context so LLM agents can self-correct without losing credits.

---

### 1.3 Test Coverage & Verification

- `lib/auth/agent-crypto.test.ts`: Unit tests for Ed25519 keypair generation, fingerprint derivation, valid signature verification, and payload tampering detection.
- `lib/image/engine.test.ts`: Unit tests for bounding-box cropping, 90° rotation dimension swapping, sepia/brightness modulation, glow composite blending, and multi-step pipeline chaining.
- `lib/mcp/server.test.ts`: Verifies complete 22+ tool schema definitions, JSON-RPC invocation flow, and credit deduction.
- `lib/e2e.test.ts`: Full autonomous agent journey from registration to tool call, testing duplicate nonce rejection, tampered signatures, and balance exhaustion.
- `scripts/test-agent-client.ts`: Standalone client simulation script performing live autonomous onboarding and signed MCP tool execution.

---

### 1.4 Technical Debt & Current MVP Limitations

1. **Flat File Keyring (`.keys/authorized_keys.json`)**: No ACID transactional safety. Concurrent writes can corrupt the JSON file or cause lost updates during simultaneous credit deductions.
2. **In-Memory Nonce Cache (`nonce-cache.ts`)**: Replay attack cache is local to the Node.js process. In a distributed multi-instance deployment (e.g. AWS ECS / Kubernetes / Vercel), nonces are not shared across nodes and are wiped on process restart.
3. **In-Memory Telemetry Logs (`store.ts`)**: Capped at 100 in-memory entries; logs disappear on server reload and cannot be queried for historical analytics.
4. **Base64 Payload Memory Footprint**: Base64 encoding inflates raster payload sizes by ~33%. Processing multiple concurrent 20–50MB images inside the Next.js API process can block the Node.js event loop and cause out-of-memory (OOM) heap crashes.
5. **Simulated Billing & Sybil Attack Risk**: Credit recharges are simulated in the UI. Anyone can script `POST /api/auth/register` with newly generated keypairs to farm infinite free credits (Sybil vulnerability).
6. **Missing Distribution & Client SDK**: Agents must construct custom crypto-signing headers manually without an official npm package or MCP registry listing.

---

# Part 2: "Where Will We Go Next?" (Production SaaS Roadmap)

```
+----------------------------------------------------------------------------------------------------------------+
|                                     PIXELMESH PRODUCTION ROADMAP OVERVIEW                                      |
+----------------------------------------------------------------------------------------------------------------+
|  Phase 0: Repository Hygiene & Production Packaging (Strip Scratch Files, Professional README.md, .gitignore)  |
|  Phase 1: Persistence & Distributed State (PostgreSQL + Prisma, Redis Nonce/Rate-Limiter, Distributed Keyring) |
|  Phase 2: Dual-Audience Routing & High-Converting Landing Experience (Public Hero, Sandbox Demo, Auth Console)  |
|  Phase 3: Compute Offloading & Resilient Image Pipeline (BullMQ Queue, Ephemeral Workers, S3/R2 Pre-signed URLs)|
|  Phase 4: Monetization & Automated Billing (Stripe Webhooks, x402 / Web3 Micropayments, Usage Analytics)       |
|  Phase 5: Production Hardening, Sybil Defense & Observability (Turnstile, PoW Challenge, OTel/Sentry, Docker)  |
|  Phase 6: Ecosystem Distribution & Agent Starter Kits (MCP Registry, npx pixelmesh-agent, SDKs & Agent Rules) |
+----------------------------------------------------------------------------------------------------------------+
```

---

## Phase 0: Repository Hygiene, Documentation Sanitization & Clean Packaging

### Goal
Sanitize the repository for public/production release by removing internal AI scratch planning files, configuring strict `.gitignore` rules, and authoring a world-class, professional `README.md` for developers and AI agents discovering the project on GitHub.

### 0.1 Repository Sanitization & Git Hygiene
- Add all scratch/planning artifacts to `.gitignore` so internal brainstorming files do not pollute the public `main` branch:
  - `.scratch/`
  - `BRAINSTORM_IDEAS.md`
  - `PROJECT_STATUS_AND_ROADMAP.md`
- Remove existing untracked scratch artifacts from Git cache.

### 0.2 Author Production-Grade `README.md`
- Visual Architecture & Protocol diagrams (ASCII/Mermaid).
- Quickstart guide for developers connecting Claude Desktop, Cursor IDE, or Python/TypeScript agents.
- Complete 22+ MCP Image Filter tool reference table with parameters and cost tiers.
- Cryptographic authentication specification (`X-Agent-*` headers and canonical payload signing).
- Live local development and Docker deployment instructions.

---

## Phase 1: Persistence & Distributed State

### Goal
Replace local flat-file storage and in-memory caches with a production-grade relational database and distributed Redis cluster, enabling zero-downtime scaling across multiple server instances.

### 1.1 Database Architecture (PostgreSQL with Prisma / Drizzle)
- **Primary Entities**:
  - `AgentKey`: `id`, `fingerprint` (indexed unique), `agent_name`, `public_key_pem`, `algorithm`, `credits_balance` (BigInt/Decimal), `scopes` (text array), `status` (active/revoked), `user_id` (foreign key to Organization/User), `created_at`, `updated_at`, `last_used_at`.
  - `CreditTransaction`: `id`, `agent_key_id`, `amount`, `balance_after`, `type` (`FREE_GRANT`, `STRIPE_TOPUP`, `X402_MICROPAYMENT`, `TOOL_USAGE`), `reference_id` (Stripe charge ID / MCP request ID), `created_at`.
  - `AuditLog`: `id`, `agent_key_id`, `method`, `tool_name`, `status`, `latency_ms`, `cost_credits`, `ip_address`, `timestamp_drift_ms`, `error_message`, `created_at`.
  - `Organization` & `User`: Multi-tenant ownership of agent keyrings with team collaboration and RBAC.
- **Concurrency & Atomic Operations**:
  - Implement row-level locking (`SELECT ... FOR UPDATE`) or atomic conditional update queries:
    ```sql
    UPDATE agent_keys
    SET credits_balance = credits_balance - $1, total_invocations = total_invocations + 1, last_used_at = NOW()
    WHERE fingerprint = $2 AND status = 'active' AND credits_balance >= $1
    RETURNING credits_balance;
    ```

### 1.2 Distributed Anti-Replay Nonce Cache & Rate Limiting (Redis / Upstash)
- **Atomic Nonce Check**:
  - `SET pixelmesh:nonce:<uuid> <timestamp> EX 60 NX`
  - If Redis returns `null`, the request is instantly rejected as a replay.
- **Sliding-Window Rate Limiter**:
  - Redis sorted sets (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`) limiting calls per key fingerprint (e.g., 60 req/min for standard tiers, 600 req/min for enterprise).

### 1.3 Distributed Telemetry Streaming
- Replace local `telemetryStore` with **Redis Streams** (`XADD pixelmesh:stream:telemetry * ...`) or Pub/Sub.
- Expose a Server-Sent Events (SSE) route `/api/telemetry/stream` enabling live multi-client dashboard updates without short-polling.

---

## Phase 2: Dual-Audience Architecture & High-Converting Landing Experience

### Goal
Provide a distinct, optimized interface for human visitors (landing page, interactive sandbox demo, and authenticated developer console) while preserving the zero-human, zero-cookie headless cryptographic gateway for autonomous AI agents at `/api/mcp`.

```
                        🌐 Visitor arrives at pixelmesh.io
                                        |
                   +--------------------+--------------------+
                   |                                         |
            🤖 Headless Agent                        👤 Human Visitor
                   |                                         |
     (Sends HTTP to /api/mcp)                                v
                   |                               +-------------------+
                   |                               | High-Converting   |
                   |                               | Landing Page      |
                   v                               +---------+---------+
        [Zero-Human Crypto Gateway]                          |
                                                 +-----------+-----------+
                                                 |                       |
                                                 v                       v
                                        [Try Studio Sandbox]   [Login / Connect Agent]
                                        (Interactive Demo)     (Developer Dashboard)
```

### 2.1 Public High-Converting Landing Page (`/`)
- **Hero Section**: Distinct value proposition: *"The AI Agent-First Image Tool Mesh & Cryptographic WebMCP Gateway"*.
- **Interactive Live Preview Widget**: Embedded draggable Before/After slider demonstrating real-time Sharp filter compositing without requiring user login.
- **Agent Protocol Feature Breakdown**:
  - Visual graphic explaining SSH-style asymmetric authentication vs. leaky API keys.
  - Sub-50ms deterministic C++ libvips performance benchmarks.
  - 22+ Native Filter catalog showcase with categorized interactive cards.
- **Pricing & Credit Tier Grid**:
  - Free Starter (100 credits on key generation).
  - Dev Pack ($10 for 5,000 credits).
  - Production Pool ($49 for 30,000 credits).
  - Enterprise Cluster ($199 for 150,000 credits + dedicated queue).
- **Global Navigation & CTAs**:
  - `Connect Your Agent` (opens MCP Quickstart & Config Hub).
  - `Launch Studio Sandbox` (`/studio`).
  - `Developer Console` (`/dashboard`).

### 2.2 Unauthenticated Studio Sandbox (`/studio`)
- **Instant Human Playground**: Visitors can upload photos, test all 22+ filter tools, drag Before/After comparison sliders, and export high-res renders directly from the browser **without generating private keys or signing headers**.
- **Interactive Code Generator**: Real-time cURL, Python (`requests`), Node.js (`fetch`), and MCP JSON-RPC payload generator reflecting whatever tool/slider parameters the human adjusts in the UI.

### 2.3 Authenticated Developer Console (`/dashboard`)
- **Protected Multi-Tenant Workspace**: Authenticated via NextAuth / Clerk (GitHub, Google, or Magic Link).
- **Keyring & Agent Fleet Manager**: Manage multiple registered Agent Public Keys, generate local Ed25519 pairs, download `.pem` files, and set per-agent spending limits.
- **Billing & Stripe Top-up**: Real-time credit balance tracker, automated auto-refill rules, Stripe invoices.
- **Live Stream Inspector & APM**: Real-time WebSocket/SSE telemetry feed of incoming signed requests, latency graphs, and cryptographic verification audits.

---

## Phase 3: Compute Offloading & Resilient Image Pipeline

### Goal
Decouple compute-heavy image transformations from Next.js HTTP server threads to prevent memory exhaustion (OOM), optimize TTFB (Time-to-First-Byte), and scale worker nodes independently.

```
+---------------+      1. Get Upload URL     +--------------------+
|  Agent / Web  | -------------------------> |  Next.js API Gateway|
|    Client     | <------------------------- | (Auth & Metering)  |
+---------------+   2. S3 Pre-signed URL     +--------------------+
        |                                              |
        | 3. Upload Binary Payload                     | 4. Enqueue Job
        v                                              v
+--------------------+                       +--------------------+
| Cloudflare R2 / S3 |                       |   BullMQ / Redis   |
|   Object Storage   |                       |     Task Queue     |
+--------------------+                       +--------------------+
        ^                                              |
        | 5. Stream Raw Image                          | 6. Dequeue Job
        +------------------+     +---------------------+
                           |     |
                    +--------------------+
                    |  Dedicated Worker  |
                    |   (Sharp / libvips)|
                    +--------------------+
```

### 2.1 Asynchronous Background Queue Architecture (BullMQ + Redis)
- **Queue Structure**:
  - Priority queues for high-priority tiers (`queue:image-fast`, `queue:image-batch`).
  - Automatic retry with exponential backoff on transient memory limits.
- **Worker Clusters**:
  - Ephemeral worker pools running containerized Node.js/C++ libvips instances on Kubernetes or AWS ECS with memory cgroups and auto-scaling based on queue depth.

### 2.2 S3 / Cloudflare R2 Pre-Signed URL Transport
- For images > 2MB (and optional for smaller images):
  1. Agent requests upload slot: `POST /api/mcp/upload-url` -> returns S3 pre-signed `PUT` URL and `image_key`.
  2. Agent uploads binary directly to bucket (zero Node.js memory overhead).
  3. Agent calls `/api/mcp` passing `image_url` or `image_key` instead of raw Base64.
  4. Worker processes image using Sharp streams directly from bucket to bucket.
  5. Response returns a CDN edge URL (Cloudflare CDN / AWS CloudFront) with pre-configured TTL.
- **Backwards Compatibility**: Retain inline Base64 processing for small thumbnails (< 2MB) for instantaneous single-roundtrip execution.

---

## Phase 3: Monetization & Automated Billing

### Goal
Provide both human-friendly payment flows (Stripe) and agent-native autonomous micropayment protocols (x402 / Web3), enabling automatic revenue collection without manual credit management.

### 3.1 Stripe Checkout & Automated Webhook Infrastructure
- **Self-Service Credit Packages**:
  - Tier 1: $10 for 5,000 credits
  - Tier 2: $49 for 30,000 credits
  - Tier 3: $199 for 150,000 credits + Dedicated Queue
- **Stripe Webhook Gateway (`/api/webhooks/stripe`)**:
  - Validates `stripe-signature` header.
  - Handles `checkout.session.completed` and `invoice.payment_succeeded`.
  - Atomically credits the agent key / organization and records a ledger transaction in `CreditTransaction`.
  - Supports automated balance auto-refill triggers (e.g. automatically charge $20 whenever balance dips below 500 credits).

### 3.2 Machine-to-Machine Autonomous Micropayments (x402 / Web3)
- **HTTP 402 Payment Required Protocol**:
  - When an uncredited agent invokes `/api/mcp`, the server returns `402 Payment Required` with a payment invoice challenge in `WWW-Authenticate: L402` or `X-402-Payment-Required`.
- **Supported Payment Vectors**:
  - Lightning Network L402 (macaroons + Lightning invoice).
  - Web3 / USDC micropayment authorization headers (EIP-712 / Solana signed transfer proofs).
  - Agent settles invoice programmatically and retries tool call in milliseconds without human interaction.

### 3.3 Advanced Usage Metering & Velocity Dashboard
- Per-tool cost breakdown charts (e.g., Geometry vs. Composite Glow filters).
- Daily/weekly token and credit burn velocity graphs.
- Configurable webhook alerts (e.g., Slack/Discord alert when key balance falls below 10%).

---

## Phase 4: Production Hardening, Sybil Defense & Observability

### Goal
Harden authentication against automated credit-farming bots, introduce enterprise-grade distributed telemetry, and implement multi-stage Docker builds with CI/CD automation.

### 4.1 Sybil & Bot Defense for `/api/auth/register`
- **Tiered Registration Defense**:
  - **Browser / Human Flow**: Cloudflare Turnstile CAPTCHA verification required before granting 100 free credits.
  - **Autonomous Headless Flow**: Cryptographic **Proof-of-Work (PoW)** challenge (e.g., Hashcash / Argon2). Server sends a random salt and difficulty target (e.g., find `nonce` such that `SHA256(salt + nonce)` starts with 5 leading zeros). Legitimate agents compute this in ~200ms; botnets attempting to generate 100,000 keys face massive computational cost.
  - **IP/Subnet Limiting**: Maximum 3 agent registrations per `/24` subnet per 24 hours.

### 4.2 Enterprise Observability & Distributed APM
- **OpenTelemetry (OTel)**:
  - Distributed trace IDs propagated from HTTP request -> Signature verification -> Redis queue -> Image worker -> Storage.
  - Metrics exported to Prometheus / Grafana or Datadog (p50, p95, p99 image processing latency by filter tool).
- **Sentry Integration**:
  - Full exception capture with sanitization (stripping image buffers from error reports).
- **Structured Logging (Pino)**:
  - JSON logging with correlation IDs, fingerprint masks, and execution times.

### 4.3 Containerization & CI/CD Pipeline
- **Multi-Stage Production Dockerfile**:
  - Stage 1: Dependency resolution (`node:22-alpine` with `sharp` native glibc/musl prebuilds).
  - Stage 2: Next.js standalone build (`output: "standalone"`).
  - Stage 3: Minimal runtime container (< 180MB) running as non-root `nextjs` user.
- **GitHub Actions CI/CD**:
  - Linting (`eslint`), TypeScript typechecking (`tsc --noEmit`).
  - Unit and integration testing (`node --test`).
  - Container vulnerability scan (Trivy).
  - Automated deployment to staging/production clusters.

---

## Phase 5: Ecosystem Distribution & Agent Starter Kits

### Goal
Drive ecosystem adoption by publishing PixelMesh to official MCP registries, releasing an npm CLI and client SDKs, and providing drop-in rules for major agent platforms.

### 5.1 Official Model Context Protocol Registry Listing
- Publish PixelMesh manifest to the official Model Context Protocol server catalog with validated schema definitions and live capability endpoints (`pixelmesh://capabilities/filters`).

### 5.2 Official CLI & Client SDKs
- **npm CLI (`npx pixelmesh-agent`)**:
  ```bash
  npx pixelmesh-agent init
  # Generates local Ed25519 keypair, self-registers to PixelMesh, and outputs config files
  npx pixelmesh-agent run --tool adjust_brightness --image ./photo.jpg --factor 30
  ```
- **TypeScript / JavaScript SDK (`@pixelmesh/client`)**:
  ```typescript
  import { PixelMeshClient } from "@pixelmesh/client";
  const client = new PixelMeshClient({ privateKeyPem: process.env.PIXELMESH_KEY });
  const result = await client.execute("glow_effect", { image: buffer, intensity: 50 });
  ```
- **Python SDK (`pixelmesh`)**:
  ```python
  from pixelmesh import PixelMeshClient
  client = PixelMeshClient(private_key_path="./agent_key.pem")
  result = client.crop_image(image_bytes, width=400, height=400)
  ```

### 6.3 Agent Starter Kits & One-Click Rules
- **Cursor IDE (`.cursorrules` & `.cursor/mcp.json`)**: Pre-configured prompt rules instructing Cursor Agent on when to invoke PixelMesh for UI asset generation and image processing.
- **Claude Desktop & Anthropic Tool Use**: Ready-to-paste tool definitions and instructions.
- **LangChain / CrewAI / AutoGen Toolkits**: Official tool wrappers (`PixelMeshTool` for LangChain Python/JS).

---

# Summary Comparison: MVP vs. Production Roadmap

| Capability | Current MVP State | Production Target (Phases 1-6) |
| :--- | :--- | :--- |
| **Data Persistence** | Flat JSON file (`.keys/authorized_keys.json`) | PostgreSQL with Prisma / Drizzle + ACID transactions |
| **Anti-Replay Cache** | In-memory single-process `Map` | Distributed Redis Cluster with 60s auto-expiry |
| **Human vs. Agent UX**| Shared raw dashboard on root (`/`) | High-converting Landing Page (`/`) + Public Studio Sandbox (`/studio`) + Auth Console (`/dashboard`) |
| **Image Compute** | Synchronous inside Next.js API thread | Ephemeral worker pool powered by BullMQ & Redis queues |
| **Payload Transport** | In-line Base64 strings in JSON-RPC | Direct Cloudflare R2 / S3 pre-signed URL binary streaming |
| **Monetization** | Simulated dashboard top-up buttons | Stripe Checkout / Webhooks + x402 / Web3 micropayments |
| **Bot Defense** | Unthrottled `/api/auth/register` | Cloudflare Turnstile (Web) + PoW Challenge & IP limits (Agent) |
| **Telemetry & APM** | 100 in-memory entries | Redis Streams SSE + OpenTelemetry + Sentry + Grafana |
| **Deployment** | Local `npm run dev` | Multi-stage Docker + GitHub Actions CI/CD |
| **Developer DX** | Manual HTTP script | `npx pixelmesh-agent` CLI + `@pixelmesh/client` SDK + MCP Registry |
