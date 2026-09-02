import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";

/**
 * GET /api/auth/keys
 * Returns public metadata for registered agent keys.
 * NEVER returns private keys.
 */
export async function GET() {
  try {
    const allKeys = await keyStore.listKeys();
    
    // Sanitize to ensure only public fields are exposed
    const publicKeys = allKeys.map(k => ({
      fingerprint: k.fingerprint,
      agentName: k.agentName,
      publicKeyPem: k.publicKeyPem,
      algorithm: k.algorithm,
      creditsBalance: k.creditsBalance,
      scopes: k.scopes,
      totalInvocations: k.totalInvocations,
      status: k.status,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt
    }));

    return NextResponse.json({
      keys: publicKeys
    });
  } catch (err: any) {
    console.error("[AuthKeys] Error listing keys:", err);
    return NextResponse.json({
      error: "Internal server error: Failed to retrieve authorized keys."
    }, { status: 500 });
  }
}

/**
 * POST /api/auth/keys
 * Protected administrative action plane.
 * Requires cryptographic signature from the key owner or authorized admin key.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const { action, fingerprint } = body;

    // Extract cryptographic signature headers
    const callerFingerprint = req.headers.get("x-agent-key-fingerprint");
    const timestampStr = req.headers.get("x-agent-timestamp");
    const nonce = req.headers.get("x-agent-nonce");
    const signature = req.headers.get("x-agent-signature");

    if (!callerFingerprint || !timestampStr || !nonce || !signature) {
      return NextResponse.json({
        error: "Unauthorized: Missing required cryptographic authentication headers (X-Agent-Key-Fingerprint, X-Agent-Timestamp, X-Agent-Nonce, X-Agent-Signature)."
      }, { status: 401 });
    }

    const timestampNum = parseInt(timestampStr, 10);
    const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum, callerFingerprint);
    if (!nonceCheck.valid) {
      return NextResponse.json({
        error: `Unauthorized: ${nonceCheck.reason}`
      }, { status: nonceCheck.statusCode || 401 });
    }

    const callerKey = await keyStore.findKeyByFingerprint(callerFingerprint);
    if (!callerKey || callerKey.status === "revoked") {
      return NextResponse.json({
        error: "Unauthorized: Agent key not found or revoked."
      }, { status: 401 });
    }

    const isValidSig = verifyRequestSignature({
      publicKeyPem: callerKey.publicKeyPem,
      signature,
      method: "POST",
      path: "/api/auth/keys",
      timestamp: timestampStr,
      nonce,
      body: rawBody
    });

    if (!isValidSig) {
      return NextResponse.json({
        error: "Unauthorized: Cryptographic signature verification failed."
      }, { status: 401 });
    }

    // Action: Self-Revocation
    if (action === "revoke") {
      if (!fingerprint) {
        return NextResponse.json({ error: "Missing target fingerprint to revoke" }, { status: 400 });
      }

      // Only the key owner or an admin-scoped key can revoke
      const isOwner = callerFingerprint === fingerprint;
      const isAdmin = callerKey.scopes?.includes("admin");

      if (!isOwner && !isAdmin) {
        return NextResponse.json({
          error: "Forbidden: You are not authorized to revoke this key."
        }, { status: 403 });
      }

      const updated = await keyStore.revokeKey(fingerprint);
      return NextResponse.json({ success: true, agent: updated });
    }

    return NextResponse.json({
      error: `Forbidden: Action '${action}' is not permitted via public API. Key enrollment must use /api/auth/register with proof-of-possession.`
    }, { status: 403 });

  } catch (err: any) {
    console.error("[AuthKeys] Error handling key action:", err);
    return NextResponse.json({ error: "Internal server error: Key operation failed." }, { status: 500 });
  }
}
