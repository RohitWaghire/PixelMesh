# Issue 01: Core Cryptographic Auth & Keyring Store

Status: ready-for-agent

## Description
Implement the cryptographic authentication layer and persistent file-backed keyring for PixelMesh.

## Acceptance Criteria
- `lib/auth/agent-crypto.ts`: Canonical signature generation & verification (`Ed25519` and `RSA-SHA256`).
- `lib/auth/nonce-cache.ts`: In-memory anti-replay cache tracking UUIDv4 nonces with 60-second sliding expiration.
- `lib/auth/key-store.ts`: JSON-backed keyring (`.keys/authorized_keys.json`) managing agent public keys, fingerprints (`SHA256:...`), credit balances, scopes, and status. Auto-provisions default Dev Agent keypair on initial boot.
- `/api/auth/register`: Pure autonomous agent self-enrollment endpoint requiring cryptographic proof-of-ownership signature, granting 100 free credits.
- `/api/auth/keys`: CRUD & credit top-up endpoint for the dashboard.
- Unit tests verifying valid/tampered signatures, nonce replay rejection, and timestamp drift defense.
