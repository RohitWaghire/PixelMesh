"use client";

import React from "react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import StudioPlayground from "@/components/studio/StudioPlayground";
import Link from "next/link";
import { Sparkles, ArrowRight, ShieldCheck, Terminal } from "lucide-react";

export default function StudioPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <Navbar />

      {/* Studio Header Banner */}
      <div className="border-b border-zinc-800/60 bg-zinc-950/40 py-3 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="font-semibold text-white">Studio Sandbox</span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-400">Interactive raster image pipeline & filter testing ground</span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/dashboard"
              className="text-zinc-400 hover:text-emerald-400 flex items-center gap-1 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Manage Agent Keys</span>
            </Link>
            <Link
              href="/docs"
              className="text-zinc-400 hover:text-emerald-400 flex items-center gap-1 transition"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Tool API Docs</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Studio Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <StudioPlayground />
      </main>

      <Footer />
    </div>
  );
}
