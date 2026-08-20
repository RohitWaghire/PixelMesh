# ADR 0002: Base64 JSON-RPC Payload Transport for Headless MCP Image Filters

## Status
Accepted

## Context
Image filter operations require transferring raster image data between the client agent and the MCP server. We evaluated three transport mechanisms:
1. Multi-part file upload with temporary image IDs.
2. Direct image URLs requiring public hosting or S3 storage.
3. In-line Base64 Data URI strings in JSON-RPC tool parameters and responses.

## Decision
We adopt **Base64 Data URI in standard JSON-RPC tool arguments and returns**:
- Every tool accepts `image_base64: "data:image/png;base64,..."` (or raw base64) and returns the modified image as `image_base64`.
- The MCP server performs in-memory transformations using Node.js `sharp` and returns the processed buffer immediately.

## Consequences
- **Positive**: Self-contained, zero external storage dependencies (no S3/bucket setup needed for local development), atomic single-call execution.
- **Trade-off**: ~33% payload size inflation over raw binary, acceptable for standard web/desktop image sizes (< 10MB).
