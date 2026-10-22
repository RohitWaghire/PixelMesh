# GitHub App & Webhook Integration Guide

This guide provides technical instructions for configuring, verifying, and testing inbound GitHub App webhooks with **PixelMesh**.

---

## 🧭 Overview

PixelMesh includes an enterprise-grade inbound webhook ingestion gateway at:
- **Receiver Endpoint**: `POST /api/webhooks/github`
- **Health & Discovery Endpoint**: `GET /api/webhooks/github`

The gateway allows custom GitHub Apps, CI/CD pipelines, and autonomous PR code review bots (such as Greptile or visual regression agents) to trigger image operations, listen for pull request updates, and log activity into PixelMesh's relational audit telemetry.

---

## ⚙️ Configuring Your GitHub App / Webhook

When configuring a Webhook or GitHub App in GitHub's Developer Settings:

| Setting | Value |
| :--- | :--- |
| **Payload URL** | `https://<your-pixelmesh-domain>/api/webhooks/github` |
| **Content type** | `application/json` |
| **Secret** | A strong, random string (e.g., generated with `openssl rand -hex 32`) |
| **SSL verification** | Enable SSL verification (recommended) |
| **Events** | Select `Pull requests`, `Issue comments`, `Check runs`, `Workflow runs` |

### Environment Configuration
Ensure your PixelMesh server environment has the shared webhook secret set:
```env
GITHUB_WEBHOOK_SECRET=your_configured_webhook_secret_here
```

---

## 🔐 Cryptographic Authentication (HMAC-SHA256)

GitHub sends a signature header with every delivery:
```http
X-Hub-Signature-256: sha256=<hex_digest>
```

### Signature Computation
PixelMesh validates the signature using constant-time buffer comparison to eliminate side-channel timing attacks:
```typescript
import crypto from "node:crypto";

function computeSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(Buffer.from(payload, "utf8"));
  return `sha256=${hmac.digest("hex")}`;
}
```

### Verification Rules
- If `X-Hub-Signature-256` is missing: **`401 Unauthorized`**
- If header prefix is not `sha256=`: **`400 Bad Request`**
- If HMAC digest does not match: **`401 Unauthorized`**
- If `GITHUB_WEBHOOK_SECRET` is unset: **`500 Internal Server Error`**

---

## 🛡️ Delivery Idempotency & Replay Defense

Every GitHub delivery includes a unique UUID:
```http
X-GitHub-Delivery: 72d3162e-cc78-11e3-81ab-4c9367dc0958
```

- PixelMesh stores delivery identifiers in Redis (`SET pixelmesh:webhook:delivery:<uuid> <event> EX 86400 NX`).
- If GitHub retries a delivery due to network latency, the duplicate request is safely acknowledged with HTTP `200 OK` (`status: "duplicate"`), preventing duplicate side effects.

---

## 📦 Supported Events

| Event Name (`X-GitHub-Event`) | Description | Gateway Handling |
| :--- | :--- | :--- |
| `ping` | Initial connection handshake from GitHub | Returns `200 OK` with PONG message and Zen quote |
| `pull_request` | PR opened, synchronized, merged, closed | Dispatches to handlers, logs to audit store |
| `issue_comment` | New comment on issue or pull request | Extracts comment body, mentions, and author |
| `check_run` | CI/CD check run status changes | Captures test run conclusions and commit SHA |
| `workflow_run` | GitHub Actions workflow execution | Tracks pipeline success/failure lifecycle |

---

## 🧪 Testing Locally

### 1. Gateway Health Check
You can verify the gateway is online and discover supported events:
```bash
curl -X GET http://localhost:3000/api/webhooks/github
```

**Expected Response**:
```json
{
  "status": "healthy",
  "gateway": "PixelMesh GitHub App Webhook Gateway",
  "configured": true,
  "supportedEvents": ["ping", "pull_request", "pull_request_review", "issue_comment", "check_run", "check_suite", "workflow_run", "installation"],
  "version": "1.0.0",
  "timestamp": "2026-10-22T07:00:00.000Z"
}
```

### 2. Simulating a Signed Ping Delivery
```bash
SECRET="your_configured_webhook_secret_here"
PAYLOAD='{"zen":"Keep it logically awesome.","hook_id":12345678}'
SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"

curl -X POST http://localhost:3000/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: $(uuidgen)" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -d "$PAYLOAD"
```

---

## 📚 Related Documentation
- [ADR 0008: GitHub App & Webhook Inbound Integration](adr/0008-github-app-webhook-integration.md)
- [Security Policy](../SECURITY.md)
- [Contributor Guide](../CONTRIBUTING.md)
