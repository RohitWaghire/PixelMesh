# ADR 0008: GitHub App & Webhook Inbound Integration Architecture

## Status
Accepted

## Context
PixelMesh integrates with autonomous agents, GitHub Actions, and custom GitHub Apps (such as code review bots, automated PR visual QA agents, and deployment orchestrators). To support automated GitHub workflows, PixelMesh needs an enterprise-grade inbound webhook ingestion gateway that is secure against timing attacks, resilient to replay attacks, and idempotent under network retries.

## Decision
We implement a dedicated, fail-closed webhook gateway at `/api/webhooks/github` governed by three core architectural principles:

1. **Constant-Time Cryptographic HMAC Verification**:
   - Every incoming request must provide an `X-Hub-Signature-256` header formatted as `sha256=<hex_digest>`.
   - The digest is validated using `crypto.timingSafeEqual` over fixed-length buffers derived from `crypto.createHmac("sha256", secret).update(rawBody)`.
   - Missing secrets, malformed prefixes, or mismatched lengths fail closed immediately with HTTP 401/400.

2. **Delivery Idempotency & Replay Protection**:
   - Inbound requests must supply a unique `X-GitHub-Delivery` GUID.
   - Deliveries are tracked atomically in Redis (`SET pixelmesh:webhook:delivery:<uuid> <event> EX 86400 NX`) with an in-memory fallback store.
   - Duplicate deliveries within the 24-hour TTL window are acknowledged with HTTP 200 `{ status: "duplicate" }` but are not re-executed by downstream event handlers.

3. **Decoupled Event Dispatching & Audit Observability**:
   - The route handler delegates business logic to `WebhookDispatcher`, which routes events by type (`ping`, `pull_request`, `issue_comment`, `check_run`, etc.) to registered asynchronous handlers.
   - All inbound delivery attempts (successful, duplicate, or rejected) are recorded in the `TelemetryStore` for audit tracking and observability.

## Consequences
- **Positive**: Eliminates timing-attack vulnerabilities; guarantees idempotency during GitHub retry storms; transparently logs delivery metrics; integrates seamlessly with GitHub Apps and Greptile review workflows.
- **Trade-off**: Requires raw body preservation during Next.js App Router request handling before JSON parsing.
