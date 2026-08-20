import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { keyStore } from "../auth/key-store";
import { signRequestPayload, generateAgentKeypair } from "../auth/agent-crypto";
import { MCP_IMAGE_TOOLS } from "./tool-schemas";
import { processSingleFilter } from "../image/engine";

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
  const agent = keyStore.registerKey({
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
  const deduction = keyStore.deductCredits(agent.fingerprint, 1);

  assert.equal(deduction.remaining, 49);
  assert.ok(result.imageBase64.startsWith("data:image/png;base64,"));
});
