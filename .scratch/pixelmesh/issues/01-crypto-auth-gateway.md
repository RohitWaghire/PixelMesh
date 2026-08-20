# 01: Project Scaffold & Cryptographic Auth Gateway

**What to build:** 
A working Next.js 15 full-stack application with an asymmetric cryptographic authentication gateway. Autonomous AI agents can generate Ed25519/RSA keypairs, self-register via a signed proof-of-ownership request to claim 100 free credits, and sign HTTP request headers. Operators can view and manage registered keys, fingerprints, and scopes in the dashboard Key Manager.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Next.js 15 app scaffolded with TypeScript, Tailwind CSS, and Lucide icons in `Web MCP App`
- [x] Cryptographic engine for generating and verifying Ed25519 and RSA-SHA256 signatures over canonical request headers
- [x] Anti-replay nonce cache tracking request UUIDv4s within a 60-second sliding window
- [x] File-backed keyring storage (`.keys/authorized_keys.json`) with auto-provisioned initial Dev Agent keypair
- [x] Autonomous agent registration endpoint (`/api/auth/register`) granting 100 free credits upon valid signature proof
- [x] Key Manager dashboard tab displaying active keys, key fingerprints (`SHA256:...`), balances, and 1-click key generation
