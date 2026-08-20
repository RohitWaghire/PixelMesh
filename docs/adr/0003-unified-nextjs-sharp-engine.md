# ADR 0003: Unified Full-Stack Next.js 15 with Native Sharp Engine

## Status
Accepted

## Context
We need to provide both a robust headless MCP endpoint with cryptographic auth for external agents, and an interactive admin dashboard / image filter playground for humans.

## Decision
We select **Next.js 15 (App Router)** as the single full-stack foundation:
- Backend API route `/api/mcp` serves the authenticated Model Context Protocol endpoint.
- Server-side image transformation runs natively on Node.js using `sharp` (libvips C++ bindings) for sub-millisecond filter performance.
- React frontend components provide the Key Manager, Playground, and Live Request Inspector.

## Consequences
- **Positive**: Single unified codebase, shared TypeScript interfaces, zero CORS/multi-port friction, easy deployment.
- **Trade-off**: Requires Node.js runtime environment (cannot run in pure Edge Worker due to native `sharp` bindings).
