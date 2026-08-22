"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, Layers, ShieldCheck, BookOpen, Terminal, ArrowUpRight, Code2 } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/studio", label: "Studio Sandbox", icon: Layers },
    { href: "/dashboard", label: "Dev Console & Keys", icon: ShieldCheck },
    { href: "/docs", label: "Documentation", icon: BookOpen },
  ];

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo & Version Pill */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50 group-hover:scale-105 transition-transform duration-200">
            <Sparkles className="w-4 h-4 text-black font-bold" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base tracking-tight text-white group-hover:text-emerald-400 transition-colors">
              PixelMesh
            </span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              v1.0.0
            </span>
          </div>
        </Link>

        {/* Central Nav Links */}
        <nav className="hidden md:flex items-center gap-1 bg-zinc-900/90 border border-zinc-800/90 p-1 rounded-xl">
          <Link
            href="/"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              pathname === "/"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Overview
          </Link>
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  isActive
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-emerald-400" : "text-zinc-400"}`} />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Actions & Status */}
        <div className="flex items-center gap-3">
          {/* MCP Endpoint Pill */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono bg-zinc-900/80 border border-zinc-800 px-2.5 py-1.2 rounded-md text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>/api/mcp</span>
          </div>

          <a
            href="https://github.com/RohitWaghire/PixelMesh"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 transition"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </a>

          <Link
            href="/studio"
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-semibold text-xs rounded-lg transition shadow-md shadow-emerald-950/40"
          >
            <span>Launch Studio</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
