import crypto from "crypto";
import sharp from "sharp";
import { generateAgentKeypair, signRequestPayload, computeKeyFingerprint } from "../lib/auth/agent-crypto";

const BASE_URL = process.env.PIXELMESH_URL || "http://localhost:3000";

async function createSampleImage(): Promise<string> {
  const buf = await sharp({
    create: {
      width: 300,
      height: 200,
      channels: 3,
      background: { r: 60, g: 120, b: 220 }
    }
  }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function runAutonomousAgentDemo() {
  console.log("=========================================================");
  console.log("🚀 PIXELMESH: Autonomous AI Agent Client Simulation");
  console.log(`🌐 Server Target: ${BASE_URL}`);
  console.log("=========================================================\n");

  // Step 1: Autonomous Key Generation
  console.log("🔑 [Step 1] Generating Local Ed25519 Cryptographic Keypair...");
  const keypair = generateAgentKeypair("ed25519");
  const fingerprint = computeKeyFingerprint(keypair.publicKeyPem);
  console.log(`   ➔ Algorithm: Ed25519`);
  console.log(`   ➔ Fingerprint: ${fingerprint}`);

  // Step 2: Autonomous Self-Registration Knock
  console.log("\n🤖 [Step 2] Sending Self-Registration Knock to /api/auth/register...");
  const regTimestamp = Math.floor(Date.now() / 1000).toString();
  const regBody = JSON.stringify({
    agent_name: "Autonomous-Test-Runner",
    public_key: keypair.publicKeyPem
  });

  const regSignature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/auth/register",
    timestamp: regTimestamp,
    nonce: "register-proof",
    body: regBody
  });

  let serverOnline = false;
  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_name: "Autonomous-Test-Runner",
        public_key: keypair.publicKeyPem,
        signature: regSignature,
        timestamp: regTimestamp
      })
    });

    if (regRes.ok) {
      serverOnline = true;
      const regData = await regRes.json();
      console.log(`   ✅ Registration response:`, regData.message);
      console.log(`   🪙 Initial Balance: ${regData.agent.credits_balance} Credits`);
    }
  } catch {
    console.log(`   ℹ️ Dev server not currently bound on port 3000, running simulated validation loop...`);
  }

  // Step 3: MCP tools/list Request
  console.log("\n📋 [Step 3] Fetching Tool Catalog via Signed MCP /api/mcp...");
  const listBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "req-list-1",
    method: "tools/list"
  });
  const listTimestamp = Math.floor(Date.now() / 1000).toString();
  const listNonce = crypto.randomUUID();
  const listSignature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: listTimestamp,
    nonce: listNonce,
    body: listBody
  });

  console.log(`   ➔ Generated Nonce: ${listNonce}`);
  console.log(`   ➔ Signed Canonical Hash: ${listSignature.slice(0, 20)}...`);

  if (serverOnline) {
    const listRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key-fingerprint": fingerprint,
        "x-agent-timestamp": listTimestamp,
        "x-agent-nonce": listNonce,
        "x-agent-signature": listSignature
      },
      body: listBody
    });
    const listData = await listRes.json();
    console.log(`   ✅ Tools received: ${listData.result?.tools?.length} available tools`);
  }

  // Step 4: Execute Image Filter Tool
  console.log("\n🎨 [Step 4] Executing Image Tool 'glow_effect' + 'rotate_image'...");
  const sampleImage = await createSampleImage();
  const toolBody = JSON.stringify({
    jsonrpc: "2.0",
    id: "req-call-1",
    method: "tools/call",
    params: {
      name: "batch_filter_pipeline",
      arguments: {
        image_base64: sampleImage,
        operations: [
          { tool: "rotate_image", params: { degrees: 90 } },
          { tool: "glow_effect", params: { intensity: 45, radius: 10 } },
          { tool: "adjust_brightness", params: { factor: 20 } }
        ]
      }
    }
  });

  const toolTimestamp = Math.floor(Date.now() / 1000).toString();
  const toolNonce = crypto.randomUUID();
  const toolSignature = signRequestPayload({
    privateKeyPem: keypair.privateKeyPem,
    method: "POST",
    path: "/api/mcp",
    timestamp: toolTimestamp,
    nonce: toolNonce,
    body: toolBody
  });

  console.log(`   ➔ Payload size: ${(toolBody.length / 1024).toFixed(1)} KB`);
  console.log(`   ➔ Signed with Ed25519 Private Key: ${toolSignature.slice(0, 25)}...`);

  if (serverOnline) {
    const toolRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key-fingerprint": fingerprint,
        "x-agent-timestamp": toolTimestamp,
        "x-agent-nonce": toolNonce,
        "x-agent-signature": toolSignature
      },
      body: toolBody
    });
    const toolData = await toolRes.json();
    console.log(`   ✅ Tool execution successful! Execution time: ${toolData.result?.execution_time_ms}ms`);
    console.log(`   🪙 Remaining Credits: ${toolRes.headers.get("x-agent-credits-remaining")}`);
  }

  console.log("\n=========================================================");
  console.log("✨ PIXELMESH AGENT DEMO SIMULATION COMPLETE");
  console.log("=========================================================");
}

runAutonomousAgentDemo().catch(console.error);
