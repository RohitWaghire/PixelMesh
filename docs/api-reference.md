# PixelMesh API Reference Index

This document provides a comprehensive technical index of all HTTP REST routes, MCP JSON-RPC protocol interfaces, and client-side WebMCP tools exposed by **PixelMesh**.

---

## 🧭 Interface Overview

| Interface Layer | Protocol / Transport | Purpose | Target Audience |
| :--- | :--- | :--- | :--- |
| **MCP Server** | JSON-RPC 2.0 over HTTP (`POST /api/mcp`) | Headless, programmatic image manipulation tools | Autonomous agents (Claude, Cursor, Python) |
| **WebMCP Studio** | W3C Draft (`document.modelContext`) | In-browser live canvas co-creation and inspection | In-app browser agents (ChatGPT, Chrome 149+) |
| **REST Management** | HTTPS REST JSON | Machine registration, key management, upload URLs | Agent orchestrators & dev console |
| **Inbound Webhooks** | HTTPS POST with HMAC (`/api/webhooks/github`) | Asynchronous event notifications from GitHub Apps | GitHub Apps, Greptile, CI/CD runners |
| **Agent Manifests** | Static Markdown (`/llms.txt`, `/docs.md`) | Autonomous zero-shot discovery and tool catalog | Web crawlers & LLM indexers |

---

## 🔐 1. Cryptographic Authentication Protocol

All requests to protected backend routes (`/api/mcp`, `/api/auth/keys`, `/api/mcp/upload-url`, `/api/telemetry/logs`) require four HTTP headers:

```http
X-Agent-Key-Fingerprint: SHA256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
X-Agent-Timestamp: 1740001234
X-Agent-Nonce: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
X-Agent-Signature: k8Z7...==
```

### Canonical Signing Format
The signature is generated across the newline-separated UTF-8 string:
```
METHOD\n
PATH\n
TIMESTAMP\n
NONCE\n
SHA256(REQUEST_BODY)
```

---

## 🌐 2. REST Management Endpoints

### Autonomous Agent Registration
`POST /api/auth/register`
- **Auth**: None (Self-enrollment).
- **Body**: `{ "publicKeyPem": "...", "agentName": "MyAgent" }`
- **Response**: `{ "fingerprint": "SHA256:...", "agentName": "...", "credits": 100 }`

### Keyring Management
`GET /api/auth/keys` | `POST /api/auth/keys`
- **Auth**: Signed request.
- **Actions**: Query registered keys, add secondary public keys, or revoke compromised keys.

### Presigned Storage Upload URL
`POST /api/mcp/upload-url`
- **Auth**: Signed request.
- **Body**: `{ "filename": "input.png", "contentType": "image/png", "fileSizeBytes": 15000000 }`
- **Response**: `{ "uploadUrl": "https://...", "storageKey": "uploads/...", "expiresInSeconds": 900 }`

### Inbound GitHub Webhook Gateway
`POST /api/webhooks/github` | `GET /api/webhooks/github`
- **Auth**: `X-Hub-Signature-256` matching `GITHUB_WEBHOOK_SECRET`.
- **Headers**: `X-GitHub-Event`, `X-GitHub-Delivery`.
- **Response**: `{ "received": true, "event": "...", "status": "processed" }`

---

## 🤖 3. MCP JSON-RPC 2.0 Server (`POST /api/mcp`)

### List Available Tools
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/list"
}
```

### Execute Image Tool
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "crop_image",
    "arguments": {
      "image": "data:image/png;base64,...",
      "left": 0,
      "top": 0,
      "width": 500,
      "height": 500
    }
  }
}
```

### Core Image Tool Catalog (22+ Tools)
- **Geometry**: `crop_image`, `circle_crop`, `rotate_image`, `flip_image`, `straighten_photo`
- **Color & Exposure**: `adjust_brightness`, `change_exposure`, `adjust_contrast`, `adjust_gamma`, `grayscale_image`, `make_sepia_tone`, `invert_image`, `adjust_hue`, `adjust_saturation`, `adjust_vibrance`, `adjust_hsl`, `clip_photo`
- **Effects**: `sharpen_image`, `blur_image`, `noise_effect`, `posterize_effect`, `glow_effect`
- **Composite Pipelines**: `batch_filter_pipeline`
- **Metadata**: `get_image_metadata`

---

## 🎨 4. Client-Side WebMCP Tools (`document.modelContext`)

When running inside the Web Studio (`/studio`), the following tools are registered on the browser's model context:

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `load_preset_image` | `preset_index`, `image_url` | Loads a standard sample photo or remote image into the canvas |
| `inspect_image` | `include_history` | Returns dimensions, color channels, format, and filter DAG history |
| `crop_canvas` | `left`, `top`, `width`, `height` | Crops the active visual canvas to specified bounding box |
| `apply_filter` | `tool`, `params`, `output_format` | Applies photographic filter with parameter dictionary |
| `build_filter_pipeline`| `operations`, `output_format` | Executes multi-operation composite pipeline sequentially |
| `set_comparison_slider`| `position` (0–100), `zoom` (0.5–3.0) | Adjusts the Before/After split comparison divider and zoom |
| `undo_canvas_action` | `action` (`undo_last` \| `reset_all`) | Reverts the most recent canvas operation or resets canvas |
| `export_canvas_image` | `format`, `quality` | Exports active canvas as Base64 data URI |

---

## 📚 Related Documentation
- [Security Model & Invariants](../SECURITY.md)
- [GitHub App & Webhooks Guide](webhooks-guide.md)
- [Operational Troubleshooting](troubleshooting.md)
- [Architectural Decision Records (ADRs)](adr/0001-agent-key-asymmetric-auth.md)
