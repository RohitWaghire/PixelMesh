/**
 * PixelMesh Phase 1 - Milestone 3 Adversarial Challenge Suite
 * Focus: Authentication & Authorization Endpoints, Proof-of-Ownership, Clock Skew, Key Revocation, Replay & Signature Tampering
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { keyStore } from "./key-store";
import {
  generateAgentKeypair,
  signRequestPayload,
  computeKeyFingerprint,
  verifyRequestSignature
} from "./agent-crypto";
import { nonceCache, NONCE_KEY_PREFIX } from "./nonce-cache";
import { resetMockDb, prisma } from "../db/prisma";
import { resetMockRedis, getRedisClient } from "../redis/client";
import { POST as registerHandler } from "../../app/api/auth/register/route";
import { GET as keysGetHandler, POST as keysPostHandler } from "../../app/api/auth/keys/route";
import { POST as mcpHandler } from "../../app/api/mcp/route";
import { telemetryStore } from "../telemetry/store";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
});

async function makeTestImage(): Promise<string> {
  const buf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 150, b: 200 } }
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// ============================================================================
// Area 1: Proof-of-Ownership Registration Signature Validation
// ============================================================================

test("adversarial 1.1: valid Ed25519 registration signature enrolls agent with 100 credits", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const agentName = "Ed25519-Agent-Alpha";

  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: agentName, public_key: keypair.publicKeyPem })
  });

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: agentName,
      public_key: keypair.publicKeyPem,
      algorithm: "ed25519",
      timestamp,
      signature
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.agent.credits_balance, 100);
  assert.equal(json.agent.status, "active");
  assert.equal(json.agent.fingerprint, computeKeyFingerprint(keypair.publicKeyPem));

  // Verify database record and ledger
  const savedKey = await prisma.agentKey.findUnique({
    where: { fingerprint: json.agent.fingerprint }
  });
  assert.ok(savedKey);
  assert.equal(savedKey.creditsBalance, 100);

  const txs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: savedKey.id }
  });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].type, "FREE_GRANT");
  assert.equal(txs[0].amount, 100);
});

test("adversarial 1.2: valid RSA-2048 registration signature enrolls agent with 100 credits", async () => {
  const keypair = generateAgentKeypair("rsa");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const agentName = "RSA-Enterprise-Agent";

  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    algorithm: "rsa",
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: agentName, public_key: keypair.publicKeyPem })
  });

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: agentName,
      public_key: keypair.publicKeyPem,
      algorithm: "rsa",
      timestamp,
      signature
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.agent.credits_balance, 100);
  assert.equal(json.agent.status, "active");
});

test("adversarial 1.3: tampered registration signature is rejected with HTTP 401", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const agentName = "Tampered-Sig-Agent";

  const validSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: agentName, public_key: keypair.publicKeyPem })
  });

  // Corrupt signature bytes
  const tamperedSig = Buffer.from(validSig, "base64");
  tamperedSig[10] ^= 0xff;
  const corruptedBase64 = tamperedSig.toString("base64");

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: agentName,
      public_key: keypair.publicKeyPem,
      timestamp,
      signature: corruptedBase64
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("Invalid proof-of-ownership signature"));

  // Verify key was NOT persisted
  const fp = computeKeyFingerprint(keypair.publicKeyPem);
  const savedKey = await prisma.agentKey.findUnique({ where: { fingerprint: fp } });
  assert.equal(savedKey, null);
});

test("adversarial 1.4: signature signed by different private key (attacker key) is rejected with HTTP 401", async () => {
  const victimKeypair = generateAgentKeypair("ed25519");
  const attackerKeypair = generateAgentKeypair("ed25519");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const agentName = "Victim-Agent";

  // Attacker signs using attacker's private key, but submits victim's public key
  const forgedSig = signRequestPayload({
    privateKeyPem: attackerKeypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: agentName, public_key: victimKeypair.publicKeyPem })
  });

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: agentName,
      public_key: victimKeypair.publicKeyPem,
      timestamp,
      signature: forgedSig
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("Invalid proof-of-ownership signature"));
});

test("adversarial 1.5: tampered agent_name payload is rejected with HTTP 401", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Signed for "Agent-Original"
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-Original", public_key: keypair.publicKeyPem })
  });

  // Submitted with "Agent-Tampered"
  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-Tampered",
      public_key: keypair.publicKeyPem,
      timestamp,
      signature
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes("Invalid proof-of-ownership signature"));
});

test("adversarial 1.6: missing required fields in registration body return HTTP 400", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // 1. Missing public_key
  const req1 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_name: "Agent-No-Key", timestamp, signature: "dummysig" })
  });
  const res1 = await registerHandler(req1);
  assert.equal(res1.status, 400);
  assert.ok((await res1.json()).error.includes("Missing required field: public_key"));

  // 2. Missing signature
  const req2 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_name: "Agent-No-Sig", public_key: keypair.publicKeyPem, timestamp })
  });
  const res2 = await registerHandler(req2);
  assert.equal(res2.status, 400);
  assert.ok((await res2.json()).error.includes("Missing required proof-of-ownership signature"));

  // 3. Missing timestamp
  const req3 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_name: "Agent-No-Ts", public_key: keypair.publicKeyPem, signature: "dummysig" })
  });
  const res3 = await registerHandler(req3);
  assert.equal(res3.status, 400);
  assert.ok((await res3.json()).error.includes("Missing required proof-of-ownership signature"));
});

test("adversarial 1.7: re-registration of revoked key is strictly blocked", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Agent-To-Revoke",
    publicKeyPem: keypair.publicKeyPem
  });

  // Revoke key
  await keyStore.revokeKey(agent.fingerprint);

  // Attempt to re-register via /api/auth/register
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: ts,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-To-Revoke", public_key: keypair.publicKeyPem })
  });

  const req = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-To-Revoke",
      public_key: keypair.publicKeyPem,
      timestamp: ts,
      signature
    })
  });

  const res = await registerHandler(req);
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(json.error.includes("revoked"));
});

// ============================================================================
// Area 2: Registration Timestamp Skew Validation (>300s)
// ============================================================================

test("adversarial 2.1: registration timestamp within 300s window is accepted", async () => {
  const now = Math.floor(Date.now() / 1000);

  // 1. Past drift 250s
  const keypair1 = generateAgentKeypair("ed25519");
  const tsPast250 = (now - 250).toString();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair1.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: tsPast250,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-Past-250", public_key: keypair1.publicKeyPem })
  });

  const req1 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-Past-250",
      public_key: keypair1.publicKeyPem,
      timestamp: tsPast250,
      signature: sig1
    })
  });
  const res1 = await registerHandler(req1);
  assert.equal(res1.status, 201);

  // 2. Future drift 250s
  const keypair2 = generateAgentKeypair("ed25519");
  const tsFut250 = (now + 250).toString();
  const sig2 = signRequestPayload({
    privateKeyPem: keypair2.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: tsFut250,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-Fut-250", public_key: keypair2.publicKeyPem })
  });

  const req2 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-Fut-250",
      public_key: keypair2.publicKeyPem,
      timestamp: tsFut250,
      signature: sig2
    })
  });
  const res2 = await registerHandler(req2);
  assert.equal(res2.status, 201);
});

test("adversarial 2.2: registration timestamp skewed > 300s is strictly rejected with HTTP 400", async () => {
  const now = Math.floor(Date.now() / 1000);

  // 1. Past drift 301s
  const keypair1 = generateAgentKeypair("ed25519");
  const tsPast301 = (now - 301).toString();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair1.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: tsPast301,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-Past-301", public_key: keypair1.publicKeyPem })
  });

  const req1 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-Past-301",
      public_key: keypair1.publicKeyPem,
      timestamp: tsPast301,
      signature: sig1
    })
  });
  const res1 = await registerHandler(req1);
  assert.equal(res1.status, 400);
  assert.ok((await res1.json()).error.includes("Proof of ownership timestamp expired"));

  // 2. Future drift 301s
  const keypair2 = generateAgentKeypair("ed25519");
  const tsFut301 = (now + 301).toString();
  const sig2 = signRequestPayload({
    privateKeyPem: keypair2.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: tsFut301,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: "Agent-Fut-301", public_key: keypair2.publicKeyPem })
  });

  const req2 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-Fut-301",
      public_key: keypair2.publicKeyPem,
      timestamp: tsFut301,
      signature: sig2
    })
  });
  const res2 = await registerHandler(req2);
  assert.equal(res2.status, 400);
  assert.ok((await res2.json()).error.includes("Proof of ownership timestamp expired"));

  // 3. Extreme past timestamp (1 day ago)
  const keypair3 = generateAgentKeypair("ed25519");
  const ts1DayAgo = (now - 86400).toString();
  const req3 = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_name: "Agent-1Day",
      public_key: keypair3.publicKeyPem,
      timestamp: ts1DayAgo,
      signature: "dummy"
    })
  });
  const res3 = await registerHandler(req3);
  assert.equal(res3.status, 400);
  assert.ok((await res3.json()).error.includes("Proof of ownership timestamp expired"));
});

test("adversarial 2.3: invalid or non-numeric registration timestamp strings return HTTP 400", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const badTimestamps = ["invalid-ts", "2026-08-22T00:00:00Z", "NaN", "abc", ""];

  for (const badTs of badTimestamps) {
    const req = new NextRequest("http://localhost:3000/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_name: "Agent-Bad-TS",
        public_key: keypair.publicKeyPem,
        timestamp: badTs,
        signature: "dummy"
      })
    });
    const res = await registerHandler(req);
    assert.equal(res.status, 400, `Bad timestamp '${badTs}' must return HTTP 400`);
  }
});

// ============================================================================
// Area 3: Key Revocation Enforcement Across All MCP Endpoints
// ============================================================================

test("adversarial 3.1: key revocation enforcement blocks tools/list on /api/mcp", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Revocation-Target-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // Revoke key
  await keyStore.revokeKey(agent.fingerprint);
  const refreshed = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(refreshed?.status, "revoked");

  // Attempt tools/list
  const body = JSON.stringify({ jsonrpc: "2.0", id: "rev-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.message.includes("Agent key not found or revoked"));
});

test("adversarial 3.2: key revocation blocks tools/call and preserves balance without deduction", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Revoked-Caller-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // Revoke key
  await keyStore.revokeKey(agent.fingerprint);

  const image = await makeTestImage();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "rev-call-1",
    method: "tools/call",
    params: {
      name: "crop_image",
      arguments: { image_base64: image, width: 50, height: 50 }
    }
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.message.includes("Agent key not found or revoked"));

  // Check database: balance remained 50, 0 invocations
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 50);
  assert.equal(finalKey?.totalInvocations, 0);
});

test("adversarial 3.3: key revocation blocks top-up and credit deduction at service layer", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Revoked-Service-Test",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 20
  });

  await keyStore.revokeKey(agent.fingerprint);

  // 1. Direct deduction must fail
  const deductRes = await keyStore.deductCredits(agent.fingerprint, 5);
  assert.equal(deductRes.success, false);
  assert.ok(deductRes.error?.includes("revoked"));

  // 2. Direct topup must throw
  await assert.rejects(async () => {
    await keyStore.topUpCredits(agent.fingerprint, 50);
  }, /revoked/);

  // 3. /api/auth/keys topup action on revoked key returns HTTP 500
  const topupReq = new NextRequest("http://localhost:3000/api/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "topup",
      fingerprint: agent.fingerprint,
      amount: 50
    })
  });
  const topupRes = await keysPostHandler(topupReq);
  assert.equal(topupRes.status, 500);
  assert.ok((await topupRes.json()).error.includes("revoked"));
});

test("adversarial 3.4: revoked key attempting resources/list is blocked with HTTP 401", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Revoked-Resource-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  await keyStore.revokeKey(agent.fingerprint);

  const body = JSON.stringify({ jsonrpc: "2.0", id: "res-1", method: "resources/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 401);
});

// ============================================================================
// Area 4: Signature Tampering & Replay Attack Integration with Redis Nonce Cache
// ============================================================================

test("adversarial 4.1: exact request replay is strictly rejected by Redis nonce cache", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Replay-Target-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "rep-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "replay-nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const createReq = () => new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  // First request: Must SUCCEED (HTTP 200)
  const res1 = await mcpHandler(createReq());
  assert.equal(res1.status, 200);

  // Second identical request (Replay): Must FAIL (HTTP 401)
  const res2 = await mcpHandler(createReq());
  assert.equal(res2.status, 401);
  const json2 = await res2.json();
  assert.ok(json2.error.message.includes("Replay attack detected"));

  // Third identical request: Must FAIL (HTTP 401)
  const res3 = await mcpHandler(createReq());
  assert.equal(res3.status, 401);
});

test("adversarial 4.2: fresh nonce with tampered body payload fails signature verification", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Tamper-Body-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const originalBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "orig-1",
    method: "tools/call",
    params: { name: "get_image_metadata", arguments: { image_base64: "data:image/png;base64,abc" } }
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "fresh-nonce-" + crypto.randomUUID();

  // Signature is generated for originalBody
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body: originalBody
  });

  // Attacker intercepts and replaces body with tampered tool call
  const tamperedBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "orig-1",
    method: "tools/call",
    params: { name: "crop_image", arguments: { width: 100 } }
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body: tamperedBody
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.message.includes("Cryptographic signature verification failed"));
});

test("adversarial 4.3: fresh nonce with tampered timestamp or nonce header fails signature check", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Tamper-Header-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "h-1", method: "tools/list" });
  const now = Math.floor(Date.now() / 1000);
  const originalTs = now.toString();
  const originalNonce = "orig-nonce-" + crypto.randomUUID();

  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: originalTs,
    nonce: originalNonce,
    body
  });

  // 1. Tampered timestamp header
  const reqTamperedTs = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": (now - 5).toString(), // Altered timestamp
      "x-agent-nonce": originalNonce,
      "x-agent-signature": sig
    },
    body
  });
  const resTs = await mcpHandler(reqTamperedTs);
  assert.equal(resTs.status, 401);
  assert.ok((await resTs.json()).error.message.includes("signature verification failed"));

  // 2. Tampered nonce header
  const reqTamperedNonce = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": originalTs,
      "x-agent-nonce": originalNonce + "-altered", // Altered nonce
      "x-agent-signature": sig
    },
    body
  });
  const resNonce = await mcpHandler(reqTamperedNonce);
  assert.equal(resNonce.status, 401);
  assert.ok((await resNonce.json()).error.message.includes("signature verification failed"));
});

test("adversarial 4.4: public key fingerprint substitution (Agent A sig with Agent B fingerprint) fails with HTTP 401", async () => {
  const agentAKeypair = generateAgentKeypair("ed25519");
  const agentBKeypair = generateAgentKeypair("ed25519");

  const agentA = await keyStore.registerKey({ agentName: "Agent-A", publicKeyPem: agentAKeypair.publicKeyPem });
  const agentB = await keyStore.registerKey({ agentName: "Agent-B", publicKeyPem: agentBKeypair.publicKeyPem });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "spoof-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "spoof-nonce-" + crypto.randomUUID();

  // Agent A signs
  const sigA = signRequestPayload({
    privateKeyPem: agentAKeypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  // Request claims fingerprint of Agent B
  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agentB.fingerprint, // Agent B fingerprint!
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sigA
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 401);
  assert.ok((await res.json()).error.message.includes("signature verification failed"));
});

test("adversarial 4.5: clock skew drift > 60s on /api/mcp is rejected by distributed nonce cache", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({ agentName: "Skew-Agent", publicKeyPem: keypair.publicKeyPem });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "skew-1", method: "tools/list" });
  const now = Math.floor(Date.now() / 1000);

  // 65s in past
  const pastTs = (now - 65).toString();
  const nonce1 = "skew-past-" + crypto.randomUUID();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: pastTs,
    nonce: nonce1,
    body
  });

  const reqPast = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": pastTs,
      "x-agent-nonce": nonce1,
      "x-agent-signature": sig1
    },
    body
  });

  const resPast = await mcpHandler(reqPast);
  assert.equal(resPast.status, 401);
  assert.ok((await resPast.json()).error.message.includes("Timestamp clock skew too large"));

  // 65s in future
  const futTs = (now + 65).toString();
  const nonce2 = "skew-fut-" + crypto.randomUUID();
  const sig2 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: futTs,
    nonce: nonce2,
    body
  });

  const reqFut = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": futTs,
      "x-agent-nonce": nonce2,
      "x-agent-signature": sig2
    },
    body
  });

  const resFut = await mcpHandler(reqFut);
  assert.equal(resFut.status, 401);
  assert.ok((await resFut.json()).error.message.includes("Timestamp clock skew too large"));
});

test("adversarial 4.6: high-concurrency race condition replay on /api/mcp yields exactly 1 success", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Concurrent-Race-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "race-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const targetNonce = "concurrent-race-" + crypto.randomUUID();

  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce: targetNonce,
    body
  });

  const concurrency = 20;
  const requests = Array.from({ length: concurrency }, () => {
    return new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": ts,
        "x-agent-nonce": targetNonce,
        "x-agent-signature": sig
      },
      body
    });
  });

  const responses = await Promise.all(requests.map((r) => mcpHandler(r)));
  const statusCodes = responses.map((r) => r.status);

  const successes = statusCodes.filter((s) => s === 200);
  const rejections = statusCodes.filter((s) => s === 401);

  assert.equal(successes.length, 1, `Exactly 1 request must succeed (actual: ${successes.length})`);
  assert.equal(rejections.length, 19, `Exactly 19 replays must be rejected (actual: ${rejections.length})`);
});

test("adversarial 4.7: Redis nonce persistence & TTL verification on /api/mcp invocation", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Redis-TTL-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "ttl-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "ttl-verify-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 200);

  // Directly inspect Redis client state
  const redis = getRedisClient();
  const redisKey = `${NONCE_KEY_PREFIX}${nonce}`;
  const storedVal = await redis.get(redisKey);
  assert.equal(storedVal, ts);

  const ttl = await redis.ttl(redisKey);
  assert.ok(ttl > 0 && ttl <= 60, `TTL must be between 1 and 60 seconds (actual: ${ttl})`);
});

test("adversarial 4.8: nonce burning defense — nonce is consumed even if signature fails", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Nonce-Burn-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: "burn-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const burnedNonce = "burned-nonce-" + crypto.randomUUID();

  // 1. Send request with INVALID signature
  const badReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": burnedNonce,
      "x-agent-signature": "invalidsignature=="
    },
    body
  });

  const badRes = await mcpHandler(badReq);
  assert.equal(badRes.status, 401);
  assert.ok((await badRes.json()).error.message.includes("signature verification failed"));

  // 2. Attacker now computes the correct signature for the same nonce and retries
  const validSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce: burnedNonce,
    body
  });

  const retryReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": burnedNonce,
      "x-agent-signature": validSig
    },
    body
  });

  const retryRes = await mcpHandler(retryReq);
  // Must be rejected by nonce replay check, NOT signature check
  assert.equal(retryRes.status, 401);
  assert.ok((await retryRes.json()).error.message.includes("Replay attack detected"));
});

test("adversarial 4.9: missing or blank SSH cryptographic headers return HTTP 401", async () => {
  const missingHeaderCombos = [
    {}, // all missing
    { "x-agent-timestamp": "123", "x-agent-nonce": "n", "x-agent-signature": "s" }, // missing fingerprint
    { "x-agent-key-fingerprint": "fp", "x-agent-nonce": "n", "x-agent-signature": "s" }, // missing timestamp
    { "x-agent-key-fingerprint": "fp", "x-agent-timestamp": "123", "x-agent-signature": "s" }, // missing nonce
    { "x-agent-key-fingerprint": "fp", "x-agent-timestamp": "123", "x-agent-nonce": "n" } // missing signature
  ];

  for (const headers of missingHeaderCombos) {
    const req = new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });

    const res = await mcpHandler(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.ok(json.error.message.includes("Missing SSH cryptographic headers"));
  }
});

test("adversarial 4.10: malformed JSON request body on /api/mcp returns JSON-RPC parse error (-32700)", async () => {
  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "this-is-not-valid-json{{{"
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error.code, -32700);
  assert.ok(json.error.message.includes("Parse error: Invalid JSON"));
});

test("adversarial 4.11: scope restriction enforcement blocks unauthorized tool calls with HTTP 403", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const scopedAgent = await keyStore.registerKey({
    agentName: "Geometry-Only-Agent",
    publicKeyPem: keypair.publicKeyPem,
    scopes: ["geometry:*"], // Only allowed geometry tools: crop_image, circle_crop, flip_image, rotate_image, straighten_photo
    initialCredits: 100
  });

  // Attempt to call "adjust_contrast" (filter tool, forbidden for this key)
  const image = await makeTestImage();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "scope-1",
    method: "tools/call",
    params: {
      name: "adjust_contrast",
      arguments: { image_base64: image, factor: 20 }
    }
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "scope-nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": scopedAgent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error.message.includes("Forbidden: Key scopes"));
  assert.ok(json.error.message.includes("do not permit executing tool 'adjust_contrast'"));

  // Check that 0 credits were deducted
  const finalKey = await keyStore.findKeyByFingerprint(scopedAgent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 100);
});

test("adversarial 4.12: balance exhaustion blocks tool calls with HTTP 402 Insufficient Credits", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Zero-Credit-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 0 // Zero balance
  });

  const image = await makeTestImage();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "exhaust-1",
    method: "tools/call",
    params: {
      name: "crop_image",
      arguments: { image_base64: image, width: 50, height: 50 }
    }
  });

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "exhaust-nonce-" + crypto.randomUUID();
  const sig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body
  });

  const req = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": sig
    },
    body
  });

  const res = await mcpHandler(req);
  assert.equal(res.status, 402);
  const json = await res.json();
  assert.ok(json.error.message.includes("Insufficient Credits. Required: 1, Available: 0"));
});

test("adversarial 4.13: telemetry audit log relational persistence verification across auth & execution states", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Audit-Log-Verification-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // 1. Successful execution
  const image = await makeTestImage();
  const bodySuccess = JSON.stringify({
    jsonrpc: "2.0",
    id: "audit-1",
    method: "tools/call",
    params: { name: "crop_image", arguments: { image_base64: image, width: 50, height: 50 } }
  });
  const ts1 = Math.floor(Date.now() / 1000).toString();
  const nonce1 = "audit-nonce-1-" + crypto.randomUUID();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts1,
    nonce: nonce1,
    body: bodySuccess
  });

  const req1 = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts1,
      "x-agent-nonce": nonce1,
      "x-agent-signature": sig1
    },
    body: bodySuccess
  });
  await mcpHandler(req1);

  // 2. Query AuditLog records in database
  const logs = await prisma.auditLog.findMany({
    where: { fingerprint: agent.fingerprint }
  });
  assert.ok(logs.length >= 1);
  const successLog = logs.find((l) => l.toolName === "crop_image" && l.status === "success");
  assert.ok(successLog);
  assert.equal(successLog.signatureValid, true);
  assert.equal(successLog.costCredits, 1);
  assert.equal(successLog.creditsRemaining, 49);
});

