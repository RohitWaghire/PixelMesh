/**
 * PixelMesh useWebMCP React Lifecycle Hook & Studio Integration Tests
 *
 * Comprehensive unit and integration test suite verifying:
 * - Feature detection, host isolation, and initial state
 * - Automatic 8-tool registration on mount & AbortController teardown on unmount
 * - Proxy adapter ref synchronization without stale closures
 * - EventTarget subscription (toolexecuted, toolexecutionfailed, toolregistered, toolunregistered)
 * - Circular execution history buffer capping (50 items)
 * - Simulator bridge (simulateAgentCall) with error fencing
 * - Natural Language prompt heuristic parser validation
 * - High-concurrency rapid mount/unmount lifecycle stress tests
 *
 * @module lib/webmcp/use-webmcp.test
 */

import test, { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import {
  ensureModelContextPolyfill,
  installModelContextPolyfill,
  resetModelContextPolyfill,
  isModelContextAvailable,
  isNativeModelContext,
} from "./polyfill";
import type {
  ModelContext,
  RegisteredTool,
  ToolExecutedEventDetail,
  ToolExecutionFailedEventDetail,
  WebMCPExecutionRecord,
} from "./types";
import type {
  StudioCanvasAdapter,
  StudioProcessResult,
  StudioCropResult,
  StudioUndoResult,
  StudioExportResult,
} from "./tools";
import { useWebMCP, UseWebMCPOptions, UseWebMCPResult } from "./use-webmcp";
import { parseNaturalLanguagePrompt } from "@/components/studio/WebMCPSimulatorDrawer";

const ReactSharedInternals =
  (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
  (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

// ============================================================================
// 1. Mock Studio Canvas Adapter Factory
// ============================================================================

class MockStudioCanvasAdapter implements StudioCanvasAdapter {
  public image: string | null = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  public originalImage: string | null = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  public metadata: any = { width: 800, height: 600, format: "png", channels: 4, space: "srgb", sizeBytes: 1024 };
  public pipelineSteps: Array<{ tool: string; params: any }> = [];
  public sliderPos: number = 50;
  public zoom: number = 1.0;

  public calls = {
    applyFilter: [] as Array<{ tool: string; params: any }>,
    cropImage: [] as Array<{ left: number; top: number; width: number; height: number }>,
    buildPipeline: [] as Array<{ operations: any[] }>,
    loadPreset: [] as Array<{ presetIndex?: number; imageUrl?: string }>,
    setSlider: [] as Array<{ pos: number; zoom?: number }>,
    undoAction: [] as string[],
    exportImage: [] as Array<{ format?: string; quality?: number }>,
  };

  public simulateErrorOnTool?: string;
  public delayMs = 0;

  getImage(): string | null {
    return this.image;
  }
  getOriginalImage(): string | null {
    return this.originalImage;
  }
  getMetadata(): any {
    return this.metadata;
  }
  getPipelineSteps(): Array<{ tool: string; params: any }> {
    return this.pipelineSteps;
  }
  getSliderPos(): number {
    return this.sliderPos;
  }
  getZoom(): number {
    return this.zoom;
  }

  async applyFilter(tool: string, params: Record<string, any>, signal?: AbortSignal): Promise<StudioProcessResult> {
    if (signal?.aborted) {
      throw new DOMException(signal.reason || "Aborted", "AbortError");
    }
    if (this.simulateErrorOnTool === "apply_filter" || this.simulateErrorOnTool === tool) {
      throw new Error(`Simulated failure in filter ${tool}`);
    }
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    this.calls.applyFilter.push({ tool, params });
    this.pipelineSteps.push({ tool, params });
    this.image = `data:image/png;base64,filtered_${tool}`;
    return {
      processedImage: this.image,
      metadata: this.metadata,
      executionTimeMs: 15,
    };
  }

  async cropImage(left: number, top: number, width: number, height: number, signal?: AbortSignal): Promise<StudioCropResult> {
    if (signal?.aborted) {
      throw new DOMException(signal.reason || "Aborted", "AbortError");
    }
    if (this.simulateErrorOnTool === "crop_canvas") {
      throw new Error("Simulated crop failure");
    }
    this.calls.cropImage.push({ left, top, width, height });
    this.metadata = { ...this.metadata, width, height };
    this.image = `data:image/png;base64,cropped_${width}x${height}`;
    return {
      processedImage: this.image,
      metadata: this.metadata,
      executionTimeMs: 10,
    };
  }

  async buildPipeline(operations: Array<{ tool: string; params?: any }>, signal?: AbortSignal): Promise<StudioProcessResult> {
    if (signal?.aborted) {
      throw new DOMException(signal.reason || "Aborted", "AbortError");
    }
    if (this.simulateErrorOnTool === "build_filter_pipeline") {
      throw new Error("Simulated pipeline failure");
    }
    this.calls.buildPipeline.push({ operations });
    this.pipelineSteps = [...operations.map((op) => ({ tool: op.tool, params: op.params || {} }))];
    this.image = `data:image/png;base64,pipeline_${operations.length}_ops`;
    return {
      processedImage: this.image,
      metadata: this.metadata,
      executionTimeMs: 25,
    };
  }

  async loadPreset(presetIndex?: number, imageUrl?: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException(signal.reason || "Aborted", "AbortError");
    }
    if (this.simulateErrorOnTool === "load_preset_image") {
      throw new Error("Simulated load failure");
    }
    this.calls.loadPreset.push({ presetIndex, imageUrl });
    this.originalImage = `data:image/png;base64,preset_${presetIndex ?? imageUrl}`;
    this.image = null;
    this.pipelineSteps = [];
    this.sliderPos = 50;
    this.zoom = 1;
  }

  setSlider(pos: number, zoom?: number): void {
    this.calls.setSlider.push({ pos, zoom });
    this.sliderPos = pos;
    if (zoom !== undefined) this.zoom = zoom;
  }

  undoAction(action: "undo_last" | "reset_all"): StudioUndoResult {
    this.calls.undoAction.push(action);
    if (action === "reset_all") {
      this.image = null;
      this.pipelineSteps = [];
      return { remainingSteps: 0, restored: true, activeImage: this.originalImage };
    }
    if (this.pipelineSteps.length <= 1) {
      this.image = null;
      this.pipelineSteps = [];
      return { remainingSteps: 0, restored: true, activeImage: this.originalImage };
    }
    this.pipelineSteps.pop();
    return { remainingSteps: this.pipelineSteps.length, restored: true };
  }

  async exportImage(format = "png", quality = 90): Promise<StudioExportResult> {
    if (this.simulateErrorOnTool === "export_canvas_image") {
      throw new Error("Simulated export failure");
    }
    this.calls.exportImage.push({ format, quality });
    return {
      imageBase64: this.image || this.originalImage || "",
      format,
      sizeBytes: 2048,
      width: this.metadata.width,
      height: this.metadata.height,
    };
  }
}

// ============================================================================
// 2. React Hook Test Harness (Lightweight, pure Node 22)
// ============================================================================

interface HookHarness<TProps, TResult> {
  result: { current: TResult };
  rerender: (newProps?: TProps) => void;
  unmount: () => void;
}

function renderHook<TProps, TResult>(
  hookFn: (props: TProps) => TResult,
  initialProps: TProps
): HookHarness<TProps, TResult> {
  let stateMap = new Map<number, any>();
  let stateIndex = 0;
  let effectList: Array<{
    effect: () => (() => void) | void;
    deps?: any[];
    cleanup?: (() => void) | void;
    prevDeps?: any[];
  }> = [];
  let effectIndex = 0;
  let currentProps = initialProps;
  let isMounted = true;
  let isExecuting = false;
  let hasPendingRerender = false;

  const resultContainer: { current: TResult } = {} as any;

  function scheduleRerender() {
    if (isExecuting) {
      hasPendingRerender = true;
      return;
    }
    if (!isMounted) return;
    runCycle(currentProps);
  }

  function runCycle(props: TProps) {
    if (!isMounted) return;
    if (isExecuting) {
      hasPendingRerender = true;
      return;
    }
    isExecuting = true;

    try {
      stateIndex = 0;
      effectIndex = 0;

      const mockDispatcher = {
        useState: <T>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void] => {
          const id = stateIndex++;
          if (!stateMap.has(id)) {
            const val = typeof initial === "function" ? (initial as any)() : initial;
            stateMap.set(id, val);
          }
          const setState = (action: T | ((prev: T) => T)) => {
            const current = stateMap.get(id);
            const next = typeof action === "function" ? (action as any)(current) : action;
            if (Object.is(current, next)) return;
            stateMap.set(id, next);
            scheduleRerender();
          };
          return [stateMap.get(id), setState];
        },

        useRef: <T>(initial: T): { current: T } => {
          const id = stateIndex++;
          if (!stateMap.has(id)) {
            stateMap.set(id, { current: initial });
          }
          return stateMap.get(id);
        },

        useCallback: <T extends Function>(fn: T, deps: any[]): T => {
          const id = stateIndex++;
          if (!stateMap.has(id)) {
            stateMap.set(id, { fn, deps: deps ? [...deps] : undefined });
            return fn;
          }
          const cached = stateMap.get(id);
          const changed = !deps || !cached.deps || deps.some((d: any, idx: number) => d !== cached.deps[idx]);
          if (changed) {
            stateMap.set(id, { fn, deps: deps ? [...deps] : undefined });
            return fn;
          }
          return cached.fn;
        },

        useMemo: <T>(factory: () => T, deps: any[]): T => {
          const id = stateIndex++;
          if (!stateMap.has(id)) {
            const val = factory();
            stateMap.set(id, { val, deps: deps ? [...deps] : undefined });
            return val;
          }
          const cached = stateMap.get(id);
          const changed = !deps || !cached.deps || deps.some((d: any, idx: number) => d !== cached.deps[idx]);
          if (changed) {
            const val = factory();
            stateMap.set(id, { val, deps: deps ? [...deps] : undefined });
            return val;
          }
          return cached.val;
        },

        useEffect: (effect: () => (() => void) | void, deps?: any[]) => {
          const id = effectIndex++;
          if (effectList.length <= id) {
            effectList.push({ effect, deps: deps ? [...deps] : undefined, prevDeps: undefined });
          } else {
            effectList[id].effect = effect;
            effectList[id].prevDeps = effectList[id].deps;
            effectList[id].deps = deps ? [...deps] : undefined;
          }
        },
      };

      if (ReactSharedInternals) {
        ReactSharedInternals.H = mockDispatcher;
      }
      (globalThis as any).React = mockDispatcher;

      resultContainer.current = hookFn(props);

      // Flush active effects
      for (const record of effectList) {
        const shouldRun =
          record.prevDeps === undefined ||
          !record.deps ||
          record.deps.some((d, i) => d !== record.prevDeps?.[i]);

        if (shouldRun) {
          if (typeof record.cleanup === "function") {
            try {
              record.cleanup();
            } catch {
              // Guard
            }
          }
          const cleanup = record.effect();
          record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
        }
        record.prevDeps = record.deps ? [...record.deps] : undefined;
      }
    } finally {
      if (ReactSharedInternals) {
        ReactSharedInternals.H = null;
      }
      isExecuting = false;
    }

    if (hasPendingRerender) {
      hasPendingRerender = false;
      runCycle(currentProps);
    }
  }

  runCycle(currentProps);

  return {
    result: resultContainer,
    rerender: (newProps?: TProps) => {
      if (!isMounted) return;
      if (newProps !== undefined) currentProps = newProps;
      runCycle(currentProps);
    },
    unmount: () => {
      isMounted = false;
      for (const record of effectList) {
        if (typeof record.cleanup === "function") {
          try {
            record.cleanup();
          } catch {
            // Guard
          }
          record.cleanup = undefined;
        }
      }
    },
  };
}

// ============================================================================
// 3. Test Suites
// ============================================================================

let mockAdapter: MockStudioCanvasAdapter;
let context: ModelContext;

beforeEach(() => {
  resetModelContextPolyfill();
  context = installModelContextPolyfill({ force: true });
  mockAdapter = new MockStudioCanvasAdapter();
});

afterEach(() => {
  resetModelContextPolyfill();
});

describe("PixelMesh WebMCP React Hook & Studio Integration Suite", { concurrency: 1 }, () => {

  // --------------------------------------------------------------------------
  // Suite 1: Feature Detection & Initial State
  // --------------------------------------------------------------------------
  describe("Suite 1: Feature Detection & Initial State", { concurrency: false }, () => {
    it("1.1 ModelContext polyfill detection reports supported: true and isSupported: true", () => {
      const harness = renderHook(() => useWebMCP(null, { autoRegister: false }), {});
      assert.equal(harness.result.current.supported, true);
      assert.equal(harness.result.current.isSupported, true);
      assert.equal(typeof harness.result.current.isNative, "boolean");
      harness.unmount();
    });

    it("1.2 Initializes with default empty state when adapter is null", () => {
      const harness = renderHook(() => useWebMCP(null, { autoRegister: true }), {});
      assert.equal(harness.result.current.registered, false);
      assert.equal(harness.result.current.isRegistered, false);
      assert.equal(harness.result.current.tools.length, 0);
      assert.equal(harness.result.current.toolCount, 0);
      assert.equal(harness.result.current.activeCall, null);
      assert.equal(harness.result.current.lastEvent, null);
      assert.equal(harness.result.current.lastExecutedTool, null);
      assert.equal(harness.result.current.executionHistory.length, 0);
      harness.unmount();
    });

    it("1.3 Respects autoRegister: false option when valid adapter is present", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: false, context }),
        {}
      );
      assert.equal(harness.result.current.registered, false);
      assert.equal(harness.result.current.toolCount, 0);
      assert.equal(context.getTools().length, 0);
      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Suite 2: Mount & Registration Lifecycle
  // --------------------------------------------------------------------------
  describe("Suite 2: Mount & Registration Lifecycle", { concurrency: false }, () => {
    it("2.1 Auto-registers all 8 Studio tools upon mount with valid adapter", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      assert.equal(harness.result.current.registered, true);
      assert.equal(harness.result.current.isRegistered, true);
      assert.equal(harness.result.current.toolCount, 8);
      assert.equal(harness.result.current.tools.length, 8);
      assert.equal(context.getTools().length, 8);

      harness.unmount();
    });

    it("2.2 Invokes onToolRegistered callback for each registered tool", () => {
      const registeredTools: RegisteredTool[] = [];
      const harness = renderHook(
        () =>
          useWebMCP(mockAdapter, {
            autoRegister: true,
            context,
            onToolRegistered: (tool) => registeredTools.push(tool),
          }),
        {}
      );

      assert.equal(registeredTools.length, 8);
      assert.ok(registeredTools.some((t) => t.name === "apply_filter"));
      assert.ok(registeredTools.some((t) => t.name === "crop_canvas"));

      harness.unmount();
    });

    it("2.3 Confirms presence of all 8 canonical Studio tools", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      const toolNames = harness.result.current.tools.map((t) => t.name).sort();
      const expected = [
        "apply_filter",
        "build_filter_pipeline",
        "crop_canvas",
        "export_canvas_image",
        "inspect_image",
        "load_preset_image",
        "set_comparison_slider",
        "undo_canvas_action",
      ].sort();

      assert.deepEqual(toolNames, expected);
      harness.unmount();
    });

    it("2.4 Manual register() call imperatively registers all tools", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: false, context }),
        {}
      );

      assert.equal(harness.result.current.registered, false);
      const tools = harness.result.current.register();

      assert.equal(tools.length, 8);
      assert.equal(harness.result.current.registered, true);
      assert.equal(context.getTools().length, 8);

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Suite 3: Unmount & Teardown Lifecycle
  // --------------------------------------------------------------------------
  describe("Suite 3: Unmount & Teardown Lifecycle", { concurrency: false }, () => {
    it("3.1 Manual unregister() call removes all 8 tools from ModelContext", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      assert.equal(context.getTools().length, 8);
      harness.result.current.unregister();

      assert.equal(harness.result.current.registered, false);
      assert.equal(harness.result.current.toolCount, 0);
      assert.equal(context.getTools().length, 0);

      harness.unmount();
    });

    it("3.2 Component unmount automatically cleans up all registered tools", () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      assert.equal(context.getTools().length, 8);
      harness.unmount();

      assert.equal(context.getTools().length, 0);
    });

    it("3.3 Invokes onToolUnregistered callback when tools are removed", () => {
      const unregisteredNames: string[] = [];
      const harness = renderHook(
        () =>
          useWebMCP(mockAdapter, {
            autoRegister: true,
            context,
            onToolUnregistered: (name) => unregisteredNames.push(name),
          }),
        {}
      );

      harness.result.current.unregister();
      assert.equal(unregisteredNames.length, 8);
      assert.ok(unregisteredNames.includes("apply_filter"));

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Suite 4: Event Listening & Reactive State
  // --------------------------------------------------------------------------
  describe("Suite 4: Event Listening & Reactive State", { concurrency: false }, () => {
    it("4.1 Captures toolexecuted event when tool executes successfully", async () => {
      let executedEvent: any = null;
      const harness = renderHook(
        () =>
          useWebMCP(mockAdapter, {
            autoRegister: true,
            context,
            onToolExecuted: (detail) => {
              executedEvent = detail;
            },
          }),
        {}
      );

      await context.executeTool("set_comparison_slider", { position: 80, zoom: 1.5 });

      assert.ok(executedEvent);
      assert.equal(executedEvent.name, "set_comparison_slider");
      assert.equal(harness.result.current.lastExecutedTool, "set_comparison_slider");
      assert.equal(harness.result.current.lastEvent?.type, "toolexecuted");

      harness.unmount();
    });

    it("4.2 Appends successful execution to executionHistory buffer", async () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      await context.executeTool("apply_filter", { tool: "make_sepia_tone", params: { intensity: 50 } });

      const history = harness.result.current.executionHistory;
      assert.ok(history.length >= 1);
      assert.equal(history[0].toolName, "apply_filter");
      assert.equal(history[0].success, true);
      assert.ok(history[0].durationMs >= 0);

      harness.unmount();
    });

    it("4.3 Captures toolexecutionfailed event on tool error", async () => {
      let failedEvent: any = null;
      mockAdapter.simulateErrorOnTool = "crop_canvas";

      const harness = renderHook(
        () =>
          useWebMCP(mockAdapter, {
            autoRegister: true,
            context,
            onToolExecutionFailed: (detail) => {
              failedEvent = detail;
            },
          }),
        {}
      );

      await assert.rejects(async () => {
        await context.executeTool("crop_canvas", { left: 0, top: 0, width: 200, height: 200 });
      });

      assert.ok(failedEvent);
      assert.equal(failedEvent.name, "crop_canvas");
      assert.equal(harness.result.current.lastEvent?.type, "toolexecutionfailed");

      const history = harness.result.current.executionHistory;
      assert.ok(history.length >= 1);
      assert.equal(history[0].success, false);

      harness.unmount();
    });

    it("4.4 Circular execution history buffer caps at 50 records and clearHistory works", async () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      for (let i = 0; i < 55; i++) {
        await context.executeTool("inspect_image", { include_history: false });
      }

      assert.equal(harness.result.current.executionHistory.length, 50);

      harness.result.current.clearHistory();
      assert.equal(harness.result.current.executionHistory.length, 0);

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Suite 5: Adapter State Synchronization & Proxy
  // --------------------------------------------------------------------------
  describe("Suite 5: Adapter State Synchronization & Proxy", { concurrency: false }, () => {
    it("5.1 Proxy adapter dynamically forwards queries and mutations to current adapter", async () => {
      const harness = renderHook(
        ({ adapter }) => useWebMCP(adapter, { autoRegister: true, context }),
        { adapter: mockAdapter }
      );

      // Mutate adapter state
      mockAdapter.sliderPos = 90;
      mockAdapter.zoom = 2.0;

      const inspectResult: any = await context.executeTool("inspect_image", { include_history: true });
      assert.equal(inspectResult.sliderPosition, 90);
      assert.equal(inspectResult.zoomLevel, 2.0);

      harness.unmount();
    });

    it("5.2 Re-executing tools with updated adapter props does not re-register tools", async () => {
      const harness = renderHook(
        ({ adapter }) => useWebMCP(adapter, { autoRegister: true, context }),
        { adapter: mockAdapter }
      );

      const initialRegisteredTools = harness.result.current.tools;

      // Update adapter
      const updatedAdapter = new MockStudioCanvasAdapter();
      updatedAdapter.sliderPos = 40;
      harness.rerender({ adapter: updatedAdapter });

      // Check tool handles remain functional
      const result: any = await context.executeTool("inspect_image", { include_history: false });
      assert.equal(result.sliderPosition, 40);

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Suite 6: In-Browser Simulator Bridge (simulateAgentCall)
  // --------------------------------------------------------------------------
  describe("Suite 6: In-Browser Simulator Bridge", { concurrency: false }, () => {
    it("6.1 simulateAgentCall executes registered tool and returns structured success payload", async () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      const res = await harness.result.current.simulateAgentCall("set_comparison_slider", {
        position: 30,
        zoom: 1.8,
      });

      assert.equal(res.success, true);
      assert.equal(res.result.sliderPosition, 30);
      assert.equal(res.result.zoom, 1.8);
      assert.ok(res.durationMs >= 0);
      assert.equal(mockAdapter.sliderPos, 30);
      assert.equal(mockAdapter.zoom, 1.8);

      harness.unmount();
    });

    it("6.2 simulateAgentCall on non-existent tool returns structured error without throw", async () => {
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      const res = await harness.result.current.simulateAgentCall("non_existent_tool_xyz", {});

      assert.equal(res.success, false);
      assert.ok(res.error?.includes("non_existent_tool_xyz"));
      assert.ok(res.durationMs >= 0);

      harness.unmount();
    });

    it("6.3 simulateAgentCall on failing tool captures error gracefully", async () => {
      mockAdapter.simulateErrorOnTool = "export_canvas_image";

      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context }),
        {}
      );

      const res = await harness.result.current.simulateAgentCall("export_canvas_image", {
        format: "png",
      });

      assert.equal(res.success, false);
      assert.ok(res.error?.includes("Simulated export failure"));

      harness.unmount();
    });

    it("6.4 native simulator retries serialized arguments and clears activity state on completion", async () => {
      const nativeTools: any[] = [];
      const nativeContext: any = new EventTarget();
      nativeContext.registerTool = (tool: any) => {
        nativeTools.push(tool);
        return Promise.resolve(tool);
      };
      nativeContext.getTools = () => Promise.resolve(nativeTools);
      nativeContext.executeTool = async (tool: any, params: unknown, options: unknown) => {
        if (typeof params !== "string") {
          throw new TypeError("Arguments must be a JSON string");
        }
        return tool.execute(JSON.parse(params), options);
      };

      const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

      try {
        Object.defineProperty(globalThis, "document", {
          value: { modelContext: nativeContext },
          configurable: true,
          writable: true,
        });
        Object.defineProperty(globalThis, "window", {
          value: {},
          configurable: true,
          writable: true,
        });

        const harness = renderHook(
          () => useWebMCP(mockAdapter, { autoRegister: true, context: nativeContext }),
          {}
        );
        const result = await harness.result.current.simulateAgentCall("set_comparison_slider", {
          position: 65,
        });

        assert.equal(result.success, true);
        assert.equal(mockAdapter.sliderPos, 65);
        assert.equal(harness.result.current.activeCall, null);
        assert.equal(harness.result.current.activeCalls, 0);
        assert.equal(harness.result.current.executionHistory[0].success, true);

        harness.unmount();
      } finally {
        if (originalDocument) {
          Object.defineProperty(globalThis, "document", originalDocument);
        } else {
          delete (globalThis as any).document;
        }
        if (originalWindow) {
          Object.defineProperty(globalThis, "window", originalWindow);
        } else {
          delete (globalThis as any).window;
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Suite 7: Natural Language Prompt Parsing Engine
  // --------------------------------------------------------------------------
  describe("Suite 7: Natural Language Prompt Parsing Engine", { concurrency: false }, () => {
    it("7.1 Correctly parses 1-click presets", () => {
      const plan1 = parseNaturalLanguagePrompt("Crop 1:1 and apply vintage warm filter");
      assert.equal(plan1.length, 2);
      assert.equal(plan1[0].tool, "crop_canvas");
      assert.equal(plan1[1].tool, "apply_filter");
      assert.equal(plan1[1].params.tool, "make_sepia_tone");

      const plan2 = parseNaturalLanguagePrompt("Reset canvas");
      assert.equal(plan2.length, 1);
      assert.equal(plan2[0].tool, "undo_canvas_action");
      assert.equal(plan2[0].params.action, "reset_all");

      const plan3 = parseNaturalLanguagePrompt("Set split slider to 50%");
      assert.equal(plan3.length, 1);
      assert.equal(plan3[0].tool, "set_comparison_slider");
      assert.equal(plan3[0].params.position, 50);
    });

    it("7.2 Correctly parses heuristic keyword intents", () => {
      const planSlider = parseNaturalLanguagePrompt("adjust slider to 75% with 2x zoom");
      assert.equal(planSlider[0].tool, "set_comparison_slider");
      assert.equal(planSlider[0].params.position, 75);
      assert.equal(planSlider[0].params.zoom, 2.0);

      const planBw = parseNaturalLanguagePrompt("make this photo black and white noir");
      assert.equal(planBw[0].tool, "apply_filter");
      assert.equal(planBw[0].params.tool, "grayscale_image");

      const planExport = parseNaturalLanguagePrompt("export image as webp");
      assert.equal(planExport[0].tool, "export_canvas_image");
      assert.equal(planExport[0].params.format, "webp");

      const planInspect = parseNaturalLanguagePrompt("inspect image metadata");
      assert.equal(planInspect[0].tool, "inspect_image");
      assert.equal(planInspect[0].params.include_history, true);
    });
  });

  // --------------------------------------------------------------------------
  // Suite 8: High Concurrency & Lifecycle Stress Isolation
  // --------------------------------------------------------------------------
  describe("Suite 8: High Concurrency & Lifecycle Stress Isolation", { concurrency: false }, () => {
    it("8.1 Rapid mount/unmount churn (20 cycles) leaves zero orphaned registrations", () => {
      for (let i = 0; i < 20; i++) {
        const harness = renderHook(
          () => useWebMCP(mockAdapter, { autoRegister: true, context }),
          {}
        );
        assert.equal(context.getTools().length, 8);
        harness.unmount();
        assert.equal(context.getTools().length, 0);
      }
    });

    it("8.2 Explicit custom context isolation", () => {
      const customCtx = installModelContextPolyfill({ force: true });
      const harness = renderHook(
        () => useWebMCP(mockAdapter, { autoRegister: true, context: customCtx }),
        {}
      );

      assert.equal(customCtx.getTools().length, 8);
      harness.unmount();
      assert.equal(customCtx.getTools().length, 0);
    });
  });
});
