<div align="center">

# ⚡ PixelMesh
**AI Agent-First Image Tool Mesh & Cryptographic WebMCP Gateway**

[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-blue.svg)](https://modelcontextprotocol.io)
[![Authentication](https://img.shields.io/badge/Auth-Ed25519%20%7C%20RSA-emerald.svg)](#-cryptographic-authentication-spec)
[![Image Engine](https://img.shields.io/badge/Engine-Sharp%20(libvips)-orange.svg)](https://sharp.pixelplumbing.com)
[![Next.js](https://img.shields.io/badge/Next.js-15%20(App%20Router)-black.svg)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

*Deterministic, sub-millisecond image manipulation gateway with zero-shared-secret asymmetric authentication for Claude, Cursor, and autonomous AI agents.*

</div>

---

## 📖 Table of Contents
- [Why PixelMesh?](#-why-pixelmesh)
- [System Architecture](#-system-architecture)
- [Quickstart for AI Agents (Autonomous Onboarding)](#-quickstart-for-ai-agents-autonomous-onboarding)
- [Quickstart for Developers (Claude Desktop & Cursor)](#-quickstart-for-developers-claude-desktop--cursor)
- [Image Processing Tool Catalog (22+ Tools)](#-image-processing-tool-catalog-22-tools)
- [Cryptographic Authentication Specification](#-cryptographic-authentication-spec)
- [Interactive Studio & Dev Console](#-interactive-studio--dev-console)
- [WebMCP Challenge Judge Path](#webmcp-challenge-judge-path)
- [Local Development & Testing](#-local-development--testing)
- [Roadmap & Architecture Decisions](#-roadmap--architecture-decisions)
- [License](#-license)

---

## 🌟 Why PixelMesh?

Traditional image processing APIs are built for humans with API keys and dashboards. When autonomous AI agents need to manipulate images (cropping, color grading, sharpening, inspecting metadata, or building complex filter DAGs), they encounter two major friction points:
1. **Credential Vulnerability**: Shared static API keys easily leak across agent scratchpads, prompt logs, and subagent forks.
2. **Nondeterministic Multimodal Hallucinations**: Prompting vision models to "edit" images often results in hallucinations, altered dimensions, and high compute latency.

**PixelMesh solves this with an Agent-First design**:
- **Zero Shared Secrets**: Agents generate ephemeral or persistent asymmetric keypairs (Ed25519 or RSA-2048). Requests are signed with HTTP message signatures verified against the agent's public key fingerprint.
- **Autonomous Machine Onboarding**: Zero-human registration via signed proof-of-ownership granting 100 free instant credits.
- **Model Context Protocol (MCP) Streamable Server**: Native JSON-RPC 2.0 endpoint (`/api/mcp`) exposing 22+ high-performance C++ `sharp` (libvips) manipulation tools.
- **Human-in-the-Loop Studio**: Interactive Web Studio with split Before/After comparison sliders, live parameter inspectors, and visual pipeline chaining.

---

## 📐 System Architecture

```
+-----------------------------------------------------------------------------------------+
|                                    PIXELMESH ARCHITECTURE                               |
+-----------------------------------------------------------------------------------------+
                                                                                          
    [ Autonomous AI Agent ]                      [ Human Developer / IDE ]                
      (Claude / Cursor / Python)                   (Claude Desktop / Web Browser)         
                 │                                                │                       
     1. Keypair Generation (Ed25519)                              │                       
     2. Signed Registration (POST /api/auth/register)             │                       
     3. Request Signing (X-Agent-Signature)                       │                       
                 │                                                │                       
                 ▼                                                ▼                       
   ┌─────────────────────────────────────────────────────────────────────────────────┐   
   │                              PixelMesh Next.js 15 Gateway                       │   
   │                                                                                 │   
   │  ┌──────────────────────┐  ┌───────────────────────┐  ┌──────────────────────┐  │   
   │  │  Crypto Auth Gateway │  │   Credit & Nonce      │  │  MCP JSON-RPC Server │  │   
   │  │  (Ed25519 & RSA-2048)│  │   (Anti-Replay Window)│  │  (tools/call, list)  │  │   
   │  └──────────┬───────────┘  └───────────┬───────────┘  └──────────┬───────────┘  │   
   │             │                          │                         │              │   
   │             └──────────────────────────┴─────────────────────────┘              │   
   │                                        │                                        │   
   │                                        ▼                                        │   
   │                    ┌───────────────────────────────────────┐                    │   
   │                    │       Native Sharp Image Engine       │                    │   
   │                    │     (Geometry, Color, Exposure, FX)   │                    │   
   │                    └───────────────────────────────────────┘                    │   
   │                                        │                                        │   
   │         ┌──────────────────────────────┴──────────────────────────────┐         │   
   │         ▼                                                             ▼         │   
   │  [ /api/mcp JSON-RPC ]                                      [ /studio & /dashboard ]│
   │  (Base64 Data URI Image In/Out)                             (Before/After Split UI) │
   └─────────────────────────────────────────────────────────────────────────────────┘   
```

---

## 🤖 Quickstart for AI Agents (Autonomous Onboarding)

Autonomous agents can self-enroll and begin executing tools in three steps with zero human intervention.

### 1. Generate an Ed25519 Keypair
```typescript
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const cleanKey = publicKey
  .replace(/-----BEGIN PUBLIC KEY-----/, '')
  .replace(/-----END PUBLIC KEY-----/, '')
  .replace(/\s+/g, '');
const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(cleanKey, 'base64')).digest('base64url');
```

### 2. Autonomous Registration (`POST /api/auth/register`)
Sign a registration challenge payload and register your agent:
```bash
# Payload: { "name": "Agent-007", "publicKey": "<PUBLIC_KEY_PEM>", "algorithm": "ed25519", "timestamp": 1740000000 }
# Sign with X-Agent-Signature header
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key-Fingerprint: $FINGERPRINT" \
  -H "X-Agent-Timestamp: $TIMESTAMP" \
  -H "X-Agent-Nonce: $NONCE" \
  -H "X-Agent-Signature: $SIGNATURE" \
  -d '{"name": "Agent-007", "publicKey": "...", "algorithm": "ed25519", "timestamp": 1740000000}'
```
*Response: Returns 201 Created with 100 free credits allocated to your key fingerprint.*

### 3. Invoke MCP Tools (`POST /api/mcp`)
Execute any filter tool via signed JSON-RPC 2.0:
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key-Fingerprint: $FINGERPRINT" \
  -H "X-Agent-Timestamp: $TIMESTAMP" \
  -H "X-Agent-Nonce: $NONCE" \
  -H "X-Agent-Signature: $SIGNATURE" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "tools/call",
    "params": {
      "name": "adjust_brightness",
      "arguments": {
        "image": "data:image/jpeg;base64,...",
        "factor": 1.3
      }
    }
  }'
```

---

## 💻 Quickstart for Developers (Claude Desktop & Cursor)

### Claude Desktop Integration
Add PixelMesh to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "pixelmesh": {
      "command": "npx",
      "args": ["-y", "@pixelmesh/agent", "connect", "--url", "http://localhost:3000/api/mcp"]
    }
  }
}
```

### Cursor IDE Integration
Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "pixelmesh": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "X-Agent-Key-Fingerprint": "YOUR_KEY_FINGERPRINT",
        "X-Agent-Dev-Key": "YOUR_DEV_KEY_IF_LOCAL"
      }
    }
  }
}
```

---

## 🛠️ Image Processing Tool Catalog (22+ Tools)

PixelMesh exposes 22+ deterministic, atomic image tools plus composite pipeline engines:

| Category | Tool Name | Key Parameters | Cost |
| :--- | :--- | :--- | :---: |
| **Geometry** | `crop_image` | `left`, `top`, `width`, `height` | 1 Credit |
| | `circle_crop` | `radius`, `centerX`, `centerY`, `background` | 1 Credit |
| | `rotate_image` | `angle` (90, 180, 270, or custom degrees), `background` | 1 Credit |
| | `flip_image` | `horizontal` (bool), `vertical` (bool) | 1 Credit |
| | `straighten_image` | `angle` (-45 to 45), `cropToFit` | 1 Credit |
| **Exposure** | `adjust_brightness` | `factor` (0.0 to 3.0) | 1 Credit |
| | `adjust_contrast` | `factor` (0.0 to 3.0) | 1 Credit |
| | `adjust_gamma` | `gamma` (0.1 to 3.0) | 1 Credit |
| | `adjust_exposure` | `stops` (-4.0 to 4.0) | 1 Credit |
| | `lighten_image` | `amount` (0.0 to 1.0) | 1 Credit |
| | `darken_image` | `amount` (0.0 to 1.0) | 1 Credit |
| **Color** | `make_sepia_tone` | `intensity` (0.0 to 1.0) | 1 Credit |
| | `make_grayscale` | `mode` (`standard` \| `weighted`) | 1 Credit |
| | `invert_colors` | None | 1 Credit |
| | `adjust_hue` | `degrees` (-180 to 180) | 1 Credit |
| | `adjust_saturation` | `factor` (0.0 to 3.0) | 1 Credit |
| | `adjust_vibrance` | `amount` (-1.0 to 1.0) | 1 Credit |
| | `adjust_hsl` | `hue`, `saturation`, `lightness` | 1 Credit |
| | `clip_photo` | `minThreshold`, `maxThreshold` | 1 Credit |
| **Effects** | `glow_effect` | `intensity` (0.0 to 2.0), `radius` (1 to 50) | 1 Credit |
| | `sharpen_image` | `sigma` (0.5 to 10), `flat`, `jagged` | 1 Credit |
| | `blur_image` | `sigma` (0.3 to 100) | 1 Credit |
| | `noise_effect` | `amount` (0.0 to 1.0), `type` (`gaussian` \| `uniform`) | 1 Credit |
| | `posterize_effect` | `levels` (2 to 32) | 1 Credit |
| **Composite** | `batch_filter_pipeline` | `pipeline: [{ tool, params }, ...]` | 3 Credits |
| **Metadata** | `get_image_metadata` | `image` (returns width, height, format, channels, color space) | 1 Credit |

> *High-Resolution Tier: Payloads exceeding 20MB are billed at 5 Credits (ADR 0005).*

---

## 🔐 Cryptographic Authentication Spec

PixelMesh rejects bearer tokens and static API secrets. All incoming requests to protected endpoints require 4 HTTP headers:

| Header Name | Format / Description | Example |
| :--- | :--- | :--- |
| `X-Agent-Key-Fingerprint` | Base64URL SHA-256 of public key PEM | `SHA256:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU` |
| `X-Agent-Timestamp` | Unix timestamp in seconds (±60s valid window) | `1740001234` |
| `X-Agent-Nonce` | UUID or random hex string (anti-replay) | `9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d` |
| `X-Agent-Signature` | Base64 signature of canonical string | `k8Z7...==` |

### Canonical Signing Format
The payload signature is calculated over the canonical string:
```
METHOD\n
PATH\n
TIMESTAMP\n
NONCE\n
SHA256(REQUEST_BODY)
```

Example in TypeScript:
```typescript
const bodyHash = crypto.createHash('sha256').update(requestBody).digest('hex');
const canonicalString = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}\n${bodyHash}`;
const signature = crypto.sign(null, Buffer.from(canonicalString), privateKey).toString('base64');
```

---

## 🎨 Interactive Studio & Dev Console

- **Studio Sandbox (`/studio`)**: Interactive 3-column workspace with a draggable Before/After split comparison slider, zoom/pan controls, parameter dials, sample preset images, and exportable JSON-RPC code snippets.
- **Developer Dashboard (`/dashboard`)**: Keyring management, instant keypair generator, credit balance top-ups, and real-time telemetry stream auto-refreshing every 2.5 seconds.
- **Config Hub (`/dashboard`)**: 1-click exporter generating ready-to-use configuration files for Claude Desktop, Cursor, Python, and Node.js.

---

## WebMCP Challenge Judge Path

PixelMesh's WebMCP implementation is client-side and lives on the Studio page. The page registers eight tools on `document.modelContext`; each tool operates on the visible canvas and reuses the same state transitions as the human controls.

### Browser setup

- **ChatGPT desktop app**: Open the live project in its in-app browser. WebMCP is enabled by default there.
- **Chrome**: Use Chrome 149 or later, open `chrome://flags/#enable-webmcp-testing`, enable the flag, relaunch Chrome, and open the live project.

### Exact smoke test

1. Open the deployed project URL and navigate to `/studio`.
2. Ask the agent: `Load the Cyberpunk Portrait preset, apply make_sepia_tone with intensity 0.65, move the comparison slider to 65, then inspect the image.`
3. Confirm that the agent discovers and calls `load_preset_image`, `apply_filter`, `set_comparison_slider`, and `inspect_image`.
4. Confirm that the canvas changes visibly, the before/after divider moves, and the WebMCP activity panel records the calls and structured results.

The Studio sandbox does not require a login or agent key for this smoke test. The separate `/api/mcp` endpoint and dashboard demonstrate PixelMesh's authenticated backend gateway. If the Studio reports `Polyfill` instead of `Native`, the browser is not exposing WebMCP and the browser setup should be corrected before judging.

The submission-focused description, implementation timeline, and remaining release checklist are in [`docs/webmcp-challenge.md`](docs/webmcp-challenge.md).

---

## 🚀 Local Development & Testing

### Prerequisites
- Node.js 18+ (Node.js 20+ recommended)
- npm or pnpm

### Installation
```bash
git clone https://github.com/RohitWaghire/PixelMesh.git
cd PixelMesh
npm install
```

### Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Web Studio & Dashboard.

### Run Automated Tests
```bash
# Run unit & E2E integration test suite
npm test
```

### Build for Production
```bash
npm run build
npm run start
```

### Docker Deployment
Run PixelMesh inside an isolated, production-ready container:
```bash
# Build multi-stage Docker container
docker build -t pixelmesh:latest .

# Run container exposed on port 3000
docker run -p 3000:3000 pixelmesh:latest
```


---

## 🗺️ Roadmap & Architecture Decisions

Read our recorded [Architectural Decision Records (ADRs)](docs/adr):
- **[ADR 0001: SSH-Style Asymmetric Cryptographic Auth](docs/adr/0001-agent-key-asymmetric-auth.md)**
- **[ADR 0002: Base64 JSON-RPC Image Transport](docs/adr/0002-base64-jsonrpc-image-transport.md)**
- **[ADR 0003: Unified Next.js Sharp Engine](docs/adr/0003-unified-nextjs-sharp-engine.md)**
- **[ADR 0004: Persistence Limits & Source Formats](docs/adr/0004-persistence-limits-formats.md)**
- **[ADR 0005: PixelMesh Branding & Credit Metering](docs/adr/0005-pixelmesh-branding-and-monetization.md)**
- **[ADR 0006: Autonomous Agent Registration](docs/adr/0006-autonomous-agent-registration.md)**
- **[ADR 0007: MCP Tool Error Handling Contract](docs/adr/0007-mcp-tool-error-handling.md)**

---

## 📄 License

MIT © [Rohit Waghire](https://github.com/RohitWaghire) & Contributors.
