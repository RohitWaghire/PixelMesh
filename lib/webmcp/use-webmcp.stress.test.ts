/**
 * PixelMesh Challenger 1 — Empirical Stress Test Harness for Milestone 3
 *
 * Adversarial empirical stress testing covering:
 * 1. Rapid mount/unmount churn with active in-flight abort signal propagation
 * 2. High-concurrency tool calls from multiple simultaneous simulated agents
 * 3. Tool execution failures & error event propagation (toolexecutionfailed)
 * 4. Circular execution history buffer boundaries (50 cap overflow & FIFO order)
 *
 * @module lib/webmcp/use-webmcp.stress.test
 */

import test, { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import {
  installModelContextPolyfill,
  resetModelContextPolyfill,
  getExecutionHistory,
  clearExecutionHistory,
} from "./polyfill";
import type { ModelContext, RegisteredTool, WebMCPExecutionRecord } from "./types";
import type { StudioCanvasAdapter, StudioProcessResult } from "./tools";
import { useWebMCP } from "./use-webmcp";

const ReactSharedInternals =
  (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
  (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

// Mock Adapter with configurable async latency and cancellation simulation
class StressCanvasAdapter implements StudioCanvasAdapter {
  public image: string | null = "data:image/png;base64,stress_test_image";
  public originalImage: string | null = "data:image/png;base64,stress_test_image";
  public metadata: any = { width: 1024, height: 768, format: "png", channels: 4, space: "srgb", sizeBytes: 2048 };
  public pipelineSteps: Array<{ tool: string; params: any }> = [];
  public sliderPos: number = 50;
  public zoom: number = 1.0;

  public activeOperations = 0;
  public abortedOperations = 0;
  public completedOperations = 0;
  public failOnTool: string | null = null;
  public opDelayMs = 10;

  getImage() { return this.image; }
  getOriginalImage() { return this.originalImage; }
  getMetadata() { return this.metadata; }
  getPipelineSteps() { return this.pipelineSteps; }
  getSliderPos() { return this.sliderPos; }
  getZoom() { return this.zoom; }

  async applyFilter(tool: string, params: Record<string, any>, signal?: AbortSignal): Promise<StudioProcessResult> {
    this.activeOperations++;
    if (signal?.aborted) {
      this.abortedOperations++;
      this.activeOperations--;
      throw new DOMException(signal.reason || "Aborted", "AbortError");
    }

    if (this.failOnTool === "apply_filter" || this.failOnTool === tool) {
      this.activeOperations--;
      throw new Error(`Simulated failure in ${tool}`);
    }

    let abortListener: (() => void) | undefined;
    let abortPromise: Promise<never> | undefined;

    if (signal) {
      abortPromise = new Promise<never>((_, reject) => {
        abortListener = () => {
          this.abortedOperations++;
          this.activeOperations--;
          reject(new DOMException(signal.reason || "Aborted", "AbortError"));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      });
    }

    try {
      const workPromise = new Promise<StudioProcessResult>((resolve) => {
        setTimeout(() => {
          this.completedOperations++;
          this.activeOperations--;
          this.pipelineSteps.push({ tool, params });
          this.image = `data:image/png;base64,filtered_${tool}_${Date.now()}`;
          resolve({
            processedImage: this.image,
            metadata: this.metadata,
            executionTimeMs: this.opDelayMs,
          });
        }, this.opDelayMs);
      });

      return await (abortPromise ? Promise.race([workPromise, abortPromise]) : workPromise);
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  }

  async cropImage(left: number, top: number, width: number, height: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.failOnTool === "crop_canvas") throw new Error("Crop failure");
    this.image = `data:image/png;base64,cropped_${width}x${height}`;
    return { processedImage: this.image, metadata: { ...this.metadata, width, height }, executionTimeMs: 5 };
  }

  async buildPipeline(operations: Array<{ tool: string; params?: any }>, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.failOnTool === "build_filter_pipeline") throw new Error("Pipeline failure");
    this.pipelineSteps = [...operations.map((o) => ({ tool: o.tool, params: o.params || {} }))];
    return { processedImage: this.image, metadata: this.metadata, executionTimeMs: 15 };
  }

  async loadPreset(presetIndex?: number, imageUrl?: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (this.failOnTool === "load_preset_image") throw new Error("Load failure");
    this.originalImage = `data:image/png;base64,preset_${presetIndex ?? imageUrl}`;
    this.image = null;
    this.pipelineSteps = [];
  }

  setSlider(pos: number, zoomLevel?: number) {
    this.sliderPos = pos;
    if (zoomLevel !== undefined) this.zoom = zoomLevel;
  }

  undoAction(action: "undo_last" | "reset_all") {
    if (action === "reset_all") {
      this.image = null;
      this.pipelineSteps = [];
      return { remainingSteps: 0, restored: true, activeImage: this.originalImage };
    }
    this.pipelineSteps.pop();
    return { remainingSteps: this.pipelineSteps.length, restored: true };
  }

  async exportImage(format = "png", quality = 90) {
    if (this.failOnTool === "export_canvas_image") throw new Error("Export failure");
    return {
      imageBase64: this.image || this.originalImage || "",
      format,
      sizeBytes: 1024,
      width: this.metadata.width,
      height: this.metadata.height,
    };
  }
}

// React 19 Client Hook Harness
function renderHook<TProps, TResult>(hookFn: (props: TProps) => TResult, initialProps: TProps) {
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

      // Flush effects
      for (const record of effectList) {
        const shouldRun =
          record.prevDeps === undefined ||
          !record.deps ||
          record.deps.some((d, i) => d !== record.prevDeps?.[i]);

        if (shouldRun) {
          if (typeof record.cleanup === "function") {
            try { record.cleanup(); } catch { /* Guard */ }
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
          try { record.cleanup(); } catch { /* Guard */ }
          record.cleanup = undefined;
        }
      }
    },
  };
}

// ============================================================================
// Empirical Challenge Stress Test Suite
// ============================================================================

describe("PixelMesh Challenger 1 — Empirical Stress Test Suite", { concurrency: 1 }, () => {
  let context: ModelContext;
  let adapter: StressCanvasAdapter;

  beforeEach(() => {
    resetModelContextPolyfill();
    context = installModelContextPolyfill({ force: true });
    adapter = new StressCanvasAdapter();
  });

  afterEach(() => {
    resetModelContextPolyfill();
  });

  // --------------------------------------------------------------------------
  // Dimension 1: Rapid Mount / Unmount Churn & Abort Signal Propagation
  // --------------------------------------------------------------------------
  describe("Dimension 1: Rapid Mount/Unmount & Abort Propagation", () => {
    it("1.1 50 Rapid mount/unmount cycles maintain registry invariant (0 leaked tools)", () => {
      for (let i = 0; i < 50; i++) {
        const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});
        assert.equal(context.getTools().length, 8, `Iteration ${i}: Expected 8 registered tools on mount`);
        assert.equal(harness.result.current.toolCount, 8);
        harness.unmount();
        assert.equal(context.getTools().length, 0, `Iteration ${i}: Expected 0 registered tools after unmount`);
      }
    });

    it("1.2 Imperative unregister() while mounted resets hook state (toolCount === 0)", () => {
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});
      assert.equal(context.getTools().length, 8);
      assert.equal(harness.result.current.toolCount, 8);
      assert.equal(harness.result.current.registered, true);

      harness.result.current.unregister();

      assert.equal(context.getTools().length, 0);
      assert.equal(harness.result.current.toolCount, 0);
      assert.equal(harness.result.current.registered, false);

      harness.unmount();
    });

    it("1.3 In-flight async execution aborted when component unmounts mid-flight", async () => {
      adapter.opDelayMs = 50;
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      const abortCtrl = new AbortController();
      const inFlightPromise = context.executeTool(
        "apply_filter",
        { tool: "make_sepia_tone", params: { intensity: 50 } },
        { signal: abortCtrl.signal }
      );

      // Unmount hook mid-flight and trigger abort
      setTimeout(() => {
        harness.unmount();
        abortCtrl.abort("Component unmounted during test");
      }, 10);

      await assert.rejects(async () => {
        await inFlightPromise;
      }, (err: any) => {
        assert.equal(err.name, "AbortError");
        return true;
      });

      assert.equal(context.getTools().length, 0);
    });

    it("1.4 Pre-aborted signal rejected before adapter execution occurs", async () => {
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      const abortCtrl = new AbortController();
      abortCtrl.abort("Pre-flight cancellation");

      await assert.rejects(async () => {
        await context.executeTool(
          "apply_filter",
          { tool: "change_exposure", params: { stops: 1.0 } },
          { signal: abortCtrl.signal }
        );
      }, (err: any) => {
        assert.equal(err.name, "AbortError");
        return true;
      });

      assert.equal(adapter.activeOperations, 0);
      assert.equal(adapter.completedOperations, 0);

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 2: High Concurrency Tool Calls (Multiple Simulated Agents)
  // --------------------------------------------------------------------------
  describe("Dimension 2: High Concurrency Tool Calls (Multi-Agent Swarm)", () => {
    it("2.1 40 Simultaneous agent calls across all 8 tools execute without race conditions", async () => {
      adapter.opDelayMs = 5;
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      const agentCalls: Promise<any>[] = [];
      const toolNames = [
        "apply_filter",
        "crop_canvas",
        "build_filter_pipeline",
        "inspect_image",
        "load_preset_image",
        "set_comparison_slider",
        "undo_canvas_action",
        "export_canvas_image",
      ];

      for (let agentId = 0; agentId < 40; agentId++) {
        const toolIndex = agentId % toolNames.length;
        const tool = toolNames[toolIndex];
        let params: any = {};

        switch (tool) {
          case "apply_filter":
            params = { tool: "make_sepia_tone", params: { intensity: agentId } };
            break;
          case "crop_canvas":
            params = { left: 0, top: 0, width: 400 + agentId, height: 400 + agentId };
            break;
          case "build_filter_pipeline":
            params = { operations: [{ tool: "adjust_vibrance", params: { factor: agentId } }] };
            break;
          case "inspect_image":
            params = { include_history: true };
            break;
          case "load_preset_image":
            params = { preset_index: agentId % 3 };
            break;
          case "set_comparison_slider":
            params = { position: (agentId * 2) % 100, zoom: 1.0 };
            break;
          case "undo_canvas_action":
            params = { action: "undo_last" };
            break;
          case "export_canvas_image":
            params = { format: "png", quality: 90 };
            break;
        }

        agentCalls.push(
          context.executeTool(tool, params, { caller: `simulated-agent-${agentId}` })
        );
      }

      const results = await Promise.allSettled(agentCalls);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.equal(fulfilled.length, 40, "All 40 concurrent agent calls must fulfill successfully");

      harness.unmount();
    });

    it("2.2 Concurrent simulateAgentCall and direct modelContext.executeTool interleave cleanly", async () => {
      adapter.opDelayMs = 2;
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      const simCalls = Array.from({ length: 15 }, (_, i) =>
        harness.result.current.simulateAgentCall("set_comparison_slider", { position: i * 5, zoom: 1.0 })
      );

      const directCalls = Array.from({ length: 15 }, (_, i) =>
        context.executeTool("inspect_image", { include_history: false }, { caller: `direct-${i}` })
      );

      const [simResults, directResults] = await Promise.all([
        Promise.all(simCalls),
        Promise.all(directCalls),
      ]);

      assert.equal(simResults.length, 15);
      assert.ok(simResults.every((r) => r.success));
      assert.equal(directResults.length, 15);

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 3: Tool Execution Failures & Error State Propagation
  // --------------------------------------------------------------------------
  describe("Dimension 3: Error State & toolexecutionfailed Propagation", () => {
    it("3.1 Emits toolexecutionfailed event and captures exact error details", async () => {
      adapter.failOnTool = "crop_canvas";
      const failedEvents: any[] = [];

      const harness = renderHook(
        () =>
          useWebMCP(adapter, {
            autoRegister: true,
            context,
            onToolExecutionFailed: (detail) => failedEvents.push(detail),
          }),
        {}
      );

      await assert.rejects(async () => {
        await context.executeTool(
          "crop_canvas",
          { left: 0, top: 0, width: 200, height: 200 },
          { caller: "adversarial-agent-007" }
        );
      });

      assert.equal(failedEvents.length, 1);
      assert.equal(failedEvents[0].name, "crop_canvas");
      assert.equal(failedEvents[0].caller, "adversarial-agent-007");
      assert.ok(failedEvents[0].error instanceof Error);
      assert.equal(failedEvents[0].error.message, "Crop failure");

      assert.equal(harness.result.current.lastEvent?.type, "toolexecutionfailed");
      assert.equal(harness.result.current.lastExecutedTool, "crop_canvas");

      const hist = harness.result.current.executionHistory;
      assert.ok(hist.length >= 1);
      assert.equal(hist[0].toolName, "crop_canvas");
      assert.equal(hist[0].success, false);
      assert.equal(hist[0].error, "Crop failure");

      harness.unmount();
    });

    it("3.2 Parameter validation failure dispatches toolexecutionfailed without executing adapter", async () => {
      const failedEvents: any[] = [];
      const harness = renderHook(
        () =>
          useWebMCP(adapter, {
            autoRegister: true,
            context,
            onToolExecutionFailed: (detail) => failedEvents.push(detail),
          }),
        {}
      );

      await assert.rejects(async () => {
        // Invalid slider position > 100
        await context.executeTool("set_comparison_slider", { position: 150, zoom: 1.0 });
      });

      assert.equal(failedEvents.length, 1);
      assert.equal(failedEvents[0].name, "set_comparison_slider");
      assert.ok(failedEvents[0].error.message.includes("greater than maximum"));

      harness.unmount();
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 4: Circular Execution History Buffer Boundaries
  // --------------------------------------------------------------------------
  describe("Dimension 4: Circular Execution History Buffer Boundaries", () => {
    it("4.1 Buffer accurately caps at 50 records during continuous 120-call surge", async () => {
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      for (let i = 1; i <= 120; i++) {
        await context.executeTool("inspect_image", { include_history: false }, { caller: `surge-call-${i}` });
      }

      const history = harness.result.current.executionHistory;
      assert.equal(history.length, 50, "History length must be strictly capped at 50");

      // FIFO verification: the newest call (surge-call-120) should be at index 0
      assert.equal(history[0].caller, "surge-call-120");
      // The oldest retained call should be surge-call-71 (120 - 50 + 1)
      assert.equal(history[49].caller, "surge-call-71");

      harness.unmount();
    });

    it("4.2 clearHistory() wipes buffer immediately and synchronizes with getExecutionHistory()", async () => {
      const harness = renderHook(() => useWebMCP(adapter, { autoRegister: true, context }), {});

      for (let i = 0; i < 10; i++) {
        await context.executeTool("inspect_image", { include_history: false });
      }
      assert.equal(harness.result.current.executionHistory.length, 10);
      assert.equal(getExecutionHistory().length, 10);

      harness.result.current.clearHistory();

      assert.equal(harness.result.current.executionHistory.length, 0);
      assert.equal(getExecutionHistory().length, 0);

      harness.unmount();
    });
  });
});
