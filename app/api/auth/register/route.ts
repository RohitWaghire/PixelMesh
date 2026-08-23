import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature, computeKeyFingerprint } from "@/lib/auth/agent-crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent_name, public_key, signature, timestamp, algorithm = "ed25519" } = body;

    if (!public_key) {
      return NextResponse.json({ error: "Missing required field: public_key" }, { status: 400 });
    }

    if (!signature || !timestamp) {
      return NextResponse.json({ error: "Missing required proof-of-ownership signature and timestamp headers." }, { status: 400 });
    }

    // Proof-of-ownership signature check (300s window)
    const now = Math.floor(Date.now() / 1000);
    const parsedTs = parseInt(String(timestamp), 10);
    if (isNaN(parsedTs) || Math.abs(now - parsedTs) > 300) {
      return NextResponse.json({ error: "Proof of ownership timestamp expired" }, { status: 400 });
    }

    const isValid = verifyRequestSignature({
      publicKeyPem: public_key,
      signature,
      method: "POST",
      path: "/api/auth/register",
      timestamp: String(timestamp),
      nonce: "register-proof",
      body: JSON.stringify({ agent_name, public_key })
    });

    if (!isValid) {
      return NextResponse.json({ error: "Invalid proof-of-ownership signature" }, { status: 401 });
    }

    const fingerprint = computeKeyFingerprint(public_key);
    const existingKey = await keyStore.findKeyByFingerprint(fingerprint);

    const registered = await keyStore.registerKey({
      agentName: agent_name || "Autonomous AI Agent",
      publicKeyPem: public_key,
      algorithm,
      initialCredits: 100
    });

    const isNew = !existingKey;

    return NextResponse.json({
      success: true,
      message: isNew 
        ? "Agent public key successfully enrolled. 100 free credits granted."
        : "Agent public key is already registered.",
      agent: {
        fingerprint: registered.fingerprint,
        agent_name: registered.agentName,
        credits_balance: registered.creditsBalance,
        scopes: registered.scopes,
        status: registered.status
      },
      mcp_endpoint: "/api/mcp"
    }, { status: isNew ? 201 : 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to register agent" }, { status: 500 });
  }
}
