# Issue 04: Interactive Studio, Key Manager & Telemetry Dashboard

Status: ready-for-agent

## Description
Build the unified Next.js 15 frontend matching the precision dark aesthetic defined in `DESIGN.md`.

## Acceptance Criteria
- Top Header: Product badge, MCP server status (`🟢 Live`), registered key counter, credit meter.
- **Studio & Playground View**:
  - Filter Tool Sidebar categorized into Geometry, Tonal, Color, Effects, and Pipeline.
  - Interactive Canvas with real-time **Before/After Split Comparison Slider**, Zoom/Pan, and high-res export.
  - Right Parameter Inspector with active Agent Key selector that generates real signed Ed25519 requests.
  - Bottom Pipeline timeline DAG showing chained operations with undo/redo.
  - Pre-loaded photography samples for instant zero-friction testing.
- **Agent Keyring Manager View**:
  - Table of registered keys, algorithms, fingerprints, balances, scopes, and status.
  - 1-Click Keypair Generator (Ed25519/RSA) with instant private key download.
  - Add public key modal & credit top-up simulation.
  - Instant 1-click copy for Claude Desktop and Cursor MCP config snippets.
- **Live Request & Signature Inspector View**:
  - Real-time audit log of incoming requests showing signature validation badges, timestamp drift, and execution latency.
