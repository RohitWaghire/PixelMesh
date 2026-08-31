# Issue 05: Standalone Agent Test Runner & End-to-End Verification

Status: ready-for-agent

## Description
Provide a standalone client test script and end-to-end integration tests verifying real-world external agent workflows.

## Acceptance Criteria
- `scripts/test-agent-client.ts`: Executable script demonstrating:
  1. Generating an Ed25519 keypair.
  2. Autonomous self-registration at `/api/auth/register` with proof-of-ownership signature.
  3. Signing HTTP headers (`X-Agent-Key-Fingerprint`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`).
  4. Invoking `/api/mcp` tools (`tools/list`, `rotate_image`, `change_exposure`, `glow_effect`, `batch_filter_pipeline`).
  5. Receiving and verifying the processed Base64 image.
- Comprehensive test suite for all cryptographic edge-cases (tampered signature, clock skew > 60s, replayed nonce, balance exhaustion).
