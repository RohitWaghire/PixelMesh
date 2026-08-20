# ADR 0007: MCP Tool Error Handling & Self-Correction Contract

## Status
Accepted

## Context
When an AI agent invokes an image filter tool with invalid parameters (e.g., crop dimensions exceeding image bounds, out-of-range gamma, corrupted base64 input), the system must handle the error without severing the agent's MCP session.

## Decision
We strictly adhere to the **Official Model Context Protocol Specification**:
1. **Tool Execution Failures**:
   - Wrap tool execution in defensive `try/catch` blocks.
   - Return `{ result: { content: [{ type: "text", text: "<Detailed recovery instructions>" }], isError: true } }`.
   - The message provides clear context (e.g., actual dimensions vs requested crop) so the LLM agent can autonomously adjust parameters and self-correct.
   - **Credits Policy**: Credits are **not deducted** if a tool fails parameter validation or execution with `isError: true`.
2. **Protocol & Cryptographic Failures**:
   - Malformed JSON-RPC or invalid/tampered cryptographic signatures return top-level JSON-RPC error codes (`-32700 Parse Error`, `-32001 Unauthorized Signature`).

## Consequences
- **Positive**: Resilient agent loops; empowers LLMs to self-correct without human intervention; fair credit billing.
- **Trade-off**: Requires descriptive error formatting across all 22+ filter tools.
