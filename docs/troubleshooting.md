# PixelMesh Troubleshooting & Diagnostics Guide

This document provides resolutions for common operational, environmental, and cryptographic issues encountered when developing or deploying **PixelMesh**.

---

## 🧭 Table of Contents
- [1. Sharp & libvips Native Binding Issues](#1-sharp--libvips-native-binding-issues)
- [2. Cryptographic Authentication & Signature Errors](#2-cryptographic-authentication--signature-errors)
- [3. WebMCP & Browser Flag Configuration](#3-webmcp--browser-flag-configuration)
- [4. Redis & Nonce Cache Connection Failures](#4-redis--nonce-cache-connection-failures)
- [5. Database & Prisma Migration Errors](#5-database--prisma-migration-errors)

---

## 1. Sharp & libvips Native Binding Issues

### Issue: `Could not load the "sharp" module using the ... runtime`
Sharp relies on platform-specific C++ `libvips` binaries. This typically happens when running in Docker or cross-compiling between OS architectures.

**Resolution**:
1. Remove `node_modules` and the package lock:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
2. If deploying to Linux or inside Docker from a macOS/Windows host, install the matching target platform bindings:
   ```bash
   npm install --os=linux --cpu=x64 sharp
   ```
3. In `next.config.ts`, verify that `sharp` is listed in `serverExternalPackages`:
   ```typescript
   serverExternalPackages: ["sharp"]
   ```

---

## 2. Cryptographic Authentication & Signature Errors

### Issue: `401 Unauthorized: Timestamp clock skew too large`
PixelMesh enforces a strict ±60-second validity window on `X-Agent-Timestamp` to prevent replay attacks.

**Resolution**:
- Ensure your host or agent runner's system clock is synchronized via NTP:
  - **Linux / macOS**: `sudo sntp -sS pool.ntp.org`
  - **Windows**: `w32tm /resync`
- Pass Unix timestamps in **seconds** (not milliseconds):
  ```typescript
  const timestamp = Math.floor(Date.now() / 1000).toString();
  ```

### Issue: `401 Unauthorized: Signature verification failed`
The calculated signature over the canonical payload string did not match the registered public key.

**Resolution**:
Verify your canonical signing string follows the exact 5-line newline-separated format:
```
METHOD\n
PATH\n
TIMESTAMP\n
NONCE\n
SHA256(BODY)
```
Example:
```typescript
const bodyHash = crypto.createHash("sha256").update(rawBodyText).digest("hex");
const canonicalString = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}\n${bodyHash}`;
const signature = crypto.sign(null, Buffer.from(canonicalString), privateKey).toString("base64");
```

---

## 3. WebMCP & Browser Flag Configuration

### Issue: Studio displays `ModelContext Polyfill` instead of `Native WebMCP`
The client browser does not have the native WebMCP experimental flag enabled.

**Resolution**:
1. Ensure you are using **Google Chrome 149+** (Chrome Canary or Dev build).
2. Navigate to:
   ```
   chrome://flags/#enable-webmcp-testing
   ```
3. Set the flag to **Enabled** and restart the browser completely.
4. Alternatively, use the in-app browser within the official ChatGPT desktop client, which supports WebMCP natively.
5. If running in a standard browser, the built-in **WebMCP Co-Pilot DevTools drawer** at the bottom of `/studio` provides complete schema inspection and local simulation.

---

## 4. Redis & Nonce Cache Connection Failures

### Issue: `Redis connection error: ECONNREFUSED` or high latency
The distributed rate limiter and anti-replay nonce cache cannot connect to Redis.

**Resolution**:
- **Automatic In-Memory Fallback**: During local development without Redis, PixelMesh automatically falls back to an in-memory sliding-window cache.
- **Upstash Configuration**: If using Upstash Redis, set both environment variables:
  ```env
  UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
  UPSTASH_REDIS_REST_TOKEN=your_token_here
  ```
- **Standard Redis / IORedis**: Set `REDIS_URL`:
  ```env
  REDIS_URL=redis://localhost:6379
  ```

---

## 5. Database & Prisma Migration Errors

### Issue: `P2002: Unique constraint failed` or `Table does not exist`
The SQLite or PostgreSQL schema is out of sync with Prisma models.

**Resolution**:
1. Re-generate Prisma Client:
   ```bash
   npm run prisma:generate
   ```
2. Deploy active migrations:
   ```bash
   npm run prisma:migrate:deploy
   ```
3. To re-seed the test organization, dev agent, and initial credit balance:
   ```bash
   npm run prisma:seed
   ```

---

## 💬 Getting Further Help
- Check our [API Reference](api-reference.md) for endpoint contracts.
- Review our [Security Policy](../SECURITY.md) for reporting critical vulnerabilities.
- Open a GitHub Issue for bug reports or feature proposals.
