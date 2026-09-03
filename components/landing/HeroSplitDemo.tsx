"use client";

import React, { useState, useRef, useEffect } from "react";
import { Terminal, Sparkles, Sliders, ShieldCheck, Check, Copy } from "lucide-react";

interface PresetTransformation {
  id: string;
  name: string;
  tool: string;
  params: Record<string, any>;
  beforeImage: string;
  afterStyle: string; // CSS filter approximation for instant client preview
  cost: string;
}

const PRESETS: PresetTransformation[] = [
  {
    id: "glow",
    name: "Cyber Glow Bloom",
    tool: "glow_effect",
    params: { intensity: 1.2, radius: 16 },
    beforeImage: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=700&auto=format&fit=crop&q=80",
    afterStyle: "brightness(1.15) contrast(1.1) drop-shadow(0 0 12px rgba(16,185,129,0.5))",
    cost: "1 Credit"
  },
  {
    id: "sepia",
    name: "Vintage Sepia Matrix",
    tool: "make_sepia_tone",
    params: { intensity: 0.95 },
    beforeImage: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=700&auto=format&fit=crop&q=80",
    afterStyle: "sepia(0.95) contrast(1.05) brightness(0.95)",
    cost: "1 Credit"
  },
  {
    id: "contrast",
    name: "High Dynamic Contrast",
    tool: "adjust_contrast",
    params: { factor: 1.6 },
    beforeImage: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=700&auto=format&fit=crop&q=80",
    afterStyle: "contrast(1.6) saturate(1.2)",
    cost: "1 Credit"
  }
];

export default function HeroSplitDemo() {
  const [activePreset, setActivePreset] = useState<PresetTransformation>(PRESETS[0]);
  const [sliderPos, setSliderPos] = useState<number>(52);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging && e.buttons !== 1) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  const jsonRpcPayload = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: "req_9f82d1",
      method: "tools/call",
      params: {
        name: activePreset.tool,
        arguments: {
          image: "data:image/jpeg;base64,...",
          ...activePreset.params
        }
      }
    },
    null,
    2
  );

  const copyPayload = () => {
    navigator.clipboard.writeText(jsonRpcPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full rounded-2xl border border-zinc-800/90 bg-zinc-950/90 shadow-2xl shadow-emerald-950/20 overflow-hidden">
      {/* Top Preset Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-mono text-zinc-300 text-[11px]">Live MCP Execution Preview</span>
        </div>

        {/* Preset Switcher */}
        <div className="flex items-center gap-1 bg-zinc-950/80 p-1 rounded-lg border border-zinc-800">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePreset(p)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                activePreset.id === p.id
                  ? "bg-zinc-800 text-emerald-400 font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
        {/* Left Side: Signed MCP Protocol Request Stream */}
        <div className="p-4 sm:p-5 flex flex-col justify-between bg-zinc-950 font-mono text-xs text-zinc-300 space-y-4">
          <div className="space-y-3">
            {/* Headers Box */}
            <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 space-y-1 text-[11px]">
              <div className="text-zinc-400 font-sans text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between">
                <span>Cryptographic Auth Headers</span>
                <span className="text-emerald-400 flex items-center gap-1 font-mono">
                  <ShieldCheck className="w-3 h-3" /> Ed25519 Signed
                </span>
              </div>
              <div className="text-zinc-400 truncate">
                <span className="text-emerald-400">X-Agent-Key-Fingerprint:</span> SHA256:47DEQpj8HBSa-_TImW...
              </div>
              <div className="text-zinc-400" suppressHydrationWarning>
                <span className="text-emerald-400">X-Agent-Timestamp:</span> 1740001234
              </div>
              <div className="text-zinc-400">
                <span className="text-emerald-400">X-Agent-Nonce:</span> 9b1deb4d-3b7d-4bad-9bdd
              </div>
              <div className="text-zinc-400 truncate">
                <span className="text-emerald-400">X-Agent-Signature:</span> k8Z7d9Q0yW1x3vP5...==
              </div>
            </div>

            {/* JSON-RPC Request Body */}
            <div className="relative">
              <div className="text-zinc-400 font-sans text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between">
                <span>POST /api/mcp (JSON-RPC 2.0)</span>
                <button
                  onClick={copyPayload}
                  className="text-zinc-400 hover:text-white transition flex items-center gap-1 font-mono text-[10px]"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copied" : "Copy Payload"}</span>
                </button>
              </div>
              <pre className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-[11px] leading-relaxed text-emerald-300/90 overflow-x-auto">
                {jsonRpcPayload}
              </pre>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-400 border-t border-zinc-900">
            <span>Latency: <strong className="text-zinc-200">~14ms</strong></span>
            <span>Credit Deduction: <strong className="text-emerald-400">{activePreset.cost}</strong></span>
          </div>
        </div>

        {/* Right Side: Interactive Draggable Split Canvas */}
        <div className="p-4 sm:p-5 flex flex-col items-center justify-center bg-zinc-900/20 select-none">
          <div
            ref={containerRef}
            onPointerDown={(e) => {
              setIsDragging(true);
              handlePointerMove(e);
            }}
            onPointerUp={() => setIsDragging(false)}
            onPointerLeave={() => setIsDragging(false)}
            onPointerMove={handlePointerMove}
            className="relative w-full aspect-[4/3] rounded-xl overflow-hidden cursor-ew-resize border border-zinc-800 shadow-inner group"
          >
            {/* Background: Processed Image */}
            <img
              src={activePreset.beforeImage}
              alt="Processed preview"
              className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
              style={{ filter: activePreset.afterStyle }}
            />

            {/* Foreground: Original Image Clipped */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${sliderPos}%` }}
            >
              <img
                src={activePreset.beforeImage}
                alt="Original preview"
                className="absolute inset-0 w-full h-full object-cover max-w-none"
                style={{
                  width: containerRef.current ? `${containerRef.current.clientWidth}px` : "100%",
                  height: "100%"
                }}
              />
            </div>

            {/* Draggable Divider Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] flex items-center justify-center"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="w-6 h-6 rounded-full bg-zinc-900 border-2 border-emerald-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Sliders className="w-3 h-3 text-emerald-400 rotate-90" />
              </div>
            </div>

            {/* Badges */}
            <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] font-mono text-zinc-300 border border-zinc-700">
              ORIGINAL
            </div>
            <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-emerald-950/80 backdrop-blur-sm text-[10px] font-mono text-emerald-300 border border-emerald-800">
              PROCESSED
            </div>
          </div>

          <p className="text-[11px] text-zinc-400 mt-2 text-center">
            Drag the split handle left or right to inspect the sub-pixel transformation.
          </p>
        </div>
      </div>
    </div>
  );
}
