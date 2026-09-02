/**
 * PixelMesh WebMCP (Web Model Context Protocol) Type Definitions
 * 
 * Strict TypeScript interfaces and type definitions matching the W3C WebMCP
 * draft specification and Google Chrome 149+ Origin Trial standard.
 * 
 * @module lib/webmcp/types
 */

// ============================================================================
// 1. JSON Schema & Parameter Types
// ============================================================================

/**
 * Primitive schema types supported by WebMCP parameter definitions.
 */
export type JSONSchemaTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

/**
 * Definition of a single tool parameter property in JSON Schema format.
 * Parameter descriptions are subject to standard character budget constraints (<150 chars).
 */
export interface JSONSchemaProperty {
  /**
   * JSON Schema data type.
   */
  type: JSONSchemaTypeName;

  /**
   * Concise description of the parameter.
   * Standard constraint: Must be strictly fewer than 150 characters.
   */
  description: string;

  /**
   * Enumeration of allowed primitive values.
   */
  enum?: readonly (string | number | boolean)[] | (string | number | boolean)[];

  /**
   * Default fallback value if omitted.
   */
  default?: unknown;

  /**
   * Minimum numeric value (for 'number' or 'integer' types).
   */
  minimum?: number;

  /**
   * Maximum numeric value (for 'number' or 'integer' types).
   */
  maximum?: number;

  /**
   * Minimum string length (for 'string' types).
   */
  minLength?: number;

  /**
   * Maximum string length (for 'string' types).
   */
  maxLength?: number;

  /**
   * Regular expression pattern (for 'string' types).
   */
  pattern?: string;

  /**
   * Schema definition for array elements (for 'array' types).
   */
  items?: JSONSchemaProperty;

  /**
   * Schema definition for child properties (for 'object' types).
   */
  properties?: Record<string, JSONSchemaProperty>;

  /**
   * List of required property keys (for 'object' types).
   */
  required?: readonly string[] | string[];

  /**
   * Whether additional unlisted properties are allowed.
   */
  additionalProperties?: boolean | JSONSchemaProperty;

  /**
   * Additional vendor or schema extensions.
   */
  [key: string]: unknown;
}

/**
 * Alias for JSONSchemaProperty for backward and forward compatibility.
 */
export type ToolPropertyDefinition = JSONSchemaProperty;

/**
 * Top-level JSON Schema object for tool input parameters.
 */
export interface ToolParameterSchema {
  /**
   * Top-level parameter schema must always be an object.
   */
  type: "object";

  /**
   * Map of parameter names to their respective schema definitions.
   */
  properties: Record<string, JSONSchemaProperty>;

  /**
   * List of parameter names required for tool invocation.
   */
  required?: readonly string[] | string[];

  /**
   * Whether additional unlisted parameters are permitted.
   */
  additionalProperties?: boolean | JSONSchemaProperty;

  /**
   * Optional schema description.
   */
  description?: string;

  /**
   * Additional vendor or schema extensions.
   */
  [key: string]: unknown;
}

// ============================================================================
// 2. Execution Callback & Options
// ============================================================================

/**
 * Runtime execution options supplied to the tool's execute callback.
 */
export interface ToolExecuteCallbackOptions {
  /**
   * Standard AbortSignal for cooperative cancellation of in-flight operations.
   */
  signal?: AbortSignal;

  /**
   * Alphanumeric identifier of the tool being executed.
   */
  toolName?: string;

  /**
   * Origin or caller identity executing the tool (e.g. 'agent:gemini-149', 'chatgpt-browser').
   */
  caller?: string;

  /**
   * Optional arbitrary runtime context forwarded to the callback handler.
   */
  context?: unknown;

  /**
   * Extensibility bucket for runtime metadata.
   */
  [key: string]: unknown;
}

/**
 * The callback function signature for tool execution.
 */
export type ToolExecuteCallback<TParams = any, TResult = any> = (
  params: TParams,
  options?: ToolExecuteCallbackOptions
) => Promise<TResult> | TResult;

// ============================================================================
// 3. Tool Interfaces & Security Hints
// ============================================================================

/**
 * Declaration of a client-side WebMCP tool to be registered on document.modelContext.
 */
export interface ModelContextTool<TParams = any, TResult = any> {
  /**
   * Unique alphanumeric tool identifier matching /^[a-zA-Z0-9_-]{1,64}$/.
   */
  name: string;

  /**
   * Clear, imperative description of tool functionality for browser AI agents.
   * Standard constraint: Must be strictly fewer than 500 characters.
   */
  description: string;

  /**
   * JSON Schema parameter definition adhering to parameter character budgets (< 150 chars).
   */
  inputSchema?: ToolParameterSchema;

  /**
   * Internal compatibility alias used by the local polyfill and simulator.
   * Native WebMCP hosts consume inputSchema.
   */
  parameters?: ToolParameterSchema;

  /**
   * The tool execution callback invoked by the browser agent or test harness.
   */
  execute: ToolExecuteCallback<TParams, TResult>;

  /**
   * Security Hint: When true, indicates the tool performs purely read-only queries
   * with zero state modifications, allowing speculative execution by agents.
   */
  readOnlyHint?: boolean;

  /**
   * Security Hint: When true, alerts the AI agent that parameters or outputs
   * contain untrusted external data (e.g. URLs or user text) that should be fenced.
   */
  untrustedContentHint?: boolean;

  /**
   * Security Hint: When true, alerts the AI agent that this tool performs
   * irreversible destructive modifications requiring explicit user confirmation.
   */
  destructiveHint?: boolean;

  /**
   * Native WebMCP security annotations.
   */
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    destructiveHint?: boolean;
    [key: string]: unknown;
  };

  /**
   * Arbitrary vendor-specific metadata annotations.
   */
  [key: string]: unknown;
}

/**
 * Active tool instance registered in the ModelContext catalog.
 */
export interface RegisteredTool<TParams = any, TResult = any> extends ModelContextTool<TParams, TResult> {
  /**
   * Epoch timestamp (in milliseconds) when the tool was registered.
   */
  registeredAt?: number;

  /**
   * Unregisters this tool instance from its owning ModelContext.
   * Returns true if successfully unregistered, false if already removed.
   */
  unregister?: () => boolean;
}

// ============================================================================
// 4. ModelContext Event Interfaces & Payloads
// ============================================================================

/**
 * Event detail payload when a tool is successfully registered.
 */
export interface ToolRegisteredEventDetail {
  tool: RegisteredTool;
  timestamp: number;
}

/**
 * Event detail payload when a tool is unregistered.
 */
export interface ToolUnregisteredEventDetail {
  name: string;
  timestamp: number;
}

/**
 * Event detail payload when a tool execution completes successfully.
 */
export interface ToolExecutedEventDetail {
  name: string;
  params: unknown;
  result: unknown;
  durationMs: number;
  caller?: string;
  timestamp: number;
}

/**
 * Event detail payload when a tool execution encounters an error or cancellation.
 */
export interface ToolExecutionFailedEventDetail {
  name: string;
  params: unknown;
  error: Error | unknown;
  durationMs: number;
  caller?: string;
  timestamp: number;
}

/**
 * Strongly typed DOM CustomEvents for ModelContext lifecycle monitoring.
 */
export type ToolRegisteredEvent = CustomEvent<ToolRegisteredEventDetail>;
export type ToolUnregisteredEvent = CustomEvent<ToolUnregisteredEventDetail>;
export type ToolExecutedEvent = CustomEvent<ToolExecutedEventDetail>;
export type ToolExecutionFailedEvent = CustomEvent<ToolExecutionFailedEventDetail>;

/**
 * Event mapping interface for ModelContext event listeners.
 */
export interface ModelContextEventMap {
  toolregistered: ToolRegisteredEvent;
  toolunregistered: ToolUnregisteredEvent;
  toolexecuted: ToolExecutedEvent;
  toolexecutionfailed: ToolExecutionFailedEvent;
}

// ============================================================================
// 5. Primary ModelContext Interface
// ============================================================================

/**
 * Primary ModelContext interface exposed on document.modelContext and navigator.modelContext.
 * Extends EventTarget to support reactive lifecycle observation by UI components and debuggers.
 */
export interface ModelContext extends EventTarget {
  /**
   * Registers a tool on the model context.
   * 
   * @throws {TypeError | WebMCPValidationError} If tool definition violates naming or character budget rules.
   * @returns {RegisteredTool} The registered tool handle with self-unregistration capability.
   */
  registerTool<TParams = any, TResult = any>(
    tool: ModelContextTool<TParams, TResult>
  ): RegisteredTool<TParams, TResult>;

  /**
   * Unregisters a tool by name.
   * 
   * @param name The name of the tool to unregister.
   * @returns {boolean} True if the tool was found and removed, false otherwise.
   */
  unregisterTool(name: string): boolean;

  /**
   * Retrieves an array snapshot of all currently registered tools.
   */
  getTools(): RegisteredTool[];

  /**
   * Retrieves a specific registered tool by its name.
   * 
   * @param name The name of the tool.
   * @returns The registered tool or undefined if not present.
   */
  getTool(name: string): RegisteredTool | undefined;

  /**
   * Checks whether a tool with the given name is registered.
   * 
   * @param name The name of the tool.
   * @returns True if registered, false otherwise.
   */
  hasTool(name: string): boolean;

  /**
   * Executes a registered tool by name with parameters and execution options.
   * 
   * @param name The name of the tool to execute.
   * @param params The parameter arguments to pass to the tool callback.
   * @param options Execution options such as AbortSignal and caller identity.
   * @returns Promise resolving to the tool result.
   * @throws {Error | TypeError | DOMException | WebMCPExecutionError} If tool not found, arguments invalid, or execution fails.
   */
  executeTool<TParams = any, TResult = any>(
    name: string,
    params?: TParams,
    options?: ToolExecuteCallbackOptions
  ): Promise<TResult>;

  /**
   * Clears all registered tools from the model context.
   */
  clearTools(): void;

  // Strict EventTarget method overloads for ModelContextEventMap
  addEventListener<K extends keyof ModelContextEventMap>(
    type: K,
    listener: (this: ModelContext, ev: ModelContextEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof ModelContextEventMap>(
    type: K,
    listener: (this: ModelContext, ev: ModelContextEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

// ============================================================================
// 6. Standard Constants & Budgets
// ============================================================================

export const WEBMCP_CONSTRAINTS = {
  /** Maximum length for a tool identifier */
  MAX_TOOL_NAME_LENGTH: 64,
  /** Regular expression pattern for valid tool names */
  TOOL_NAME_PATTERN: /^[a-zA-Z0-9_-]{1,64}$/,
  /** Maximum character budget for tool descriptions */
  MAX_TOOL_DESCRIPTION_LENGTH: 500,
  /** Maximum character budget for parameter property descriptions */
  MAX_PARAM_DESCRIPTION_LENGTH: 150,
  /** Default execution timeout in milliseconds */
  DEFAULT_TIMEOUT_MS: 30000,
} as const;

// ============================================================================
// 7. Error Classes
// ============================================================================

/**
 * Base error class for all WebMCP operations.
 */
export class WebMCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebMCPError";
  }
}

/**
 * Error thrown when a tool definition or input parameter fails schema validation.
 */
export class WebMCPValidationError extends WebMCPError {
  public field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "WebMCPValidationError";
    this.field = field;
  }
}

/**
 * Error thrown when a tool execution fails or encounters a runtime error.
 */
export class WebMCPExecutionError extends WebMCPError {
  public toolName: string;
  public cause?: unknown;

  constructor(message: string, toolName: string, cause?: unknown) {
    super(message);
    this.name = "WebMCPExecutionError";
    this.toolName = toolName;
    this.cause = cause;
  }
}

// ============================================================================
// 8. Debug & DevTools Inspection Harness Types
// ============================================================================

export interface ToolBudgetAnalysis {
  toolName: string;
  descriptionLength: number;
  descriptionBudgetMax: number; // 500
  descriptionBudgetOk: boolean;
  parameterBudgetsOk: boolean;
  parameterBudgets: Array<{
    property: string;
    descriptionLength: number;
    budgetMax: number; // 150
    budgetOk: boolean;
  }>;
  overallCompliant: boolean;
}

export interface WebMCPExecutionRecord {
  id: string;
  timestamp: number;
  toolName: string;
  params: Record<string, unknown>;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  caller?: string;
}

export interface WebMCPDebugInfo {
  polyfillVersion: string;
  isNative: boolean;
  isInstalled: boolean;
  hostLocations: {
    document: boolean;
    navigator: boolean;
    window: boolean;
  };
  toolsCount: number;
  toolNames: string[];
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  recentExecutions: WebMCPExecutionRecord[];
  budgetCompliance: {
    totalTools: number;
    allBudgetsCompliant: boolean;
    nonCompliantTools: string[];
    toolAnalyses: Record<string, ToolBudgetAnalysis>;
  };
}

export interface WebMCPDebugHarness {
  version: string;
  listTools: () => RegisteredTool[];
  inspectTool: (name: string) => {
    tool?: RegisteredTool;
    budgetAnalysis?: ToolBudgetAnalysis;
  } | undefined;
  simulateAgentCall: <TParams = any, TResult = any>(
    name: string,
    params?: TParams,
    options?: ToolExecuteCallbackOptions
  ) => Promise<{
    success: boolean;
    result?: TResult;
    error?: string;
    durationMs: number;
    tool: string;
    timestamp: number;
  }>;
  getDebugInfo: () => WebMCPDebugInfo;
  getExecutionHistory: () => WebMCPExecutionRecord[];
  clearHistory: () => void;
  clearAllTools: () => void;
  getPolyfillInstance: () => ModelContext;
}

// ============================================================================
// 9. Global Ambient Augmentation
// ============================================================================

declare global {
  interface Document {
    /**
     * WebMCP ModelContext standard host object on Document.
     * Native in Chrome 149+ Origin Trial; polyfilled in standard browsers.
     */
    modelContext?: ModelContext;
  }

  interface Navigator {
    /**
     * WebMCP ModelContext host object on Navigator (secondary discovery location).
     */
    modelContext?: ModelContext;
  }

  interface Window {
    /**
     * Optional Window alias for ModelContext.
     */
    modelContext?: ModelContext;

    /**
     * Polyfill version identifier.
     */
    __WEBMCP_POLYFILL_VERSION__?: string;

    /**
     * Interactive debugging harness for browser DevTools.
     */
    __WEBMCP_DEBUG__?: WebMCPDebugHarness;
  }
}
