import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import crypto from "crypto";
import { keyStore } from "../auth/key-store";
import { signRequestPayload, generateAgentKeypair, computeKeyFingerprint } from "../auth/agent-crypto";
import { MCP_IMAGE_TOOLS } from "./tool-schemas";
import { processSingleFilter } from "../image/engine";
import { resetMockDb } from "../db/prisma";
import { resetMockRedis } from "../redis/client";
import { nonceCache } from "../auth/nonce-cache";
import { NextRequest } from "next/server";
import { POST as mcpPostHandler } from "../../app/api/mcp/route";

beforeEach(async () => {
  resetMockDb();
  resetMockRedis();
  await nonceCache.clear();
});

async function createTestImage(): Promise<string> {
  const buf = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 120, g: 80, b: 200 } }
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("mcp: tool catalog exposes all 21+ tools with strict input schemas", () => {
  assert.ok(MCP_IMAGE_TOOLS.length >= 21, "Must contain all 21+ tools");
  const cropTool = MCP_IMAGE_TOOLS.find(t => t.name === "crop_image");
  assert.ok(cropTool);
  assert.ok(cropTool.inputSchema.required.includes("image_base64"));
});

test("mcp: signed JSON-RPC execution flow with credit deduction", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "MCP Test Worker",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const testImage = await createTestImage();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "test-call-1",
    method: "tools/call",
    params: {
      name: "adjust_brightness",
      arguments: {
        image_base64: testImage,
        factor: 25
      }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "test-nonce-" + Math.random().toString(36).substring(2, 9);
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body
  });

  assert.ok(signature.length > 0);

  // Simulate filter execution and deduction
  const result = await processSingleFilter(testImage, "adjust_brightness", { factor: 25 });
  const deduction = await keyStore.deductCredits(agent.fingerprint, 1);

  assert.equal(deduction.remaining, 49);
  assert.ok(result.imageBase64.startsWith("data:image/png;base64,"));
});

test("mcp: 0-credit deduction on tool validation failure (isError: true)", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Error-Handling-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 50
  });

  const rawBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "err-call-1",
    method: "tools/call",
    params: {
      name: "crop_image",
      arguments: {
        image_base64: "" // Missing/empty image
      }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "err-nonce-" + crypto.randomUUID();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body: rawBody
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
    body: rawBody
  });

  const res = await mcpPostHandler(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.result.isError, true);
  assert.equal(res.headers.get("x-agent-credits-remaining"), "50");

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 50, "Credits must not be deducted on validation error");
});

test("mcp: full HTTP gateway tool execution with header verification", async () => {
  const keypair = generateAgentKeypair("ed25519");
  const agent = await keyStore.registerKey({
    agentName: "Full-Gateway-Agent",
    publicKeyPem: keypair.publicKeyPem,
    initialCredits: 20
  });

  const testImage = await createTestImage();
  const rawBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "gateway-call-1",
    method: "tools/call",
    params: {
      name: "flip_image",
      arguments: {
        image_base64: testImage,
        direction: "horizontal"
      }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "gateway-nonce-" + crypto.randomUUID();
  const signature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp,
    nonce,
    body: rawBody
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
    body: rawBody
  });

  const res = await mcpPostHandler(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-agent-credits-remaining"), "19");

  const json = await res.json();
  assert.ok(json.result.content);
  assert.equal(json.result.content[1].type, "image");
  assert.ok(json.result.image_base64.startsWith("data:image/png;base64,"));

  const keyAfter = await keyStore.findKeyByFingerprint(agent.fingerprint);
  assert.equal(keyAfter?.creditsBalance, 19);
});
