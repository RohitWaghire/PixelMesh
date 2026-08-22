import { NextRequest, NextResponse } from "next/server";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { MCP_IMAGE_TOOLS } from "@/lib/mcp/tool-schemas";
import { processSingleFilter, processPipeline } from "@/lib/image/engine";
import { telemetryStore } from "@/lib/telemetry/store";

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  const rawBodyText = await req.text();

  let bodyJson: any;
  try {
    bodyJson = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: Invalid JSON" }
    }, { status: 400 });
  }

  const { jsonrpc = "2.0", id = null, method, params = {} } = bodyJson;

  // Extract SSH-Style Signature Headers
  const fingerprint = req.headers.get("x-agent-key-fingerprint");
  const timestampStr = req.headers.get("x-agent-timestamp");
  const nonce = req.headers.get("x-agent-nonce");
  const signature = req.headers.get("x-agent-signature");

  // 1. Authenticate Request Headers
  if (!fingerprint || !timestampStr || !nonce || !signature) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: method || "unknown",
      toolName: params?.name,
      fingerprint: fingerprint || "anonymous",
      agentName: "Unknown Agent",
      signatureValid: false,
      timestampDriftMs: 0,
      nonce: nonce || "none",
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Missing required SSH cryptographic headers (x-agent-key-fingerprint, x-agent-timestamp, x-agent-nonce, x-agent-signature)"
    });

    return NextResponse.json({
      jsonrpc,
      id,
      error: {
        code: -32001,
        message: "Unauthorized: Missing SSH cryptographic headers. Sign requests with your registered Agent Private Key."
      }
    }, { status: 401 });
  }

  const timestampNum = parseInt(timestampStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const driftMs = (nowSec - timestampNum) * 1000;

  // 2. Anti-Replay and Clock Skew Check via Distributed Nonce Cache
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum);
  if (!nonceCheck.valid) {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: method || "unknown",
      toolName: params?.name,
      fingerprint,
      agentName: "Unknown",
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: nonceCheck.reason
    });

    return NextResponse.json({
      jsonrpc,
      id,
      error: { code: -32001, message: `Unauthorized: ${nonceCheck.reason}` }
    }, { status: nonceCheck.statusCode || 401 });
  }

  // 3. Find Key in Asynchronous Prisma KeyStore
  const agentKey = await keyStore.findKeyByFingerprint(fingerprint);
  if (!agentKey || agentKey.status === "revoked") {
    await telemetryStore.addLog({
      timestamp: new Date().toISOString(),
      method: method || "unknown",
      toolName: params?.name,
      fingerprint,
      agentName: "Unknown",
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: 0,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Agent key not registered or has been revoked"
    });

    return NextResponse.json({
      jsonrpc,
      id,
      error: { code: -32001, message: "Unauthorized: Agent key not found or revoked." }
    }, { status: 401 });
  }

  // 4. Verify Cryptographic Signature
  const isValidSig = verifyRequestSignature({
    publicKeyPem: agentKey.publicKeyPem,
    signature,
    method: "POST",
    path: "/api/mcp",
    timestamp: timestampStr,
    nonce,
    body: rawBodyText
  });

  if (!isValidSig) {
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: method || "unknown",
      toolName: params?.name,
      fingerprint,
      agentName: agentKey.agentName,
      signatureValid: false,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: agentKey.creditsBalance,
      latencyMs: Math.round(performance.now() - startTime),
      status: "auth_error",
      errorMessage: "Cryptographic signature verification failed (payload or headers tampered)"
    });

    return NextResponse.json({
      jsonrpc,
      id,
      error: { code: -32001, message: "Unauthorized: Cryptographic signature verification failed." }
    }, { status: 401 });
  }

  // 5. Handle MCP Protocol Methods
  if (method === "tools/list") {
    const latency = Math.round(performance.now() - startTime);
    await telemetryStore.addLog({
      agentKeyId: agentKey.id,
      timestamp: new Date().toISOString(),
      method: "tools/list",
      fingerprint,
      agentName: agentKey.agentName,
      signatureValid: true,
      timestampDriftMs: driftMs,
      nonce,
      costCredits: 0,
      creditsRemaining: agentKey.creditsBalance,
      latencyMs: latency,
      status: "success"
    });

    const response = NextResponse.json({
      jsonrpc,
      id,
      result: { tools: MCP_IMAGE_TOOLS }
    });
    response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
    return response;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    // Validate Key Scopes
    const allowedScopes = agentKey.scopes || ["all-tools"];
    const hasPermission = allowedScopes.includes("all-tools") ||
      allowedScopes.includes(toolName) ||
      (allowedScopes.includes("filters:*") && toolName !== "export_image") ||
      (allowedScopes.includes("geometry:*") && ["crop_image", "circle_crop", "flip_image", "rotate_image", "straighten_photo"].includes(toolName));

    if (!hasPermission) {
      await telemetryStore.addLog({
        agentKeyId: agentKey.id,
        timestamp: new Date().toISOString(),
        method: "tools/call",
        toolName,
        fingerprint,
        agentName: agentKey.agentName,
        signatureValid: true,
        timestampDriftMs: driftMs,
        nonce,
        costCredits: 0,
        creditsRemaining: agentKey.creditsBalance,
        latencyMs: Math.round(performance.now() - startTime),
        status: "auth_error",
        errorMessage: `Scope permission denied for tool: ${toolName}. Key scopes: [${allowedScopes.join(", ")}]`
      });

      return NextResponse.json({
        jsonrpc,
        id,
        error: {
          code: -32001,
          message: `Forbidden: Key scopes [${allowedScopes.join(", ")}] do not permit executing tool '${toolName}'.`
        }
      }, { status: 403 });
    }

    // Determine Cost per ADR 0005
    const isHighRes = Boolean(toolArgs.image_base64 && toolArgs.image_base64.length > 20 * 1024 * 1024);
    const cost = toolName === "get_image_metadata" ? 0 : isHighRes ? 5 : toolName === "batch_filter_pipeline" ? 3 : 1;

    // Check Credit Balance
    if (agentKey.creditsBalance < cost) {
      await telemetryStore.addLog({
        agentKeyId: agentKey.id,
        timestamp: new Date().toISOString(),
        method: "tools/call",
        toolName,
        fingerprint,
        agentName: agentKey.agentName,
        signatureValid: true,
        timestampDriftMs: driftMs,
        nonce,
        costCredits: 0,
        creditsRemaining: agentKey.creditsBalance,
        latencyMs: Math.round(performance.now() - startTime),
        status: "rate_limited",
        errorMessage: `Insufficient credits (requires ${cost}, has ${agentKey.creditsBalance})`
      });

      return NextResponse.json({
        jsonrpc,
        id,
        error: {
          code: -32002,
          message: `Insufficient Credits. Required: ${cost}, Available: ${agentKey.creditsBalance}. Top up credits in the dashboard.`
        }
      }, { status: 402 });
    }

    try {
      let filterResult: any;

      if (toolName === "get_image_metadata") {
        if (!toolArgs.image_base64) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: 'image_base64' is required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }
        const { parseBase64Image } = await import("@/lib/image/engine");
        const sharp = (await import("sharp")).default;
        const { buffer } = parseBase64Image(toolArgs.image_base64);
        const meta = await sharp(buffer).metadata();

        await telemetryStore.addLog({
          agentKeyId: agentKey.id,
          timestamp: new Date().toISOString(),
          method: "tools/call",
          toolName,
          fingerprint,
          agentName: agentKey.agentName,
          signatureValid: true,
          timestampDriftMs: driftMs,
          nonce,
          costCredits: 0,
          creditsRemaining: agentKey.creditsBalance,
          latencyMs: Math.round(performance.now() - startTime),
          status: "success"
        });

        const response = NextResponse.json({
          jsonrpc,
          id,
          result: {
            content: [{ type: "text", text: `Image metadata: ${JSON.stringify(meta)}` }],
            metadata: meta
          }
        });
        response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
        return response;
      }

      if (toolName === "batch_filter_pipeline") {
        if (!toolArgs.image_base64 || !Array.isArray(toolArgs.operations)) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: 'image_base64' and 'operations' array are required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }
        filterResult = await processPipeline(toolArgs.image_base64, toolArgs.operations);
      } else {
        const { image_base64, output_format, ...restParams } = toolArgs;
        if (!image_base64) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: 'image_base64' is required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }
        filterResult = await processSingleFilter(image_base64, toolName, restParams, output_format);
      }

      // Deduct Credits ONLY after successful execution
      const deduction = await keyStore.deductCredits(fingerprint, cost, undefined, toolName);
      const latency = Math.round(performance.now() - startTime);

      await telemetryStore.addLog({
        agentKeyId: agentKey.id,
        timestamp: new Date().toISOString(),
        method: "tools/call",
        toolName,
        fingerprint,
        agentName: agentKey.agentName,
        signatureValid: true,
        timestampDriftMs: driftMs,
        nonce,
        costCredits: cost,
        creditsRemaining: deduction.remaining,
        latencyMs: latency,
        status: "success"
      });

      const response = NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Tool '${toolName}' executed successfully in ${filterResult.executionTimeMs}ms. Metadata: ${JSON.stringify(filterResult.metadata)}`
            },
            {
              type: "image",
              data: filterResult.imageBase64,
              mimeType: filterResult.metadata?.format ? `image/${filterResult.metadata.format}` : "image/png"
            }
          ],
          image_base64: filterResult.imageBase64,
          metadata: filterResult.metadata,
          execution_time_ms: filterResult.executionTimeMs
        }
      });

      response.headers.set("x-agent-credits-remaining", deduction.remaining.toString());
      return response;
    } catch (err: any) {
      // MCP Non-Fatal Error Contract (0 credits deducted on isError: true)
      const latency = Math.round(performance.now() - startTime);

      await telemetryStore.addLog({
        agentKeyId: agentKey.id,
        timestamp: new Date().toISOString(),
        method: "tools/call",
        toolName,
        fingerprint,
        agentName: agentKey.agentName,
        signatureValid: true,
        timestampDriftMs: driftMs,
        nonce,
        costCredits: 0,
        creditsRemaining: agentKey.creditsBalance,
        latencyMs: latency,
        status: "tool_error",
        errorMessage: err.message
      });

      const response = NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Filter operation failed: ${err.message}. Please adjust parameters and retry.`
            }
          ],
          isError: true
        }
      });
      response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
      return response;
    }
  }

  if (method === "resources/list") {
    return NextResponse.json({
      jsonrpc,
      id,
      result: {
        resources: [
          {
            uri: "pixelmesh://capabilities/filters",
            name: "PixelMesh 21+ Filter Tool Suite",
            mimeType: "application/json"
          }
        ]
      }
    });
  }

  return NextResponse.json({
    jsonrpc,
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  }, { status: 404 });
}
