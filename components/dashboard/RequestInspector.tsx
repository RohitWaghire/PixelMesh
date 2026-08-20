"use client";

import React, { useState, useEffect } from "react";
import { Terminal, ShieldCheck, AlertTriangle, Clock, RefreshCw, Trash2, Copy, Check, Sparkles, Send } from "lucide-react";
import { RequestLogEntry } from "@/lib/telemetry/store";

export default function RequestInspector() {
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/telemetry/logs");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch telemetry logs:", err);
    }
  };

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 2500);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const handleClear = async () => {
    try {
      await fetch("/api/telemetry/logs", { method: "DELETE" });
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Telemetry Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Live Request & Cryptographic Stream</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time telemetry auditing incoming MCP requests to <code className="font-mono bg-zinc-950 px-1 py-0.5 rounded text-emerald-400">/api/mcp</code> with signature verification details.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer bg-zinc-800/60 px-3 py-2 rounded-lg border border-zinc-700/60">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-zinc-900 border-zinc-700 text-emerald-500 focus:ring-0"
            />
            <span>Auto-refresh (2.5s)</span>
          </label>
          <button
            onClick={fetchLogs}
            className="p-2.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg transition"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-900/40 border border-red-900/40 rounded-lg transition"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear Stream
          </button>
        </div>
      </div>

      {/* Stream Table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Timestamp</th>
                <th className="px-5 py-3.5">Method / Tool</th>
                <th className="px-5 py-3.5">Agent Key Fingerprint</th>
                <th className="px-5 py-3.5">Signature Status</th>
                <th className="px-5 py-3.5">Drift & Latency</th>
                <th className="px-5 py-3.5">Credits</th>
                <th className="px-5 py-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-zinc-500 font-sans">
                    <Terminal className="w-8 h-8 mx-auto mb-2 text-zinc-600 animate-pulse" />
                    No incoming requests captured yet. Make a signed call via `/api/mcp` or test in the Playground.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/30 transition">
                    <td className="px-5 py-3.5 text-zinc-400">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-zinc-200">{log.method}</span>
                      {log.tool && (
                        <div className="text-[11px] text-emerald-400 font-normal">
                          ➔ {log.tool}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-300 truncate max-w-[150px]" title={log.fingerprint}>
                          {log.fingerprint}
                        </span>
                        <button
                          onClick={() => handleCopy(log.fingerprint, log.id)}
                          className="text-zinc-500 hover:text-zinc-300 transition"
                        >
                          {copiedId === log.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {log.signatureValid ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
                          <ShieldCheck className="w-3 h-3" /> Verified Ed25519
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-400 bg-red-950/60 border border-red-800/40 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" /> Invalid Signature
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400">
                      <div>Drift: {log.timestampDriftMs > 0 ? `+${log.timestampDriftMs}ms` : `${log.timestampDriftMs}ms`}</div>
                      <div className="text-[11px] text-zinc-500">Latency: {log.latencyMs}ms</div>
                    </td>
                    <td className="px-5 py-3.5">
                      {log.costCredits > 0 ? (
                        <span className="text-amber-400 font-semibold">
                          -{log.costCredits} (Bal: {log.creditsRemaining})
                        </span>
                      ) : (
                        <span className="text-zinc-500 font-normal">0 credits</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          log.status === "success"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : log.status === "rate_limited"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
