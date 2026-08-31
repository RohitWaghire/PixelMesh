import test from "node:test";
import assert from "node:assert/strict";
import { 
  generateAgentKeypair, 
  computeKeyFingerprint, 
  signRequestPayload, 
  verifyRequestSignature,
  createCanonicalSigningString
} from "@/lib/auth/agent-crypto";

test("agent-crypto: generate keypair and compute fingerprint", () => {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair("ed25519");
  assert.ok(publicKeyPem.includes("BEGIN PUBLIC KEY"));
  assert.ok(privateKeyPem.includes("BEGIN PRIVATE KEY"));

  const fingerprint = computeKeyFingerprint(publicKeyPem);
  assert.ok(fingerprint.startsWith("SHA256:"), "Fingerprint must start with SHA256:");
  assert.equal(fingerprint.length > 20, true, "Fingerprint must be a valid hash");
});

test("agent-crypto: valid ed25519 signature succeeds verification", () => {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair("ed25519");
  const method = "POST";
  const path = "/api/mcp";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "550e8400-e29b-41d4-a716-446655440000";
  const body = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });

  const signature = signRequestPayload({
    privateKeyPem,
    method,
    path,
    timestamp,
    nonce,
    body
  });

  assert.ok(signature.length > 10, "Signature should be non-empty base64");

  const isValid = verifyRequestSignature({
    publicKeyPem,
    signature,
    method,
    path,
    timestamp,
    nonce,
    body
  });

  assert.equal(isValid, true, "Valid signature must verify successfully");
});

test("agent-crypto: tampered body fails verification", () => {
  const { publicKeyPem, privateKeyPem } = generateAgentKeypair("ed25519");
  const method = "POST";
  const path = "/api/mcp";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "550e8400-e29b-41d4-a716-446655440000";
  const body = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });

  const signature = signRequestPayload({
    privateKeyPem,
    method,
    path,
    timestamp,
    nonce,
    body
  });

  const tamperedBody = JSON.stringify({ jsonrpc: "2.0", method: "tools/call", id: 1 });
  const isValid = verifyRequestSignature({
    publicKeyPem,
    signature,
    method,
    path,
    timestamp,
    nonce,
    body: tamperedBody
  });

  assert.equal(isValid, false, "Tampered payload must fail verification");
});
