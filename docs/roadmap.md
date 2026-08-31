# PixelMesh roadmap

## Current state

PixelMesh provides signed agent registration, credit metering, MCP image tools, asynchronous jobs, object storage adapters, and a Studio interface. The active branch also contains uncommitted WebMCP Studio work. Keep that work intact while completing the repository cleanup.

## Cleanup sequence

1. Keep tests outside production modules and use the TypeScript and ESLint commands in `package.json` as the local quality gate.
2. Reduce route files by moving shared MCP request parsing, authentication, and execution into `lib/mcp/` modules. Route files should only adapt HTTP requests and responses.
3. Separate database adapters from credit and key behaviour without changing the Prisma and in-memory test implementations.
4. Replace `any` where modules cross into routes, storage adapters, queue adapters, and WebMCP interfaces.
5. Move the remaining WebMCP tests into `tests/webmcp/` only after the current uncommitted WebMCP feature is committed or explicitly handed over.

## Product follow-up

The next product work should focus on production observability, billing, and external client distribution. The archived Phase 3 status document is historical context, not a source of truth.
