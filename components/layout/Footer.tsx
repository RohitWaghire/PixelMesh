"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, Terminal, FileText, Shield, ExternalLink, Code2 } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-zinc-800/80 bg-zinc-950 text-zinc-400 text-xs py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Brand & Purpose */}
          <div className="space-y-3 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-black font-bold" />
              </div>
              <span className="font-bold text-sm text-white">PixelMesh</span>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed">
              AI Agent-First Image Tool Mesh and Cryptographic WebMCP Gateway with SSH-style asymmetric authentication and 22+ native Sharp image tools.
            </p>
            <div className="text-[11px] font-mono text-zinc-400">
              Protocol: MCP 2024-11-05 Spec
            </div>
          </div>

          {/* Col 2: Interfaces */}
          <div className="space-y-2.5">
            <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wider font-mono">Surfaces</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/studio" className="hover:text-emerald-400 transition-colors">
                  Web Studio Sandbox
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-emerald-400 transition-colors">
                  Agent Keyring & Keys
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-emerald-400 transition-colors">
                  Live Request Stream
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-emerald-400 transition-colors">
                  Tool Catalog & API Docs
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Agent & Machine Endpoints */}
          <div className="space-y-2.5">
            <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wider font-mono">Agent Discovery</h4>
            <ul className="space-y-2">
              <li>
                <a href="/llms.txt" target="_blank" className="hover:text-emerald-400 transition-colors flex items-center gap-1">
                  <span>/llms.txt</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </li>
              <li>
                <a href="/docs.md" target="_blank" className="hover:text-emerald-400 transition-colors flex items-center gap-1">
                  <span>/docs.md (Agent Docs)</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </li>
              <li>
                <a href="/index.md" target="_blank" className="hover:text-emerald-400 transition-colors flex items-center gap-1">
                  <span>/index.md (Manifest)</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              </li>
              <li>
                <span className="text-zinc-400 font-mono text-[11px]">POST /api/mcp</span>
              </li>
              <li>
                <span className="text-zinc-400 font-mono text-[11px]">POST /api/auth/register</span>
              </li>
            </ul>
          </div>

          {/* Col 4: Architecture & Community */}
          <div className="space-y-2.5">
            <h4 className="font-semibold text-zinc-200 text-xs uppercase tracking-wider font-mono">Architecture & Open Source</h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://github.com/RohitWaghire/PixelMesh"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-400 transition-colors flex items-center gap-1"
                >
                  <Code2 className="w-3 h-3" />
                  <span>GitHub Repository</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/RohitWaghire/PixelMesh/tree/main/docs/adr"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-emerald-400 transition-colors flex items-center gap-1"
                >
                  <Shield className="w-3 h-3" />
                  <span>ADR Architectural Records</span>
                </a>
              </li>
              <li>
                <span className="text-zinc-400">MIT License</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-zinc-400 text-[11px]">
          <p>© {new Date().getFullYear()} PixelMesh. Open Source under MIT License.</p>
          <p className="font-mono">Engineered for autonomous AI agents & human creators.</p>
        </div>
      </div>
    </footer>
  );
}
