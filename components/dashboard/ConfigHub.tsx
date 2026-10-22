"use client";

import React, { useState } from "react";
import { Copy, Check, Terminal, Code, Layers, Sparkles } from "lucide-react";

interface ConfigHubProps {
  serverUrl?: string;
  fingerprint?: string;
  privateKeyPem?: string;
}

export default function ConfigHub({
  serverUrl,
  fingerprint = "SHA256:your_agent_key_fingerprint",
  privateKeyPem = "-----BEGIN PRIVATE KEY-----\n..."
}: ConfigHubProps) {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const [origin, setOrigin] = useState<string>("");

  React.useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  // Dynamically resolve server URL based on live deployment origin
  const effectiveServerUrl =
    serverUrl ||
    (origin ? `${origin}/api/mcp` : "https://pixel-mesh-iota.vercel.app/api/mcp");

  const claudeDesktopConfig = JSON.stringify({
    mcpServers: {
      pixelmesh: {
        command: "node",
        args: ["./scripts/test-agent-client.ts", "--server", effectiveServerUrl],
        env: {
          AGENT_FINGERPRINT: fingerprint,
          AGENT_PRIVATE_KEY: privateKeyPem
        }
      }
    }
  }, null, 2);

  const cursorMcpConfig = JSON.stringify({
    mcp: {
      servers: [
        {
          name: "pixelmesh-image-mesh",
          type: "http",
          url: effectiveServerUrl,
          headers: {
            "x-agent-key-fingerprint": fingerprint
          }
        }
      ]
    }
  }, null, 2);

  const pythonSnippet = `import requests, time, uuid, json, hashlib
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

# 1. Sign Request
timestamp = str(int(time.time()))
nonce = str(uuid.uuid4())
body = json.dumps({"jsonrpc": "2.0", "method": "tools/list", "id": 1})
body_hash = hashlib.sha256(body.encode()).hexdigest()
canonical = f"POST\\n/api/mcp\\n{timestamp}\\n{nonce}\\n{body_hash}"

# 2. Call PixelMesh MCP Endpoint
headers = {
    "x-agent-key-fingerprint": "${fingerprint}",
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": "base64_signature_here"
}
response = requests.post("${effectiveServerUrl}", data=body, headers=headers)
print(response.json())`;

  const handleCopy = (text: string, tab: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <Code className="w-5 h-5 text-emerald-400" />
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Connect External AI Agents</h3>
          <p className="text-xs text-zinc-400">1-Click configuration snippets for Claude Desktop, Cursor, and Python/Node MCP clients.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Claude Desktop */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Claude Desktop (claude_desktop_config.json)</span>
            <button
              onClick={() => handleCopy(claudeDesktopConfig, "claude")}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
            >
              {copiedTab === "claude" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTab === "claude" ? "Copied!" : "Copy JSON"}
            </button>
          </div>
          <pre className="p-3 bg-zinc-900 rounded-lg text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-44">
            {claudeDesktopConfig}
          </pre>
        </div>

        {/* Cursor IDE */}
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Cursor IDE (.cursor/mcp.json)</span>
            <button
              onClick={() => handleCopy(cursorMcpConfig, "cursor")}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
            >
              {copiedTab === "cursor" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTab === "cursor" ? "Copied!" : "Copy JSON"}
            </button>
          </div>
          <pre className="p-3 bg-zinc-900 rounded-lg text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-44">
            {cursorMcpConfig}
          </pre>
        </div>
      </div>
    </div>
  );
}
