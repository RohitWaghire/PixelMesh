/**
 * PixelMesh useWebMCP React Lifecycle Hook
 * 
 * Standard React lifecycle hook modeled after Google Chrome Labs' use-webmcp-tool.
 * Declaratively and programmatically registers PixelMesh Studio tools onto
 * document.modelContext adhering to the W3C WebMCP draft specification.
 * 
 * Features:
 * - Ref-isolated proxy adapter preventing infinite re-registration render loops
 * - Auto-registration of all 8 Studio tools on mount and AbortController cleanup on unmount
 * - Reactive EventTarget subscription (toolexecuted, toolexecutionfailed, toolregistered, toolunregistered)
 * - In-flight active call state tracking for visual Co-Pilot HUD
 * - Simulator bridge method (simulateAgentCall) for in-browser DevTools
 * - Full backward and forward compatibility with canonical and aliased property names
 * 
 * @module lib/webmcp/use-webmcp
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  ModelContext,
  RegisteredTool,
  ToolExecutedEventDetail,
  ToolExecutionFailedEventDetail,
  ToolRegisteredEventDetail,
  ToolUnregisteredEventDetail,
  WebMCPExecutionRecord,
  ToolExecuteCallbackOptions,
} from './types';
import {
  ensureModelContextPolyfill,
  isModelContextAvailable,
  isNativeModelContext,
  getExecutionHistory,
  clearExecutionHistory,
} from './polyfill';
import { createStudioWebMCPTools, StudioCanvasAdapter } from './tools';

export interface WebMCPActiveCall {
  toolName: string;
  params: Record<string, any>;
  startTime: number;
  caller?: string;
}

export interface WebMCPEvent {
  type: 'toolregistered' | 'toolunregistered' | 'toolexecuted' | 'toolexecutionfailed';
  toolName: string;
  timestamp: number;
  detail: any;
}

export interface UseWebMCPOptions {
  /**
   * Whether to automatically register tools upon component mount.
   * Defaults to true.
   */
  autoRegister?: boolean;

  /**
   * Explicit ModelContext instance to bind tools to.
   * If omitted, defaults to document.modelContext (or the polyfilled global host).
   */
  context?: ModelContext;

  /**
   * Callback fired when a tool is registered on the ModelContext.
   */
  onToolRegistered?: (tool: RegisteredTool) => void;

  /**
   * Callback fired when a tool is unregistered.
   */
  onToolUnregistered?: (toolName: string) => void;

  /**
   * Callback fired when a tool finishes execution successfully.
   */
  onToolExecuted?: (detail: ToolExecutedEventDetail) => void;

  /**
   * Callback fired when a tool execution encounters an error or cancellation.
   */
  onToolExecutionFailed?: (detail: ToolExecutionFailedEventDetail) => void;
}

export interface UseWebMCPResult {
  /** Whether WebMCP / ModelContext is available on the current host */
  supported: boolean;
  /** Alias for supported */
  isSupported: boolean;
  /** Whether the host ModelContext is native browser implementation */
  isNative: boolean;
  /** Whether tools are currently registered */
  registered: boolean;
  /** Alias for registered */
  isRegistered: boolean;
  /** Array of currently registered tool handles */
  tools: RegisteredTool[];
  /** Count of currently registered tools */
  toolCount: number;
  /** Current in-flight tool call info, or null if idle */
  activeCall: WebMCPActiveCall | null;
  /** Number of concurrent active tool calls */
  activeCalls: number;
  /** Chronological history of tool executions (capped at 50) */
  executionHistory: WebMCPExecutionRecord[];
  /** Alias for executionHistory */
  history: WebMCPExecutionRecord[];
  /** Most recent WebMCP event received from ModelContext */
  lastEvent: WebMCPEvent | null;
  /** Name of the most recently executed tool */
  lastExecutedTool: string | null;
  /** Whether a simulation tool call is currently in flight */
  isSimulating: boolean;
  /** Imperatively registers tools on the ModelContext */
  register: () => RegisteredTool[];
  /** Imperatively unregisters tools and aborts in-flight operations */
  unregister: () => void;
  /** Simulates an agent tool call via ModelContext.executeTool */
  simulateAgentCall: (
    toolName: string,
    params?: Record<string, any>,
    options?: ToolExecuteCallbackOptions
  ) => Promise<{
    success: boolean;
    result?: any;
    error?: string;
    durationMs: number;
  }>;
  /** Clears the execution history buffer */
  clearHistory: () => void;
}

export function useWebMCP(
  adapter: StudioCanvasAdapter | null,
  options: UseWebMCPOptions = {}
): UseWebMCPResult {
  const {
    autoRegister = true,
    context: explicitContext,
    onToolRegistered,
    onToolUnregistered,
    onToolExecuted,
    onToolExecutionFailed,
  } = options;

  const [supported, setSupported] = useState<boolean>(() => {
    if (explicitContext && typeof explicitContext.registerTool === 'function') return true;
    if (isModelContextAvailable()) return true;
    const polyfill = ensureModelContextPolyfill();
    return Boolean(polyfill && typeof polyfill.registerTool === 'function');
  });
  const [isNative, setIsNative] = useState<boolean>(() => isNativeModelContext());
  const [registered, setRegistered] = useState<boolean>(false);
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [activeCall, setActiveCall] = useState<WebMCPActiveCall | null>(null);
  const [activeCalls, setActiveCalls] = useState<number>(0);
  const [lastExecutedTool, setLastExecutedTool] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<WebMCPEvent | null>(null);
  const [executionHistory, setExecutionHistory] = useState<WebMCPExecutionRecord[]>(() => getExecutionHistory());
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Persistent reference to latest adapter to avoid re-registration loops
  const adapterRef = useRef<StudioCanvasAdapter | null>(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  // Persistent reference to callback props to avoid event listener churn
  const callbacksRef = useRef({
    onToolRegistered,
    onToolUnregistered,
    onToolExecuted,
    onToolExecutionFailed,
  });
  useEffect(() => {
    callbacksRef.current = {
      onToolRegistered,
      onToolUnregistered,
      onToolExecuted,
      onToolExecutionFailed,
    };
  }, [onToolRegistered, onToolUnregistered, onToolExecuted, onToolExecutionFailed]);

  const registeredHandlesRef = useRef<RegisteredTool[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize context & feature detection on mount
  useEffect(() => {
    const ctx =
      explicitContext ||
      (typeof document !== 'undefined' && (document as any).modelContext) ||
      ensureModelContextPolyfill();
    setSupported(Boolean(ctx && typeof ctx.registerTool === 'function'));
    setIsNative(isNativeModelContext());
    setExecutionHistory(getExecutionHistory());
  }, [explicitContext]);

  // Helper to obtain the active ModelContext instance
  const getTargetContext = useCallback((): ModelContext | null => {
    if (explicitContext) return explicitContext;
    if (typeof document !== 'undefined' && (document as any).modelContext) {
      return (document as any).modelContext;
    }
    return ensureModelContextPolyfill();
  }, [explicitContext]);

  // Unregister all tools and abort active operations
  const unregister = useCallback(() => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort('Component unmounted or unregistered');
      } catch {
        // Safe guard
      }
      abortControllerRef.current = null;
    }

    if (registeredHandlesRef.current.length > 0) {
      for (const handle of registeredHandlesRef.current) {
        try {
          handle.unregister();
        } catch {
          // Safe guard
        }
      }
      registeredHandlesRef.current = [];
    }

    setRegistered(false);
    setTools([]);
    setActiveCall(null);
    setActiveCalls(0);
  }, []);

  // Register all 8 Studio tools via proxy adapter
  const register = useCallback((): RegisteredTool[] => {
    const targetContext = getTargetContext();
    if (!targetContext) return [];

    // Clean up previous handles first
    if (registeredHandlesRef.current.length > 0) {
      for (const handle of registeredHandlesRef.current) {
        try {
          handle.unregister();
        } catch {
          // Safe guard
        }
      }
      registeredHandlesRef.current = [];
    }

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {
        // Safe guard
      }
    }
    abortControllerRef.current = new AbortController();

    // Proxy adapter routes calls dynamically to adapterRef.current
    const proxyAdapter: StudioCanvasAdapter = {
      getImage: () => adapterRef.current?.getImage() ?? null,
      getOriginalImage: () => adapterRef.current?.getOriginalImage() ?? null,
      getMetadata: () => adapterRef.current?.getMetadata() ?? null,
      getPipelineSteps: () => adapterRef.current?.getPipelineSteps() ?? [],
      getSliderPos: () => adapterRef.current?.getSliderPos() ?? 50,
      getZoom: () => adapterRef.current?.getZoom() ?? 1,

      applyFilter: async (tool, params, signal) => {
        if (!adapterRef.current) {
          throw new Error('Studio canvas adapter is not mounted');
        }
        return adapterRef.current.applyFilter(tool, params, signal);
      },

      cropImage: async (left, top, width, height, signal) => {
        if (!adapterRef.current) {
          throw new Error('Studio canvas adapter is not mounted');
        }
        return adapterRef.current.cropImage(left, top, width, height, signal);
      },

      buildPipeline: async (operations, signal) => {
        if (!adapterRef.current) {
          throw new Error('Studio canvas adapter is not mounted');
        }
        return adapterRef.current.buildPipeline(operations, signal);
      },

      loadPreset: async (presetIndex, imageUrl, signal) => {
        if (!adapterRef.current) {
          throw new Error('Studio canvas adapter is not mounted');
        }
        return adapterRef.current.loadPreset(presetIndex, imageUrl, signal);
      },

      setSlider: (pos, zoomLevel) => {
        adapterRef.current?.setSlider(pos, zoomLevel);
      },

      undoAction: (action) => {
        if (!adapterRef.current) {
          return { remainingSteps: 0, restored: false };
        }
        return adapterRef.current.undoAction(action);
      },

      exportImage: async (format, quality) => {
        if (!adapterRef.current) {
          throw new Error('Studio canvas adapter is not mounted');
        }
        return adapterRef.current.exportImage(format, quality);
      },
    };

    const toolDefs = createStudioWebMCPTools(proxyAdapter);
    const registeredList = toolDefs.map((tool) => targetContext.registerTool(tool));

    registeredHandlesRef.current = registeredList;
    setTools(registeredList);
    setRegistered(true);

    return registeredList;
  }, [getTargetContext]);

  // Subscribe to ModelContext EventTarget lifecycle events
  useEffect(() => {
    const targetContext = getTargetContext();
    if (!targetContext) return;

    const handleToolRegistered = (e: Event) => {
      const customEvent = e as CustomEvent<ToolRegisteredEventDetail>;
      const tool = customEvent.detail?.tool;
      const eventObj: WebMCPEvent = {
        type: 'toolregistered',
        toolName: tool?.name || 'unknown',
        timestamp: customEvent.detail?.timestamp || Date.now(),
        detail: customEvent.detail,
      };
      setLastEvent(eventObj);
      setTools(targetContext.getTools());
      callbacksRef.current.onToolRegistered?.(tool);
    };

    const handleToolUnregistered = (e: Event) => {
      const customEvent = e as CustomEvent<ToolUnregisteredEventDetail>;
      const name = customEvent.detail?.name || 'unknown';
      const eventObj: WebMCPEvent = {
        type: 'toolunregistered',
        toolName: name,
        timestamp: customEvent.detail?.timestamp || Date.now(),
        detail: customEvent.detail,
      };
      setLastEvent(eventObj);
      setTools(targetContext.getTools());
      callbacksRef.current.onToolUnregistered?.(name);
    };

    const handleToolExecuted = (e: Event) => {
      const customEvent = e as CustomEvent<ToolExecutedEventDetail>;
      const detail = customEvent.detail;
      const toolName = detail?.name || 'unknown';
      const eventObj: WebMCPEvent = {
        type: 'toolexecuted',
        toolName,
        timestamp: detail?.timestamp || Date.now(),
        detail,
      };
      setLastEvent(eventObj);
      setLastExecutedTool(toolName);
      setExecutionHistory(getExecutionHistory());
      setActiveCall(null);
      setActiveCalls((prev) => Math.max(0, prev - 1));
      callbacksRef.current.onToolExecuted?.(detail);
    };

    const handleToolExecutionFailed = (e: Event) => {
      const customEvent = e as CustomEvent<ToolExecutionFailedEventDetail>;
      const detail = customEvent.detail;
      const toolName = detail?.name || 'unknown';
      const eventObj: WebMCPEvent = {
        type: 'toolexecutionfailed',
        toolName,
        timestamp: detail?.timestamp || Date.now(),
        detail,
      };
      setLastEvent(eventObj);
      setLastExecutedTool(toolName);
      setExecutionHistory(getExecutionHistory());
      setActiveCall(null);
      setActiveCalls((prev) => Math.max(0, prev - 1));
      callbacksRef.current.onToolExecutionFailed?.(detail);
    };

    targetContext.addEventListener('toolregistered', handleToolRegistered);
    targetContext.addEventListener('toolunregistered', handleToolUnregistered);
    targetContext.addEventListener('toolexecuted', handleToolExecuted);
    targetContext.addEventListener('toolexecutionfailed', handleToolExecutionFailed);

    return () => {
      targetContext.removeEventListener('toolregistered', handleToolRegistered);
      targetContext.removeEventListener('toolunregistered', handleToolUnregistered);
      targetContext.removeEventListener('toolexecuted', handleToolExecuted);
      targetContext.removeEventListener('toolexecutionfailed', handleToolExecutionFailed);
    };
  }, [getTargetContext]);

  // Mount/Unmount lifecycle
  const hasAdapter = Boolean(adapter);
  useEffect(() => {
    if (autoRegister && hasAdapter) {
      register();
    }

    return () => {
      unregister();
    };
  }, [autoRegister, register, unregister, hasAdapter]);

  // Simulate an agent tool call
  const simulateAgentCall = useCallback(
    async (
      toolName: string,
      params: Record<string, any> = {},
      callOptions?: ToolExecuteCallbackOptions
    ): Promise<{ success: boolean; result?: any; error?: string; durationMs: number }> => {
      const targetContext = getTargetContext();
      if (!targetContext) {
        return {
          success: false,
          error: 'ModelContext host is not available.',
          durationMs: 0,
        };
      }

      const caller = callOptions?.caller || 'simulator:agent-dev';
      const startTime = Date.now();
      const t0 = typeof performance !== 'undefined' ? performance.now() : startTime;

      setActiveCall({
        toolName,
        params,
        startTime,
        caller,
      });
      setActiveCalls((prev) => prev + 1);
      setIsSimulating(true);

      try {
        const result = await targetContext.executeTool(toolName, params, {
          caller,
          signal: callOptions?.signal,
          context: callOptions?.context,
        });

        const durationMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
        );

        return {
          success: true,
          result,
          durationMs,
        };
      } catch (err: any) {
        const durationMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
        );

        return {
          success: false,
          error: err?.message || String(err),
          durationMs,
        };
      } finally {
        setIsSimulating(false);
      }
    },
    [getTargetContext]
  );

  const clearHistory = useCallback(() => {
    clearExecutionHistory();
    setExecutionHistory([]);
  }, []);

  return {
    supported,
    isSupported: supported,
    isNative,
    registered,
    isRegistered: registered,
    tools,
    toolCount: tools.length,
    activeCall,
    activeCalls,
    executionHistory,
    history: executionHistory,
    lastEvent,
    lastExecutedTool,
    isSimulating,
    register,
    unregister,
    simulateAgentCall,
    clearHistory,
  };
}
