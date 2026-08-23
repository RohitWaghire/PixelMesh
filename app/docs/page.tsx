"use client";

import React, { useState } from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { 
  ShieldCheck, 
  Terminal, 
  Code, 
  KeyRound, 
  Copy, 
  Check, 
  Layers, 
  Zap, 
  ExternalLink,
  BookOpen,
  ArrowRight
} from "lucide-react";

export default function DocsPage() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const tools = [
    {
      name: "crop_image",
      category: "Geometry",
      cost: "1 Credit",
      description: "Extracts an exact rectangular sub-region by coordinate bounding box.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "left", type: "number", required: true, desc: "Left X start coordinate in pixels" },
        { name: "top", type: "number", required: true, desc: "Top Y start coordinate in pixels" },
        { name: "width", type: "number", required: true, desc: "Width of extracted crop in pixels" },
        { name: "height", type: "number", required: true, desc: "Height of extracted crop in pixels" }
      ]
    },
    {
      name: "circle_crop",
      category: "Geometry",
      cost: "1 Credit",
      description: "Masks the image into a circular/elliptical crop with alpha transparency or custom background fill.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "radius", type: "number", required: false, desc: "Circle radius (defaults to half of min dimension)" },
        { name: "centerX", type: "number", required: false, desc: "Center X pixel coordinate" },
        { name: "centerY", type: "number", required: false, desc: "Center Y pixel coordinate" },
        { name: "background", type: "string", required: false, desc: "Hex/CSS background color for out-of-circle areas" }
      ]
    },
    {
      name: "rotate_image",
      category: "Geometry",
      cost: "1 Credit",
      description: "Rotates the image by an exact angle with automatic canvas dimension calculation.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "angle", type: "number", required: true, desc: "Angle in degrees (e.g. 90, 180, 270, 45)" },
        { name: "background", type: "string", required: false, desc: "Color for newly exposed corners" }
      ]
    },
    {
      name: "flip_image",
      category: "Geometry",
      cost: "1 Credit",
      description: "Mirrors the image along the horizontal and/or vertical axes.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "horizontal", type: "boolean", required: false, desc: "Flip along vertical axis (mirror horizontally)" },
        { name: "vertical", type: "boolean", required: false, desc: "Flip along horizontal axis (mirror vertically)" }
      ]
    },
    {
      name: "straighten_image",
      category: "Geometry",
      cost: "1 Credit",
      description: "Applies fine-tuned perspective straightening (-45° to +45°) with optional auto-zoom crop to eliminate black edges.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "angle", type: "number", required: true, desc: "Angle in degrees between -45 and 45" },
        { name: "cropToFit", type: "boolean", required: false, desc: "Crop inwards to remove exposed boundary triangles" }
      ]
    },
    {
      name: "adjust_brightness",
      category: "Exposure",
      cost: "1 Credit",
      description: "Scales linear image luminance by a multiplicative factor.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "factor", type: "number", required: true, desc: "Luminance multiplier (0.0 to 3.0, 1.0 is neutral)" }
      ]
    },
    {
      name: "adjust_contrast",
      category: "Exposure",
      cost: "1 Credit",
      description: "Expands or compresses the dynamic range around the midtone luminance curve.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "factor", type: "number", required: true, desc: "Contrast multiplier (0.0 to 3.0)" }
      ]
    },
    {
      name: "adjust_gamma",
      category: "Exposure",
      cost: "1 Credit",
      description: "Applies non-linear gamma exponent correction to restore shadow and highlight detail.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "gamma", type: "number", required: true, desc: "Gamma exponent (0.1 to 3.0, default 1.0)" }
      ]
    },
    {
      name: "make_sepia_tone",
      category: "Color",
      cost: "1 Credit",
      description: "Transforms the image into a warm vintage sepia photograph using a calibrated 3x3 color recombination matrix.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "intensity", type: "number", required: false, desc: "Sepia blending intensity (0.0 to 1.0, default 1.0)" }
      ]
    },
    {
      name: "make_grayscale",
      category: "Color",
      cost: "1 Credit",
      description: "Converts the image to single-channel luminance with standard or perceptual Rec.709 weights.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "mode", type: "string", required: false, desc: "'standard' or 'weighted' (default: standard)" }
      ]
    },
    {
      name: "glow_effect",
      category: "Effects",
      cost: "1 Credit",
      description: "Synthesizes an ethereal luminous bloom via multi-pass Gaussian blur and screen/add blending.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image source" },
        { name: "intensity", type: "number", required: false, desc: "Bloom intensity factor (0.0 to 2.0, default 0.8)" },
        { name: "radius", type: "number", required: false, desc: "Blur radius in pixels (1 to 50, default 10)" }
      ]
    },
    {
      name: "batch_filter_pipeline",
      category: "Composite",
      cost: "3 Credits",
      description: "Chains multiple image manipulation steps sequentially into an atomic DAG pipeline in a single round-trip.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Initial base64 image input" },
        { name: "pipeline", type: "array of objects", required: true, desc: "Ordered array of { tool, params } definitions" }
      ]
    },
    {
      name: "get_image_metadata",
      category: "Metadata",
      cost: "1 Credit",
      description: "Extracts dimension dimensions (width, height), color space, alpha channels, format, and density without altering pixels.",
      params: [
        { name: "image", type: "string (data URI)", required: true, desc: "Base64 data URI image to analyze" }
      ]
    }
  ];

  const filteredTools = activeCategory === "all" ? tools : tools.filter(t => t.category.toLowerCase() === activeCategory.toLowerCase());

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <Navbar />

      {/* Docs Header */}
      <div className="border-b border-zinc-800/80 bg-zinc-950/60 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
            <BookOpen className="w-4 h-4" />
            <span>DOCUMENTATION & PROTOCOL SPECIFICATION</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
            PixelMesh Developer & Agent API
          </h1>
          <p className="text-zinc-400 text-sm max-w-3xl leading-relaxed">
            Everything you need to connect Claude Desktop, Cursor, Python scripts, and autonomous LLM agents to the high-performance Sharp image mesh using asymmetric cryptographic authentication.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-1 space-y-12">
        {/* Section 1: Asymmetric Auth Specification */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>Authentication Protocol</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            SSH-Style Cryptographic Request Signing (ADR 0001)
          </h2>
          <p className="text-zinc-400 text-xs leading-relaxed">
            PixelMesh completely eliminates shared static API keys. Agents sign each request payload using their private key. The gateway verifies the signature against the registered public key matching the fingerprint header.
          </p>

          {/* Canonical Signature Table */}
          <div className="overflow-x-auto border border-zinc-800 rounded-xl bg-zinc-900/50">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-950/70 text-zinc-400 font-mono">
                <tr>
                  <th className="p-3">Required Header</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono text-zinc-300">
                <tr>
                  <td className="p-3 text-emerald-400">X-Agent-Key-Fingerprint</td>
                  <td className="p-3 font-sans text-zinc-400">Base64URL SHA-256 hash of public key</td>
                  <td className="p-3 text-zinc-400">SHA256:47DEQpj8...</td>
                </tr>
                <tr>
                  <td className="p-3 text-emerald-400">X-Agent-Timestamp</td>
                  <td className="p-3 font-sans text-zinc-400">Unix epoch timestamp in seconds (±60s window)</td>
                  <td className="p-3 text-zinc-400">1740001234</td>
                </tr>
                <tr>
                  <td className="p-3 text-emerald-400">X-Agent-Nonce</td>
                  <td className="p-3 font-sans text-zinc-400">Unique UUID/hex string to prevent replay attacks</td>
                  <td className="p-3 text-zinc-400">9b1deb4d-3b7d-...</td>
                </tr>
                <tr>
                  <td className="p-3 text-emerald-400">X-Agent-Signature</td>
                  <td className="p-3 font-sans text-zinc-400">Base64 signature of the canonical string</td>
                  <td className="p-3 text-zinc-400">k8Z7d9...==</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Canonical String Formula */}
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-300 space-y-1">
            <div className="text-zinc-400 font-sans text-[11px] font-semibold uppercase tracking-wider mb-2">
              Canonical Signature String Structure:
            </div>
            <div className="text-emerald-400">METHOD + &quot;\n&quot; + PATH + &quot;\n&quot; + TIMESTAMP + &quot;\n&quot; + NONCE + &quot;\n&quot; + SHA256_HEX(REQUEST_BODY)</div>
          </div>
        </section>

        {/* Section 2: Zero-Human Agent Registration */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs uppercase tracking-wider">
            <KeyRound className="w-4 h-4" />
            <span>Autonomous Onboarding</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Autonomous Machine Registration (`POST /api/auth/register`)
          </h2>
          <p className="text-zinc-400 text-xs leading-relaxed">
            Agents can onboard themselves without human intervention by generating an Ed25519 keypair and submitting a signed challenge to receive 100 free instant credits.
          </p>

          <div className="relative rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-300">
            <button
              onClick={() => copyToClipboard(`curl -X POST http://localhost:3000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Key-Fingerprint: SHA256:your_fingerprint" \\
  -H "X-Agent-Timestamp: 1740001234" \\
  -H "X-Agent-Nonce: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \\
  -H "X-Agent-Signature: your_base64_signature" \\
  -d '{"name": "Agent-007", "publicKey": "-----BEGIN PUBLIC KEY-----\\n...", "algorithm": "ed25519", "timestamp": 1740001234}'`, "curl-reg")}
              className="absolute top-3 right-3 p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
            >
              {copiedKey === "curl-reg" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <pre className="overflow-x-auto text-[11px] leading-relaxed">
{`curl -X POST http://localhost:3000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Key-Fingerprint: SHA256:your_fingerprint" \\
  -H "X-Agent-Timestamp: 1740001234" \\
  -H "X-Agent-Nonce: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" \\
  -H "X-Agent-Signature: your_base64_signature" \\
  -d '{
    "name": "Autonomous-Agent-1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEA...\\n-----END PUBLIC KEY-----",
    "algorithm": "ed25519",
    "timestamp": 1740001234
  }'`}
            </pre>
          </div>
        </section>

        {/* Section 3: Tool Catalog & Schema Reference */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs uppercase tracking-wider">
                <Layers className="w-4 h-4" />
                <span>Tool Catalog Reference</span>
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight mt-1">
                22+ Native Image Processing Tools
              </h2>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-xl text-xs">
              {["all", "Geometry", "Exposure", "Color", "Effects", "Composite"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat.toLowerCase())}
                  className={`px-2.5 py-1 rounded-lg capitalize transition ${
                    activeCategory === cat.toLowerCase()
                      ? "bg-zinc-800 text-white font-medium shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Tools Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTools.map((tool) => (
              <div key={tool.name} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-xs text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-900/40">
                    {tool.name}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                    {tool.cost}
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {tool.description}
                </p>

                {/* Parameters List */}
                <div className="space-y-1 pt-2 border-t border-zinc-800/80">
                  <div className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">Arguments:</div>
                  <ul className="space-y-1 text-[11px]">
                    {tool.params.map((p) => (
                      <li key={p.name} className="flex items-start gap-1 font-mono">
                        <span className="text-zinc-200">{p.name}</span>
                        <span className="text-zinc-400">({p.type}):</span>
                        <span className="text-zinc-400 font-sans">{p.desc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Footer />
    </div>
  );
}
