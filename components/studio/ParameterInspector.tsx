"use client";

import React from "react";
import { FilterToolDef } from "@/lib/image/tools-catalog";
import { Sparkles, Play, RotateCcw, Key } from "lucide-react";

interface ParameterInspectorProps {
  selectedTool: FilterToolDef;
  params: Record<string, any>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onApply: () => void;
  onReset: () => void;
  loading: boolean;
  activeKeyFingerprint: string;
}

export default function ParameterInspector({
  selectedTool,
  params,
  setParams,
  onApply,
  onReset,
  loading,
  activeKeyFingerprint,
}: ParameterInspectorProps) {
  const handleParamChange = (key: string, value: any) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="w-80 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-200">{selectedTool.name}</h3>
        <p className="text-xs text-zinc-400 mt-0.5">{selectedTool.description}</p>
      </div>

      {/* Active Agent Signing Badge */}
      <div className="px-4 py-2.5 bg-zinc-950/60 border-b border-zinc-800/60 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Key className="w-3.5 h-3.5 text-emerald-400" />
          <span>Signing Agent:</span>
        </div>
        <span className="text-emerald-400 truncate max-w-[130px]" title={activeKeyFingerprint}>
          {activeKeyFingerprint ? activeKeyFingerprint.slice(0, 14) + "..." : "Dev Admin"}
        </span>
      </div>

      {/* Parameters List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {selectedTool.paramControls.length === 0 ? (
          <div className="text-xs text-zinc-500 py-6 text-center">
            This filter operates with standard automatic luminance transformation. No parameter tuning required.
          </div>
        ) : (
          selectedTool.paramControls.map((ctrl) => (
            <div key={ctrl.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-zinc-300">{ctrl.label}</label>
                <span className="font-mono text-emerald-400">
                  {params[ctrl.key] ?? selectedTool.defaultParams[ctrl.key]}
                </span>
              </div>

              {ctrl.type === "slider" && (
                <input
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step || 1}
                  value={params[ctrl.key] ?? selectedTool.defaultParams[ctrl.key]}
                  onChange={(e) => handleParamChange(ctrl.key, Number(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              )}

              {ctrl.type === "number" && (
                <input
                  type="number"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step || 1}
                  value={params[ctrl.key] ?? selectedTool.defaultParams[ctrl.key]}
                  onChange={(e) => handleParamChange(ctrl.key, Number(e.target.value))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                />
              )}

              {ctrl.type === "select" && (
                <select
                  value={params[ctrl.key] ?? selectedTool.defaultParams[ctrl.key]}
                  onChange={(e) => handleParamChange(ctrl.key, e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  {ctrl.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))
        )}
      </div>

      {/* Action Footer */}
      <div className="p-4 border-t border-zinc-800 flex gap-2">
        <button
          onClick={onReset}
          className="flex items-center justify-center p-2.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 rounded-xl transition"
          title="Reset Parameters"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onApply}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl shadow-lg shadow-emerald-950/40 transition"
        >
          {loading ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" /> Processing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" /> Execute Tool (1 Credit)
            </>
          )}
        </button>
      </div>
    </div>
  );
}
