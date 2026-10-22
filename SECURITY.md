# Security Policy

The PixelMesh project takes security seriously. As a tool mesh executing native image processing and cryptographic request verification for autonomous AI agents, security and tamper-resistance are foundational to our architecture.

---

## 🛡️ Supported Versions

We actively support and release security fixes for the following versions:

| Version | Supported | Notes |
| :--- | :--- | :--- |
| `1.0.x` (current) | ✅ Yes | Active development and production release |
| `< 1.0.0` | ❌ No | Deprecated development prototypes |

---

## 🔒 Cryptographic Architecture & Security Model

PixelMesh is designed with an **agent-first, zero-shared-secrets** security posture:

1. **Asymmetric HTTP Request Signatures**:
   - Rejects bearer tokens and shared static secrets.
   - All protected agent requests require Ed25519 or RSA-2048 signatures over canonical request headers (`METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)`).
   - Validated against public key fingerprints (`X-Agent-Key-Fingerprint`).

2. **Anti-Replay Nonce Cache & Clock Drift Defense**:
   - Enforces a strict timestamp freshness window of ±60 seconds.
   - Nonce values (`X-Agent-Nonce`) are verified and recorded atomically in Redis with tenant isolation. Duplicate nonces within the valid drift window are immediately rejected with HTTP `401 Unauthorized`.

3. **Inbound Webhook Verification**:
   - Webhook endpoints (`/api/webhooks/github`) enforce constant-time HMAC-SHA256 verification using `crypto.timingSafeEqual` against the raw byte payload.
   - Incoming `X-GitHub-Delivery` GUIDs are cached for 24 hours to prevent replay attacks and duplicate event executions.

4. **Fail-Closed Execution & Zero-Loss Billing Invariant**:
   - If an operation fails parameter validation, encounters a pipeline exception, or exhausts worker retries, 0 credits are deducted.
   - In case of database or Redis unavailability, the system fails closed rather than allowing unauthenticated or unmetered executions.

---

## 🔑 Agent Key Rotation Guidelines

If you suspect an agent's private key has been exposed or compromised:

1. **Immediate Revocation**:
   - Navigate to `/dashboard` and click **Revoke Key** next to the compromised key fingerprint, or submit a signed revocation request to `/api/auth/keys`.
2. **Keypair Regeneration**:
   - Generate a fresh Ed25519 keypair and register the new public key via `/api/auth/register`.
3. **Audit Inspection**:
   - Review `/dashboard` telemetry logs for any unauthorized invocations using the revoked key's fingerprint.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or potential threat in PixelMesh:

1. **Do not create a public issue.**
2. Send an email to the security team with details of the vulnerability:
   - **Primary Contact**: Rohit Waghire (`waghirerohit91@gmail.com`)
   - **Subject**: `[SECURITY] PixelMesh Vulnerability Report - <Summary>`
3. Please include:
   - A clear description of the issue.
   - Steps to reproduce or proof-of-concept payload.
   - Potential impact and affected components.
4. We acknowledge receipt within **24 hours** and aim to provide a remediation plan within **72 hours**.
