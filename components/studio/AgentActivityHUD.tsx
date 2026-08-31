"use client";

import React, { useState, useEffect } from "react";
import { Bot, Sparkles, CheckCircle2, AlertCircle, X, Zap, Terminal } from "lucide-react";
import type { WebMCPActiveCall } from "@/lib/webmcp/use-webmcp";
import type { WebMCPExecutionRecord } from "@/lib/webmcp/types";

export interface AgentActivityHUDProps {
  activeCall: WebMCPActiveCall | null;
  lastRecord?: WebMCPExecutionRecord | null;
  onDismiss?: () => void;
}

export default function AgentActivityHUD({
  activeCall,
  lastRecord,
  onDismiss,
}: AgentActivityHUDProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Derive active display record
  const currentRecord = React.useMemo(() => {
    if (activeCall) {
      return {
        id: `active-${activeCall.startTime}`,
        toolName: activeCall.toolName,
        params: activeCall.params,
        caller: activeCall.caller || "agent:browser",
        success: true,
        isLoading: true,
        durationMs: undefined,
        error: undefined,
      };
    }
    if (lastRecord) {
      return {
        id: lastRecord.id,
        toolName: lastRecord.toolName,
        params: lastRecord.params,
        caller: lastRecord.caller || "agent:browser",
        success: lastRecord.success,
        isLoading: false,
        durationMs: lastRecord.durationMs,
        error: lastRecord.error,
      };
    }
    return null;
  }, [activeCall, lastRecord]);

  // Control visibility and auto-dismiss timer
  useEffect(() => {
    if (!currentRecord) {
      setVisible(false);
      return;
    }

    if (currentRecord.id === dismissedId) {
      setVisible(false);
      return;
    }

    setVisible(true);

    // Auto-dismiss completed actions after 4.5 seconds of inactivity
    if (!currentRecord.isLoading) {
      const timer = setTimeout(() => {
        setVisible(false);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [currentRecord, dismissedId]);

  if (!visible || !currentRecord) return null;

  const formatParams = (params: Record<string, any>) => {
    if (!params || Object.keys(params).length === 0) return null;
    const entries = Object.entries(params);
    if (entries.length === 1 && typeof entries[0][1] !== "object") {
      return `${entries[0][0]}: ${String(entries[0][1])}`;
    }
    if (params.tool) {
      return `filter: ${params.tool}`;
    }
    if (params.position !== undefined) {
      return `pos: ${params.position}%${params.zoom ? ` · zoom: ${params.zoom}x` : ""}`;
    }
    if (params.width && params.height) {
      return `crop: ${params.width}×${params.height} at (${params.left || 0},${params.top || 0})`;
    }
    if (params.operations && Array.isArray(params.operations)) {
      return `pipeline: ${params.operations.length} steps`;
    }
    if (params.action) {
      return `action: ${params.action}`;
    }
    return JSON.stringify(params).slice(0, 48);
  };

  const formattedParamStr = formatParams(currentRecord.params);

  const handleDismiss = () => {
    if (currentRecord) {
      setDismissedId(currentRecord.id);
    }
    setVisible(false);
    onDismiss?.();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-4 right-4 z-40 max-w-sm w-auto transition-all duration-300 transform animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-zinc-950/90 border border-emerald-500/40 backdrop-blur-md shadow-[0_0_30px_rgba(16,185,129,0.25)] text-xs text-zinc-200 selection:bg-emerald-500/30">
        {/* Pulsing Status Dot / Icon */}
        <div className="relative flex items-center justify-center shrink-0">
          {currentRecord.isLoading ? (
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
            </span>
          ) : currentRecord.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-0.5 min-w-0 pr-1">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-semibold text-white">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span>AI Co-Pilot</span>
            </span>

            <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 truncate max-w-[140px]">
              {currentRecord.toolName}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            {formattedParamStr && (
              <span className="font-mono text-zinc-300 truncate max-w-[180px]" title={formattedParamStr}>
                {formattedParamStr}
              </span>
            )}

            {currentRecord.durationMs !== undefined && (
              <span className="flex items-center gap-0.5 text-emerald-400 font-mono shrink-0">
                <Zap className="w-3 h-3 fill-emerald-400" />
                {currentRecord.durationMs}ms
              </span>
            )}

            {currentRecord.isLoading && (
              <span className="flex items-center gap-1 text-amber-300 font-medium animate-pulse shrink-0">
                <Sparkles className="w-3 h-3 animate-spin" />
                Executing...
              </span>
            )}
          </div>

          {currentRecord.error && (
            <div className="text-[10px] font-mono text-rose-400 truncate max-w-[220px]">
              Error: {currentRecord.error}
            </div>
          )}

          {currentRecord.caller && !currentRecord.error && (
            <div className="text-[9px] font-mono text-zinc-500 flex items-center gap-1">
              <Terminal className="w-2.5 h-2.5" />
              <span>{currentRecord.caller}</span>
            </div>
          )}
        </div>

        {/* Dismiss Button */}
        <button
          onClick={handleDismiss}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-lg transition ml-auto shrink-0"
          title="Dismiss HUD"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
