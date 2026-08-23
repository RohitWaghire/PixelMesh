"use client";

import React, { useState } from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import KeyManager from "@/components/dashboard/KeyManager";
import RequestInspector from "@/components/dashboard/RequestInspector";
import ConfigHub from "@/components/dashboard/ConfigHub";
import { ShieldCheck, Terminal, Code, Layers } from "lucide-react";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"keys" | "inspector" | "configs">("keys");

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <Navbar />

      {/* Subnav Dashboard Header */}
      <div className="border-b border-zinc-800/80 bg-zinc-950/60 py-4 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Developer & Agent Console</h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Manage Ed25519/RSA asymmetric agent keys, observe real-time telemetry, and export IDE configs.
            </p>
          </div>

          {/* Tab Selector */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("keys")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "keys"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ShieldCheck className={`w-3.5 h-3.5 ${activeTab === "keys" ? "text-emerald-400" : "text-zinc-400"}`} />
              <span>Agent Keyring</span>
            </button>
            <button
              onClick={() => setActiveTab("inspector")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "inspector"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Terminal className={`w-3.5 h-3.5 ${activeTab === "inspector" ? "text-emerald-400" : "text-zinc-400"}`} />
              <span>Request Stream</span>
            </button>
            <button
              onClick={() => setActiveTab("configs")}
              className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition ${
                activeTab === "configs"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Code className={`w-3.5 h-3.5 ${activeTab === "configs" ? "text-emerald-400" : "text-zinc-400"}`} />
              <span>IDE & Agent Configs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {activeTab === "keys" && (
          <div className="space-y-8">
            <KeyManager />
            <ConfigHub />
          </div>
        )}

        {activeTab === "inspector" && (
          <div className="space-y-8">
            <RequestInspector />
            <ConfigHub />
          </div>
        )}

        {activeTab === "configs" && (
          <div className="space-y-8">
            <ConfigHub />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
