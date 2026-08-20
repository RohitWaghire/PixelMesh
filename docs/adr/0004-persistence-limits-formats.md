# ADR 0004: Key Persistence, High-Res Limits, and Format Preservation

## Status
Accepted

## Context
We need to finalize the operational parameters for key storage, image memory limits, and format conversions during image transformations.

## Decision
1. **Key Storage**: Store authorized agent keys in a local file-backed JSON store (`.keys/authorized_keys.json`), ensuring persistence across restarts with zero external database dependencies.
2. **Payload Safety**: Set a generous 50MB payload threshold to accommodate high-resolution RAW/PNG/JPEG assets while guarding against unbounded memory allocation.
3. **Format Handling**: Automatically detect and preserve the source format (JPEG/PNG/WebP), with an optional `output_format` override parameter on all 22+ filter tools.

## Consequences
- **Positive**: Resilient state, high-fidelity image support, flexible format conversion without degrading original compression profiles.
- **Trade-off**: Requires sufficient server RAM to process simultaneous 50MB image buffers.
