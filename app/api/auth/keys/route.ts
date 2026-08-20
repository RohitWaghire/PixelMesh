import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { generateAgentKeypair } from "@/lib/auth/agent-crypto";

export async function GET() {
  const keys = keyStore.getAllKeys();
  const devKeypair = keyStore.getDevKeypair();

  return NextResponse.json({
    keys,
    devKeypair: devKeypair ? {
      fingerprint: keys[0]?.fingerprint,
      publicKeyPem: devKeypair.publicKeyPem,
      privateKeyPem: devKeypair.privateKeyPem
    } : null
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, fingerprint, amount, algorithm = "ed25519", agent_name, public_key } = body;

    if (action === "generate") {
      const keypair = generateAgentKeypair(algorithm);
      const registered = keyStore.registerKey({
        agentName: agent_name || `Generated Agent (${algorithm})`,
        publicKeyPem: keypair.publicKeyPem,
        algorithm,
        initialCredits: 100
      });
      return NextResponse.json({
        success: true,
        keypair,
        agent: registered
      });
    }

    if (action === "topup") {
      if (!fingerprint || !amount) {
        return NextResponse.json({ error: "Missing fingerprint or amount" }, { status: 400 });
      }
      const updated = keyStore.topUpCredits(fingerprint, Number(amount));
      return NextResponse.json({ success: true, agent: updated });
    }

    if (action === "revoke") {
      if (!fingerprint) {
        return NextResponse.json({ error: "Missing fingerprint" }, { status: 400 });
      }
      const updated = keyStore.revokeKey(fingerprint);
      return NextResponse.json({ success: true, agent: updated });
    }

    if (action === "add") {
      if (!public_key) {
        return NextResponse.json({ error: "Missing public_key" }, { status: 400 });
      }
      const registered = keyStore.registerKey({
        agentName: agent_name || "Custom Agent",
        publicKeyPem: public_key,
        algorithm,
        initialCredits: 100
      });
      return NextResponse.json({ success: true, agent: registered });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
