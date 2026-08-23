import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import crypto from "crypto";
import { keyStore } from "../lib/auth/key-store";
import { generateAgentKeypair, signRequestPayload, computeKeyFingerprint, verifyRequestSignature } from "../lib/auth/agent-crypto";
import { nonceCache } from "../lib/auth/nonce-cache";
import { processSingleFilter, processPipeline } from "../lib/image/engine";
import { resetMockDb } from "../lib/db/prisma";
import { resetMockRedis } from "../lib/redis/client";
import { NextRequest } from "next/server";
import { POST as registerHandler } from "../app/api/auth/register/route";
import { POST as mcpHandler } from "../app/api/mcp/route";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
});

async function makeTestImage(): Promise<string> {
  const buf = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 50, g: 150, b: 250 } }
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("e2e: autonomous agent full journey - registration, signing, and filter execution", async () => {
  // 1. Generate Keypair
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);

  // 2. Register Agent
  const agent = await keyStore.registerKey({
    agentName: "E2E-Worker-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  assert.equal(agent.creditsBalance, 100);
  assert.equal(agent.status, "active");

  // 3. Prepare Tool Call Payload
  const image = await makeTestImage();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "e2e-1",
    method: "tools/call",
    params: {
      name: "adjust_contrast",
      arguments: { image_base64: image, factor: 40 }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  // 4. Sign with Private Key
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body
  });

  // 5. Server Verification Step
  const isValid = verifyRequestSignature({
    publicKeyPem: agent.publicKeyPem,
    signature,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body
  });
  assert.equal(isValid, true, "Signature verification must succeed");

  // 6. Anti-Replay Check
  const nonceCheck = await nonceCache.checkAndRecord(nonce, parseInt(timestamp, 10));
  assert.equal(nonceCheck.valid, true, "Fresh nonce must be accepted");

  // 7. Duplicate Nonce Rejection
  const replayCheck = await nonceCache.checkAndRecord(nonce, parseInt(timestamp, 10));
  assert.equal(replayCheck.valid, false, "Replayed nonce must be rejected");

  // 8. Execute Tool
  const result = await processSingleFilter(image, "adjust_contrast", { factor: 40 });
  assert.ok(result.imageBase64.startsWith("data:image/png;base64,"));
  assert.equal(result.metadata.width, 120);

  // 9. Deduct Credits
  const deduction = await keyStore.deductCredits(fingerprint, 1);
  assert.equal(deduction.remaining, 99);
});

test("e2e: security - tampered signature and balance exhaustion defense", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "E2E-Security-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 2
  });

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1 });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body
  });

  // Tamper check
  const isTamperedValid = verifyRequestSignature({
    publicKeyPem: agent.publicKeyPem,
    signature,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2 }) // Changed id
  });
  assert.equal(isTamperedValid, false, "Tampered payload must fail cryptographic verification");

  // Balance exhaustion check
  const deduct1 = await keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct1.remaining, 1);

  const deduct2 = await keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct2.remaining, 0);

  const deduct3 = await keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct3.success, false, "Should fail when balance is exhausted");
  assert.ok(deduct3.error?.includes("Insufficient credits"));
});

test("e2e: full gateway journey - autonomous registration, signed tool invocation, and replay defense", async () => {
  // Step 1: Autonomous Enrollment via /api/auth/register
  const keypair = generateAgentKeypair("ed25519");
  const regTimestamp = Math.floor(Date.now() / 1000).toString();
  const regPayload = {
    agent_name: "Autonomous Gateway Voyager",
    public_key: keypair.publicKeyPem,
    algorithm: "ed25519"
  };
  const regBody = JSON.stringify(regPayload);
  const regSig = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: regTimestamp,
    nonce: "register-proof",
    body: JSON.stringify({ agent_name: regPayload.agent_name, public_key: regPayload.public_key })
  });

  const regReq = new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...regPayload,
      signature: regSig,
      timestamp: regTimestamp
    })
  });

  const regRes = await registerHandler(regReq);
  assert.equal(regRes.status, 201);
  const regJson = await regRes.json();
  assert.equal(regJson.success, true);
  assert.equal(regJson.agent.credits_balance, 100);
  const fingerprint = regJson.agent.fingerprint;

  // Step 2: Invoke Single Tool (crop_image) on /api/mcp
  const testImage = await makeTestImage();
  const cropBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "voyager-crop-1",
    method: "tools/call",
    params: {
      name: "crop_image",
      arguments: {
        image_base64: testImage,
        width: 60,
        height: 60
      }
    }
  });

  const timestamp1 = Math.floor(Date.now() / 1000).toString();
  const nonce1 = "nonce-" + crypto.randomUUID();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: timestamp1,
    nonce: nonce1,
    body: cropBody
  });

  const cropReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": fingerprint,
      "x-agent-timestamp": timestamp1,
      "x-agent-nonce": nonce1,
      "x-agent-signature": sig1
    },
    body: cropBody
  });

  const cropRes = await mcpHandler(cropReq);
  assert.equal(cropRes.status, 200);
  assert.equal(cropRes.headers.get("x-agent-credits-remaining"), "99");
  const cropJson = await cropRes.json();
  assert.ok(cropJson.result.image_base64.startsWith("data:image/png;base64,"));

  // Step 3: Replay Attack Defense
  const replayReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": fingerprint,
      "x-agent-timestamp": timestamp1,
      "x-agent-nonce": nonce1,
      "x-agent-signature": sig1
    },
    body: cropBody
  });

  const replayRes = await mcpHandler(replayReq);
  assert.equal(replayRes.status, 401);
  const replayJson = await replayRes.json();
  assert.ok(replayJson.error.message.includes("Replay attack detected"));

  // Step 4: Batch Filter Pipeline (Cost: 3 credits)
  const batchBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "voyager-batch-1",
    method: "tools/call",
    params: {
      name: "batch_filter_pipeline",
      arguments: {
        image_base64: testImage,
        operations: [
          { tool: "adjust_brightness", params: { factor: 10 } },
          { tool: "grayscale_image" }
        ]
      }
    }
  });

  const timestamp2 = Math.floor(Date.now() / 1000).toString();
  const nonce2 = "nonce-" + crypto.randomUUID();
  const sig2 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: timestamp2,
    nonce: nonce2,
    body: batchBody
  });

  const batchReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": fingerprint,
      "x-agent-timestamp": timestamp2,
      "x-agent-nonce": nonce2,
      "x-agent-signature": sig2
    },
    body: batchBody
  });

  const batchRes = await mcpHandler(batchReq);
  assert.equal(batchRes.status, 200);
  assert.equal(batchRes.headers.get("x-agent-credits-remaining"), "96");

  const keyRecord = await keyStore.findKeyByFingerprint(fingerprint);
  assert.equal(keyRecord?.creditsBalance, 96);
  assert.equal(keyRecord?.totalInvocations, 2);
});

test("e2e: zero-credit deduction on tool validation error and malformed payload", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Zero-Credit-Test-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  // 1. Missing image_base64 parameter
  const malformedBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "fail-1",
    method: "tools/call",
    params: {
      name: "flip_image",
      arguments: { direction: "horizontal" } // image_base64 is missing
    }
  });

  const ts1 = Math.floor(Date.now() / 1000).toString();
  const n1 = "fail-nonce-1-" + crypto.randomUUID();
  const sig1 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts1,
    nonce: n1,
    body: malformedBody
  });

  const req1 = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts1,
      "x-agent-nonce": n1,
      "x-agent-signature": sig1
    },
    body: malformedBody
  });

  const res1 = await mcpHandler(req1);
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.result.isError, true);
  assert.equal(res1.headers.get("x-agent-credits-remaining"), "50");

  // 2. Corrupted image binary to trigger engine processing error
  const corruptBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "fail-2",
    method: "tools/call",
    params: {
      name: "flip_image",
      arguments: {
        image_base64: "data:image/png;base64,not-a-valid-base64-image-stream",
        direction: "vertical"
      }
    }
  });

  const ts2 = Math.floor(Date.now() / 1000).toString();
  const n2 = "fail-nonce-2-" + crypto.randomUUID();
  const sig2 = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: ts2,
    nonce: n2,
    body: corruptBody
  });

  const req2 = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": agent.fingerprint,
      "x-agent-timestamp": ts2,
      "x-agent-nonce": n2,
      "x-agent-signature": sig2
    },
    body: corruptBody
  });

  const res2 = await mcpHandler(req2);
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.result.isError, true);
  assert.equal(res2.headers.get("x-agent-credits-remaining"), "50");

  const keyFinal = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyFinal?.creditsBalance, 50, "Credits must strictly remain intact at 50");
  assert.equal(keyFinal?.totalInvocations, 0);
});

test("e2e: backward compatibility for RSA and Ed25519 signatures across SSH headers", async () => {
  // Test RSA Keypair enrollment and signed invocation
  const rsaKeypair = generateAgentKeypair("rsa");
  const rsaAgent = await keyStore.registerKey({
    agentName: "RSA Enterprise Agent",
    publicKeyPem: rsaKeypair.publicKeyPem,
    algorithm: "rsa",
    initialCredits: 50
  });

  const listBody = JSON.stringify({ jsonrpc: "2.0", id: "rsa-1", method: "tools/list" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = "rsa-nonce-" + crypto.randomUUID();
  const rsaSig = signRequestPayload({
    privateKeyPem: rsaKeypair.privateKeyPem,
    algorithm: "rsa",
    method: "POST",
    path: "/api/mcp",
    timestamp: ts,
    nonce,
    body: listBody
  });

  const rsaReq = new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key-fingerprint": rsaAgent.fingerprint,
      "x-agent-timestamp": ts,
      "x-agent-nonce": nonce,
      "x-agent-signature": rsaSig
    },
    body: listBody
  });

  const rsaRes = await mcpHandler(rsaReq);
  assert.equal(rsaRes.status, 200);
  const rsaJson = await rsaRes.json();
  assert.ok(rsaJson.result.tools.length >= 21);
});
