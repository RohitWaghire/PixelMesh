"use client";

import React, { useRef } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Download, Sparkles } from "lucide-react";

interface CanvasViewportProps {
  originalImage: string | null;
  processedImage: string | null;
  sliderPos: number;
  setSliderPos: (pos: number) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  loading: boolean;
  metadata?: any;
  executionTimeMs?: number;
  children?: React.ReactNode;
}

export default function CanvasViewport({
  originalImage,
  processedImage,
  sliderPos,
  setSliderPos,
  zoom,
  setZoom,
  loading,
  metadata,
  executionTimeMs,
  children,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSliderMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  };

  const handleDownload = () => {
    if (!processedImage) return;
    const a = document.createElement("a");
    a.href = processedImage;
    a.download = `pixelmesh_export_${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex-1 flex flex-col bg-zinc-950/80 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl relative">
      {/* Canvas Controls Header */}
      <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-400">
            {metadata?.width ? `${metadata.width} × ${metadata.height}px` : "1920 × 1080px"}
          </span>
          {executionTimeMs !== undefined && (
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
              ⚡ {executionTimeMs}ms
            </span>
          )}
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 font-mono animate-pulse">
              <Sparkles className="w-3.5 h-3.5" /> Processing filter...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 rounded border border-zinc-700/60 transition"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono text-zinc-400 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 rounded border border-zinc-700/60 transition"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 rounded border border-zinc-700/60 transition"
            title="Reset Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {processedImage && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 ml-2 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow transition"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
        </div>
      </div>

      {/* Main Interactive Stage */}
      <div
        ref={containerRef}
        onMouseMove={(e) => {
          if (e.buttons === 1) handleSliderMove(e);
        }}
        onClick={handleSliderMove}
        className="flex-1 min-h-[440px] flex items-center justify-center p-6 select-none cursor-ew-resize relative overflow-hidden bg-dot-pattern"
      >
        {originalImage ? (
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            className="relative transition-transform duration-75 max-w-full max-h-full flex items-center justify-center shadow-2xl rounded-lg overflow-hidden border border-zinc-800"
          >
            {/* Underlay / Processed Image */}
            <img
              src={processedImage || originalImage}
              alt="Processed"
              className="max-h-[500px] object-contain block pointer-events-none"
            />

            {/* Overlay / Original Image clipped by Before/After slider */}
            {processedImage && (
              <div
                style={{ clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)` }}
                className="absolute inset-0 pointer-events-none"
              >
                <img
                  src={originalImage}
                  alt="Original"
                  className="max-h-[500px] object-contain block pointer-events-none"
                />
              </div>
            )}

            {/* Split Divider Handle */}
            {processedImage && (
              <div
                style={{ left: `${sliderPos}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)] pointer-events-none"
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white text-zinc-900 flex items-center justify-center text-[10px] font-bold shadow-lg border border-zinc-300">
                  ↔
                </div>
                <div className="absolute top-3 -translate-x-full pr-2 text-[10px] uppercase font-mono font-bold tracking-wider text-white bg-black/60 px-1.5 py-0.5 rounded">
                  Before
                </div>
                <div className="absolute top-3 pl-2 text-[10px] uppercase font-mono font-bold tracking-wider text-emerald-400 bg-black/60 px-1.5 py-0.5 rounded">
                  After
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-zinc-500">
            <p>Upload or select an image to inspect live filter transformations.</p>
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
