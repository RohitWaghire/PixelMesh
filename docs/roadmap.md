# PixelMesh roadmap

## Current state

PixelMesh provides signed agent registration, credit metering, MCP image tools, asynchronous jobs, object storage adapters, and a Studio interface. The `dev` branch now also contains the WebMCP Studio integration; PR #3 tracks its promotion to `main`.

## Cleanup sequence

1. Keep tests outside production modules and use the TypeScript and ESLint commands in `package.json` as the local quality gate.
2. Reduce route files by moving shared MCP request parsing, authentication, and execution into `lib/mcp/` modules. Route files should only adapt HTTP requests and responses.
3. Separate database adapters from credit and key behaviour without changing the Prisma and in-memory test implementations.
4. Replace `any` where modules cross into routes, storage adapters, queue adapters, and WebMCP interfaces.
5. Move the remaining WebMCP tests into `tests/webmcp/` after the current feature has stabilized, keeping the test script and import boundaries aligned.

## Product follow-up

The next product work should focus on production observability, billing, and external client distribution. The archived Phase 3 status document is historical context, not a source of truth.
