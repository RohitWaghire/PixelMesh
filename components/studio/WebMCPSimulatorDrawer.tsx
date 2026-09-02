"use client";

import React, { useState } from "react";
import type { RegisteredTool, WebMCPExecutionRecord } from "@/lib/webmcp/types";
import {
  Bot,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Play,
  Copy,
  Trash2,
  Check,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Layers,
  Code2,
  FileText,
  Sliders,
  Send,
  Zap,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export interface WebMCPSimulatorDrawerProps {
  tools: RegisteredTool[];
  history: WebMCPExecutionRecord[];
  isNative: boolean;
  isSimulating: boolean;
  onSimulate: (
    toolName: string,
    params?: Record<string, any>,
    options?: { caller?: string }
  ) => Promise<{ success: boolean; result?: any; error?: string; durationMs: number }>;
  onClearHistory: () => void;
}

interface PromptPreset {
  title: string;
  description: string;
  prompt: string;
  plan: Array<{ tool: string; params: Record<string, any> }>;
}

const PROMPT_PRESETS: PromptPreset[] = [
  {
    title: "Vintage Warm Mood",
    description: "Crops to 1:1 square and applies vintage warm sepia styling",
    prompt: "Crop 1:1 and apply vintage warm filter",
    plan: [
      { tool: "crop_canvas", params: { left: 0, top: 0, width: 600, height: 600 } },
      { tool: "apply_filter", params: { tool: "make_sepia_tone", params: { intensity: 75 } } },
    ],
  },
  {
    title: "Enhance Portrait Lighting",
    description: "Boosts exposure and introduces subtle photographic glow",
    prompt: "Enhance portrait lighting",
    plan: [
      { tool: "apply_filter", params: { tool: "change_exposure", params: { stops: 1.2 } } },
      { tool: "apply_filter", params: { tool: "glow_effect", params: { intensity: 40, radius: 10 } } },
    ],
  },
  {
    title: "Neon Cyberpunk Glow",
    description: "Intense neon vibrancy and dual-tone saturation",
    prompt: "Apply neon cyberpunk glow",
    plan: [
      { tool: "apply_filter", params: { tool: "glow_effect", params: { intensity: 85, radius: 18 } } },
      { tool: "apply_filter", params: { tool: "adjust_vibrance", params: { factor: 60 } } },
    ],
  },
  {
    title: "High-Contrast Noir B&W",
    description: "Converts to black & white with deepened shadows and contrast",
    prompt: "Convert to High-Contrast B&W",
    plan: [
      { tool: "apply_filter", params: { tool: "grayscale_image", params: {} } },
      { tool: "apply_filter", params: { tool: "adjust_contrast", params: { factor: 40 } } },
    ],
  },
  {
    title: "50/50 Split Slider View",
    description: "Sets before/after split slider to center (50%) at 1.2x zoom",
    prompt: "Set split slider to 50%",
    plan: [{ tool: "set_comparison_slider", params: { position: 50, zoom: 1.2 } }],
  },
  {
    title: "Inspect Canvas State",
    description: "Queries active canvas metadata and filter pipeline history",
    prompt: "Inspect canvas metadata and pipeline",
    plan: [{ tool: "inspect_image", params: { include_history: true } }],
  },
  {
    title: "Reset Canvas",
    description: "Reverts all active filter steps back to original image",
    prompt: "Reset canvas",
    plan: [{ tool: "undo_canvas_action", params: { action: "reset_all" } }],
  },
  {
    title: "Export Canvas as WEBP",
    description: "Exports the current canvas rendering in high-quality WebP format",
    prompt: "Export current image as WEBP",
    plan: [{ tool: "export_canvas_image", params: { format: "webp", quality: 92 } }],
  },
];

/**
 * Natural Language heuristic prompt parser mapping free-form user text
 * to WebMCP tool operations and parameters.
 */
export function parseNaturalLanguagePrompt(
  prompt: string
): Array<{ tool: string; params: Record<string, any> }> {
  const p = prompt.toLowerCase().trim();

  // 1. Check exact preset matches
  for (const preset of PROMPT_PRESETS) {
    if (preset.prompt.toLowerCase() === p) {
      return preset.plan;
    }
  }

  // 2. Reset actions
  if (p.includes("reset") || p.includes("revert") || p.includes("original") || p.includes("clear")) {
    return [{ tool: "undo_canvas_action", params: { action: "reset_all" } }];
  }

  // 3. Undo last
  if (p.includes("undo")) {
    return [{ tool: "undo_canvas_action", params: { action: "undo_last" } }];
  }

  // 4. Slider & Zoom
  if (p.includes("slider") || p.includes("split") || p.includes("comparison") || p.includes("zoom")) {
    let pos = 50;
    const posMatch = p.match(/(\d+)%/);
    if (posMatch) {
      pos = Math.min(100, Math.max(0, parseInt(posMatch[1], 10)));
    }
    let zoom = 1.0;
    const zoomMatch = p.match(/(\d+(?:\.\d+)?)x|zoom\s*(?:to|level)?\s*(\d+(?:\.\d+)?)/);
    if (zoomMatch) {
      const zVal = parseFloat(zoomMatch[1] || zoomMatch[2]);
      if (!isNaN(zVal)) zoom = Math.min(3.0, Math.max(0.5, zVal));
    }
    return [{ tool: "set_comparison_slider", params: { position: pos, zoom } }];
  }

  // 5. Inspect
  if (p.includes("inspect") || p.includes("metadata") || p.includes("dimensions") || p.includes("size")) {
    return [{ tool: "inspect_image", params: { include_history: true } }];
  }

  // 6. Export
  if (p.includes("export") || p.includes("download") || p.includes("save")) {
    const fmt = p.includes("webp") ? "webp" : p.includes("jpeg") || p.includes("jpg") ? "jpeg" : "png";
    return [{ tool: "export_canvas_image", params: { format: fmt, quality: 90 } }];
  }

  // 7. Crop
  if (p.includes("crop")) {
    if (p.includes("1:1") || p.includes("square")) {
      return [{ tool: "crop_canvas", params: { left: 0, top: 0, width: 600, height: 600 } }];
    }
    return [{ tool: "crop_canvas", params: { left: 50, top: 50, width: 500, height: 400 } }];
  }

  // 8. Filters
  if (p.includes("sepia") || p.includes("vintage") || p.includes("warm")) {
    return [{ tool: "apply_filter", params: { tool: "make_sepia_tone", params: { intensity: 75 } } }];
  }

  if (p.includes("black and white") || p.includes("b&w") || p.includes("grayscale") || p.includes("monochrome") || p.includes("noir")) {
    return [{ tool: "apply_filter", params: { tool: "grayscale_image", params: {} } }];
  }

  if (p.includes("cyberpunk") || p.includes("neon") || p.includes("glow")) {
    return [
      { tool: "apply_filter", params: { tool: "glow_effect", params: { intensity: 80, radius: 15 } } },
      { tool: "apply_filter", params: { tool: "adjust_vibrance", params: { factor: 50 } } },
    ];
  }

  if (p.includes("blur") || p.includes("gaussian")) {
    return [{ tool: "apply_filter", params: { tool: "gaussian_blur", params: { radius: 10 } } }];
  }

  if (p.includes("exposure") || p.includes("bright") || p.includes("lighting")) {
    return [{ tool: "apply_filter", params: { tool: "change_exposure", params: { stops: 1.2 } } }];
  }

  if (p.includes("contrast")) {
    return [{ tool: "apply_filter", params: { tool: "adjust_contrast", params: { factor: 30 } } }];
  }

  if (p.includes("invert")) {
    return [{ tool: "apply_filter", params: { tool: "invert_colors", params: {} } }];
  }

  // Default fallback: apply vibrance
  return [{ tool: "apply_filter", params: { tool: "adjust_vibrance", params: { factor: 35 } } }];
}

export default function WebMCPSimulatorDrawer({
  tools,
  history,
  isNative,
  isSimulating,
  onSimulate,
  onClearHistory,
}: WebMCPSimulatorDrawerProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"simulator" | "schemas" | "console" | "logs">("simulator");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [simulationOutput, setSimulationOutput] = useState<any>(null);
  const [selectedToolName, setSelectedToolName] = useState<string>("apply_filter");
  const [manualParamsText, setManualParamsText] = useState<string>('{\n  "tool": "make_sepia_tone",\n  "params": { "intensity": 60 }\n}');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync selected tool when tools change
  const activeToolDef = tools.find((t) => t.name === selectedToolName) || tools[0];

  const handleRunPreset = async (preset: PromptPreset) => {
    setCustomPrompt(preset.prompt);
    setSimulationOutput({ status: "executing", prompt: preset.prompt, steps: [] });

    const stepResults: any[] = [];
    for (const step of preset.plan) {
      const res = await onSimulate(step.tool, step.params, { caller: "simulator:nl-preset" });
      stepResults.push({ tool: step.tool, params: step.params, result: res });
      if (!res.success) break;
    }

    setSimulationOutput({
      status: "completed",
      prompt: preset.prompt,
      steps: stepResults,
      success: stepResults.every((r) => r.result.success),
    });
  };

  const handleRunCustomPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;

    const plan = parseNaturalLanguagePrompt(customPrompt);
    setSimulationOutput({ status: "executing", prompt: customPrompt, plan, steps: [] });

    const stepResults: any[] = [];
    for (const step of plan) {
      const res = await onSimulate(step.tool, step.params, { caller: "simulator:nl-custom" });
      stepResults.push({ tool: step.tool, params: step.params, result: res });
      if (!res.success) break;
    }

    setSimulationOutput({
      status: "completed",
      prompt: customPrompt,
      steps: stepResults,
      success: stepResults.every((r) => r.result.success),
    });
  };

  const handleRunManualConsole = async () => {
    let parsedParams = {};
    try {
      if (manualParamsText.trim()) {
        parsedParams = JSON.parse(manualParamsText);
      }
    } catch {
      alert("Invalid JSON format in parameter input");
      return;
    }

    const res = await onSimulate(selectedToolName, parsedParams, { caller: "simulator:console" });
    setSimulationOutput({
      status: "completed",
      tool: selectedToolName,
      params: parsedParams,
      result: res,
      success: res.success,
    });
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md transition-all duration-300">
      {/* Persistent Toggle Bar */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-4 py-3 bg-zinc-900/70 hover:bg-zinc-900 cursor-pointer border-b border-zinc-800/80 select-none transition"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Bot className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>WebMCP Co-Pilot DevTools & In-Browser Simulator</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 font-mono text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 rounded">
              {tools.length} Tools Registered
            </span>

            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] bg-zinc-800 text-zinc-300 rounded border border-zinc-700">
              {isNative ? "🟢 Chrome 149+ Native" : "⚡ ModelContext Polyfill"}
            </span>

            {isSimulating && (
              <span className="flex items-center gap-1 text-[11px] text-amber-300 font-mono animate-pulse">
                <Sparkles className="w-3 h-3 animate-spin" /> In-Flight Simulation
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
          <span className="hidden md:inline">
            {expanded ? "Collapse DevTools" : "Expand Inspector"}
          </span>
          <button
            type="button"
            className="p-1 text-zinc-400 hover:text-white rounded transition"
            aria-label={expanded ? "Collapse DevTools" : "Expand DevTools"}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Content Stage */}
      {expanded && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* DevTools Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
              <button
                onClick={() => setActiveTab("simulator")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  activeTab === "simulator"
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>NL Simulator</span>
              </button>

              <button
                onClick={() => setActiveTab("schemas")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  activeTab === "schemas"
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Tool Schemas ({tools.length})</span>
              </button>

              <button
                onClick={() => setActiveTab("console")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  activeTab === "console"
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Manual Console</span>
              </button>

              <button
                onClick={() => setActiveTab("logs")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
                  activeTab === "logs"
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Call Logs ({history.length})</span>
              </button>
            </div>

            {activeTab === "logs" && history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/30 border border-rose-900/40 rounded-lg transition"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {/* TAB 1: Natural Language Prompt Simulator */}
          {activeTab === "simulator" && (
            <div className="space-y-4">
              {/* Custom Prompt Input */}
              <form onSubmit={handleRunCustomPrompt} className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter natural language agent prompt (e.g. 'Crop 1:1 and apply vintage warm filter')..."
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSimulating || !customPrompt.trim()}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow transition"
                >
                  {isSimulating ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Simulate Prompt</span>
                </button>
              </form>

              {/* 1-Click Preset Grid */}
              <div>
                <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  1-Click AI Agent Prompt Presets:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {PROMPT_PRESETS.map((preset) => (
                    <button
                      key={preset.title}
                      onClick={() => handleRunPreset(preset)}
                      disabled={isSimulating}
                      className="flex flex-col text-left p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-850 border border-zinc-800/80 hover:border-emerald-500/40 transition group"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold text-zinc-200 group-hover:text-emerald-300">
                        <span>{preset.title}</span>
                        <Play className="w-3 h-3 text-zinc-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition" />
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{preset.description}</p>
                      <div className="mt-2 text-[10px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800/60 truncate">
                        &quot;{preset.prompt}&quot;
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Simulation Output Card */}
              {simulationOutput && (
                <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">Execution Result:</span>
                      {simulationOutput.status === "executing" ? (
                        <span className="text-amber-400 font-mono flex items-center gap-1 text-[11px]">
                          <Sparkles className="w-3 h-3 animate-spin" /> In Flight...
                        </span>
                      ) : simulationOutput.success ? (
                        <span className="text-emerald-400 font-mono flex items-center gap-1 text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK (Success)
                        </span>
                      ) : (
                        <span className="text-rose-400 font-mono flex items-center gap-1 text-[11px]">
                          <XCircle className="w-3.5 h-3.5" /> Failed
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => handleCopy("sim-output", JSON.stringify(simulationOutput, null, 2))}
                      className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1 text-[10px] font-mono"
                    >
                      {copiedId === "sim-output" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copy Result JSON</span>
                    </button>
                  </div>

                  <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-950 p-3 rounded-lg overflow-x-auto max-h-48 border border-zinc-800">
                    {JSON.stringify(simulationOutput, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Live Registered Tool Catalog & Schema Viewer */}
          {activeTab === "schemas" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {tools.map((tool) => {
                  const descLen = tool.description.length;
                  const descBudgetOk = descLen < 500;
                  const inputSchema = tool.inputSchema || tool.parameters;
                  const paramProps = inputSchema?.properties ? Object.entries(inputSchema.properties) : [];
                  const annotations = tool.annotations;
                  const readOnlyHint = tool.readOnlyHint ?? annotations?.readOnlyHint;
                  const untrustedContentHint = tool.untrustedContentHint ?? annotations?.untrustedContentHint;
                  const destructiveHint = tool.destructiveHint ?? annotations?.destructiveHint;

                  return (
                    <div
                      key={tool.name}
                      className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2.5"
                    >
                      {/* Tool Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono font-bold text-xs text-emerald-300">{tool.name}</div>
                          <p className="text-[11px] text-zinc-300 mt-0.5 leading-relaxed">{tool.description}</p>
                        </div>

                        {/* Security Badges */}
                        <div className="flex flex-col gap-1 items-end shrink-0">
                          {readOnlyHint && (
                            <span className="px-1.5 py-0.5 text-[9px] font-mono bg-blue-950 text-blue-300 border border-blue-800 rounded">
                              readOnly
                            </span>
                          )}
                          {untrustedContentHint && (
                            <span className="px-1.5 py-0.5 text-[9px] font-mono bg-amber-950 text-amber-300 border border-amber-800 rounded">
                              untrustedContent
                            </span>
                          )}
                          {!destructiveHint && (
                            <span className="px-1.5 py-0.5 text-[9px] font-mono bg-zinc-800 text-zinc-400 rounded">
                              safe
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Character Budget Compliance Meters */}
                      <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/80 space-y-1.5 text-[10px] font-mono">
                        <div className="flex items-center justify-between text-zinc-400">
                          <span>Description Budget:</span>
                          <span className={descBudgetOk ? "text-emerald-400" : "text-rose-400"}>
                            {descLen} / 500 chars ({Math.round((descLen / 500) * 100)}%)
                          </span>
                        </div>
                        <div className="w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${descBudgetOk ? "bg-emerald-500" : "bg-rose-500"}`}
                            style={{ width: `${Math.min(100, (descLen / 500) * 100)}%` }}
                          />
                        </div>

                        {/* Parameters summary */}
                        <div className="flex items-center justify-between text-zinc-400 pt-1">
                          <span>Parameters Schema:</span>
                          <span className="text-zinc-300">{paramProps.length} properties (&lt;150 chars each)</span>
                        </div>
                      </div>

                      {/* Expandable Parameters Schema */}
                      <details className="text-[11px] font-mono text-zinc-400">
                        <summary className="cursor-pointer hover:text-zinc-200 select-none">
                          View JSON Schema ({paramProps.length} properties)
                        </summary>
                        <pre className="mt-2 p-2 bg-zinc-950 rounded text-[10px] text-emerald-300 border border-zinc-800 overflow-x-auto max-h-36">
                          {JSON.stringify(inputSchema || {}, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Manual Tool Execution Console */}
          {activeTab === "console" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Select WebMCP Tool:</label>
                  <select
                    value={selectedToolName}
                    onChange={(e) => {
                      setSelectedToolName(e.target.value);
                      const matched = tools.find((t) => t.name === e.target.value);
                      if (matched?.name === "apply_filter") {
                        setManualParamsText('{\n  "tool": "make_sepia_tone",\n  "params": { "intensity": 60 }\n}');
                      } else if (matched?.name === "crop_canvas") {
                        setManualParamsText('{\n  "left": 0,\n  "top": 0,\n  "width": 500,\n  "height": 500\n}');
                      } else if (matched?.name === "set_comparison_slider") {
                        setManualParamsText('{\n  "position": 75,\n  "zoom": 1.2\n}');
                      } else if (matched?.name === "inspect_image") {
                        setManualParamsText('{\n  "include_history": true\n}');
                      } else if (matched?.name === "undo_canvas_action") {
                        setManualParamsText('{\n  "action": "undo_last"\n}');
                      } else if (matched?.name === "export_canvas_image") {
                        setManualParamsText('{\n  "format": "png",\n  "quality": 90\n}');
                      } else {
                        setManualParamsText('{\n}');
                      }
                    }}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                  >
                    {tools.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.description.slice(0, 45)}...)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-zinc-300">JSON Input Parameters:</label>
                    <span className="text-zinc-500 font-mono text-[10px]">JSON Schema Validated</span>
                  </div>
                  <textarea
                    rows={7}
                    value={manualParamsText}
                    onChange={(e) => setManualParamsText(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleRunManualConsole}
                  disabled={isSimulating}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded-xl shadow transition"
                >
                  {isSimulating ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                  <span>Execute on document.modelContext</span>
                </button>
              </div>

              {/* Console Output Inspector */}
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-zinc-800">
                    <span className="font-semibold text-zinc-200">Execution Output & Telemetry:</span>
                    {activeToolDef && (
                      <span className="font-mono text-[10px] text-zinc-400">
                        {activeToolDef.readOnlyHint ? "read-only query" : "state mutation"}
                      </span>
                    )}
                  </div>

                  <pre className="mt-3 text-[11px] font-mono text-zinc-300 bg-zinc-950 p-3 rounded-lg overflow-x-auto max-h-64 border border-zinc-800">
                    {simulationOutput ? JSON.stringify(simulationOutput, null, 2) : "// Execute a tool to view return payload"}
                  </pre>
                </div>

                <div className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-3 py-2 rounded-lg border border-zinc-800/80">
                  ⚡ Target: document.modelContext.executeTool(&quot;{selectedToolName}&quot;, params)
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Chronological Call Logs */}
          {activeTab === "logs" && (
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 font-mono">
                  No WebMCP tool calls recorded yet. Execute tools via simulator or AI Agent to see live telemetry logs.
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {history.map((record) => (
                    <div
                      key={record.id}
                      className="p-3 bg-zinc-900/70 border border-zinc-800 rounded-xl text-xs font-mono space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {record.success ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 rounded">
                              200 OK
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 rounded">
                              ERROR
                            </span>
                          )}

                          <span className="font-bold text-white">{record.toolName}</span>
                          <span className="text-zinc-500 text-[10px]">
                            {new Date(record.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-emerald-400 text-[10px] flex items-center gap-0.5">
                            <Zap className="w-3 h-3 fill-emerald-400" /> {record.durationMs}ms
                          </span>
                          <span className="text-zinc-500 text-[10px]">{record.caller || "agent"}</span>
                        </div>
                      </div>

                      {/* Params & Results */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                        <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80 overflow-x-auto">
                          <span className="text-zinc-500 block mb-0.5">Params:</span>
                          <span className="text-zinc-300">{JSON.stringify(record.params)}</span>
                        </div>
                        <div className="bg-zinc-950 p-2 rounded border border-zinc-800/80 overflow-x-auto">
                          <span className="text-zinc-500 block mb-0.5">Result:</span>
                          <span className={record.success ? "text-emerald-300" : "text-rose-400"}>
                            {record.error ? `Error: ${record.error}` : JSON.stringify(record.result || {})}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
