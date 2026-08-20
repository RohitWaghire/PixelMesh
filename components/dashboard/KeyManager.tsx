"use client";

import React, { useState, useEffect } from "react";
import { Key, ShieldCheck, Plus, RefreshCw, Trash2, Copy, Check, Terminal, Zap } from "lucide-react";

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

interface DevKeypair {
  fingerprint: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export default function KeyManager() {
  const [keys, setKeys] = useState<AuthorizedKey[]>([]);
  const [devKeypair, setDevKeypair] = useState<DevKeypair | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedFingerprint, setCopiedFingerprint] = useState<string | null>(null);
  const [copiedDevKey, setCopiedDevKey] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAlgorithm, setNewAlgorithm] = useState<"ed25519" | "rsa">("ed25519");
  const [generatedResult, setGeneratedResult] = useState<{ keypair: any; agent: AuthorizedKey } | null>(null);

  const fetchKeys = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/keys");
      const data = await res.json();
      setKeys(data.keys || []);
      setDevKeypair(data.devKeypair || null);
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

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          agent_name: newAgentName || undefined,
          algorithm: newAlgorithm
        })
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedResult(data);
        fetchKeys();
      }
    } catch (err) {
      console.error("Failed to generate key:", err);
    }
  };

  const handleTopup = async (fingerprint: string) => {
    try {
      await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topup", fingerprint, amount: 100 })
      });
      fetchKeys();
    } catch (err) {
      console.error("Failed to top up:", err);
    }
  };

  const handleRevoke = async (fingerprint: string) => {
    if (!confirm("Are you sure you want to revoke this agent key?")) return;
    try {
      await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", fingerprint })
      });
      fetchKeys();
    } catch (err) {
      console.error("Failed to revoke key:", err);
    }
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
            Manage asymmetric cryptographic keys for autonomous agents. Every request requires an Ed25519 / RSA HTTP signature.
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
            onClick={() => { setShowGenerateModal(true); setGeneratedResult(null); }}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg shadow-emerald-950/40 transition"
          >
            <Plus className="w-4 h-4" />
            Generate Agent Keypair
          </button>
        </div>
      </div>

      {/* Auto-Provisioned Dev Key Banner */}
      {devKeypair && (
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-4 text-emerald-300 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded">
                Auto-Provisioned Dev Key
              </span>
              <span className="text-sm font-mono text-emerald-200/80">{devKeypair.fingerprint}</span>
            </div>
            <p className="text-xs text-emerald-400/80">
              Ready for immediate playground & script testing. Private key is saved locally in <code className="font-mono bg-emerald-950 px-1 py-0.5 rounded">.keys/authorized_keys.json</code>.
            </p>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(devKeypair.privateKeyPem);
              setCopiedDevKey(true);
              setTimeout(() => setCopiedDevKey(false), 2000);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-200 bg-emerald-900/60 hover:bg-emerald-800/60 border border-emerald-700/50 rounded-lg transition shrink-0"
          >
            {copiedDevKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedDevKey ? "Private Key Copied!" : "Copy Private Key PEM"}
          </button>
        </div>
      )}

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
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-zinc-500 font-sans">
                    No authorized keys found. Click &quot;Generate Agent Keypair&quot; to create one.
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
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTopup(key.fingerprint)}
                          className="px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/40 rounded transition"
                          title="Add 100 Credits"
                        >
                          +100 Credits
                        </button>
                        {key.status === "active" && (
                          <button
                            onClick={() => handleRevoke(key.fingerprint)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 transition"
                            title="Revoke Key"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Keypair Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-semibold text-zinc-100">
                  {generatedResult ? "Keypair Generated Successfully" : "Generate Agent Keypair"}
                </h3>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-zinc-500 hover:text-zinc-300 text-lg font-mono"
              >
                ✕
              </button>
            </div>

            {!generatedResult ? (
              <form onSubmit={handleGenerateKey} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Agent Name / Identifier</label>
                  <input
                    type="text"
                    value={newAgentName}
                    onChange={(e) => setNewAgentName(e.target.value)}
                    placeholder="e.g. Claude-Vision-Worker-01"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Cryptographic Algorithm</label>
                  <select
                    value={newAlgorithm}
                    onChange={(e) => setNewAlgorithm(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 transition"
                  >
                    <option value="ed25519">Ed25519 (Recommended — Fast, Compact 256-bit)</option>
                    <option value="rsa">RSA-2048 (Standard Enterprise)</option>
                  </select>
                </div>

                <div className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-400">
                  ⚡ The public key will be auto-enrolled with <strong className="text-amber-400">100 free credits</strong>. You will receive the private key to configure in your AI agent.
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition shadow-lg shadow-emerald-950/40"
                  >
                    Generate & Enroll
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-xs text-emerald-300">
                  ✅ Key fingerprint: <span className="font-mono font-semibold">{generatedResult.agent.fingerprint}</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Private Key (Keep Secret!)</label>
                  <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-48">
                    {generatedResult.keypair.privateKeyPem}
                  </pre>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={() => {
                      const element = document.createElement("a");
                      const file = new Blob([generatedResult.keypair.privateKeyPem], { type: "text/plain" });
                      element.href = URL.createObjectURL(file);
                      element.download = `agent_${generatedResult.agent.fingerprint.slice(7, 15)}_private.pem`;
                      document.body.appendChild(element);
                      element.click();
                    }}
                    className="px-4 py-2 text-xs font-medium text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/60 rounded-lg transition"
                  >
                    Download Private Key (.pem)
                  </button>
                  <button
                    onClick={() => setShowGenerateModal(false)}
                    className="px-5 py-2 text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
