import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { keyStore } from "@/lib/auth/key-store";
import { verifyRequestSignature } from "@/lib/auth/agent-crypto";
import { nonceCache } from "@/lib/auth/nonce-cache";
import { MCP_IMAGE_TOOLS } from "@/lib/mcp/tool-schemas";
import { canCallTool, declaredInputBytes, hasImageInput as hasMcpImageInput, toolCost } from "@/lib/mcp/tool-policy";
import { processSingleFilter, processPipeline, resolveInputImage } from "@/lib/image/engine";
import { jobQueue, inferJobPriority } from "@/lib/queue/job-queue";
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

  // 2. Anti-Replay and Clock Skew Check via Distributed Nonce Cache (namespaced by fingerprint)
  const nonceCheck = await nonceCache.checkAndRecord(nonce, timestampNum, fingerprint);
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

  // 3. Find Cey in Asynchronous Prisma KeyStore
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
    const hasPermission = canCallTool(allowedScopes, toolName);

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
    const cost = toolCost(toolName, declaredInputBytes(toolArgs));


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

    // Check Prefer: respond-async header
    const preferHeader = req.headers.get("prefer") || "";
    const isAsyncPreferred = preferHeader.toLowerCase().includes("respond-async") || preferHeader.toLowerCase().includes("async");

    if (isAsyncPreferred) {
      const requestedPriority = toolArgs.priority || inferJobPriority(toolName, toolArgs);
      const returnType = toolArgs.return_type || toolArgs.returnType || "base64";
      const asyncJobId = `job_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
      let asyncCreditsRemaining = agentKey.creditsBalance;

      if (cost > 0) {
        const deduction = await keyStore.deductCredits(
          fingerprint,
          cost,
          asyncJobId,
          toolName
        );

        if (!deduction.success) {
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
            creditsRemaining: deduction.remaining,
            latencyMs: Math.round(performance.now() - startTime),
            status: "rate_limited",
            errorMessage: deduction.error || `Insufficient credits (requires ${cost})`
          });

          return NextResponse.json({
            jsonrpc,
            id,
            error: {
              code: -32002,
              message: `Insufficient Credits. Required: ${cost}, Available: ${deduction.remaining}. Top up credits in the dashboard.`
            }
          }, { status: 402 });
        }

        asyncCreditsRemaining = deduction.remaining;
      }

      let jobRecord;
      try {
        jobRecord = await jobQueue.addJob({ 
          id: asyncJobId,
          fingerprint: agentKey.fingerprint,
          agentName: agentKey.agentName,
          toolName,
          toolArgs,
          cost,
          costDeducted: cost,
          returnType,
          priority: requestedPriority
        }, {
          priority: requestedPriority
        });
      } catch (enqueueErr: any) {
        if (cost > 0) {
          try {
            await keyStore.refundCredits(
              fingerprint,
              cost,
              `refund-enqueue-${asyncJobId}`,
              `Refund for enqueue failure: ${enqueueErr.message}`
            );
          } catch (refundErr) {
            console.error(`[McpRoute] Failed to refund ${cost} credits on enqueue failure:`, refundErr);
          }
        }
        throw enqueueErr;
      }

      const pollUrl = `/api/mcp/jobs/${jobRecord.id}`;
      const streamUrl = `/api/mcp/jobs/${jobRecord.id}/stream`;

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
        creditsRemaining: asyncCreditsRemaining,
        latencyMs: latency,
        status: "success"
      });

      const response = NextResponse.json({
        jsonrpc,
        id,
        status: "queued",
        job_id: jobRecord.id,
        jobId: jobRecord.id,
        poll_url: pollUrl,
        stream_url: streamUrl,
        estimated_cost: cost,
        result: {
          status: "queued",
          job_id: jobRecord.id,
          jobId: jobRecord.id,
          poll_url: pollUrl,
          stream_url: streamUrl
        }
      }, { status: 202 });

      response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
      response.headers.set("Location", pollUrl);
      return response;
    }
    // Synchronous Execution Flow
    try {
      let filterResult: any;
      const hasImageInput = hasMcpImageInput(toolArgs);

      if (toolName === "get_image_metadata") {
        if (!hasImageInput) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: 'image_base64', 'image_key', or 'image_url' is required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }

        const resolved = await resolveInputImage(toolArgs);
        const sharp = (await import("sharp")).default;
        const meta = await sharp(resolved.buffer).metadata();

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


      const returnType = toolArgs.return_type || toolArgs.returnType || "base64";

      if (toolName === "batch_filter_pipeline") {
        if (!hasImageInput || !Array.isArray(toolArgs.operations)) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: image input and 'operations' array are required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }
        filterResult = await processPipeline(toolArgs, toolArgs.operations, toolArgs.output_format, returnType);
      } else {
        const { output_format, ...restParams } = toolArgs;
        if (!hasImageInput) {
          const response = NextResponse.json({
            jsonrpc,
            id,
            result: {
              content: [{ type: "text", text: "Invalid arguments: image input is required." }],
              isError: true
            }
          });
          response.headers.set("x-agent-credits-remaining", agentKey.creditsBalance.toString());
          return response;
        }
        filterResult = await processSingleFilter(toolArgs, toolName, restParams, output_format, returnType);
      }

      // Reconcile Cost dynamically based on resolved input image size (ADR 0005)
      const inputBytes = filterResult.inputSizeBytes || (toolArgs.image_base64 ? Math.round(toolArgs.image_base64.length * 0.75) : 0);
      const actualCost = toolCost(toolName, inputBytes);

      // Deduct Credits ONLY after successful execution
      const deduction = await keyStore.deductCredits(fingerprint, actualCost, undefined, toolName);
      if (!deduction.success) {
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
          creditsRemaining: deduction.remaining,
          latencyMs: Math.round(performance.now() - startTime),
          status: "rate_limited",
          errorMessage: deduction.error || "Insufficient credits during settlement."
        });

        return NextResponse.json({
          jsonrpc,
          id,
          error: {
            code: -32002,
            message: `Insufficient Credits: ${deduction.error || "Unable to settle credits. Please top up your balance."}`
          }
        }, { status: 402 });
      }

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
        costCredits: actualCost,
        creditsRemaining: deduction.remaining,
        latencyMs: latency,
        status: "success"
      });

      const resResult: any = {
        content: [
          {
            type: "text",
            text: `Tool '${toolName}' executed successfully in ${filterResult.executionTimeMs}ms. Metadata: ${JSON.stringify(filterResult.metadata)}`
          }
        ],
        metadata: filterResult.metadata,
        execution_time_ms: filterResult.executionTimeMs
      };

      if (filterResult.imageBase64) {
        resResult.content.push({
          type: "image",
          data: filterResult.imageBase64,
          mimeType: filterResult.metadata?.format ? `image/${filterResult.metadata.format}` : "image/png"
        });
        resResult.image_base64 = filterResult.imageBase64;
        resResult.imageBase64 = filterResult.imageBase64;
      }
      if (filterResult.imageKey || filterResult.image_key) {
        resResult.image_key = filterResult.image_key || filterResult.imageKey;
        resResult.imageKey = resResult.image_key;
      }
      if (filterResult.imageUrl || filterResult.image_url || filterResult.publicUrl) {
        resResult.image_url = filterResult.image_url || filterResult.imageUrl || filterResult.publicUrl;
        resResult.imageUrl = resResult.image_url;
        resResult.public_url = resResult.image_url;
        resResult.publicUrl = resResult.image_url;
      }

      const response = NextResponse.json({
        jsonrpc,
        id,
        result: resResult
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
