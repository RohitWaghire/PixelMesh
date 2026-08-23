"use client";

import React, { useState, useEffect } from "react";
import { Key, ShieldCheck, Plus, RefreshCw, Copy, Check, Terminal, Zap, ShieldAlert, Download, Lock } from "lucide-react";

interface AuthorizedKey {
  fingerprint: string;
  agentName: string;
  publicKeyPem: string;
  algorithm: "ed25519" | "rsa";
  creditsBalance: number;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  totalInvocations: number;
  status: "active" | "revoked";
}

export default function KeyManager() {
  const [keys, setKeys] = useState<AuthorizedKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedFingerprint, setCopiedFingerprint] = useState<string | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAlgorithm, setNewAlgorithm] = useState<"ed25519" | "rsa">("ed25519");
  const [generatedResult, setGeneratedResult] = useState<{ keypair?: any; agent?: any } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchKeys = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/keys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (err) {
      console.error("Failed to fetch keys:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFingerprint(id);
    setTimeout(() => setCopiedFingerprint(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Authorized Agent Keyring</h2>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Zero-knowledge cryptographic access plane. Every request requires an asymmetric HTTP signature (<code className="text-zinc-300 font-mono">X-Agent-Signature</code>).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchKeys}
            className="p-2.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg transition"
            title="Refresh Keyring"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => { setShowGenerateModal(true); setGeneratedResult(null); setErrorMsg(null); }}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg shadow-emerald-950/40 transition"
          >
            <Plus className="w-4 h-4" />
            Enroll New Agent
          </button>
        </div>
      </div>

      {/* Security Architecture Callout */}
      <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4 text-zinc-300 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
                Zero-Knowledge Private Key Security
              </span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              PixelMesh never stores or returns agent private keys. Agents hold private keys locally and authenticate autonomously via <code className="text-zinc-300 font-mono">POST /api/auth/register</code> with proof-of-possession.
            </p>
          </div>
        </div>
      </div>

      {/* Keys Table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Agent / Algorithm</th>
                <th className="px-5 py-3.5">Key Fingerprint</th>
                <th className="px-5 py-3.5">Credits Balance</th>
                <th className="px-5 py-3.5">Scopes</th>
                <th className="px-5 py-3.5">Invocations</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-zinc-500 font-sans">
                    {loading ? "Loading authorized keys..." : "No authorized keys found. Use the CLI or registration endpoint to enroll an agent."}
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.fingerprint} className="hover:bg-zinc-800/30 transition">
                    <td className="px-5 py-4 font-sans font-medium text-zinc-200">
                      <div>{key.agentName}</div>
                      <span className="text-xs font-mono text-zinc-500 uppercase">{key.algorithm}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-300 truncate max-w-[200px]" title={key.fingerprint}>
                          {key.fingerprint}
                        </span>
                        <button
                          onClick={() => handleCopy(key.fingerprint, key.fingerprint)}
                          className="text-zinc-500 hover:text-zinc-300 transition"
                          title="Copy fingerprint"
                        >
                          {copiedFingerprint === key.fingerprint ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-400">
                        <span>🪙 {key.creditsBalance}</span>
                        <span className="text-[10px] text-zinc-500 font-normal">credits</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((s) => (
                          <span
                            key={s}
                            className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-zinc-400">{key.totalInvocations} calls</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          key.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {key.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right text-zinc-500">
                      {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "Active"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Autonomous Enrollment Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-zinc-100">
                  Autonomous Agent Self-Enrollment
                </h3>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-zinc-500 hover:text-zinc-300 text-lg font-mono"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-zinc-300">
              <p>
                To maintain strict cryptographic security, agent keypairs must be generated inside your agent runtime or client environment.
              </p>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3 font-mono text-xs">
                <div className="text-zinc-400">// 1. Generate & Enroll via CLI (Recommended)</div>
                <div className="flex items-center justify-between bg-zinc-900 p-2.5 rounded-lg border border-zinc-800">
                  <span className="text-emerald-400">npx @pixelmesh/agent init</span>
                  <button
                    onClick={() => handleCopy("npx @pixelmesh/agent init", "cli-cmd")}
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    {copiedFingerprint === "cli-cmd" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <div className="text-zinc-400 pt-2">// 2. Or Self-Register via Autonomous HTTP API</div>
                <div className="text-zinc-300">
                  POST <span className="text-amber-400">/api/auth/register</span>
                </div>
                <pre className="text-[11px] text-zinc-400 bg-zinc-900 p-2.5 rounded-lg overflow-x-auto">
{`{
  "agent_name": "My-Worker-Agent",
  "public_key": "-----BEGIN PUBLIC KEY-----\\n...",
  "algorithm": "ed25519",
  "signature": "<proof_of_ownership_signature>"
}`}
                </pre>
              </div>

              <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-xs text-emerald-300">
                ⚡ Every self-registered key is automatically granted <strong>100 free testing credits</strong> upon valid signature verification.
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="px-5 py-2 text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
