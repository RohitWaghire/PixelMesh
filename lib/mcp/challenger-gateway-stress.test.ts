/**
 * PixelMesh Phase 1 - Challenger MCP Gateway Concurrency & Error Handling Stress Test Suite
 * 
 * Adversarial tests:
 * 1. 100 concurrent MCP gateway calls with mixed valid operations and isError: true failures (verify only successful tools debit).
 * 2. High-concurrency tool execution with credit depletion boundary.
 * 3. Concurrent replay attack flood (50 identical nonces hitting gateway simultaneously).
 * 4. Concurrent scope violation enforcement (geometry:* vs unauthorized color filters).
 */

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import crypto from "crypto";
import { keyStore } from "../auth/key-store";
import { generateAgentKeypair, signRequestPayload, computeKeyFingerprint } from "../auth/agent-crypto";
import { nonceCache } from "../auth/nonce-cache";
import { prisma, resetMockDb } from "../db/prisma";
import { resetMockRedis } from "../redis/client";
import { NextRequest } from "next/server";
import { POST as mcpHandler } from "../../app/api/mcp/route";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
});

async function makeTestImage(w = 100, h = 100, r = 100, g = 150, b = 200): Promise<string> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } }
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("challenger-gateway: 100 concurrent gateway calls with mixed success (50) and isError: true (50) on single key", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Gateway-Stress-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const validImage = await makeTestImage(80, 80);

  // Generate 50 valid requests and 50 failing requests (25 argument validation errors, 25 processing errors)
  const requests = Array.from({ length: 100 }, async (_, i) => {
    const isValid = i % 2 === 0;
    const isValidationError = !isValid && i % 4 === 1;
    const isExecutionError = !isValid && i % 4 === 3;
    const toolName = isValid ? "adjust_brightness" : "crop_image";

    // Valid: proper arguments; Validation error: missing image_base64; Execution error: corrupt base64
    let args: any;
    if (isValid) {
      args = { image_base64: validImage, factor: 10 };
    } else if (isValidationError) {
      args = { width: 40, height: 40 }; // missing image_base64
    } else {
      args = { image_base64: "data:image/png;base64,corrupted-payload", width: 40, height: 40 };
    }

    const bodyObj = {
      jsonrpc: "2.0",
      id: `req-stress-${i}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    };

    const bodyStr = JSON.stringify(bodyObj);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = `nonce-concurrent-${i}-${crypto.randomUUID()}`;
    const signature = signRequestPayload({
      privateKeyPem: keypair.privateKeyPem,
      method: "POST",
      path: "/api/mcp",
      timestamp,
      nonce,
      body: bodyStr
    });

    const req = new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature
      },
      body: bodyStr
    });

    const res = await mcpHandler(req);
    const json = await res.json();
    return {
      index: i,
      isValid,
      isValidationError,
      isExecutionError,
      status: res.status,
      json,
      headers: res.headers
    };
  });

  const results = await Promise.all(requests);

  const validResults = results.filter(r => r.isValid);
  const errorResults = results.filter(r => !r.isValid);

  assert.equal(validResults.length, 50, "Should have 50 valid requests");
  assert.equal(errorResults.length, 50, "Should have 50 invalid requests");

  // Verify all 50 valid requests succeeded
  for (const v of validResults) {
    assert.equal(v.status, 200);
    assert.equal(v.json.result.isError, undefined, "Valid result must not have isError: true");
    assert.ok(v.json.result.image_base64, "Valid result must return transformed image");
  }

  // Verify all 50 failing requests returned isError: true with 0 credits deducted
  for (const e of errorResults) {
    assert.equal(e.status, 200);
    assert.equal(e.json.result.isError, true, "Invalid request must return isError: true");
  }

  // Verify final agent key balance in database
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);
  assert.equal(
    finalKey.creditsBalance,
    50,
    `Final balance must be exactly 50 (100 initial - 50 successful * 1 credit). Actual: ${finalKey.creditsBalance}`
  );
  assert.equal(finalKey.totalInvocations, 50, "Total invocations must be exactly 50");

  // Verify CreditTransaction ledger entries
  const deductionTxs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });

  assert.equal(deductionTxs.length, 50, "Exactly 50 USAGE_DEDUCTION records in ledger");
  const totalDeducted = deductionTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  assert.equal(totalDeducted, 50, "Total credits deducted must be exactly 50");

  // Verify Telemetry AuditLogs
  const auditLogs = await prisma.auditLog.findMany({
    where: { fingerprint: agent.fingerprint }
  });

  const successLogs = auditLogs.filter(l => l.status === "success");
  const toolErrorLogs = auditLogs.filter(l => l.status === "tool_error");

  assert.equal(successLogs.length, 50, "AuditLog must record 50 success logs");
  assert.equal(toolErrorLogs.length, 25, "AuditLog records 25 tool_error logs for execution exceptions (validation early returns lack audit logs)");
  assert.ok(toolErrorLogs.every(l => l.costCredits === 0), "All tool_error logs must have costCredits === 0");
  assert.ok(successLogs.every(l => l.costCredits === 1), "All success logs must have costCredits === 1");
});

test("challenger-gateway: concurrent replay attack flood (50 concurrent requests with identical nonce)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Replay-Flood-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 100
  });

  const testImage = await makeTestImage(50, 50);
  const bodyStr = JSON.stringify({
    jsonrpc: "2.0",
    id: "flood-1",
    method: "tools/call",
    params: {
      name: "flip_image",
      arguments: { image_base64: testImage, direction: "horizontal" }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sharedNonce = "shared-flood-nonce-" + crypto.randomUUID();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce: sharedNonce,
    body: bodyStr
  });

  // Launch 50 concurrent requests with the identical nonce
  const floodTasks = Array.from({ length: 50 }, async () => {
    const req = new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": sharedNonce,
        "x-agent-signature": signature
      },
      body: bodyStr
    });

    const res = await mcpHandler(req);
    const json = await res.json();
    return { status: res.status, json };
  });

  const results = await Promise.all(floodTasks);

  const accepted = results.filter(r => r.status === 200);
  const rejected = results.filter(r => r.status === 401);

  assert.equal(accepted.length, 1, "Exactly ONE request must be accepted");
  assert.equal(rejected.length, 49, "Exactly 49 duplicate requests must be rejected with 401 Unauthorized");

  for (const rej of rejected) {
    assert.ok(rej.json.error?.message.includes("Replay attack detected"));
  }

  // Exactly 1 credit deducted
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 99);
  assert.equal(finalKey?.totalInvocations, 1);
});

test("challenger-gateway: concurrent scope violation enforcement (geometry:* vs color filters)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Geometry-Only-Agent",
    publicKeyPem: keypair.publicKeyPem,
    scopes: ["geometry:*"],
    initialCredits: 100
  });

  const testImage = await makeTestImage(60, 60);

  const tasks = Array.from({ length: 40 }, async (_, i) => {
    const isGeometry = i % 2 === 0;
    const toolName = isGeometry ? "crop_image" : "adjust_brightness";
    const args = isGeometry
      ? { image_base64: testImage, width: 30, height: 30 }
      : { image_base64: testImage, factor: 20 };

    const bodyStr = JSON.stringify({
      jsonrpc: "2.0",
      id: `scope-task-${i}`,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = `scope-nonce-${i}-${crypto.randomUUID()}`;
    const signature = signRequestPayload({
      privateKeyPem: keypair.privateKeyPem,
      method: "POST",
      path: "/api/mcp",
      timestamp,
      nonce,
      body: bodyStr
    });

    const req = new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature
      },
      body: bodyStr
    });

    const res = await mcpHandler(req);
    const json = await res.json();
    return { isGeometry, status: res.status, json };
  });

  const results = await Promise.all(tasks);

  const geometryResults = results.filter(r => r.isGeometry);
  const colorResults = results.filter(r => !r.isGeometry);

  assert.equal(geometryResults.length, 20);
  assert.equal(colorResults.length, 20);

  // Geometry calls must succeed
  for (const g of geometryResults) {
    assert.equal(g.status, 200);
    assert.ok(g.json.result.image_base64);
  }

  // Color calls must be rejected with 403 Forbidden
  for (const c of colorResults) {
    assert.equal(c.status, 403);
    assert.ok(c.json.error?.message.includes("Forbidden: Key scopes"));
  }

  // Balance: 100 - 20 = 80
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(finalKey?.creditsBalance, 80);
  assert.equal(finalKey?.totalInvocations, 20);
});

test("challenger-gateway: concurrent valid requests exceeding balance (overdraw race boundary)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const initialCredits = 5;
  const agent = await keyStore.registerKey({
    agentName: "Overdraw-Gateway-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits
  });

  const testImage = await makeTestImage(40, 40);

  // Send 20 concurrent valid requests (1 credit each) when only 5 credits exist
  const tasks = Array.from({ length: 20 }, async (_, i) => {
    const bodyStr = JSON.stringify({
      jsonrpc: "2.0",
      id: `overdraw-task-${i}`,
      method: "tools/call",
      params: {
        name: "adjust_brightness",
        arguments: { image_base64: testImage, factor: 10 }
      }
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = `overdraw-nonce-${i}-${crypto.randomUUID()}`;
    const signature = signRequestPayload({
      privateKeyPem: keypair.privateKeyPem,
      method: "POST",
      path: "/api/mcp",
      timestamp,
      nonce,
      body: bodyStr
    });

    const req = new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-key-fingerprint": agent.fingerprint,
        "x-agent-timestamp": timestamp,
        "x-agent-nonce": nonce,
        "x-agent-signature": signature
      },
      body: bodyStr
    });

    const res = await mcpHandler(req);
    const json = await res.json();
    return {
      index: i,
      status: res.status,
      json,
      headers: res.headers
    };
  });

  const results = await Promise.all(tasks);

  // Database balance check: Must NEVER be negative
  const finalKey = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.ok(finalKey);
  assert.equal(finalKey.creditsBalance, 0, "Final database balance must be 0 (never negative)");

  // Credit transactions in DB
  const deductionTxs = await prisma.creditTransaction.findMany({
    where: { agentKeyId: agent.id, type: "USAGE_DEDUCTION" }
  });
  assert.equal(deductionTxs.length, 5, "Database must record exactly 5 USAGE_DEDUCTION transactions");

  console.log(`[Gateway Overdraw Test] HTTP 200 count: ${results.filter(r => r.status === 200).length}, HTTP 402 count: ${results.filter(r => r.status === 402).length}`);
});

