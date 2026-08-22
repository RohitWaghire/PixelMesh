"use client";

import React, { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import HeroSplitDemo from "@/components/landing/HeroSplitDemo";
import ConfigHub from "@/components/dashboard/ConfigHub";
import { FILTER_TOOLS_CATALOG } from "@/lib/image/tools-catalog";
import { 
  Sparkles, 
  ArrowRight, 
  ShieldCheck, 
  Layers, 
  Terminal, 
  Code, 
  Zap, 
  Cpu, 
  KeyRound, 
  Copy, 
  Check, 
  Sliders, 
  ExternalLink,
  ChevronRight,
  CreditCard,
  CheckCircle2
} from "lucide-react";

export default function Home() {
  const [copiedCli, setCopiedCli] = useState<boolean>(false);
  const [activeCatalogTab, setActiveCatalogTab] = useState<"geometry" | "exposure" | "color" | "effects">("geometry");

  const copyCliCommand = () => {
    navigator.clipboard.writeText("npx @pixelmesh/agent init");
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  const filteredTools = FILTER_TOOLS_CATALOG.filter((t) => t.category === activeCatalogTab);

  const pricingTiers = [
    {
      name: "Free Starter",
      price: "$0",
      period: "forever",
      description: "Zero-human autonomous agent self-registration with instant test credits.",
      credits: "100 Credits",
      badge: "Instant Enrolled",
      features: [
        "100 instant free credits",
        "Ed25519 & RSA signature auth",
        "All 22+ atomic Sharp filters",
        "1 concurrent agent stream",
        "Public community support"
      ],
      cta: "Self-Register Now",
      href: "/dashboard",
      popular: false
    },
    {
      name: "Developer Pack",
      price: "$10",
      period: "/ month",
      description: "For individual builders and agent developers running continuous test loops.",
      credits: "2,500 Credits",
      badge: "Indie Builders",
      features: [
        "2,500 monthly credits",
        "5 concurrent agent connections",
        "50MB payload threshold",
        "Batch DAG pipeline execution",
        "Persistent API key store"
      ],
      cta: "Upgrade to Dev",
      href: "/dashboard",
      popular: false
    },
    {
      name: "Production Pool",
      price: "$49",
      period: "/ month",
      description: "For high-throughput multi-agent systems and commercial autonomous pipelines.",
      credits: "15,000 Credits",
      badge: "Recommended",
      features: [
        "15,000 monthly credits",
        "25 concurrent agent streams",
        "Sub-10ms priority execution",
        "Webhook usage alerts",
        "Dedicated rate-limit headroom"
      ],
      cta: "Deploy Production",
      href: "/dashboard",
      popular: true
    },
    {
      name: "Enterprise Cluster",
      price: "$199",
      period: "/ month",
      description: "Dedicated infrastructure, custom libvips C++ extensions, and SLA guarantees.",
      credits: "75,000 Credits",
      badge: "Scale & SLA",
      features: [
        "75,000 monthly credits",
        "Unlimited concurrency",
        "Custom Sharp C++ filters",
        "Dedicated isolated instance",
        "24/7 priority SLA support"
      ],
      cta: "Contact Enterprise",
      href: "/docs",
      popular: false
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
      <Navbar />

      {/* Hero Section */}
      <section className="relative pt-12 pb-16 md:pt-20 md:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {/* Subtle Background Glow Texture */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none -z-10" />

        <div className="flex flex-col items-center text-center space-y-6 max-w-3xl mx-auto">
          {/* Eyebrow Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-950/40 text-emerald-400 text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AGENT-FIRST IMAGE INFRASTRUCTURE · MCP COMPATIBLE</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Give AI Agents Sight & <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-200">Pixel Control</span>.
          </h1>

          {/* Subtext */}
          <p className="text-base sm:text-lg text-zinc-400 max-w-2xl leading-relaxed">
            Deterministic, sub-millisecond Sharp image processing with SSH-style asymmetric cryptographic auth for Claude, Cursor, and autonomous agents.
          </p>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              href="/studio"
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-semibold text-sm rounded-xl transition shadow-lg shadow-emerald-950/50"
            >
              <span>Explore Web Studio</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] text-zinc-200 font-semibold text-sm rounded-xl border border-zinc-800 transition"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Agent Keyring & Configs</span>
            </Link>

            {/* CLI Copy Pill */}
            <button
              onClick={copyCliCommand}
              className="flex items-center gap-2 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 font-mono text-xs rounded-xl transition"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>npx @pixelmesh/agent init</span>
              {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
            </button>
          </div>
        </div>

        {/* Hero Interactive Split Demo */}
        <div className="mt-12 sm:mt-16">
          <HeroSplitDemo />
        </div>
      </section>

      {/* Dual Protocol Architecture Section */}
      <section className="border-t border-zinc-800/80 bg-zinc-950/50 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Dual-Protocol Architecture
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400">
              Built from the ground up to serve autonomous machine agents and human engineers concurrently.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Path A: Autonomous Agents */}
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 space-y-4 hover:border-zinc-700 transition">
              <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">For Autonomous AI Agents</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                No human signup or credit cards required. Agents generate local Ed25519 keypairs, issue signed proof-of-ownership requests to self-enroll, and receive 100 free credits immediately.
              </p>
              <ul className="space-y-2 text-xs font-mono text-zinc-300 pt-2 border-t border-zinc-800">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>1. Generate Ed25519 / RSA-2048 keypair</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>2. Sign & POST /api/auth/register</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>3. Execute MCP tools over JSON-RPC 2.0</span>
                </li>
              </ul>
            </div>

            {/* Path B: Human Developers & IDEs */}
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 space-y-4 hover:border-zinc-700 transition">
              <div className="w-10 h-10 rounded-xl bg-teal-950/80 border border-teal-800/60 flex items-center justify-center text-teal-400">
                <Sliders className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">For Human Engineers & IDEs</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Connect Claude Desktop and Cursor IDE in one click. Use the visual Web Studio to tune filter parameters, test sample images with split-screen sliders, and inspect telemetry streams live.
              </p>
              <ul className="space-y-2 text-xs font-mono text-zinc-300 pt-2 border-t border-zinc-800">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  <span>1. Export claude_desktop_config.json / .cursor/mcp.json</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  <span>2. Test filters interactively in Web Studio</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  <span>3. Monitor live request stream & deductions</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 22+ Native Tools Catalog Section (Centralized from FILTER_TOOLS_CATALOG) */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              22+ Native Image Processing Tools
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Powered by high-performance C++ Sharp (libvips) with sub-millisecond execution.
            </p>
          </div>

          {/* Catalog Tab Switcher */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-xl text-xs">
            {(["geometry", "exposure", "color", "effects"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveCatalogTab(tab)}
                className={`px-3 py-1.5 rounded-lg capitalize font-medium transition ${
                  activeCatalogTab === tab
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Tool Cards from catalog */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTools.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 transition space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-900/50">
                  {item.id}
                </span>
                <span className="text-[10px] font-mono text-zinc-400">1 Credit</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-emerald-900/40 bg-emerald-950/20 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span>Need multi-step chaining? Use <strong className="text-white font-mono">batch_filter_pipeline</strong> to execute multi-filter DAGs in a single round trip (3 credits).</span>
          </div>
          <Link href="/docs" className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1">
            <span>View Full Docs</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      {/* 4-Tier Pricing Grid (§2.1) */}
      <section className="border-t border-zinc-800/80 bg-zinc-950/60 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
              <CreditCard className="w-3.5 h-3.5" />
              <span>TRANSPARENT USAGE PRICING</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Pay Only For Compute Credits
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400">
              1 credit per standard filter execution, 3 credits for multi-filter batch pipelines.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl p-6 flex flex-col justify-between border transition ${
                  tier.popular
                    ? "bg-zinc-900/80 border-emerald-500/60 shadow-xl shadow-emerald-950/30 relative"
                    : "bg-zinc-900/30 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                {tier.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-500 text-black font-bold text-[10px] uppercase font-mono tracking-wider">
                    Most Popular
                  </span>
                )}

                <div className="space-y-4">
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">{tier.badge}</span>
                    <h3 className="text-lg font-bold text-white mt-0.5">{tier.name}</h3>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-white">{tier.price}</span>
                    <span className="text-xs text-zinc-400">{tier.period}</span>
                  </div>

                  <div className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1 rounded-lg">
                    {tier.credits}
                  </div>

                  <p className="text-xs text-zinc-400 leading-relaxed">
                    {tier.description}
                  </p>

                  <ul className="space-y-2 text-xs text-zinc-300 pt-3 border-t border-zinc-800/80">
                    {tier.features.map((feat) => (
                      <li key={feat} className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-6 mt-6 border-t border-zinc-800/80">
                  <Link
                    href={tier.href}
                    className={`w-full py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                      tier.popular
                        ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-md shadow-emerald-950/50"
                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700"
                    }`}
                  >
                    <span>{tier.cta}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integration Hub Section */}
      <section className="border-t border-zinc-800/80 bg-zinc-950/70 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              1-Click Ecosystem Integration
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400">
              Drop PixelMesh directly into your agent runtime or IDE setup.
            </p>
          </div>

          <ConfigHub />
        </div>
      </section>

      {/* Agent Discovery Banner */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
              <KeyRound className="w-3.5 h-3.5" />
              <span>AGENT DISCOVERY READY</span>
            </div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              Are you an autonomous AI crawler or LLM?
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Read our machine-actionable manifests at <code className="text-emerald-300 bg-zinc-950 px-1.5 py-0.5 rounded">/llms.txt</code> and <code className="text-emerald-300 bg-zinc-950 px-1.5 py-0.5 rounded">/docs.md</code> for zero-prompt programmatic onboarding.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/llms.txt"
              target="_blank"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono rounded-lg border border-zinc-700 transition flex items-center gap-1.5"
            >
              <span>View /llms.txt</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href="/docs.md"
              target="_blank"
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-lg transition flex items-center gap-1.5"
            >
              <span>View /docs.md</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
