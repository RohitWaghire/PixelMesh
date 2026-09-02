/**
 * WebMCP Client Polyfill Engine (W3C Draft & Chrome 149 Origin Trial Standard)
 *
 * Implements the ModelContext interface on document.modelContext and navigator.modelContext
 * with strict validation, character budgets (<500 char tool desc, <150 char param desc),
 * EventTarget lifecycle dispatches, and AbortSignal cancellation support.
 *
 * @module lib/webmcp/polyfill
 */

import type {
  ModelContext,
  ModelContextTool,
  RegisteredTool,
  ToolExecuteCallbackOptions,
  ToolParameterSchema,
  ToolPropertyDefinition,
  ToolRegisteredEventDetail,
  ToolUnregisteredEventDetail,
  ToolExecutedEventDetail,
  ToolExecutionFailedEventDetail,
  ToolBudgetAnalysis,
  WebMCPExecutionRecord,
  WebMCPDebugInfo,
  WebMCPDebugHarness,
} from "./types";
import { WEBMCP_CONSTRAINTS, WebMCPValidationError } from "./types";

/**
 * Character budget limits mandated by W3C WebMCP specification
 */
export const BUDGET_LIMITS = {
  MAX_TOOL_NAME_LENGTH: WEBMCP_CONSTRAINTS.MAX_TOOL_NAME_LENGTH,
  MAX_TOOL_DESCRIPTION_LENGTH: WEBMCP_CONSTRAINTS.MAX_TOOL_DESCRIPTION_LENGTH,
  MAX_PARAM_DESCRIPTION_LENGTH: WEBMCP_CONSTRAINTS.MAX_PARAM_DESCRIPTION_LENGTH,
} as const;

/**
 * Valid tool identifier regex: alphanumeric plus underscores and hyphens (1-64 chars)
 */
export const TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Safe DOMException resolver across browser and Node.js environments
 */
function createAbortError(message = "The operation was aborted."): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

/**
 * CustomEvent constructor helper with SSR / Node fallback
 */
export function createCustomEvent<T>(type: string, detail: T): CustomEvent<T> {
  if (typeof CustomEvent !== "undefined") {
    try {
      return new CustomEvent<T>(type, { detail, bubbles: true, cancelable: true });
    } catch {
      // In some mock DOM environments CustomEvent constructor might fail
    }
  }
  if (typeof Event !== "undefined") {
    const event = new Event(type, { bubbles: true, cancelable: true }) as any;
    event.detail = detail;
    return event as CustomEvent<T>;
  }
  // Headless Node fallback object
  return {
    type,
    detail,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    timeStamp: Date.now(),
  } as unknown as CustomEvent<T>;
}

/**
 * High-resolution timestamp helper
 */
function getNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Validates tool name matching /^[a-zA-Z0-9_-]{1,64}$/
 */
export function validateToolName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("Tool name must be a non-empty string");
  }
  if (name.length > BUDGET_LIMITS.MAX_TOOL_NAME_LENGTH) {
    throw new TypeError(
      `Tool name "${name}" exceeds ${BUDGET_LIMITS.MAX_TOOL_NAME_LENGTH} characters limit (${name.length} chars)`
    );
  }
  if (!TOOL_NAME_REGEX.test(name)) {
    throw new TypeError(
      `Invalid tool name "${name}". Name must match ${TOOL_NAME_REGEX.toString()} (1-64 alphanumeric characters, underscores, or hyphens)`
    );
  }
}

/**
 * Recursively validates parameter property definitions against prompt character budgets (<150 chars)
 */
export function validatePropertyDescriptions(
  properties: Record<string, ToolPropertyDefinition>,
  toolName: string,
  pathPrefix = ""
): void {
  for (const [propName, propDef] of Object.entries(properties)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${propName}` : propName;

    if (!propDef || typeof propDef !== "object") {
      throw new TypeError(`Tool "${toolName}" parameter property "${currentPath}" definition must be an object`);
    }

    if (typeof propDef.description !== "string" || propDef.description.trim().length === 0) {
      throw new TypeError(`Parameter "${currentPath}" in tool "${toolName}" must have a non-empty description`);
    }

    if (propDef.description.length >= BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH) {
      throw new TypeError(
        `Parameter "${currentPath}" description in tool "${toolName}" exceeds ${BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH} characters limit (${propDef.description.length}/${BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH})`
      );
    }

    // Recursively validate nested object properties
    if (propDef.properties && typeof propDef.properties === "object") {
      validatePropertyDescriptions(propDef.properties, toolName, currentPath);
    }

    // Recursively validate array items
    if (propDef.items && typeof propDef.items === "object") {
      if (typeof propDef.items.description === "string") {
        if (propDef.items.description.length >= BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH) {
          throw new TypeError(
            `Parameter "${currentPath}[items]" description in tool "${toolName}" exceeds ${BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH} characters limit (${propDef.items.description.length}/${BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH})`
          );
        }
      }
      if (propDef.items.properties && typeof propDef.items.properties === "object") {
        validatePropertyDescriptions(propDef.items.properties, toolName, `${currentPath}[items]`);
      }
    }
  }
}

/**
 * Validates a ModelContextTool definition according to W3C WebMCP rules
 */
export function validateToolDefinition<TParams = any, TResult = any>(
  tool: ModelContextTool<TParams, TResult>
): void {
  if (!tool || typeof tool !== "object") {
    throw new TypeError("Tool definition must be a non-null object");
  }

  // 1. Tool Name Validation
  validateToolName(tool.name);

  // 2. Tool Description Budget Validation (<500 chars)
  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    throw new TypeError(`Tool "${tool.name}" description must be a non-empty string`);
  }
  if (tool.description.length >= BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH) {
    throw new TypeError(
      `Tool "${tool.name}" description exceeds ${BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH} characters limit (${tool.description.length}/${BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH})`
    );
  }

  // 3. Tool Execute Callback Validation
  if (typeof tool.execute !== "function") {
    throw new TypeError(`Tool "${tool.name}" execute must be a callable function`);
  }

  // 4. Tool Parameter Schema Validation (<150 chars per property)
  const inputSchema = tool.inputSchema ?? tool.parameters;
  if (inputSchema !== undefined) {
    if (typeof inputSchema !== "object" || inputSchema === null) {
      throw new TypeError(`Tool "${tool.name}" parameters must be a valid JSON Schema object`);
    }
    if (inputSchema.type !== "object") {
      throw new TypeError(`Tool "${tool.name}" parameters.type must be "object"`);
    }
    if (inputSchema.properties && typeof inputSchema.properties === "object") {
      validatePropertyDescriptions(inputSchema.properties, tool.name);
    }
  }
}

/**
 * Validates tool budgets and returns compliance analysis
 */
export function validateToolBudgets(tool: ModelContextTool): void {
  validateToolDefinition(tool);
}

/**
 * Validates execution arguments against ToolParameterSchema and applies defaults
 */
export function validateAndApplyParameters<T = Record<string, unknown>>(
  schema: ToolParameterSchema | undefined,
  inputParams: Record<string, unknown> | undefined,
  toolName: string
): T {
  const params: Record<string, any> = { ...(inputParams || {}) };

  if (!schema || !schema.properties) {
    return params as T;
  }

  // 1. Check required parameters
  if (Array.isArray(schema.required)) {
    for (const reqKey of schema.required) {
      if (params[reqKey] === undefined || params[reqKey] === null) {
        throw new TypeError(`Missing required parameter "${reqKey}" for tool "${toolName}"`);
      }
    }
  }

  // 2. Validate individual property types, enums, ranges, and apply defaults
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    let val = params[propName];

    // Apply default if undefined
    if (val === undefined && propDef.default !== undefined) {
      params[propName] = propDef.default;
      val = propDef.default;
    }

    if (val === undefined || val === null) {
      continue;
    }

    // Type validation
    if (propDef.type === "number" || propDef.type === "integer") {
      if (typeof val !== "number" || Number.isNaN(val)) {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be a number, received ${typeof val}`
        );
      }
      if (propDef.type === "integer" && !Number.isInteger(val)) {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be an integer, received ${val}`
        );
      }
      if (propDef.minimum !== undefined && val < propDef.minimum) {
        throw new TypeError(
          `Parameter "${propName}" (${val}) is less than minimum allowed ${propDef.minimum}`
        );
      }
      if (propDef.maximum !== undefined && val > propDef.maximum) {
        throw new TypeError(
          `Parameter "${propName}" (${val}) is greater than maximum allowed ${propDef.maximum}`
        );
      }
    } else if (propDef.type === "string") {
      if (typeof val !== "string") {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be a string, received ${typeof val}`
        );
      }
      if (propDef.minLength !== undefined && val.length < propDef.minLength) {
        throw new TypeError(
          `Parameter "${propName}" length is less than minimum allowed length ${propDef.minLength}`
        );
      }
      if (propDef.maxLength !== undefined && val.length > propDef.maxLength) {
        throw new TypeError(
          `Parameter "${propName}" length exceeds maximum allowed length ${propDef.maxLength}`
        );
      }
    } else if (propDef.type === "boolean") {
      if (typeof val !== "boolean") {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be a boolean, received ${typeof val}`
        );
      }
    } else if (propDef.type === "array") {
      if (!Array.isArray(val)) {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be an array, received ${typeof val}`
        );
      }
    } else if (propDef.type === "object") {
      if (typeof val !== "object" || val === null || Array.isArray(val)) {
        throw new TypeError(
          `Parameter "${propName}" for tool "${toolName}" must be an object, received ${typeof val}`
        );
      }
    }

    // Enum validation
    if (Array.isArray(propDef.enum) && !propDef.enum.includes(val)) {
      throw new TypeError(
        `Invalid value "${val}" for parameter "${propName}". Allowed values: ${JSON.stringify(propDef.enum)}`
      );
    }
  }

  return params as T;
}

// -----------------------------------------------------------------------------
// In-Memory Circular Execution History for Debugging
// -----------------------------------------------------------------------------

const MAX_HISTORY_LENGTH = 50;
const executionHistory: WebMCPExecutionRecord[] = [];

function recordExecution(entry: WebMCPExecutionRecord): void {
  executionHistory.unshift(entry);
  if (executionHistory.length > MAX_HISTORY_LENGTH) {
    executionHistory.pop();
  }
}

export function getExecutionHistory(): WebMCPExecutionRecord[] {
  return [...executionHistory];
}

export function clearExecutionHistory(): void {
  executionHistory.length = 0;
}

// -----------------------------------------------------------------------------
// ModelContextPolyfill Class
// -----------------------------------------------------------------------------

/**
 * ModelContextPolyfill class implementing the W3C WebMCP ModelContext interface
 */
export class ModelContextPolyfill extends EventTarget implements ModelContext {
  private toolStore: Map<string, RegisteredTool> = new Map();

  constructor() {
    super();
  }

  /**
   * Dispatches an event safely, isolating listener exceptions from breaking execution.
   */
  private safeDispatchEvent(event: Event): boolean {
    try {
      return this.dispatchEvent(event);
    } catch (err) {
      console.warn("[WebMCP] Event listener error:", err);
      return true;
    }
  }

  /**
   * Registers a tool on the ModelContext.
   * Validates name, description budget, and parameter schema budgets.
   * Dispatches 'toolregistered' event.
   */
  public registerTool<TParams = any, TResult = any>(
    tool: ModelContextTool<TParams, TResult>
  ): RegisteredTool<TParams, TResult> {
    // 1. Strict Validation
    validateToolDefinition(tool);

    // 2. Handle Duplicate Registration (unregister existing cleanly)
    if (this.toolStore.has(tool.name)) {
      this.unregisterTool(tool.name);
    }

    // 3. Construct RegisteredTool instance
    const registeredTool: RegisteredTool<TParams, TResult> = {
      ...tool,
      registeredAt: Date.now(),
      unregister: (): boolean => {
        return this.unregisterTool(tool.name);
      },
    };

    // 4. Store in tool Map
    this.toolStore.set(tool.name, registeredTool as RegisteredTool);

    // 5. Dispatch 'toolregistered' event
    const eventDetail: ToolRegisteredEventDetail = {
      tool: registeredTool,
      timestamp: Date.now(),
    };
    this.safeDispatchEvent(createCustomEvent("toolregistered", eventDetail));

    return registeredTool;
  }

  /**
   * Unregisters a tool by name.
   * Dispatches 'toolunregistered' event.
   * Returns true if a tool was removed, false if not found.
   */
  public unregisterTool(name: string): boolean {
    if (typeof name !== "string" || !name) {
      return false;
    }

    if (!this.toolStore.has(name)) {
      return false;
    }

    this.toolStore.delete(name);

    // Dispatch 'toolunregistered' event
    const eventDetail: ToolUnregisteredEventDetail = {
      name,
      timestamp: Date.now(),
    };
    this.safeDispatchEvent(createCustomEvent("toolunregistered", eventDetail));

    return true;
  }

  /**
   * Retrieves an array snapshot copy of all currently registered tools.
   */
  public getTools(): RegisteredTool[] {
    return Array.from(this.toolStore.values());
  }

  /**
   * Retrieves a registered tool by name.
   */
  public getTool(name: string): RegisteredTool | undefined {
    if (typeof name !== "string") return undefined;
    return this.toolStore.get(name);
  }

  /**
   * Checks whether a tool with the given name is registered.
   */
  public hasTool(name: string): boolean {
    if (typeof name !== "string") return false;
    return this.toolStore.has(name);
  }

  /**
   * Executes a registered tool by name with parameter validation and AbortSignal support.
   * Dispatches 'toolexecuted' on success or 'toolexecutionfailed' on error.
   */
  public async executeTool<TParams = any, TResult = any>(
    name: string,
    params: TParams = {} as TParams,
    options?: ToolExecuteCallbackOptions
  ): Promise<TResult> {
    const startTime = getNow();
    const timestamp = Date.now();
    const execId = `exec_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Tool Presence Check
    const tool = this.toolStore.get(name);
    if (!tool) {
      const error = new Error(`Tool "${name}" is not registered on document.modelContext`);
      const durationMs = Math.round(getNow() - startTime);
      const eventDetail: ToolExecutionFailedEventDetail = {
        name,
        params,
        error,
        durationMs,
        caller: options?.caller,
        timestamp,
      };
      this.safeDispatchEvent(createCustomEvent("toolexecutionfailed", eventDetail));
      recordExecution({
        id: execId,
        timestamp,
        toolName: name,
        params: (params && typeof params === "object" ? params : {}) as Record<string, unknown>,
        success: false,
        error: error.message,
        durationMs,
        caller: options?.caller,
      });
      throw error;
    }

    // 2. Pre-flight AbortSignal Check
    if (options?.signal?.aborted) {
      const abortReason =
        typeof options.signal.reason === "string"
          ? options.signal.reason
          : options.signal.reason?.message || "The operation was aborted.";
      const error = createAbortError(abortReason);
      const durationMs = 0;
      const eventDetail: ToolExecutionFailedEventDetail = {
        name,
        params,
        error,
        durationMs,
        caller: options?.caller,
        timestamp,
      };
      this.safeDispatchEvent(createCustomEvent("toolexecutionfailed", eventDetail));
      recordExecution({
        id: execId,
        timestamp,
        toolName: name,
        params: (params && typeof params === "object" ? params : {}) as Record<string, unknown>,
        success: false,
        error: error.message,
        durationMs,
        caller: options?.caller,
      });
      throw error;
    }

    // 3. Schema Parameter Validation and Default Value Application
    let validatedParams: TParams = params;
    try {
      validatedParams = validateAndApplyParameters<TParams>(
        tool.inputSchema ?? tool.parameters,
        params as Record<string, unknown>,
        name
      );
    } catch (validationError: unknown) {
      const durationMs = Math.round(getNow() - startTime);
      const normalizedError =
        validationError instanceof Error ? validationError : new Error(String(validationError));
      const eventDetail: ToolExecutionFailedEventDetail = {
        name,
        params,
        error: normalizedError,
        durationMs,
        caller: options?.caller,
        timestamp,
      };
      this.safeDispatchEvent(createCustomEvent("toolexecutionfailed", eventDetail));
      recordExecution({
        id: execId,
        timestamp,
        toolName: name,
        params: (params && typeof params === "object" ? params : {}) as Record<string, unknown>,
        success: false,
        error: normalizedError.message,
        durationMs,
        caller: options?.caller,
      });
      throw validationError;
    }

    // 4. In-flight Execution & Abort Racing
    let abortListener: (() => void) | undefined;
    let abortPromise: Promise<never> | undefined;
    const signal = options?.signal;

    if (signal) {
      abortPromise = new Promise<never>((_, reject) => {
        abortListener = () => {
          const abortReason =
            typeof signal.reason === "string"
              ? signal.reason
              : signal.reason?.message || "The operation was aborted.";
          reject(createAbortError(abortReason));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      });
    }

    try {
      const executionPromise = Promise.resolve(tool.execute(validatedParams, options));
      const result = await (abortPromise ? Promise.race([executionPromise, abortPromise]) : executionPromise);

      const durationMs = Math.round(getNow() - startTime);
      const eventDetail: ToolExecutedEventDetail = {
        name,
        params: validatedParams,
        result,
        durationMs,
        caller: options?.caller,
        timestamp: Date.now(),
      };
      recordExecution({
        id: execId,
        timestamp,
        toolName: name,
        params: (validatedParams && typeof validatedParams === "object" ? validatedParams : {}) as Record<string, unknown>,
        success: true,
        result,
        durationMs,
        caller: options?.caller,
      });
      this.safeDispatchEvent(createCustomEvent("toolexecuted", eventDetail));

      return result as TResult;
    } catch (err: unknown) {
      const durationMs = Math.round(getNow() - startTime);
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      const eventDetail: ToolExecutionFailedEventDetail = {
        name,
        params: validatedParams,
        error: normalizedError,
        durationMs,
        caller: options?.caller,
        timestamp: Date.now(),
      };
      recordExecution({
        id: execId,
        timestamp,
        toolName: name,
        params: (validatedParams && typeof validatedParams === "object" ? validatedParams : {}) as Record<string, unknown>,
        success: false,
        error: normalizedError.message,
        durationMs,
        caller: options?.caller,
      });
      this.safeDispatchEvent(createCustomEvent("toolexecutionfailed", eventDetail));
      throw err;
    } finally {
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    }
  }

  /**
   * Clears all registered tools from the store.
   * Dispatches 'toolunregistered' for each cleared tool.
   */
  public clearTools(): void {
    const toolNames = Array.from(this.toolStore.keys());
    this.toolStore.clear();

    for (const name of toolNames) {
      const eventDetail: ToolUnregisteredEventDetail = {
        name,
        timestamp: Date.now(),
      };
      this.safeDispatchEvent(createCustomEvent("toolunregistered", eventDetail));
    }
  }
}

// -----------------------------------------------------------------------------
// Diagnostic & Budget Analysis Helpers
// -----------------------------------------------------------------------------

/**
 * Analyzes a tool's description and parameter property descriptions against prompt budget limits.
 */
export function analyzeToolBudget(tool: ModelContextTool): ToolBudgetAnalysis {
  const descLen = tool.description ? tool.description.length : 0;
  const descBudgetOk = descLen > 0 && descLen < BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH;

  const paramBudgets: Array<{
    property: string;
    descriptionLength: number;
    budgetMax: number;
    budgetOk: boolean;
  }> = [];
  let allParamsOk = true;

  const inputSchema = tool.inputSchema ?? tool.parameters;
  if (inputSchema && inputSchema.properties) {
    const inspectProps = (props: Record<string, ToolPropertyDefinition>, prefix = "") => {
      for (const [propName, propDef] of Object.entries(props)) {
        const fullPropName = prefix ? `${prefix}.${propName}` : propName;
        const pLen = propDef.description ? propDef.description.length : 0;
        const pOk = pLen > 0 && pLen < BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH;
        if (!pOk) allParamsOk = false;
        paramBudgets.push({
          property: fullPropName,
          descriptionLength: pLen,
          budgetMax: BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH,
          budgetOk: pOk,
        });

        if (propDef.properties) {
          inspectProps(propDef.properties, fullPropName);
        }
        if (propDef.items && propDef.items.properties) {
          inspectProps(propDef.items.properties, `${fullPropName}[items]`);
        }
      }
    };
    inspectProps(inputSchema.properties);
  }

  return {
    toolName: tool.name,
    descriptionLength: descLen,
    descriptionBudgetMax: BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH,
    descriptionBudgetOk: descBudgetOk,
    parameterBudgetsOk: allParamsOk,
    parameterBudgets: paramBudgets,
    overallCompliant: descBudgetOk && allParamsOk,
  };
}

/**
 * Returns comprehensive runtime diagnostic and budget compliance snapshot.
 */
export function getModelContextDebugInfo(context?: ModelContext): WebMCPDebugInfo {
  let targetContext = context;
  if (!targetContext && typeof document !== "undefined") {
    targetContext = document.modelContext;
  }

  const tools = targetContext ? targetContext.getTools() : [];
  const toolAnalyses: Record<string, ToolBudgetAnalysis> = {};
  const nonCompliantTools: string[] = [];

  for (const tool of tools) {
    const analysis = analyzeToolBudget(tool);
    toolAnalyses[tool.name] = analysis;
    if (!analysis.overallCompliant) {
      nonCompliantTools.push(tool.name);
    }
  }

  const isNative =
    typeof document !== "undefined" &&
    document.modelContext !== undefined &&
    !(document.modelContext instanceof ModelContextPolyfill);

  const history = getExecutionHistory();

  return {
    polyfillVersion: "1.0.0-w3c-draft",
    isNative,
    isInstalled: typeof document !== "undefined" && !!document.modelContext,
    hostLocations: {
      document: typeof document !== "undefined" && !!document.modelContext,
      navigator: typeof navigator !== "undefined" && !!navigator.modelContext,
      window: typeof window !== "undefined" && !!(window as any).modelContext,
    },
    toolsCount: tools.length,
    toolNames: tools.map((t) => t.name),
    totalExecutions: history.length,
    successfulExecutions: history.filter((e) => e.success).length,
    failedExecutions: history.filter((e) => !e.success).length,
    recentExecutions: history,
    budgetCompliance: {
      totalTools: tools.length,
      allBudgetsCompliant: nonCompliantTools.length === 0,
      nonCompliantTools,
      toolAnalyses,
    },
  };
}

// -----------------------------------------------------------------------------
// Polyfill Installation & Global Lifecycle Management
// -----------------------------------------------------------------------------

let ssrFallbackInstance: ModelContextPolyfill | null = null;

/**
 * Checks whether document.modelContext is present and functional
 */
export function isModelContextAvailable(): boolean {
  if (typeof document === "undefined") return false;
  return (
    typeof (document as any).modelContext !== "undefined" &&
    typeof (document as any).modelContext.registerTool === "function"
  );
}

/**
 * Checks whether the active document.modelContext is a native browser host object
 */
export function isNativeModelContext(): boolean {
  if (!isModelContextAvailable()) return false;
  const mc = (document as any).modelContext;
  return !(mc instanceof ModelContextPolyfill) && typeof (window as any)?.__WEBMCP_POLYFILL_VERSION__ === "undefined";
}

/**
 * Installs the ModelContextPolyfill onto document, navigator, and window.
 * Preserves native document.modelContext unless force is true.
 */
export function installModelContextPolyfill(options?: { force?: boolean }): ModelContext {
  // 1. SSR Guard: In Node / SSR environments without window/document, return singleton fallback
  if (typeof window === "undefined" || typeof document === "undefined") {
    if (!ssrFallbackInstance) {
      ssrFallbackInstance = new ModelContextPolyfill();
    }
    return ssrFallbackInstance;
  }

  // 2. Native Coexistence: Check if document.modelContext already exists
  if (!options?.force && isModelContextAvailable()) {
    return (document as any).modelContext as ModelContext;
  }

  // 3. Create Polyfill Instance
  const polyfill = new ModelContextPolyfill();

  // 4. Attach to document.modelContext
  try {
    Object.defineProperty(document, "modelContext", {
      value: polyfill,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    (document as any).modelContext = polyfill;
  }

  // 5. Attach to navigator.modelContext
  if (typeof navigator !== "undefined" && (!navigator.modelContext || options?.force)) {
    try {
      Object.defineProperty(navigator, "modelContext", {
        value: polyfill,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      (navigator as any).modelContext = polyfill;
    }
  }

  // 6. Attach to window.modelContext & Developer Debug Harness
  (window as any).modelContext = polyfill;
  (window as any).__WEBMCP_POLYFILL_VERSION__ = "1.0.0-w3c-draft";
  const debugHarness: WebMCPDebugHarness = {
    version: "1.0.0-w3c-draft",
    listTools: () => polyfill.getTools(),
    inspectTool: (name: string) => {
      const tool = polyfill.getTool(name);
      if (!tool) return undefined;
      return {
        tool,
        budgetAnalysis: analyzeToolBudget(tool),
      };
    },
    simulateAgentCall: async <TParams = any, TResult = any>(
      name: string,
      params?: TParams,
      opts?: ToolExecuteCallbackOptions
    ) => {
      const t0 = getNow();
      const timestamp = Date.now();
      try {
        const result = await polyfill.executeTool<TParams, TResult>(name, params, opts);
        return {
          success: true,
          result,
          durationMs: Math.round(getNow() - t0),
          tool: name,
          timestamp,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || String(err),
          durationMs: Math.round(getNow() - t0),
          tool: name,
          timestamp,
        };
      }
    },
    getDebugInfo: () => getModelContextDebugInfo(polyfill),
    getExecutionHistory: () => getExecutionHistory(),
    clearHistory: () => clearExecutionHistory(),
    clearAllTools: () => polyfill.clearTools(),
    getPolyfillInstance: () => polyfill,
  };
  (window as any).__WEBMCP_DEBUG__ = debugHarness;

  return polyfill;
}

/**
 * Convenience method ensuring ModelContext is available on document.modelContext.
 */
export function ensureModelContextPolyfill(): ModelContext {
  return installModelContextPolyfill();
}

/**
 * Resets the polyfill state (clears all registered tools and resets SSR instance).
 * Crucial for clean isolated test runs.
 */
export function resetModelContextPolyfill(): void {
  clearExecutionHistory();

  if (ssrFallbackInstance) {
    ssrFallbackInstance.clearTools();
    ssrFallbackInstance = null;
  }

  if (typeof document !== "undefined" && (document as any).modelContext) {
    const mc = (document as any).modelContext;
    if (typeof mc.clearTools === "function") {
      mc.clearTools();
    }
  }
}
