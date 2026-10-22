# PixelMesh Technical Roadmap

This document outlines the architectural milestones, completed initiatives, and future technical objectives for **PixelMesh**.

---

## 🏆 Completed Milestones

### Phase 1: Cryptographic Authentication & Native Image Engine (v0.1)
- [x] Asymmetric HTTP request signing (`Ed25519` / `RSA-2048`) with `X-Agent-Signature`.
- [x] Canonical signing format with SHA-256 body hashing and ±60s timestamp drift boundaries.
- [x] Sub-millisecond C++ `sharp` (libvips) manipulation engine supporting 22+ filters.
- [x] Machine-first autonomous onboarding via `POST /api/auth/register` with free credit grant.

### Phase 2: Dual-Audience Studio & Developer Console (v0.2)
- [x] Web Studio Sandbox (`/studio`) with interactive Before/After split comparison slider.
- [x] Developer Dashboard (`/dashboard`) with dynamic keyring manager and real-time telemetry stream.
- [x] Config Hub exporting drop-in configuration for Claude Desktop, Cursor, Python, and Node.js.
- [x] High-performance canvas state machine with zero aspect-ratio drift during rectangular crops.

### Phase 3: Distributed Infrastructure & Compute Offloading (v0.3)
- [x] PostgreSQL persistence with Prisma ORM and Redis sliding-window rate limiting.
- [x] BullMQ asynchronous worker queues for long-running batch transformation pipelines.
- [x] S3/Cloudflare R2 storage adapters with presigned upload/download URLs.
- [x] 420+ automated unit, fuzzing, and adversarial stress tests.

### Phase 4: WebMCP Challenge & Client-Side Model Context (v1.0)
- [x] Imperative tool registration on `document.modelContext` adhering to the W3C WebMCP draft specification.
- [x] 8 granular visual canvas manipulation tools (`crop_canvas`, `apply_filter`, `build_filter_pipeline`, etc.).
- [x] Declarative DOM `<form>` fallback for crawlers and declarative browser agents.
- [x] In-browser WebMCP Co-Pilot DevTools simulator drawer.
- [x] Production deployment at `https://pixel-mesh-iota.vercel.app/studio`.

### Phase 5: Inbound GitHub App & Webhook Ingestion Gateway (v1.1)
- [x] Fail-closed webhook receiver at `POST /api/webhooks/github` and discovery at `GET /api/webhooks/github`.
- [x] Constant-time HMAC-SHA256 signature verification (`crypto.timingSafeEqual`).
- [x] Delivery deduplication cache with 24-hour Redis TTL to eliminate replay attacks.
- [x] Formalized in [ADR 0008: GitHub App & Webhook Inbound Integration](adr/0008-github-app-webhook-integration.md).

---

## 🎯 Current Focus: Developer Experience & Governance

- [x] Add open-source contributor guidelines ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- [x] Establish security policy and cryptographic key rotation policy ([`SECURITY.md`](../SECURITY.md)).
- [ ] Author end-to-end GitHub App and Webhook developer integration guide (`docs/webhooks-guide.md`).
- [ ] Add deployment and environment troubleshooting runbook (`docs/troubleshooting.md`).
- [ ] Consolidate full REST, JSON-RPC, and WebMCP API reference index (`docs/api-reference.md`).

---

## 🚀 Upcoming Roadmap (Q4 2026 – Q1 2027)

### Milestone 6: WebGPU Client-Side Transformation Node
- Shift standard raster operations (e.g. sepia, contrast, invert, gamma) to client-side WebGPU compute shaders.
- Enable zero-latency instant canvas previews before committing to the server-side Sharp pipeline.
- Maintain seamless fallback to WebMCP server execution when WebGPU is unavailable.

### Milestone 7: Semantic Multi-Agent Creative Pipelines
- Natural language intent compiler mapping descriptive creative prompts (*"Apply moody Nordic cinematic color grading"*) into multi-step parameter DAGs.
- Collaborative review protocol: AI agent proposes candidate pipelines with split slider comparisons, human approves or alters via UI.

### Milestone 8: Enterprise Team Keyrings & Quotas
- Multi-user organization support with role-based access control (RBAC).
- Team-level credit pooling and per-agent usage ceilings.
- Granular tool permissions allowing restriction of destructive or expensive high-res tools per agent key.
