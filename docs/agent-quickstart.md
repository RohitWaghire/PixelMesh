# Autonomous AI Agent Quickstart Guide

This guide enables autonomous AI agents (Claude, Cursor, Python scripts, or custom agent runners) to self-enroll, sign requests cryptographically, and invoke PixelMesh image processing tools with zero human intervention.

---

## 🧭 The Agent-First Model

Traditional image processing APIs rely on static bearer tokens or dashboard-generated API keys. These credentials routinely leak in agent scratchpads, prompt traces, and subagent forks.

PixelMesh replaces static secrets with **asymmetric cryptographic authentication**:
1. The agent generates a local **Ed25519 keypair**.
2. The agent submits only its **public key** to `/api/auth/register` (granting 100 free instant credits).
3. The agent signs all subsequent HTTP requests with its **private key**. The server verifies the signature against the agent's public key fingerprint.

---

## 🚀 3-Step Autonomous Quickstart

```
    [ Autonomous Agent ]                         [ PixelMesh Gateway ]
             │                                              │
             │ 1. Generate Ed25519 Keypair (Local)          │
             │                                              │
             │ 2. POST /api/auth/register                   │
             │    { publicKeyPem, agentName }               │
             │ ───────────────────────────────────────────> │
             │    < 200 OK: { fingerprint, credits: 100 }   │
             │ <─────────────────────────────────────────── │
             │                                              │
             │ 3. POST /api/mcp (Signed JSON-RPC 2.0)       │
             │    Headers: X-Agent-Signature, Nonce, etc.   │
             │ ───────────────────────────────────────────> │
             │    < 200 OK: Processed Image Result          │
             │ <─────────────────────────────────────────── │
```

---

## 💻 Full Implementation: TypeScript / Node.js

```typescript
import crypto from "node:crypto";

async function runAutonomousAgent() {
  const baseUrl = "https://pixel-mesh-iota.vercel.app";

  // 1. Generate Ed25519 Keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const cleanPublicKey = publicKey.replace(/\r\n/g, "\n").trim();
  const cleanPrivateKey = privateKey.replace(/\r\n/g, "\n").trim();

  // 2. Self-Enroll & Claim Free Credit Grant
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKeyPem: cleanPublicKey,
      agentName: "Autonomous-Vision-Worker-01",
    }),
  });

  const registration = await registerRes.json();
  const fingerprint = registration.fingerprint;
  console.log(`Enrolled successfully! Fingerprint: ${fingerprint}, Credits: ${registration.credits}`);

  // 3. Construct MCP JSON-RPC 2.0 Request
  const mcpPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: {
      name: "make_sepia_tone",
      arguments: {
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        intensity: 65,
      },
    },
  });

  // 4. Sign Request with Canonical String
  const method = "POST";
  const path = "/api/mcp";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash("sha256").update(mcpPayload).digest("hex");

  const canonicalString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const signature = crypto.sign(null, Buffer.from(canonicalString), cleanPrivateKey).toString("base64");

  // 5. Execute Signed MCP Call
  const mcpRes = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Key-Fingerprint": fingerprint,
      "X-Agent-Timestamp": timestamp,
      "X-Agent-Nonce": nonce,
      "X-Agent-Signature": signature,
    },
    body: mcpPayload,
  });

  const result = await mcpRes.json();
  console.log("MCP Result:", JSON.stringify(result, null, 2));
}

runAutonomousAgent().catch(console.error);
```

---

## 🐍 Full Implementation: Python

```python
import time
import uuid
import hashlib
import base64
import requests
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

BASE_URL = "https://pixel-mesh-iota.vercel.app"

# 1. Generate Ed25519 Keypair
private_key = ed25519.Ed25519PrivateKey.generate()
public_key = private_key.public_key()

public_pem = public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
).decode('utf-8')

# 2. Self-Enroll
reg_response = requests.post(f"{BASE_URL}/api/auth/register", json={
    "publicKeyPem": public_pem,
    "agentName": "Python-Agent-Vision"
}).json()

fingerprint = reg_response["fingerprint"]
print(f"Registered! Fingerprint: {fingerprint}, Balance: {reg_response['credits']}")

# 3. Create Payload
payload = {
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
        "name": "crop_image",
        "arguments": {
            "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "left": 0, "top": 0, "width": 1, "height": 1
        }
    }
}
raw_body = json.dumps(payload)

# 4. Canonical Signing
timestamp = str(int(time.time()))
nonce = str(uuid.uuid4())
body_hash = hashlib.sha256(raw_body.encode('utf-8')).hexdigest()
canonical_string = f"POST\n/api/mcp\n{timestamp}\n{nonce}\n{body_hash}"

signature_bytes = private_key.sign(canonical_string.encode('utf-8'))
signature_b64 = base64.b64encode(signature_bytes).decode('utf-8')

# 5. Execute
headers = {
    "Content-Type": "application/json",
    "X-Agent-Key-Fingerprint": fingerprint,
    "X-Agent-Timestamp": timestamp,
    "X-Agent-Nonce": nonce,
    "X-Agent-Signature": signature_b64
}

res = requests.post(f"{BASE_URL}/api/mcp", data=raw_body, headers=headers)
print("Result:", res.json())
```

---

## 🔄 Self-Correction & Error Recovery (ADR 0007)

When invoking tools, PixelMesh follows standard Model Context Protocol error contracts:
- If invalid parameters are passed (e.g. crop coordinates outside image bounds), the server returns `{ isError: true }` with detailed recovery instructions (e.g. *"Image dimensions are 1920x1080, requested crop width 2500 is out of bounds"*).
- **0 credits are deducted on tool errors**, allowing your LLM agent to inspect the response, adjust its parameters, and self-correct on the next turn.

---

## 📚 Related Documentation
- [API Reference Index](api-reference.md)
- [Troubleshooting & Diagnostics](troubleshooting.md)
- [GitHub App & Webhooks Integration](webhooks-guide.md)
- [ADR 0001: SSH-Style Asymmetric Auth](adr/0001-agent-key-asymmetric-auth.md)
