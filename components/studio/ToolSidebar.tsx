"use client";

import React from "react";
import { 
  FilterToolDef, 
  FILTER_TOOLS_CATALOG 
} from "@/lib/image/tools-catalog";
import { 
  Crop, 
  CheckCircle, 
  Plus, 
  RotateCw, 
  Sun, 
  Sliders, 
  Contrast, 
  MinusCircle, 
  Zap, 
  EyeOff, 
  Sparkles, 
  ImageIcon 
} from "lucide-react";

interface ToolSidebarProps {
  selectedTool: FilterToolDef;
  onSelectTool: (tool: FilterToolDef) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Crop: <Crop className="w-4 h-4 text-emerald-400" />,
  CheckCircle: <CheckCircle className="w-4 h-4 text-emerald-400" />,
  Plus: <Plus className="w-4 h-4 text-emerald-400" />,
  RotateCw: <RotateCw className="w-4 h-4 text-emerald-400" />,
  Sun: <Sun className="w-4 h-4 text-amber-400" />,
  Sliders: <Sliders className="w-4 h-4 text-amber-400" />,
  Contrast: <Contrast className="w-4 h-4 text-violet-400" />,
  MinusCircle: <MinusCircle className="w-4 h-4 text-violet-400" />,
  Zap: <Zap className="w-4 h-4 text-sky-400" />,
  EyeOff: <EyeOff className="w-4 h-4 text-sky-400" />,
  Sparkles: <Sparkles className="w-4 h-4 text-amber-400" />,
  ImageIcon: <ImageIcon className="w-4 h-4 text-zinc-400" />
};

export default function ToolSidebar({ selectedTool, onSelectTool }: ToolSidebarProps) {
  return (
    <div className="w-72 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden backdrop-blur-md">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Image Filters</h2>
        </div>
        <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
          {FILTER_TOOLS_CATALOG.length} Tools
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {FILTER_TOOLS_CATALOG.map((tool) => {
          const isSelected = selectedTool.id === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => onSelectTool(tool)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs transition group ${
                isSelected
                  ? "bg-zinc-800 text-zinc-100 font-medium shadow-sm border border-zinc-700/60"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              }`}
            >
              <span className="shrink-0 group-hover:scale-110 transition-transform">
                {ICON_MAP[tool.iconName] || <ImageIcon className="w-4 h-4 text-zinc-400" />}
              </span>
              <span className="truncate">{tool.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
