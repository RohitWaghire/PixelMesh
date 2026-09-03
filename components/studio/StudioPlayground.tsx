"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import ToolSidebar from "./ToolSidebar";
import CanvasViewport from "./CanvasViewport";
import ParameterInspector from "./ParameterInspector";
import AgentActivityHUD from "./AgentActivityHUD";
import WebMCPSimulatorDrawer from "./WebMCPSimulatorDrawer";
import DeclarativeWebMCPForms from "./DeclarativeWebMCPForms";
import { FILTER_TOOLS_CATALOG, FilterToolDef } from "@/lib/image/tools-catalog";
import { useWebMCP } from "@/lib/webmcp/use-webmcp";
import {
  composePipelineState,
  StudioCanvasMutationCoordinator,
  type StudioCanvasState,
} from "@/lib/webmcp/studio-mutation-state";
import type {
  StudioCanvasAdapter,
  StudioProcessResult,
  StudioCropResult,
  StudioUndoResult,
  StudioExportResult,
} from "@/lib/webmcp/tools";
import { WebMCPValidationError, WebMCPExecutionError } from "@/lib/webmcp/types";
import { Upload, Trash2, ArrowRight } from "lucide-react";

// Clean High-Quality Sample Photography (Portrait, Neon City, Mountain Landscape)
const SAMPLE_IMAGES = [
  {
    name: "Neon Cyberpunk Portrait",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80",
  },
  {
    name: "Golden Hour Landscape",
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop&q=80",
  },
  {
    name: "Architectural Studio",
    url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80",
  },
];

export default function StudioPlayground() {
  const [selectedTool, setSelectedTool] = useState<FilterToolDef>(FILTER_TOOLS_CATALOG[0]);
  const [toolParams, setToolParams] = useState<Record<string, any>>(FILTER_TOOLS_CATALOG[0].defaultParams);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | undefined>(undefined);
  const [pipelineSteps, setPipelineSteps] = useState<Array<{ tool: string; params: any }>>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [activeKeyFingerprint, setActiveKeyFingerprint] = useState<string>("");

  // Ref tracking for latest state to support synchronous access
  const stateRef = useRef({
    originalImage,
    processedImage,
    sliderPos,
    zoom,
    metadata,
    pipelineSteps,
    activeKeyFingerprint,
  });

  const mutationCoordinatorRef = useRef(
    new StudioCanvasMutationCoordinator({
      originalImage,
      processedImage,
      sliderPos,
      zoom,
      metadata,
      executionTimeMs,
      pipelineSteps,
    }),
  );
  const mutationCoordinator = mutationCoordinatorRef.current;

  const syncCanvasState = (next: StudioCanvasState) => {
    stateRef.current = {
      ...stateRef.current,
      originalImage: next.originalImage,
      processedImage: next.processedImage,
      sliderPos: next.sliderPos,
      zoom: next.zoom,
      metadata: next.metadata,
      pipelineSteps: next.pipelineSteps,
    };
    setOriginalImage(next.originalImage);
    setProcessedImage(next.processedImage);
    setSliderPos(next.sliderPos);
    setZoom(next.zoom);
    setMetadata(next.metadata);
    setExecutionTimeMs(next.executionTimeMs);
    setPipelineSteps(next.pipelineSteps);
  };

  const resetCanvasState = (next: StudioCanvasState) => {
    return mutationCoordinator.enqueueReset(next).then(() => {
      syncCanvasState(mutationCoordinator.getState());
    });
  };

  const enqueueCanvasMutation = <T,>(
    mutation: () => Promise<{ state: StudioCanvasState; result: T }>,
    options?: { resetHistory?: boolean },
  ): Promise<T> => mutationCoordinator.enqueue(mutation, options);

  useEffect(() => {
    stateRef.current = {
      originalImage,
      processedImage,
      sliderPos,
      zoom,
      metadata,
      pipelineSteps,
      activeKeyFingerprint,
    };
  }, [originalImage, processedImage, sliderPos, zoom, metadata, pipelineSteps, activeKeyFingerprint]);

  // Load registered keys & default image
  useEffect(() => {
    fetch("/api/auth/keys")
      .then((res) => res.json())
      .then((data) => {
        setKeys(data.keys || []);
        if (data.keys?.[0]) {
          setActiveKeyFingerprint(data.keys[0].fingerprint);
        }
      })
      .catch((err) => {
        console.warn("Failed fetching agent keys:", err);
      });

    setMounted(true);
    loadSampleImage(SAMPLE_IMAGES[0].url);
    // The initial sample and key lookup intentionally run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSampleImage = async (url: string, signal?: AbortSignal) => {
    try {
      setLoading(true);
      let base64: string;
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`Failed fetching sample: HTTP ${res.status}`);
        const blob = await res.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed reading sample image"));
          reader.readAsDataURL(blob);
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === "AbortError") throw fetchErr;
        // Fallback to local /icon.png if remote image fails or is offline
        const localRes = await fetch("/icon.png", { signal });
        const localBlob = await localRes.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed reading local fallback image"));
          reader.readAsDataURL(localBlob);
        });
      }

      await resetCanvasState({
        ...mutationCoordinator.getState(),
        originalImage: base64,
        processedImage: null,
        metadata: null,
        executionTimeMs: undefined,
        pipelineSteps: [],
        sliderPos: 50,
        zoom: 1,
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Failed to load sample image:", err);
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      resetCanvasState({
        ...mutationCoordinator.getState(),
        originalImage: base64,
        processedImage: null,
        metadata: null,
        executionTimeMs: undefined,
        pipelineSteps: [],
        sliderPos: 50,
        zoom: 1,
      }).catch((err) => {
        console.error("Failed to reset canvas after upload:", err);
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSelectTool = (tool: FilterToolDef) => {
    setSelectedTool(tool);
    setToolParams(tool.defaultParams);
  };

  // Construct StudioCanvasAdapter
  const adapter: StudioCanvasAdapter = useMemo(
    () => ({
      getImage: () => mutationCoordinator.getState().processedImage || mutationCoordinator.getState().originalImage,
      getOriginalImage: () => mutationCoordinator.getState().originalImage,
      getMetadata: () => mutationCoordinator.getState().metadata,
      getPipelineSteps: () => mutationCoordinator.getState().pipelineSteps,
      getSliderPos: () => mutationCoordinator.getState().sliderPos,
      getZoom: () => mutationCoordinator.getState().zoom,

      applyFilter: async (toolId: string, params: Record<string, any>, signal?: AbortSignal): Promise<StudioProcessResult> => {
        setLoading(true);
        try {
          const result = await enqueueCanvasMutation(async () => {
            const current = mutationCoordinator.getState();
            const currentInput = current.processedImage || current.originalImage;
            if (!currentInput) {
              throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (stateRef.current.activeKeyFingerprint) {
              headers["x-agent-key-fingerprint"] = stateRef.current.activeKeyFingerprint;
            }

            const res = await fetch("/api/studio/process", {
              method: "POST",
              headers,
              body: JSON.stringify({
                image_base64: currentInput,
                tool: toolId,
                params: params || {},
                output_format: (params as any)?.output_format || "png",
              }),
              signal,
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new WebMCPExecutionError(data.error || "Filter execution failed", toolId);
            }

            const nextState: StudioCanvasState = {
              ...current,
              processedImage: data.result.imageBase64,
              metadata: data.result.metadata,
              executionTimeMs: data.result.executionTimeMs,
              pipelineSteps: [...current.pipelineSteps, { tool: toolId, params: params || {} }],
            };

            const matchedTool = FILTER_TOOLS_CATALOG.find((t) => t.id === toolId);
            if (matchedTool) {
              setSelectedTool(matchedTool);
              setToolParams(params || matchedTool.defaultParams);
            }

            return {
              state: nextState,
              result: {
                processedImage: data.result.imageBase64,
                metadata: data.result.metadata,
                executionTimeMs: data.result.executionTimeMs,
              },
            };
          });
          syncCanvasState(mutationCoordinator.getState());
          return result;
        } finally {
          setLoading(false);
        }
      },

      cropImage: async (
        left: number,
        top: number,
        width: number,
        height: number,
        signal?: AbortSignal
      ): Promise<StudioCropResult> => {
        setLoading(true);
        try {
          const result = await enqueueCanvasMutation(async () => {
            const current = mutationCoordinator.getState();
            const currentInput = current.processedImage || current.originalImage;
            if (!currentInput) {
              throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (stateRef.current.activeKeyFingerprint) {
              headers["x-agent-key-fingerprint"] = stateRef.current.activeKeyFingerprint;
            }

            const res = await fetch("/api/studio/process", {
              method: "POST",
              headers,
              body: JSON.stringify({
                image_base64: currentInput,
                tool: "crop_image",
                params: { left, top, width, height },
              }),
              signal,
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new WebMCPExecutionError(data.error || "Crop execution failed", "crop_canvas");
            }

            const nextState: StudioCanvasState = {
              ...current,
              processedImage: data.result.imageBase64,
              metadata: data.result.metadata,
              executionTimeMs: data.result.executionTimeMs,
              pipelineSteps: [
                ...current.pipelineSteps,
                { tool: "crop_image", params: { left, top, width, height } },
              ],
            };

            return {
              state: nextState,
              result: {
                processedImage: data.result.imageBase64,
                metadata: data.result.metadata,
                executionTimeMs: data.result.executionTimeMs,
              },
            };
          });
          syncCanvasState(mutationCoordinator.getState());
          return result;
        } finally {
          setLoading(false);
        }
      },

      buildPipeline: async (
        operations: Array<{ tool: string; params?: any }>,
        signal?: AbortSignal,
        outputFormat?: string
      ): Promise<StudioProcessResult> => {
        setLoading(true);
        try {
          const result = await enqueueCanvasMutation(async () => {
            const current = mutationCoordinator.getState();
            const currentInput = current.processedImage || current.originalImage;
            if (!currentInput) {
              throw new WebMCPValidationError("No image is currently loaded in the studio canvas", "image");
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (stateRef.current.activeKeyFingerprint) {
              headers["x-agent-key-fingerprint"] = stateRef.current.activeKeyFingerprint;
            }

            const res = await fetch("/api/studio/process", {
              method: "POST",
              headers,
              body: JSON.stringify({
                image_base64: currentInput,
                operations,
                output_format: outputFormat || "png",
              }),
              signal,
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new WebMCPExecutionError(
                data.error || "Pipeline execution failed",
                "build_filter_pipeline"
              );
            }

            const nextState = composePipelineState(
              current,
              {
                processedImage: data.result.imageBase64,
                metadata: data.result.metadata,
                executionTimeMs: data.result.executionTimeMs,
              },
              operations,
            );

            return {
              state: nextState,
              result: {
                processedImage: data.result.imageBase64,
                metadata: data.result.metadata,
                executionTimeMs: data.result.executionTimeMs,
              },
            };
          });
          syncCanvasState(mutationCoordinator.getState());
          return result;
        } finally {
          setLoading(false);
        }
      },

      loadPreset: async (presetIndex?: number, imageUrl?: string, signal?: AbortSignal): Promise<void> => {
        let targetUrl = "";
        if (presetIndex !== undefined && SAMPLE_IMAGES[presetIndex]) {
          targetUrl = SAMPLE_IMAGES[presetIndex].url;
        } else if (imageUrl) {
          targetUrl = imageUrl;
        } else {
          throw new WebMCPValidationError(
            "Either a valid preset_index (0-2) or image_url must be provided",
            "load_preset_image"
          );
        }

        await loadSampleImage(targetUrl, signal);
      },

      setSlider: (pos: number, zoomLevel?: number) => {
        const current = mutationCoordinator.getState();
        const next = mutationCoordinator.update({
          sliderPos: pos,
          zoom: zoomLevel === undefined ? current.zoom : zoomLevel,
        });
        syncCanvasState(next);
      },

      undoAction: (action: "undo_last" | "reset_all"): StudioUndoResult => {
        const undo = mutationCoordinator.undo(action);
        syncCanvasState(undo.state);
        return {
          remainingSteps: undo.remainingSteps,
          restored: undo.restored,
          activeImage: undo.state.processedImage || undo.state.originalImage,
        };
      },

      exportImage: async (format = "png", quality = 90): Promise<StudioExportResult> => {
        const current = mutationCoordinator.getState();
        const active = current.processedImage || current.originalImage;
        if (!active) {
          throw new WebMCPValidationError("No image is currently loaded to export", "image");
        }

        const normFormat = (format || "png").toLowerCase();
        const mimeType =
          normFormat === "jpeg" || normFormat === "jpg"
            ? "image/jpeg"
            : normFormat === "webp"
            ? "image/webp"
            : normFormat === "avif"
            ? "image/avif"
            : "image/png";

        let exportedBase64 = active;
        if (typeof window !== "undefined" && typeof document !== "undefined") {
          try {
            const img = new Image();
            img.src = active;
            await new Promise<void>((resolve, reject) => {
              if (img.complete) {
                resolve();
              } else {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error("Failed to load active image for transcoding"));
              }
            });

            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              if (mimeType === "image/jpeg") {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
              }
              ctx.drawImage(img, 0, 0);
              const qualityRatio = Math.max(0.1, Math.min(1.0, quality / 100));
              exportedBase64 = canvas.toDataURL(mimeType, qualityRatio);
            }
          } catch {
            exportedBase64 = active;
          }
        }

        const sizeBytes = Math.round(exportedBase64.length * 0.75);
        return {
          imageBase64: exportedBase64,
          format: normFormat,
          sizeBytes,
          width: current.metadata?.width,
          height: current.metadata?.height,
        };
      },
    }),
    // Keep the adapter identity stable so useWebMCP does not re-register tools on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Bind WebMCP React Lifecycle Hook
  const {
    tools,
    activeCall,
    executionHistory,
    isNative,
    isSimulating,
    simulateAgentCall,
    clearHistory,
  } = useWebMCP(adapter);

  const handleApplyFilter = async () => {
    if (!originalImage) return;

    try {
      // Keep manual executions on the same ModelContext path as browser agents
      // so the HUD and Call Logs reflect every tool execution consistently.
      await simulateAgentCall(
        "apply_filter",
        { tool: selectedTool.id, params: toolParams },
        { caller: "human:studio" },
      );
    } catch (err: any) {
      console.error("Error executing filter:", err);
      alert(err?.message || "Filter failed to apply");
    }
  };

  const handleResetToOriginal = () => {
    adapter.undoAction("reset_all");
  };

  return (
    <div className="space-y-4">
      {/* The native host already discovers the imperative catalog. Keep the
          local declarative fallback from duplicating those tool names. */}
      {mounted && !isNative && <DeclarativeWebMCPForms />}

      {/* Quick Toolbar / Sample Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg cursor-pointer transition">
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Upload Image</span>
            <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
          </label>

          <span className="text-xs text-zinc-500 font-mono hidden sm:inline">or try samples:</span>

          <div className="flex items-center gap-1.5">
            {SAMPLE_IMAGES.map((s, idx) => (
              <button
                key={s.name}
                onClick={() => loadSampleImage(s.url)}
                aria-label={`Load ${s.name}`}
                className="px-2.5 py-1 text-xs text-zinc-300 hover:text-white bg-zinc-950/70 hover:bg-zinc-800/80 border border-zinc-800 rounded-lg transition"
              >
                {s.name} (Sample {idx + 1})
              </button>
            ))}
          </div>
        </div>

        {/* Active Key Selector */}
        {keys.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400 font-medium">Agent Key:</span>
            <select
              value={activeKeyFingerprint}
              onChange={(e) => setActiveKeyFingerprint(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs font-mono text-emerald-400 focus:outline-none"
            >
              {keys.map((k) => (
                <option key={k.fingerprint} value={k.fingerprint}>
                  {k.agentName} (🪙 {k.creditsBalance})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 3-Column Studio Workspace */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-[580px]">
        <ToolSidebar selectedTool={selectedTool} onSelectTool={handleSelectTool} />

        <CanvasViewport
          originalImage={originalImage}
          processedImage={processedImage}
          sliderPos={sliderPos}
          setSliderPos={(pos) => adapter.setSlider(pos)}
          zoom={zoom}
          setZoom={(value) => {
            const current = mutationCoordinator.getState();
            const nextZoom = typeof value === "function" ? value(current.zoom) : value;
            adapter.setSlider(current.sliderPos, nextZoom);
          }}
          loading={loading}
          metadata={metadata}
          executionTimeMs={executionTimeMs}
        >
          {/* Live Agent Activity HUD */}
          <AgentActivityHUD
            activeCall={activeCall}
            lastRecord={executionHistory.length > 0 ? executionHistory[0] : null}
          />
        </CanvasViewport>

        <ParameterInspector
          selectedTool={selectedTool}
          params={toolParams}
          setParams={setToolParams}
          onApply={handleApplyFilter}
          onReset={() => setToolParams(selectedTool.defaultParams)}
          loading={loading}
          activeKeyFingerprint={activeKeyFingerprint}
        />
      </div>

      {/* Pipeline History Timeline */}
      {pipelineSteps.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 mr-2">
              Active Pipeline Chain:
            </span>
            <span className="px-2.5 py-1 text-xs font-mono bg-zinc-800 rounded text-zinc-300 border border-zinc-700 shrink-0">
              Source
            </span>
            {pipelineSteps.map((step, i) => (
              <React.Fragment key={i}>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                <span className="px-2.5 py-1 text-xs font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 rounded shrink-0">
                  {step.tool}
                </span>
              </React.Fragment>
            ))}
          </div>
          <button
            onClick={handleResetToOriginal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg shrink-0 transition"
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset Pipeline
          </button>
        </div>
      )}

      {/* In-Browser WebMCP Simulator & DevTools Inspector Drawer */}
      <WebMCPSimulatorDrawer
        tools={tools}
        history={executionHistory}
        isNative={isNative}
        isSimulating={isSimulating}
        onSimulate={simulateAgentCall}
        onClearHistory={clearHistory}
      />
    </div>
  );
}
