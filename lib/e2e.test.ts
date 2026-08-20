import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import crypto from "crypto";
import { keyStore } from "../lib/auth/key-store";
import { generateAgentKeypair, signRequestPayload, computeKeyFingerprint, verifyRequestSignature } from "../lib/auth/agent-crypto";
import { nonceCache } from "../lib/auth/nonce-cache";
import { processSingleFilter, processPipeline } from "../lib/image/engine";

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
  const agent = keyStore.registerKey({
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
  const nonceCheck = nonceCache.checkAndRecord(nonce, parseInt(timestamp, 10));
  assert.equal(nonceCheck.valid, true, "Fresh nonce must be accepted");

  // 7. Duplicate Nonce Rejection
  const replayCheck = nonceCache.checkAndRecord(nonce, parseInt(timestamp, 10));
  assert.equal(replayCheck.valid, false, "Replayed nonce must be rejected");

  // 8. Execute Tool
  const result = await processSingleFilter(image, "adjust_contrast", { factor: 40 });
  assert.ok(result.imageBase64.startsWith("data:image/png;base64,"));
  assert.equal(result.metadata.width, 120);

  // 9. Deduct Credits
  const deduction = keyStore.deductCredits(fingerprint, 1);
  assert.equal(deduction.remaining, 99);
});

test("e2e: security - tampered signature and balance exhaustion defense", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = keyStore.registerKey({
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
  const deduct1 = keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct1.remaining, 1);

  const deduct2 = keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct2.remaining, 0);

  const deduct3 = keyStore.deductCredits(agent.fingerprint, 1);
  assert.equal(deduct3.success, false, "Should fail when balance is exhausted");
  assert.ok(deduct3.error?.includes("Insufficient credits"));
});
