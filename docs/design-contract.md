# Design Contract: PixelMesh Studio & Agent Gateway

## 1. Visual World & Aesthetic POV
- **Theme**: **Deep Cyber Dark / Precision Engineering** (Zinc-950 base `#09090b`, Slate-900 panels `#0f172a`, Emerald-500 cryptographic accents `#10b981`, Amber-400 credit tokens `#f59e0b`, Violet-500 MCP mesh indicators `#8b5cf6`).
- **Typography**: Clean monospace numeric & code displays (`JetBrains Mono` / `Fira Code`) paired with a high-legibility geometric sans-serif (`Inter` / `Geist`).
- **Anti-Slop Commitment**: No generic purple gradient blobs, no placeholder empty cards, no fake metric graphs. Every pixel represents real image buffers, real Ed25519 cryptographic signatures, and live JSON-RPC telemetry.

---

## 2. Layout Structure & Workspaces

```
+---------------------------------------------------------------------------------------------------------+
|  [⚡ PixelMesh]  [v1.0.0]        [🟢 MCP Live: /api/mcp]       [📜 4 Registered Keys]   [🪙 100 Credits] |
+---------------------------------------------------------------------------------------------------------+
|  MODE SELECTOR TABS:                                                                                    |
|  [ 🖼️ Studio & Filter Playground ]   [ 🔑 Agent Keyring & Scopes ]   [ 📡 Live Request & Signature Stream ] |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  STUDIO WORKSPACE VIEW (3-Column Precision Layout):                                                     |
|                                                                                                         |
|  +--------------------+  +---------------------------------------------------+  +--------------------+  |
|  | FILTER TOOL MENU   |  | INTERACTIVE CANVAS VIEWPORT                       |  | AGENT RUNNER &     |  |
|  | (Exact 22+ list)   |  |                                                   |  | SIGNATURE TELEMETRY|  |
|  |                    |  |  +---------------------------------------------+  |  |                    |  |
|  | 📷 Photo Editor    |  |  |                                             |  |  | 🤖 Agent Mock /    |  |
|  | ✂️ Crop Image      |  |  |        [ Before / After Split Slider ]      |  |  |    Active Key:      |  |
|  | 🔘 Circle Crop     |  |  |          Original  <========||========>     |  |  |    `SHA256:4dF9...` |  |
|  | 🔄 Rotate Image    |  |  |                     Processed Filter        |  |  |                    |  |
|  | ☀️ Brightness      |  |  |                                             |  |  | 🎛️ Live Parameters |  |
|  | ⚙️ Exposure        |  |  +---------------------------------------------+  |  |    [ Slider / Num ] |  |
|  | ⚡ Sharpen         |  |                                                   |  |                    |  |
|  | 👁️ Blur Image       |  |  [ 🔍 Zoom ]  [ ↔️ Pan ]  [ 🔄 Reset ] [ ⬇️ Export]  |  | 📦 JSON-RPC Schema |  |
|  | 🎨 HSL / Hue       |  +---------------------------------------------------+  |  |    Payload Preview  |  |
|  | 👻 Snapchat Preset |  | ACTIVE PIPELINE CHAIN (DAG)                       |  |                    |  |
|  | ... (all 22 tools) |  | [Crop 800x600] ➔ [Gamma 1.2] ➔ [Glow +20]          |  | [⚡ Execute Tool]  |  |
|  +--------------------+  +---------------------------------------------------+  +--------------------+  |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. The 3 Primary Workspaces

### 1. 🖼️ **Studio & Filter Playground**
- **Left Sidebar**: The exact 22+ categorized filter tools matching your specification (Geometry, Tonal, Color, Effects, Presets).
- **Center Canvas**: Full-screen canvas viewport with interactive **Before/After Split Comparison Slider**, Zoom/Pan controls, image drag & drop uploader, and high-res export (PNG/JPEG/WebP).
- **Right Inspector Panel**: Real-time parameter sliders, active agent key selector, payload preview, and instant execution trigger.
- **Bottom Timeline**: Visual pipeline chain showing multi-step filter compositions with one-click step removal or reordering.

### 2. 🔑 **Agent Keyring & Scopes Manager**
- Table of all registered agent public keys.
- Shows: `Agent Name`, `Algorithm (Ed25519/RSA)`, `Key Fingerprint (SHA256:...)`, `Remaining Credits Balance`, `Allowed Scopes`, `Total Invocations`, `Status (Active/Revoked)`.
- **Quick Action Bar**:
  - `Generate Agent Keypair` (One-click creates private/public keypair with instant download & auto-enrollment).
  - `Add Public Key` (Paste public key to enroll with 100 free credits).
  - `Top Up Credits` (Simulate credit recharge).
  - `Revoke Key` (Instantly block a compromised agent key).
  - `Copy Claude / Cursor MCP Config` (Instant JSON snippet).

### 3. 📡 **Live Request & Signature Stream**
- Real-time audit log of all incoming MCP requests to `/api/mcp`.
- Displays cryptographic validation badges:
  - `✅ Signature Valid (Ed25519)`
  - `⏱️ Timestamp Drift: +120ms`
  - `🔒 Nonce Verified: 550e8400...`
  - `🪙 Cost: -1 Credit (Balance: 98)`
- Expandable raw JSON-RPC request and response inspector with execution timing (e.g. `sharp processed in 14.2ms`).

---

## 4. Required Component States
- **Loading State**: Shimmering skeleton loader with subtle pulse effect on image transforms.
- **Empty State**: Drag & drop zone with pre-loaded sample photography (portraits, landscapes, neon cityscapes) so users can test immediately without searching for files.
- **Error State**: Non-blocking toast alerts with clear recovery actions (e.g. *"Crop exceeded 1920px bounds - auto-adjusted to maximum boundary"*).
- **Zero Credits State**: Warning banner with one-click top-up trigger.
- **Responsive**: Adapts gracefully from wide 4K displays down to laptop screens with collapsible sidebars.
