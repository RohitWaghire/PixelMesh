"use client";

import React, { useState, useEffect } from "react";
import ToolSidebar from "./ToolSidebar";
import CanvasViewport from "./CanvasViewport";
import ParameterInspector from "./ParameterInspector";
import { FILTER_TOOLS_CATALOG, FilterToolDef } from "@/lib/image/tools-catalog";
import { Upload, Image as ImageIcon, Sparkles, Check, Trash2, ArrowRight } from "lucide-react";

// Clean High-Quality Sample Photography (Portrait, Neon City, Mountain Landscape)
const SAMPLE_IMAGES = [
  {
    name: "Neon Cyberpunk Portrait",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80"
  },
  {
    name: "Golden Hour Landscape",
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&auto=format&fit=crop&q=80"
  },
  {
    name: "Architectural Studio",
    url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80"
  }
];

export default function StudioPlayground() {
  const [selectedTool, setSelectedTool] = useState<FilterToolDef>(FILTER_TOOLS_CATALOG[0]);
  const [toolParams, setToolParams] = useState<Record<string, any>>(FILTER_TOOLS_CATALOG[0].defaultParams);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [zoom, setZoom] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | undefined>(undefined);
  const [pipelineSteps, setPipelineSteps] = useState<Array<{ tool: string; params: any }>>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [activeKeyFingerprint, setActiveKeyFingerprint] = useState<string>("");

  // Load registered keys & default image
  useEffect(() => {
    fetch("/api/auth/keys")
      .then((res) => res.json())
      .then((data) => {
        setKeys(data.keys || []);
        if (data.keys?.[0]) {
          setActiveKeyFingerprint(data.keys[0].fingerprint);
        }
      });

    loadSampleImage(SAMPLE_IMAGES[0].url);
  }, []);

  const loadSampleImage = async (url: string) => {
    try {
      setLoading(true);
      const res = await fetch(url);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setOriginalImage(base64);
        setProcessedImage(null);
        setPipelineSteps([]);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Failed to load sample image:", err);
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
      setOriginalImage(base64);
      setProcessedImage(null);
      setPipelineSteps([]);
    };
    reader.readAsDataURL(file);
  };

  const handleSelectTool = (tool: FilterToolDef) => {
    setSelectedTool(tool);
    setToolParams(tool.defaultParams);
  };

  const handleApplyFilter = async () => {
    if (!originalImage) return;

    try {
      setLoading(true);
      const currentInput = processedImage || originalImage;

      const res = await fetch("/api/studio/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: currentInput,
          tool: selectedTool.id,
          params: toolParams
        })
      });

      const data = await res.json();
      if (data.success) {
        setProcessedImage(data.result.imageBase64);
        setMetadata(data.result.metadata);
        setExecutionTimeMs(data.result.executionTimeMs);
        setPipelineSteps((prev) => [...prev, { tool: selectedTool.name, params: toolParams }]);
      } else {
        alert(data.error || "Filter failed to apply");
      }
    } catch (err) {
      console.error("Error executing filter:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleResetToOriginal = () => {
    setProcessedImage(null);
    setPipelineSteps([]);
  };

  return (
    <div className="space-y-4">
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
                className="px-2.5 py-1 text-xs text-zinc-300 hover:text-white bg-zinc-950/70 hover:bg-zinc-800/80 border border-zinc-800 rounded-lg transition"
              >
                Sample {idx + 1}
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
          setSliderPos={setSliderPos}
          zoom={zoom}
          setZoom={setZoom}
          loading={loading}
          metadata={metadata}
          executionTimeMs={executionTimeMs}
        />

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
    </div>
  );
}
