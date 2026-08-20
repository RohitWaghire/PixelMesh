# ADR 0005: Product Branding (PixelMesh) & Credit-Based Agent Metering Policy

## Status
Accepted

## Context
We need a clear product identity and a sustainable, machine-friendly monetization mechanism suitable for autonomous AI agents consuming tool operations via MCP.

## Decision
1. **Product Name**: **PixelMesh** (The AI Agent-First Image Tool Mesh & Cryptographic WebMCP Gateway).
2. **Monetization Model (Credit-Based Metering per Agent Key)**:
   - Every registered Agent Public Key is assigned a `credits_balance` (default: 100 free credits on registration).
   - **Cost Schedule**:
     - Standard single filter transformation: **1 credit**
     - Complex effects / composite batch pipeline: **3 credits**
     - High-resolution (> 20MB) compute: **5 credits**
   - **Enforcement**:
     - The `/api/mcp` endpoint validates the agent's key balance before invoking `sharp`.
     - Returns standard JSON-RPC error `-32002 (Insufficient Credits)` with a top-up link if balance is exhausted.
     - Response headers return remaining balance: `X-Agent-Credits-Remaining: 97`.
   - **Dashboard Integration**:
     - The Key Manager displays live credit balances, consumption velocity, and a one-click "Add Credits / Checkout" interface.

## Consequences
- **Positive**: Machine-friendly, predictable pricing for agent operators; prevents abusive compute exhaustion on the image engine.
- **Trade-off**: Requires atomic balance deduction and transactional safety in the key-store.
