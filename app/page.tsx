"use client";

import React, { useState } from "react";
import KeyManager from "@/components/dashboard/KeyManager";
import StudioPlayground from "@/components/studio/StudioPlayground";
import RequestInspector from "@/components/dashboard/RequestInspector";
import ConfigHub from "@/components/dashboard/ConfigHub";
import { ShieldCheck, Layers, Terminal, Sparkles, Code } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"studio" | "keys" | "inspector">("keys");

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      {/* Top Precision Navigation Bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Sparkles className="w-4 h-4 text-black font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">PixelMesh</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  v1.0.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">AI Agent-First Image Tool Mesh & MCP Gateway</p>
            </div>
          </div>

          {/* Nav Tabs */}
          <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("studio")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "studio"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>Studio & Filters</span>
            </button>
            <button
              onClick={() => setActiveTab("keys")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "keys"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Agent Keyring</span>
            </button>
            <button
              onClick={() => setActiveTab("inspector")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "inspector"
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Request Stream</span>
            </button>
          </div>

          {/* Status Badge */}
          <div className="hidden md:flex items-center gap-2 text-xs font-mono bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>MCP: /api/mcp</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {activeTab === "keys" && (
          <div className="space-y-6">
            <KeyManager />
            <ConfigHub />
          </div>
        )}
        {activeTab === "studio" && <StudioPlayground />}
        {activeTab === "inspector" && (
          <div className="space-y-6">
            <RequestInspector />
            <ConfigHub />
          </div>
        )}
      </main>
    </div>
  );
}
