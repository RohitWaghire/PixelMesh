import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ModelContextPolyfill,
  ensureModelContextPolyfill,
  installModelContextPolyfill,
  resetModelContextPolyfill,
  isModelContextAvailable,
  isNativeModelContext,
  analyzeToolBudget,
  getModelContextDebugInfo,
  getExecutionHistory,
  clearExecutionHistory,
  validateToolName,
  validateToolDefinition,
  validatePropertyDescriptions,
  validateAndApplyParameters,
  BUDGET_LIMITS,
  TOOL_NAME_REGEX,
  WEBMCP_CONSTRAINTS,
  WebMCPError,
  WebMCPValidationError,
  WebMCPExecutionError,
} from "./index";
import type {
  ModelContextTool,
  ToolParameterSchema,
  ToolExecuteCallbackOptions,
  ToolRegisteredEventDetail,
  ToolUnregisteredEventDetail,
  ToolExecutedEventDetail,
  ToolExecutionFailedEventDetail,
} from "./types";
import {
  createStudioWebMCPTools,
  registerStudioWebMCPTools,
  createApplyFilterTool,
  createCropCanvasTool,
  createBuildFilterPipelineTool,
  createInspectImageTool,
  createLoadPresetImageTool,
  createSetComparisonSliderTool,
  createUndoCanvasActionTool,
  createExportCanvasImageTool,
} from "./tools";
import type {
  StudioCanvasAdapter,
  StudioProcessResult,
  StudioCropResult,
  StudioUndoResult,
  StudioExportResult,
  StudioInspectionResult,
} from "./tools";
import type { ImageMetadata } from "../image/types";
import { FILTER_TOOLS_CATALOG } from "../image/tools-catalog";

beforeEach(() => {
  resetModelContextPolyfill();
});

afterEach(() => {
  resetModelContextPolyfill();
});

// ============================================================================
// Suite 1: Polyfill Detection, SSR Resilience & Host Attachment
// ============================================================================

test("webmcp-m1: [1.1] ensureModelContextPolyfill creates and returns a valid ModelContext instance", () => {
  const context = ensureModelContextPolyfill();
  assert.ok(context, "ModelContext must be created");
  assert.equal(typeof context.registerTool, "function");
  assert.equal(typeof context.unregisterTool, "function");
  assert.equal(typeof context.getTools, "function");
  assert.equal(typeof context.getTool, "function");
  assert.equal(typeof context.hasTool, "function");
  assert.equal(typeof context.executeTool, "function");
  assert.equal(typeof context.clearTools, "function");
});

test("webmcp-m1: [1.2] SSR Guard: installModelContextPolyfill returns singleton fallback when window/document undefined", () => {
  const polyfill = new ModelContextPolyfill();
  assert.ok(polyfill instanceof ModelContextPolyfill);
  assert.ok(polyfill instanceof EventTarget);

  const fallback = installModelContextPolyfill();
  assert.ok(fallback);
  assert.equal(typeof fallback.registerTool, "function");
});

test("webmcp-m1: [1.3] Coexistence: existing document.modelContext is preserved unless force option is passed", () => {
  const mockExisting: any = {
    registerTool: () => ({ name: "existing_tool" }),
    unregisterTool: () => true,
    getTools: () => [],
    getTool: () => undefined,
    hasTool: () => false,
    executeTool: async () => "native_result",
    clearTools: () => {},
  };

  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");

  try {
    Object.defineProperty(globalThis, "document", {
      value: { modelContext: mockExisting },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    });

    assert.equal(isModelContextAvailable(), true);
    assert.equal(isNativeModelContext(), true);

    const context = installModelContextPolyfill();
    assert.equal(context, mockExisting, "Must preserve existing document.modelContext");

    const forced = installModelContextPolyfill({ force: true });
    assert.ok(forced instanceof ModelContextPolyfill, "Force option must override with polyfill");
  } finally {
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("webmcp-m1: [1.4] Global Attachment: attaches to document, navigator, and window with debug harness", () => {
  const mockDoc: any = {};
  const mockNav: any = {};
  const mockWin: any = {};

  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const origNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");

  try {
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: mockNav,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: mockWin,
      configurable: true,
      writable: true,
    });

    const context = installModelContextPolyfill();
    assert.ok(context instanceof ModelContextPolyfill);
    assert.equal(mockDoc.modelContext, context);
    assert.equal(mockNav.modelContext, context);
    assert.equal(mockWin.modelContext, context);
    assert.equal(mockWin.__WEBMCP_POLYFILL_VERSION__, "1.0.0-w3c-draft");
    assert.ok(mockWin.__WEBMCP_DEBUG__);
    assert.equal(typeof mockWin.__WEBMCP_DEBUG__.listTools, "function");
    assert.equal(typeof mockWin.__WEBMCP_DEBUG__.simulateAgentCall, "function");
  } finally {
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
    if (origNav) {
      Object.defineProperty(globalThis, "navigator", origNav);
    } else {
      delete (globalThis as any).navigator;
    }
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("webmcp-m1: [1.5] Idempotency: multiple calls to ensureModelContextPolyfill return identical instance", () => {
  const c1 = ensureModelContextPolyfill();
  const c2 = ensureModelContextPolyfill();
  assert.equal(c1, c2, "Successive calls must return the same singleton polyfill instance");
});

test("webmcp-m1: [1.6] Clean Reset: resetModelContextPolyfill clears all tools and history", () => {
  const context = ensureModelContextPolyfill();
  context.registerTool({
    name: "temporary_tool",
    description: "Temporary tool for reset testing.",
    execute: () => "temp",
  });
  assert.equal(context.hasTool("temporary_tool"), true);

  resetModelContextPolyfill();
  const freshContext = ensureModelContextPolyfill();
  assert.equal(freshContext.hasTool("temporary_tool"), false);
  assert.equal(getExecutionHistory().length, 0);
});

// ============================================================================
// Suite 2: Tool Name & Tool Description Budget (<500 chars) Validation
// ============================================================================

test("webmcp-m1: [2.1] Valid Tool Registration succeeds with compliant metadata", () => {
  const context = new ModelContextPolyfill();
  const tool: ModelContextTool = {
    name: "apply_filter",
    description: "Applies a specified visual filter to the active canvas image.",
    readOnlyHint: false,
    execute: async (params: { filter: string }) => ({ applied: params.filter }),
  };

  const registered = context.registerTool(tool);
  assert.equal(registered.name, "apply_filter");
  assert.equal(registered.description, tool.description);
  assert.ok(registered.registeredAt > 0);
  assert.equal(typeof registered.unregister, "function");
  assert.equal(context.hasTool("apply_filter"), true);
});

test("webmcp-m1: [2.2] Empty or non-string tool name throws TypeError", () => {
  const context = new ModelContextPolyfill();

  assert.throws(
    () => context.registerTool({ name: "", description: "test", execute: () => {} }),
    { name: "TypeError", message: /Tool name must be a non-empty string/ }
  );

  assert.throws(
    () => context.registerTool({ name: "   ", description: "test", execute: () => {} }),
    { name: "TypeError", message: /Tool name must be a non-empty string/ }
  );

  assert.throws(
    () => context.registerTool({ name: null as any, description: "test", execute: () => {} }),
    { name: "TypeError", message: /Tool name must be a non-empty string/ }
  );
});

test("webmcp-m1: [2.3] Invalid name characters (spaces, slashes, symbols) throw TypeError", () => {
  const context = new ModelContextPolyfill();

  const invalidNames = [
    "apply filter",
    "image/crop",
    "tool@v1",
    "filter!",
    "crop.image",
    "tool#123",
  ];

  for (const name of invalidNames) {
    assert.throws(
      () => context.registerTool({ name, description: "Valid description", execute: () => {} }),
      { name: "TypeError", message: /Invalid tool name/ },
      `Expected invalid name '${name}' to throw TypeError`
    );
  }
});

test("webmcp-m1: [2.4] Tool name exceeding 64 characters throws TypeError", () => {
  const context = new ModelContextPolyfill();
  const longName = "a".repeat(65);

  assert.throws(
    () => context.registerTool({ name: longName, description: "Valid description", execute: () => {} }),
    { name: "TypeError", message: /exceeds 64 characters limit/ }
  );
});

test("webmcp-m1: [2.5] Exact boundary description (499 characters) registers successfully", () => {
  const context = new ModelContextPolyfill();
  const boundaryDesc = "x".repeat(499);

  const registered = context.registerTool({
    name: "boundary_tool",
    description: boundaryDesc,
    execute: () => "ok",
  });

  assert.equal(registered.name, "boundary_tool");
  assert.equal(registered.description.length, 499);
  assert.equal(context.hasTool("boundary_tool"), true);
});

test("webmcp-m1: [2.6] Exceeded description budget (>=500 characters) throws TypeError", () => {
  const context = new ModelContextPolyfill();
  const desc500 = "x".repeat(500);
  const desc520 = "x".repeat(520);

  assert.throws(
    () => context.registerTool({ name: "tool_500", description: desc500, execute: () => {} }),
    { name: "TypeError", message: /description exceeds 500 characters limit \(500\/500\)/ }
  );

  assert.throws(
    () => context.registerTool({ name: "tool_520", description: desc520, execute: () => {} }),
    { name: "TypeError", message: /description exceeds 500 characters limit \(520\/500\)/ }
  );
});

test("webmcp-m1: [2.7] Missing or empty description throws TypeError", () => {
  const context = new ModelContextPolyfill();

  assert.throws(
    () => context.registerTool({ name: "test_tool", description: "", execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );

  assert.throws(
    () => context.registerTool({ name: "test_tool", description: "   ", execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );
});

test("webmcp-m1: [2.8] Missing execute callback or non-function execute throws TypeError", () => {
  const context = new ModelContextPolyfill();

  assert.throws(
    () => context.registerTool({ name: "test_tool", description: "Valid desc", execute: null as any }),
    { name: "TypeError", message: /execute must be a callable function/ }
  );

  assert.throws(
    () => context.registerTool({ name: "test_tool", description: "Valid desc", execute: "not_a_fn" as any }),
    { name: "TypeError", message: /execute must be a callable function/ }
  );
});

// ============================================================================
// Suite 3: Parameter Schema & Parameter Description Budget (<150 chars) Validation
// ============================================================================

test("webmcp-m1: [3.1] Valid parameter schema registers successfully", () => {
  const context = new ModelContextPolyfill();
  const schema: ToolParameterSchema = {
    type: "object",
    properties: {
      filter_name: {
        type: "string",
        description: "The name of the visual filter to apply to the canvas image.",
      },
      intensity: {
        type: "number",
        description: "Filter intensity value between 0.0 and 1.0.",
        minimum: 0,
        maximum: 1,
        default: 1.0,
      },
    },
    required: ["filter_name"],
  };

  const registered = context.registerTool({
    name: "filter_tool",
    description: "Applies filter with parameters.",
    parameters: schema,
    execute: () => "ok",
  });

  assert.ok(registered.parameters);
  assert.equal(Object.keys(registered.parameters.properties).length, 2);
});

test("webmcp-m1: [3.2] Boundary parameter description (149 characters) registers successfully", () => {
  const context = new ModelContextPolyfill();
  const paramDesc149 = "p".repeat(149);

  const registered = context.registerTool({
    name: "boundary_param_tool",
    description: "Tool with 149-char param description.",
    parameters: {
      type: "object",
      properties: {
        param1: {
          type: "string",
          description: paramDesc149,
        },
      },
    },
    execute: () => "ok",
  });

  assert.equal(registered.parameters?.properties.param1.description.length, 149);
});

test("webmcp-m1: [3.3] Exceeded parameter description budget (>=150 chars) throws TypeError", () => {
  const context = new ModelContextPolyfill();
  const paramDesc150 = "p".repeat(150);
  const paramDesc160 = "p".repeat(160);

  assert.throws(
    () =>
      context.registerTool({
        name: "param_tool_150",
        description: "Tool description.",
        parameters: {
          type: "object",
          properties: {
            fieldA: { type: "string", description: paramDesc150 },
          },
        },
        execute: () => {},
      }),
    { name: "TypeError", message: /Parameter "fieldA" description in tool "param_tool_150" exceeds 150 characters limit \(150\/150\)/ }
  );

  assert.throws(
    () =>
      context.registerTool({
        name: "param_tool_160",
        description: "Tool description.",
        parameters: {
          type: "object",
          properties: {
            fieldB: { type: "string", description: paramDesc160 },
          },
        },
        execute: () => {},
      }),
    { name: "TypeError", message: /Parameter "fieldB" description in tool "param_tool_160" exceeds 150 characters limit \(160\/150\)/ }
  );
});

test("webmcp-m1: [3.4] Nested parameter budget: recursively validates nested objects and array items", () => {
  const context = new ModelContextPolyfill();

  // Nested object property violation
  assert.throws(
    () =>
      context.registerTool({
        name: "nested_obj_tool",
        description: "Tool with nested object parameters.",
        parameters: {
          type: "object",
          properties: {
            options: {
              type: "object",
              description: "Configuration options map.",
              properties: {
                nestedField: {
                  type: "string",
                  description: "x".repeat(155),
                },
              },
            },
          },
        },
        execute: () => {},
      }),
    { name: "TypeError", message: /Parameter "options.nestedField" description in tool "nested_obj_tool" exceeds 150 characters limit/ }
  );

  // Array items property violation
  assert.throws(
    () =>
      context.registerTool({
        name: "nested_arr_tool",
        description: "Tool with array item parameters.",
        parameters: {
          type: "object",
          properties: {
            pipeline: {
              type: "array",
              description: "List of pipeline operations.",
              items: {
                type: "object",
                description: "x".repeat(152),
              },
            },
          },
        },
        execute: () => {},
      }),
    { name: "TypeError", message: /Parameter "pipeline\[items\]" description in tool "nested_arr_tool" exceeds 150 characters limit/ }
  );
});

test("webmcp-m1: [3.5] Non-object schema rejection throws TypeError", () => {
  const context = new ModelContextPolyfill();

  assert.throws(
    () =>
      context.registerTool({
        name: "invalid_schema_tool",
        description: "Invalid schema type.",
        parameters: { type: "string" as any, properties: {} },
        execute: () => {},
      }),
    { name: "TypeError", message: /parameters.type must be "object"/ }
  );
});

test("webmcp-m1: [3.6] Optional parameters: registering tool without parameters property succeeds", () => {
  const context = new ModelContextPolyfill();

  const tool = context.registerTool({
    name: "no_param_tool",
    description: "Tool with zero parameters required.",
    execute: () => "clean",
  });

  assert.ok(tool);
  assert.equal(tool.parameters, undefined);
  assert.equal(context.hasTool("no_param_tool"), true);
});

// ============================================================================
// Suite 4: Tool Registry Lifecycle (Registration, Unregistration, Querying, Clear)
// ============================================================================

test("webmcp-m1: [4.1] registerTool returns RegisteredTool with timestamp and unregister capability", () => {
  const context = new ModelContextPolyfill();
  const registered = context.registerTool({
    name: "inspect_tool",
    description: "Inspection tool.",
    execute: () => ({ status: "ready" }),
  });

  assert.equal(registered.name, "inspect_tool");
  assert.ok(typeof registered.registeredAt === "number");
  assert.equal(typeof registered.unregister, "function");
});

test("webmcp-m1: [4.2] hasTool returns true for registered tool, false for unknown tool", () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "known_tool",
    description: "Known tool.",
    execute: () => "known",
  });

  assert.equal(context.hasTool("known_tool"), true);
  assert.equal(context.hasTool("unknown_tool"), false);
  assert.equal(context.hasTool(""), false);
});

test("webmcp-m1: [4.3] getTool returns RegisteredTool instance or undefined", () => {
  const context = new ModelContextPolyfill();
  const registered = context.registerTool({
    name: "tool_lookup",
    description: "Lookup test.",
    execute: () => "lookup",
  });

  assert.equal(context.getTool("tool_lookup"), registered);
  assert.equal(context.getTool("non_existent"), undefined);
});

test("webmcp-m1: [4.4] getTools returns defensive snapshot array copy", () => {
  const context = new ModelContextPolyfill();
  context.registerTool({ name: "t1", description: "d1", execute: () => 1 });
  context.registerTool({ name: "t2", description: "d2", execute: () => 2 });

  const tools = context.getTools();
  assert.equal(tools.length, 2);

  // Mutating the returned array should not affect internal registry
  tools.pop();
  assert.equal(tools.length, 1);
  assert.equal(context.getTools().length, 2, "Internal registry must remain untouched");
});

test("webmcp-m1: [4.5] registeredTool.unregister cleanly removes tool and returns boolean", () => {
  const context = new ModelContextPolyfill();
  const registered = context.registerTool({
    name: "self_unregister_tool",
    description: "Self unregister test.",
    execute: () => "ok",
  });

  assert.equal(context.hasTool("self_unregister_tool"), true);

  const res1 = registered.unregister();
  assert.equal(res1, true, "First unregister must return true");
  assert.equal(context.hasTool("self_unregister_tool"), false);

  const res2 = registered.unregister();
  assert.equal(res2, false, "Second unregister on removed tool must return false");
});

test("webmcp-m1: [4.6] modelContext.unregisterTool returns true on success, false on missing", () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "direct_unregister_tool",
    description: "Direct unregister test.",
    execute: () => "ok",
  });

  assert.equal(context.unregisterTool("direct_unregister_tool"), true);
  assert.equal(context.unregisterTool("direct_unregister_tool"), false);
  assert.equal(context.unregisterTool("non_existent"), false);
});

test("webmcp-m1: [4.7] Duplicate tool replacement unregisters previous definition and updates entry", () => {
  const context = new ModelContextPolyfill();
  let v1UnregisteredFired = false;
  let v2RegisteredFired = false;

  context.addEventListener("toolunregistered", (e: any) => {
    if (e.detail?.name === "duplicate_tool") v1UnregisteredFired = true;
  });
  context.addEventListener("toolregistered", (e: any) => {
    if (e.detail?.tool?.description === "Version 2 description") v2RegisteredFired = true;
  });

  context.registerTool({
    name: "duplicate_tool",
    description: "Version 1 description",
    execute: () => "v1",
  });

  context.registerTool({
    name: "duplicate_tool",
    description: "Version 2 description",
    execute: () => "v2",
  });

  assert.equal(context.getTools().length, 1);
  assert.equal(context.getTool("duplicate_tool")?.description, "Version 2 description");
  assert.equal(v1UnregisteredFired, true, "Old tool must trigger toolunregistered");
  assert.equal(v2RegisteredFired, true, "New tool must trigger toolregistered");
});

test("webmcp-m1: [4.8] clearTools removes all registered tools and dispatches unregister events", () => {
  const context = new ModelContextPolyfill();
  const unregisteredNames: string[] = [];

  context.addEventListener("toolunregistered", (e: any) => {
    unregisteredNames.push(e.detail.name);
  });

  context.registerTool({ name: "clear_t1", description: "desc1", execute: () => 1 });
  context.registerTool({ name: "clear_t2", description: "desc2", execute: () => 2 });
  context.registerTool({ name: "clear_t3", description: "desc3", execute: () => 3 });

  assert.equal(context.getTools().length, 3);
  context.clearTools();

  assert.equal(context.getTools().length, 0);
  assert.deepEqual(unregisteredNames.sort(), ["clear_t1", "clear_t2", "clear_t3"].sort());
});

// ============================================================================
// Suite 5: Schema Parameter Validation during executeTool
// ============================================================================

test("webmcp-m1: [5.1] Execution of non-existent tool rejects with descriptive error", async () => {
  const context = new ModelContextPolyfill();

  await assert.rejects(
    async () => context.executeTool("ghost_tool", {}),
    { message: /Tool "ghost_tool" is not registered on document.modelContext/ }
  );
});

test("webmcp-m1: [5.2] Required parameter missing rejects with TypeError", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "crop_canvas",
    description: "Crops canvas.",
    parameters: {
      type: "object",
      properties: {
        width: { type: "number", description: "Width in pixels." },
        height: { type: "number", description: "Height in pixels." },
      },
      required: ["width", "height"],
    },
    execute: (p: any) => p,
  });

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { width: 100 } as any),
    { name: "TypeError", message: /Missing required parameter "height" for tool "crop_canvas"/ }
  );
});

test("webmcp-m1: [5.3] Parameter type mismatch rejects with TypeError", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "resize_tool",
    description: "Resize canvas.",
    parameters: {
      type: "object",
      properties: {
        width: { type: "number", description: "Width numeric value." },
        maintain_aspect: { type: "boolean", description: "Aspect ratio boolean." },
      },
    },
    execute: (p: any) => p,
  });

  // String passed for number
  await assert.rejects(
    async () => context.executeTool("resize_tool", { width: "100px" } as any),
    { name: "TypeError", message: /must be a number, received string/ }
  );

  // Number passed for boolean
  await assert.rejects(
    async () => context.executeTool("resize_tool", { maintain_aspect: 1 } as any),
    { name: "TypeError", message: /must be a boolean, received number/ }
  );
});

test("webmcp-m1: [5.4] Enum constraint enforcement rejects invalid values with TypeError", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "export_tool",
    description: "Export image format.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Target image format.",
          enum: ["png", "jpeg", "webp"],
        },
      },
    },
    execute: (p: any) => p,
  });

  await assert.rejects(
    async () => context.executeTool("export_tool", { format: "gif" } as any),
    { name: "TypeError", message: /Invalid value "gif" for parameter "format"/ }
  );

  // Valid enum succeeds
  const res = await context.executeTool("export_tool", { format: "webp" });
  assert.deepEqual(res, { format: "webp" });
});

test("webmcp-m1: [5.5] Range bounds (minimum / maximum) enforcement", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "brightness_tool",
    description: "Adjust brightness level.",
    parameters: {
      type: "object",
      properties: {
        level: {
          type: "number",
          description: "Brightness level percentage.",
          minimum: 0,
          maximum: 100,
        },
      },
    },
    execute: (p: any) => p,
  });

  // Below minimum
  await assert.rejects(
    async () => context.executeTool("brightness_tool", { level: -5 }),
    { name: "TypeError", message: /less than minimum allowed 0/ }
  );

  // Above maximum
  await assert.rejects(
    async () => context.executeTool("brightness_tool", { level: 105 }),
    { name: "TypeError", message: /greater than maximum allowed 100/ }
  );

  // Valid boundary values
  const rMin = await context.executeTool("brightness_tool", { level: 0 });
  assert.deepEqual(rMin, { level: 0 });
  const rMax = await context.executeTool("brightness_tool", { level: 100 });
  assert.deepEqual(rMax, { level: 100 });
});

test("webmcp-m1: [5.6] Default value injection applies schema defaults when omitted", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "pipeline_tool",
    description: "Runs pipeline with defaults.",
    parameters: {
      type: "object",
      properties: {
        output_format: {
          type: "string",
          description: "Output format.",
          default: "png",
        },
        quality: {
          type: "number",
          description: "Quality metric.",
          default: 90,
        },
      },
    },
    execute: (p: any) => p,
  });

  // Call with empty params -> defaults injected
  const result: any = await context.executeTool("pipeline_tool", {});
  assert.equal(result.output_format, "png");
  assert.equal(result.quality, 90);

  // Call with explicit override
  const customResult: any = await context.executeTool("pipeline_tool", { output_format: "webp", quality: 80 });
  assert.equal(customResult.output_format, "webp");
  assert.equal(customResult.quality, 80);
});

// ============================================================================
// Suite 6: AbortSignal Cancellation Lifecycle
// ============================================================================

test("webmcp-m1: [6.1] Pre-flight Abort: rejects immediately with AbortError without invoking callback", async () => {
  const context = new ModelContextPolyfill();
  let callbackInvoked = false;

  context.registerTool({
    name: "heavy_compute",
    description: "Heavy computation tool.",
    execute: async () => {
      callbackInvoked = true;
      return "done";
    },
  });

  const controller = new AbortController();
  controller.abort("User cancelled before invocation");

  await assert.rejects(
    async () => context.executeTool("heavy_compute", {}, { signal: controller.signal }),
    (err: any) => {
      assert.equal(err.name, "AbortError");
      assert.ok(err.message.includes("User cancelled") || err.message.includes("aborted"));
      return true;
    }
  );

  assert.equal(callbackInvoked, false, "Callback must NOT be invoked when signal is already aborted");
});

test("webmcp-m1: [6.2] In-flight Abort: aborting active execution rejects with AbortError", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "async_filter",
    description: "Simulated long filter.",
    execute: async (_params: any, options?: ToolExecuteCallbackOptions) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve("computed"), 500);
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("Cancelled in worker");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    },
  });

  const controller = new AbortController();
  const executePromise = context.executeTool("async_filter", {}, { signal: controller.signal });

  // Abort after 20ms
  setTimeout(() => controller.abort("In-flight timeout"), 20);

  await assert.rejects(
    async () => executePromise,
    (err: any) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );
});

test("webmcp-m1: [6.3] Abort Event Firing: toolexecutionfailed is dispatched on abort with AbortError", async () => {
  const context = new ModelContextPolyfill();
  let failedEvent: ToolExecutionFailedEventDetail | null = null;

  context.addEventListener("toolexecutionfailed", (e: any) => {
    failedEvent = e.detail;
  });

  context.registerTool({
    name: "abortable_tool",
    description: "Abortable execution.",
    execute: async () => new Promise((resolve) => setTimeout(resolve, 500)),
  });

  const controller = new AbortController();
  controller.abort("Preflight abort reason");

  try {
    await context.executeTool("abortable_tool", {}, { signal: controller.signal });
  } catch {
    // Expected rejection
  }

  assert.ok(failedEvent, "toolexecutionfailed must be dispatched on abort");
  assert.equal((failedEvent as ToolExecutionFailedEventDetail).name, "abortable_tool");
  assert.equal(((failedEvent as ToolExecutionFailedEventDetail).error as any)?.name, "AbortError");
});

test("webmcp-m1: [6.4] Successful completion without abort returns result cleanly", async () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "fast_tool",
    description: "Fast async execution.",
    execute: async (p: { value: number }) => ({ doubled: p.value * 2 }),
  });

  const controller = new AbortController();
  const res = await context.executeTool("fast_tool", { value: 21 }, { signal: controller.signal });
  assert.deepEqual(res, { doubled: 42 });
});

// ============================================================================
// Suite 7: EventTarget & CustomEvent Lifecycle Dispatching
// ============================================================================

test("webmcp-m1: [7.1] toolregistered Event dispatched on registerTool with RegisteredTool handle", () => {
  const context = new ModelContextPolyfill();
  let registeredEvent: ToolRegisteredEventDetail | null = null;

  context.addEventListener("toolregistered", (e: any) => {
    registeredEvent = e.detail;
  });

  const registered = context.registerTool({
    name: "event_tool",
    description: "Event test tool.",
    execute: () => "ok",
  });

  assert.ok(registeredEvent);
  assert.equal((registeredEvent as ToolRegisteredEventDetail).tool.name, "event_tool");
  assert.equal((registeredEvent as ToolRegisteredEventDetail).tool, registered);
  assert.ok((registeredEvent as ToolRegisteredEventDetail).timestamp > 0);
});

test("webmcp-m1: [7.2] toolunregistered Event dispatched via unregisterTool", () => {
  const context = new ModelContextPolyfill();
  let unregisteredEvent: ToolUnregisteredEventDetail | null = null;

  context.addEventListener("toolunregistered", (e: any) => {
    unregisteredEvent = e.detail;
  });

  context.registerTool({ name: "unreg_target", description: "desc", execute: () => 1 });
  context.unregisterTool("unreg_target");

  assert.ok(unregisteredEvent);
  assert.equal((unregisteredEvent as ToolUnregisteredEventDetail).name, "unreg_target");
  assert.ok((unregisteredEvent as ToolUnregisteredEventDetail).timestamp > 0);
});

test("webmcp-m1: [7.3] toolunregistered Event dispatched via tool.unregister() handle", () => {
  const context = new ModelContextPolyfill();
  let unregisteredName: string | null = null;

  context.addEventListener("toolunregistered", (e: any) => {
    unregisteredName = e.detail.name;
  });

  const tool = context.registerTool({ name: "self_unreg_target", description: "desc", execute: () => 1 });
  tool.unregister();

  assert.equal(unregisteredName, "self_unreg_target");
});

test("webmcp-m1: [7.4] toolexecuted Event dispatched on successful execution with durationMs", async () => {
  const context = new ModelContextPolyfill();
  let executedDetail: ToolExecutedEventDetail | null = null;

  context.addEventListener("toolexecuted", (e: any) => {
    executedDetail = e.detail;
  });

  context.registerTool({
    name: "calc_tool",
    description: "Calculation tool.",
    execute: (p: { a: number; b: number }) => p.a + p.b,
  });

  const result = await context.executeTool("calc_tool", { a: 10, b: 20 }, { caller: "test-agent" });
  assert.equal(result, 30);

  assert.ok(executedDetail);
  assert.equal((executedDetail as ToolExecutedEventDetail).name, "calc_tool");
  assert.deepEqual((executedDetail as ToolExecutedEventDetail).params, { a: 10, b: 20 });
  assert.equal((executedDetail as ToolExecutedEventDetail).result, 30);
  assert.ok((executedDetail as ToolExecutedEventDetail).durationMs >= 0);
  assert.equal((executedDetail as ToolExecutedEventDetail).caller, "test-agent");
});

test("webmcp-m1: [7.5] toolexecutionfailed Event dispatched when tool callback throws", async () => {
  const context = new ModelContextPolyfill();
  let failedDetail: ToolExecutionFailedEventDetail | null = null;

  context.addEventListener("toolexecutionfailed", (e: any) => {
    failedDetail = e.detail;
  });

  context.registerTool({
    name: "failing_tool",
    description: "Throws runtime error.",
    execute: () => {
      throw new Error("Internal image render failure");
    },
  });

  await assert.rejects(
    async () => context.executeTool("failing_tool", { data: "test" }),
    { message: /Internal image render failure/ }
  );

  assert.ok(failedDetail);
  assert.equal((failedDetail as ToolExecutionFailedEventDetail).name, "failing_tool");
  assert.equal(((failedDetail as ToolExecutionFailedEventDetail).error as Error).message, "Internal image render failure");
  assert.ok((failedDetail as ToolExecutionFailedEventDetail).durationMs >= 0);
});

test("webmcp-m1: [7.6] Multiple Event Listeners and Listener Removal (removeEventListener)", () => {
  const context = new ModelContextPolyfill();
  let l1Count = 0;
  let l2Count = 0;

  const listener1 = () => { l1Count++; };
  const listener2 = () => { l2Count++; };

  context.addEventListener("toolregistered", listener1);
  context.addEventListener("toolregistered", listener2);

  context.registerTool({ name: "t_listen_1", description: "desc", execute: () => 1 });
  assert.equal(l1Count, 1);
  assert.equal(l2Count, 1);

  context.removeEventListener("toolregistered", listener1);
  context.registerTool({ name: "t_listen_2", description: "desc", execute: () => 2 });
  assert.equal(l1Count, 1, "Removed listener must not be called again");
  assert.equal(l2Count, 2, "Remaining listener must be called");
});

// ============================================================================
// Suite 8: Simulated Agent Debug Harness & Telemetry Inspection
// ============================================================================

test("webmcp-m1: [8.1] analyzeToolBudget evaluates character budgets accurately", () => {
  const compliantTool: ModelContextTool = {
    name: "compliant_tool",
    description: "A completely valid description under 500 characters.",
    parameters: {
      type: "object",
      properties: {
        opt: {
          type: "string",
          description: "Short parameter description under 150 characters.",
        },
      },
    },
    execute: () => "ok",
  };

  const analysis = analyzeToolBudget(compliantTool);
  assert.equal(analysis.toolName, "compliant_tool");
  assert.equal(analysis.descriptionBudgetOk, true);
  assert.equal(analysis.parameterBudgetsOk, true);
  assert.equal(analysis.overallCompliant, true);
  assert.equal(analysis.parameterBudgets.length, 1);
  assert.equal(analysis.parameterBudgets[0].budgetOk, true);
});

test("webmcp-m1: [8.2] getModelContextDebugInfo provides comprehensive diagnostic snapshot", () => {
  const context = new ModelContextPolyfill();
  context.registerTool({
    name: "diag_tool_1",
    description: "First diagnostic tool.",
    execute: () => 1,
  });
  context.registerTool({
    name: "diag_tool_2",
    description: "Second diagnostic tool.",
    execute: () => 2,
  });

  const info = getModelContextDebugInfo(context);
  assert.equal(info.polyfillVersion, "1.0.0-w3c-draft");
  assert.equal(info.toolsCount, 2);
  assert.deepEqual(info.toolNames, ["diag_tool_1", "diag_tool_2"]);
  assert.equal(info.budgetCompliance.allBudgetsCompliant, true);
  assert.equal(info.budgetCompliance.nonCompliantTools.length, 0);
  assert.ok(info.budgetCompliance.toolAnalyses.diag_tool_1);
});

test("webmcp-m1: [8.3] Debug Harness simulateAgentCall executes tool and returns structured result", async () => {
  const mockWin: any = {};
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");

  try {
    Object.defineProperty(globalThis, "window", {
      value: mockWin,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {},
      configurable: true,
      writable: true,
    });

    const context = installModelContextPolyfill({ force: true });
    context.registerTool({
      name: "simulate_target",
      description: "Simulation target tool.",
      execute: (p: { num: number }) => ({ squared: p.num * p.num }),
    });

    const debugHarness = mockWin.__WEBMCP_DEBUG__;
    assert.ok(debugHarness);

    const simResult = await debugHarness.simulateAgentCall("simulate_target", { num: 9 });
    assert.equal(simResult.success, true);
    assert.deepEqual(simResult.result, { squared: 81 });
    assert.equal(simResult.tool, "simulate_target");
    assert.ok(simResult.durationMs >= 0);

    const toolsList = debugHarness.listTools();
    assert.equal(toolsList.length, 1);
    assert.equal(toolsList[0].name, "simulate_target");

    const inspected = debugHarness.inspectTool("simulate_target");
    assert.ok(inspected?.tool);
    assert.ok(inspected?.budgetAnalysis?.overallCompliant);
  } finally {
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
  }
});

test("webmcp-m1: [8.4] simulateAgentCall on failing tool captures error without unhandled rejection", async () => {
  const mockWin: any = {};
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");

  try {
    Object.defineProperty(globalThis, "window", {
      value: mockWin,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {},
      configurable: true,
      writable: true,
    });

    const context = installModelContextPolyfill({ force: true });
    context.registerTool({
      name: "faulty_tool",
      description: "Faulty tool.",
      execute: () => {
        throw new Error("Simulated backend fault");
      },
    });

    const debugHarness = mockWin.__WEBMCP_DEBUG__;
    const simResult = await debugHarness.simulateAgentCall("faulty_tool", {});
    assert.equal(simResult.success, false);
    assert.ok(simResult.error?.includes("Simulated backend fault"));
    assert.equal(simResult.tool, "faulty_tool");
  } finally {
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
  }
});

test("webmcp-m1: [8.5] Circular Execution History tracking and clearing", async () => {
  const context = new ModelContextPolyfill();
  clearExecutionHistory();

  context.registerTool({
    name: "hist_tool",
    description: "History test tool.",
    execute: (p: { count: number }) => p.count + 1,
  });

  await context.executeTool("hist_tool", { count: 1 });
  await context.executeTool("hist_tool", { count: 2 });

  const history = getExecutionHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].params.count, 2, "Latest execution must be first");
  assert.equal(history[1].params.count, 1);

  clearExecutionHistory();
  assert.equal(getExecutionHistory().length, 0);
});

// ============================================================================
// Suite 9: Error Hierarchy & Constants Verification
// ============================================================================

test("webmcp-m1: [9.1] WEBMCP_CONSTRAINTS and custom Error classes conform to spec", () => {
  assert.equal(WEBMCP_CONSTRAINTS.MAX_TOOL_NAME_LENGTH, 64);
  assert.equal(WEBMCP_CONSTRAINTS.MAX_TOOL_DESCRIPTION_LENGTH, 500);
  assert.equal(WEBMCP_CONSTRAINTS.MAX_PARAM_DESCRIPTION_LENGTH, 150);
  assert.equal(WEBMCP_CONSTRAINTS.DEFAULT_TIMEOUT_MS, 30000);

  const baseErr = new WebMCPError("base error");
  assert.equal(baseErr.name, "WebMCPError");
  assert.equal(baseErr instanceof Error, true);

  const valErr = new WebMCPValidationError("validation error", "tool.description");
  assert.equal(valErr.name, "WebMCPValidationError");
  assert.equal(valErr.field, "tool.description");
  assert.equal(valErr instanceof WebMCPError, true);

  const execErr = new WebMCPExecutionError("execution failed", "crop_canvas", { code: 500 });
  assert.equal(execErr.name, "WebMCPExecutionError");
  assert.equal(execErr.toolName, "crop_canvas");
  assert.deepEqual(execErr.cause, { code: 500 });
  assert.equal(execErr instanceof WebMCPError, true);
});

// ============================================================================
// Suite 10: Adversarial Stress, Boundary Extremes & Security Verification
// ============================================================================

test("webmcp-m1-adv: [10.1] Tool Description Boundary Precision (499 chars vs 500 chars vs 501 chars)", () => {
  const context = new ModelContextPolyfill();

  const desc499 = "D".repeat(499);
  const tool499 = context.registerTool({
    name: "tool_boundary_499",
    description: desc499,
    execute: () => "ok_499",
  });
  assert.equal(tool499.description.length, 499);
  assert.equal(context.hasTool("tool_boundary_499"), true);

  const desc500 = "D".repeat(500);
  assert.throws(
    () =>
      context.registerTool({
        name: "tool_boundary_500",
        description: desc500,
        execute: () => "fail_500",
      }),
    { name: "TypeError", message: /description exceeds 500 characters limit \(500\/500\)/ }
  );

  const desc501 = "D".repeat(501);
  assert.throws(
    () =>
      context.registerTool({
        name: "tool_boundary_501",
        description: desc501,
        execute: () => "fail_501",
      }),
    { name: "TypeError", message: /description exceeds 500 characters limit \(501\/500\)/ }
  );
});

test("webmcp-m1-adv: [10.2] Tool Description Whitespace and Falsy Corner Cases", () => {
  const context = new ModelContextPolyfill();

  assert.throws(
    () => context.registerTool({ name: "t_empty", description: "", execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );

  assert.throws(
    () => context.registerTool({ name: "t_spaces", description: "   \n\t  ", execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );

  assert.throws(
    () => context.registerTool({ name: "t_null", description: null as any, execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );
  assert.throws(
    () => context.registerTool({ name: "t_num", description: 12345 as any, execute: () => {} }),
    { name: "TypeError", message: /description must be a non-empty string/ }
  );
});

test("webmcp-m1-adv: [10.3] Tool Name Boundary Precision (1 char, 64 chars, 65 chars)", () => {
  const context = new ModelContextPolyfill();

  const t1 = context.registerTool({ name: "a", description: "Single char tool", execute: () => "a" });
  assert.equal(t1.name, "a");

  const name64 = "a".repeat(64);
  const t64 = context.registerTool({ name: name64, description: "64 char tool", execute: () => "64" });
  assert.equal(t64.name, name64);

  const name65 = "a".repeat(65);
  assert.throws(
    () => context.registerTool({ name: name65, description: "65 char tool", execute: () => "65" }),
    { name: "TypeError", message: /exceeds 64 characters limit \(65 chars\)/ }
  );
});

test("webmcp-m1-adv: [10.4] Parameter Description Boundary Precision (149 chars vs 150 chars vs 151 chars)", () => {
  const context = new ModelContextPolyfill();

  const p149 = "P".repeat(149);
  const tool149 = context.registerTool({
    name: "tool_param_149",
    description: "Tool with 149 char param description",
    parameters: {
      type: "object",
      properties: {
        field: { type: "string", description: p149 },
      },
    },
    execute: () => "ok",
  });
  assert.equal(tool149.parameters?.properties.field.description.length, 149);

  const p150 = "P".repeat(150);
  assert.throws(
    () =>
      context.registerTool({
        name: "tool_param_150",
        description: "Tool with 150 char param description",
        parameters: {
          type: "object",
          properties: {
            field: { type: "string", description: p150 },
          },
        },
        execute: () => "fail",
      }),
    { name: "TypeError", message: /Parameter "field" description in tool "tool_param_150" exceeds 150 characters limit \(150\/150\)/ }
  );

  const p151 = "P".repeat(151);
  assert.throws(
    () =>
      context.registerTool({
        name: "tool_param_151",
        description: "Tool with 151 char param description",
        parameters: {
          type: "object",
          properties: {
            field: { type: "string", description: p151 },
          },
        },
        execute: () => "fail",
      }),
    { name: "TypeError", message: /Parameter "field" description in tool "tool_param_151" exceeds 150 characters limit \(151\/150\)/ }
  );
});

test("webmcp-m1-adv: [10.5] Deeply Nested Parameter Budgets (Object -> Array -> Object -> Nested Field)", () => {
  const context = new ModelContextPolyfill();

  const validDeepTool = context.registerTool({
    name: "deep_tool_valid",
    description: "Deep schema valid test",
    parameters: {
      type: "object",
      properties: {
        level1: {
          type: "object",
          description: "Level 1 object",
          properties: {
            level2_arr: {
              type: "array",
              description: "Level 2 array",
              items: {
                type: "object",
                description: "Level 3 array item object",
                properties: {
                  deep_field: {
                    type: "string",
                    description: "P".repeat(149),
                  },
                },
              },
            },
          },
        },
      },
    },
    execute: () => "deep_ok",
  });
  assert.ok(validDeepTool);

  assert.throws(
    () =>
      context.registerTool({
        name: "deep_tool_invalid",
        description: "Deep schema invalid test",
        parameters: {
          type: "object",
          properties: {
            level1: {
              type: "object",
              description: "Level 1 object",
              properties: {
                level2_arr: {
                  type: "array",
                  description: "Level 2 array",
                  items: {
                    type: "object",
                    description: "Level 3 array item object",
                    properties: {
                      deep_field: {
                        type: "string",
                        description: "P".repeat(150),
                      },
                    },
                  },
                },
              },
            },
          },
        },
        execute: () => "fail",
      }),
    { name: "TypeError", message: /Parameter "level1\.level2_arr\[items\]\.deep_field" description in tool "deep_tool_invalid" exceeds 150 characters limit/ }
  );
});

test("webmcp-m1-adv: [10.6] Synchronous dispatch errors in safeDispatchEvent do not break registerTool", () => {
  const context = new ModelContextPolyfill();

  const originalDispatch = context.dispatchEvent.bind(context);
  (context as any).dispatchEvent = () => {
    throw new Error("Synchronous DOM error simulation");
  };

  const registered = context.registerTool({
    name: "sync_err_tool",
    description: "Testing exception isolation in sync dispatch",
    execute: () => "ok",
  });

  assert.ok(registered);
  assert.equal(registered.name, "sync_err_tool");
  assert.equal(context.hasTool("sync_err_tool"), true);

  (context as any).dispatchEvent = originalDispatch;
});

test("webmcp-m1-adv: [10.7] Synchronous dispatch errors in safeDispatchEvent do not break executeTool", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "sync_exec_tool",
    description: "Testing exec dispatch resilience",
    execute: (p: { value: number }) => p.value * 2,
  });

  (context as any).dispatchEvent = () => {
    throw new Error("Synchronous DOM dispatch failure");
  };

  const result = await context.executeTool("sync_exec_tool", { value: 21 });
  assert.equal(result, 42);
});

test("webmcp-m1-adv: [10.8] Synchronous dispatch errors do not break unregisterTool or clearTools", () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "unreg_safe_tool",
    description: "Unreg test",
    execute: () => "ok",
  });

  (context as any).dispatchEvent = () => {
    throw new Error("Synchronous DOM unreg error");
  };

  const unregRes = context.unregisterTool("unreg_safe_tool");
  assert.equal(unregRes, true);
  assert.equal(context.hasTool("unreg_safe_tool"), false);

  assert.doesNotThrow(() => context.clearTools());
});

test("webmcp-m1-adv: [10.9] Pre-flight Abort with custom Error object reason preserves message", async () => {
  const context = new ModelContextPolyfill();
  let callbackRan = false;

  context.registerTool({
    name: "preflight_custom_tool",
    description: "Preflight abort test",
    execute: async () => {
      callbackRan = true;
      return "done";
    },
  });

  const controller = new AbortController();
  controller.abort(new Error("Custom pre-flight abort reason error"));

  await assert.rejects(
    async () => context.executeTool("preflight_custom_tool", {}, { signal: controller.signal }),
    (err: any) => {
      assert.equal(err.name, "AbortError");
      assert.ok(err.message.includes("Custom pre-flight abort reason error"));
      return true;
    }
  );

  assert.equal(callbackRan, false);
});

test("webmcp-m1-adv: [10.10] In-flight Abort with custom string reason", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "inflight_custom_tool",
    description: "Inflight abort test",
    execute: async () => {
      return new Promise((resolve) => setTimeout(resolve, 500));
    },
  });

  const controller = new AbortController();
  const execPromise = context.executeTool("inflight_custom_tool", {}, { signal: controller.signal });

  setTimeout(() => {
    controller.abort("User clicked Stop Generating");
  }, 20);

  await assert.rejects(
    async () => execPromise,
    (err: any) => {
      assert.equal(err.name, "AbortError");
      assert.ok(err.message.includes("User clicked Stop Generating"));
      return true;
    }
  );
});

test("webmcp-m1-adv: [10.11] High Concurrency: 50 simultaneous executeTool calls aborted at varying intervals", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "concurrent_calc",
    description: "Concurrent calculations",
    execute: async (p: { delay: number; id: number }) => {
      await new Promise((resolve) => setTimeout(resolve, p.delay));
      return { id: p.id, success: true };
    },
  });

  const operations: Promise<unknown>[] = [];
  const controllers: AbortController[] = [];

  for (let i = 0; i < 50; i++) {
    const controller = new AbortController();
    controllers.push(controller);
    const delay = 30 + (i % 5) * 20;

    const op = context.executeTool(
      "concurrent_calc",
      { delay, id: i },
      { signal: controller.signal }
    );
    operations.push(op);

    if (i % 2 === 0) {
      setTimeout(() => controller.abort(`Abort batch index ${i}`), 15);
    }
  }

  const results = await Promise.allSettled(operations);
  assert.equal(results.length, 50);

  let abortedCount = 0;
  let fulfilledCount = 0;

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (res.status === "rejected") {
      assert.equal((res.reason as Error).name, "AbortError");
      abortedCount++;
    } else {
      assert.equal(res.status, "fulfilled");
      fulfilledCount++;
    }
  }

  assert.equal(abortedCount, 25, "Exactly 25 even-indexed executions must be aborted");
  assert.equal(fulfilledCount, 25, "Exactly 25 odd-indexed executions must be fulfilled");
});

test("webmcp-m1-adv: [10.12] Falsy parameter values (0, false, empty string) are preserved and NOT replaced by defaults", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "falsy_tool",
    description: "Preserves explicit falsy values",
    parameters: {
      type: "object",
      properties: {
        num: { type: "number", description: "Number param", default: 100 },
        flag: { type: "boolean", description: "Boolean param", default: true },
        text: { type: "string", description: "String param", default: "default text" },
      },
    },
    execute: (p: any) => p,
  });

  const result: any = await context.executeTool("falsy_tool", {
    num: 0,
    flag: false,
    text: "",
  });

  assert.equal(result.num, 0, "Explicit 0 must NOT be overwritten by default 100");
  assert.equal(result.flag, false, "Explicit false must NOT be overwritten by default true");
  assert.equal(result.text, "", "Explicit empty string must NOT be overwritten by default text");
});

test("webmcp-m1-adv: [10.13] Integer vs Float Type Validation & NaN Rejection", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "int_tool",
    description: "Integer validation tool",
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: "Count integer" },
      },
    },
    execute: (p: any) => p,
  });

  const res = await context.executeTool("int_tool", { count: 42 });
  assert.deepEqual(res, { count: 42 });

  await assert.rejects(
    async () => context.executeTool("int_tool", { count: 42.5 }),
    { name: "TypeError", message: /must be an integer, received 42.5/ }
  );

  await assert.rejects(
    async () => context.executeTool("int_tool", { count: NaN }),
    { name: "TypeError", message: /must be a number/ }
  );
});

test("webmcp-m1-adv: [10.14] String minLength and maxLength Boundary Validation", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "string_bound_tool",
    description: "String bounds test",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Length 3-6 code",
          minLength: 3,
          maxLength: 6,
        },
      },
    },
    execute: (p: any) => p,
  });

  await assert.rejects(
    async () => context.executeTool("string_bound_tool", { code: "ab" }),
    { name: "TypeError", message: /length is less than minimum allowed length 3/ }
  );

  const rMin = await context.executeTool("string_bound_tool", { code: "abc" });
  assert.deepEqual(rMin, { code: "abc" });

  const rMax = await context.executeTool("string_bound_tool", { code: "abcdef" });
  assert.deepEqual(rMax, { code: "abcdef" });

  await assert.rejects(
    async () => context.executeTool("string_bound_tool", { code: "abcdefg" }),
    { name: "TypeError", message: /length exceeds maximum allowed length 6/ }
  );
});

test("webmcp-m1-adv: [10.15] Prototype Keys as Tool Names (toString, valueOf, __proto__, constructor)", () => {
  const context = new ModelContextPolyfill();

  const protoNames = ["toString", "valueOf", "__proto__", "constructor", "hasOwnProperty"];

  for (const name of protoNames) {
    const tool = context.registerTool({
      name,
      description: `Tool named ${name}`,
      execute: () => name,
    });
    assert.equal(tool.name, name);
    assert.equal(context.hasTool(name), true);
    assert.equal(context.getTool(name)?.name, name);
    assert.equal(typeof context.getTools, "function");
  }

  assert.equal(context.getTools().length, protoNames.length);

  for (const name of protoNames) {
    assert.equal(context.unregisterTool(name), true);
    assert.equal(context.hasTool(name), false);
  }

  assert.equal(context.getTools().length, 0);
});

test("webmcp-m1-adv: [10.16] Security Hints Preservation (readOnlyHint, untrustedContentHint, destructiveHint)", () => {
  const context = new ModelContextPolyfill();

  const tool = context.registerTool({
    name: "secure_inspect",
    description: "Inspection tool with hints",
    readOnlyHint: true,
    untrustedContentHint: true,
    destructiveHint: false,
    execute: () => "inspected",
  });

  assert.equal(tool.readOnlyHint, true);
  assert.equal(tool.untrustedContentHint, true);
  assert.equal(tool.destructiveHint, false);

  const retrieved = context.getTool("secure_inspect");
  assert.equal(retrieved?.readOnlyHint, true);
  assert.equal(retrieved?.untrustedContentHint, true);
  assert.equal(retrieved?.destructiveHint, false);
});

test("webmcp-m1-adv: [10.17] Re-entrant Tool Execution (Tool A executes Tool B via modelContext)", async () => {
  const context = new ModelContextPolyfill();

  context.registerTool({
    name: "multiplier",
    description: "Multiplies input by 2",
    parameters: {
      type: "object",
      properties: {
        val: { type: "number", description: "Value to multiply" },
      },
    },
    execute: (p: { val: number }) => p.val * 2,
  });

  context.registerTool({
    name: "composite_tool",
    description: "Invokes multiplier internally",
    parameters: {
      type: "object",
      properties: {
        num: { type: "number", description: "Initial number" },
      },
    },
    execute: async (p: { num: number }) => {
      const step1: any = await context.executeTool("multiplier", { val: p.num });
      return step1 + 10;
    },
  });

  const finalResult = await context.executeTool("composite_tool", { num: 5 });
  assert.equal(finalResult, 20);
});

test("webmcp-m1-adv: [10.18] Circular Execution History Caps at 50 Records and clearExecutionHistory cleans up", async () => {
  const context = new ModelContextPolyfill();
  clearExecutionHistory();

  context.registerTool({
    name: "quick_counter",
    description: "Quick counter",
    execute: (p: { idx: number }) => p.idx * 2,
  });

  for (let i = 1; i <= 60; i++) {
    await context.executeTool("quick_counter", { idx: i });
  }

  const history = getExecutionHistory();
  assert.equal(history.length, 50, "History buffer must cap strictly at 50 records");
  assert.equal((history[0].params as any).idx, 60, "Latest execution must be at index 0");
  assert.equal((history[49].params as any).idx, 11, "Oldest preserved execution must be idx 11");

  clearExecutionHistory();
  assert.equal(getExecutionHistory().length, 0);
});

// ============================================================================
// Mock StudioCanvasAdapter Test Harness
// ============================================================================

export interface MockStudioAdapterOptions {
  initialImage?: string | null;
  initialOriginalImage?: string | null;
  initialMetadata?: ImageMetadata | null;
  initialPipelineSteps?: Array<{ tool: string; params: any }>;
  initialSliderPos?: number;
  initialZoom?: number;
  applyFilterDelayMs?: number;
  loadPresetDelayMs?: number;
  simulateErrorOnTool?: string;
}

export class MockStudioCanvasAdapter implements StudioCanvasAdapter {
  public image: string | null;
  public originalImage: string | null;
  public metadata: ImageMetadata | null;
  public pipelineSteps: Array<{ tool: string; params: any }>;
  public sliderPos: number;
  public zoom: number;
  public history: Array<{
    image: string | null;
    metadata: ImageMetadata | null;
    pipelineSteps: Array<{ tool: string; params: any }>;
  }>;

  public calls: {
    applyFilter: Array<{ tool: string; params: any; signal?: AbortSignal }>;
    cropImage: Array<{ left: number; top: number; width: number; height: number; signal?: AbortSignal }>;
    buildPipeline: Array<{ operations: Array<{ tool: string; params: any }>; signal?: AbortSignal }>;
    loadPreset: Array<{ presetIndex?: number; imageUrl?: string; signal?: AbortSignal }>;
    setSlider: Array<{ pos: number; zoom?: number }>;
    undoAction: Array<{ action: "undo_last" | "reset_all" }>;
    exportImage: Array<{ format?: string; quality?: number }>;
  };

  private options: MockStudioAdapterOptions;

  constructor(options: MockStudioAdapterOptions = {}) {
    this.options = options;
    const defaultImg = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    this.image = options.initialImage !== undefined ? options.initialImage : defaultImg;
    this.originalImage = options.initialOriginalImage !== undefined ? options.initialOriginalImage : defaultImg;
    this.metadata = options.initialMetadata !== undefined ? options.initialMetadata : {
      width: 800,
      height: 600,
      format: "png",
      channels: 4,
      space: "srgb",
      sizeBytes: 1024,
    };
    this.pipelineSteps = options.initialPipelineSteps ? [...options.initialPipelineSteps] : [];
    this.sliderPos = options.initialSliderPos ?? 50;
    this.zoom = options.initialZoom ?? 1.0;
    this.history = [];

    this.calls = {
      applyFilter: [],
      cropImage: [],
      buildPipeline: [],
      loadPreset: [],
      setSlider: [],
      undoAction: [],
      exportImage: [],
    };
  }

  getImage(): string | null { return this.image; }
  getOriginalImage(): string | null { return this.originalImage; }
  getMetadata(): ImageMetadata | null { return this.metadata; }
  getPipelineSteps(): Array<{ tool: string; params: any }> { return [...this.pipelineSteps]; }
  getSliderPos(): number { return this.sliderPos; }
  getZoom(): number { return this.zoom; }

  async applyFilter(tool: string, params: Record<string, any>, signal?: AbortSignal): Promise<StudioProcessResult> {
    this.calls.applyFilter.push({ tool, params, signal });
    if (signal?.aborted) {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }

    if (this.options.simulateErrorOnTool === tool) {
      throw new Error(`Simulated engine failure on tool: ${tool}`);
    }

    if (this.options.applyFilterDelayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.applyFilterDelayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }

    this.history.push({
      image: this.image,
      metadata: this.metadata,
      pipelineSteps: [...this.pipelineSteps],
    });

    const newImage = `data:image/png;base64,PROCESSED_${tool.toUpperCase()}_${Date.now()}`;
    this.image = newImage;
    this.pipelineSteps.push({ tool, params });

    return {
      processedImage: newImage,
      metadata: { ...this.metadata, format: "png" },
      executionTimeMs: 12.5,
    };
  }

  async cropImage(left: number, top: number, width: number, height: number, signal?: AbortSignal): Promise<StudioCropResult> {
    this.calls.cropImage.push({ left, top, width, height, signal });
    if (signal?.aborted) {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }

    this.history.push({
      image: this.image,
      metadata: this.metadata,
      pipelineSteps: [...this.pipelineSteps],
    });

    const newImage = `data:image/png;base64,CROPPED_${left}_${top}_${width}_${height}`;
    this.image = newImage;
    this.metadata = { ...this.metadata, width, height };

    return {
      processedImage: newImage,
      metadata: this.metadata,
      executionTimeMs: 8.2,
    };
  }

  async buildPipeline(operations: Array<{ tool: string; params: any }>, signal?: AbortSignal): Promise<StudioProcessResult> {
    this.calls.buildPipeline.push({ operations, signal });
    if (signal?.aborted) {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }

    if (this.options.applyFilterDelayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.applyFilterDelayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }

    this.history.push({
      image: this.image,
      metadata: this.metadata,
      pipelineSteps: [...this.pipelineSteps],
    });

    for (const op of operations) {
      this.pipelineSteps.push(op);
    }

    const newImage = `data:image/png;base64,PIPELINE_APPLIED_${operations.length}_STEPS`;
    this.image = newImage;

    return {
      processedImage: newImage,
      metadata: { ...this.metadata },
      executionTimeMs: 25.4,
    };
  }

  async loadPreset(presetIndex?: number, imageUrl?: string, signal?: AbortSignal): Promise<void> {
    this.calls.loadPreset.push({ presetIndex, imageUrl, signal });
    if (signal?.aborted) {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }

    if (this.options.loadPresetDelayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.loadPresetDelayMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }

    const loadedImg = imageUrl
      ? `data:image/png;base64,URL_LOADED_${imageUrl}`
      : `data:image/png;base64,PRESET_LOADED_${presetIndex ?? 0}`;

    this.originalImage = loadedImg;
    this.image = loadedImg;
    this.pipelineSteps = [];
    this.history = [];
  }

  setSlider(pos: number, zoom?: number): void {
    this.calls.setSlider.push({ pos, zoom });
    this.sliderPos = pos;
    if (zoom !== undefined) this.zoom = zoom;
  }

  undoAction(action: "undo_last" | "reset_all"): StudioUndoResult {
    this.calls.undoAction.push({ action });
    if (action === "reset_all") {
      this.image = this.originalImage;
      this.pipelineSteps = [];
      this.history = [];
      return { remainingSteps: 0, restored: true, activeImage: this.image };
    }

    if (this.history.length > 0) {
      const prev = this.history.pop()!;
      this.image = prev.image;
      this.metadata = prev.metadata;
      this.pipelineSteps = prev.pipelineSteps;
      return { remainingSteps: this.pipelineSteps.length, restored: true, activeImage: this.image };
    }

    this.image = this.originalImage;
    this.pipelineSteps = [];
    return { remainingSteps: 0, restored: true, activeImage: this.originalImage };
  }

  async exportImage(format = "png", quality = 90): Promise<StudioExportResult> {
    this.calls.exportImage.push({ format, quality });
    const active = this.image || this.originalImage || "";
    return {
      imageBase64: active,
      format,
      sizeBytes: active.length,
      width: this.metadata?.width,
      height: this.metadata?.height,
    };
  }
}

// Expected 8 canonical studio tool names
const EXPECTED_STUDIO_TOOL_NAMES = [
  "apply_filter",
  "crop_canvas",
  "build_filter_pipeline",
  "inspect_image",
  "load_preset_image",
  "set_comparison_slider",
  "undo_canvas_action",
  "export_canvas_image",
] as const;

// ============================================================================
// Suite 11: M2 Studio WebMCP Tool Catalog Registration & Lifecycle
// ============================================================================

test("webmcp-m2: [11.1] createStudioWebMCPTools factory creates exactly 8 distinct tools with compliant names", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  assert.equal(tools.length, 8, "Must return exactly 8 tools");
  const toolNames = tools.map((t) => t.name);

  for (const expected of EXPECTED_STUDIO_TOOL_NAMES) {
    assert.ok(toolNames.includes(expected), `Tools must include "${expected}"`);
  }

  for (const tool of tools) {
    assert.equal(typeof tool.name, "string");
    assert.ok(TOOL_NAME_REGEX.test(tool.name), `Tool name "${tool.name}" must match valid regex`);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0, `Tool "${tool.name}" must have non-empty description`);
    assert.equal(typeof tool.execute, "function", `Tool "${tool.name}" must have callable execute method`);
  }
});

test("webmcp-m2: [11.2] registerStudioWebMCPTools registers all 8 tools with valid registeredAt timestamps", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();

  const registered = registerStudioWebMCPTools(context, adapter);
  assert.equal(registered.length, 8);
  assert.equal(context.getTools().length, 8);

  const now = Date.now();
  for (const tool of registered) {
    assert.ok(tool.registeredAt <= now && tool.registeredAt >= now - 5000);
    assert.equal(typeof tool.unregister, "function");
  }
});

test("webmcp-m2: [11.3] document.modelContext global registration integration via registerStudioWebMCPTools", () => {
  const mockDoc: any = {};
  const mockWin: any = {};
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");

  try {
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: mockWin,
      configurable: true,
      writable: true,
    });

    const context = installModelContextPolyfill({ force: true });
    const adapter = new MockStudioCanvasAdapter();

    const registered = registerStudioWebMCPTools(mockDoc.modelContext, adapter);
    assert.equal(registered.length, 8);
    assert.equal(mockDoc.modelContext.getTools().length, 8);
    assert.equal(context.getTools().length, 8);
  } finally {
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("webmcp-m2: [11.4] Context query methods (hasTool, getTool, getTools) confirm presence and schema integrity", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  for (const name of EXPECTED_STUDIO_TOOL_NAMES) {
    assert.equal(context.hasTool(name), true, `hasTool("${name}") must be true`);
    const tool = context.getTool(name);
    assert.ok(tool, `getTool("${name}") must return tool handle`);
    assert.equal(tool?.name, name);
    assert.ok(tool?.parameters, `Tool "${name}" should have parameters schema defined`);
  }

  assert.equal(context.hasTool("unknown_filter_tool"), false);
  assert.equal(context.getTool("unknown_filter_tool"), undefined);
});

test("webmcp-m2: [11.5] Individual unregistration via RegisteredTool.unregister() cleans up registry", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  const registered = registerStudioWebMCPTools(context, adapter);

  const applyFilterTool = registered.find((t) => t.name === "apply_filter")!;
  assert.ok(applyFilterTool);

  const unregResult = applyFilterTool.unregister();
  assert.equal(unregResult, true);
  assert.equal(context.hasTool("apply_filter"), false);
  assert.equal(context.getTools().length, 7);

  // Subsequent call returns false
  assert.equal(applyFilterTool.unregister(), false);
});

test("webmcp-m2: [11.6] Individual unregistration via context.unregisterTool(name) cleans up registry", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  assert.equal(context.unregisterTool("crop_canvas"), true);
  assert.equal(context.hasTool("crop_canvas"), false);
  assert.equal(context.getTools().length, 7);
  assert.equal(context.unregisterTool("crop_canvas"), false);
});

test("webmcp-m2: [11.7] Idempotent re-registration cleanly updates tools without duplicate counts", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();

  registerStudioWebMCPTools(context, adapter);
  assert.equal(context.getTools().length, 8);

  // Second registration
  registerStudioWebMCPTools(context, adapter);
  assert.equal(context.getTools().length, 8);
});

test("webmcp-m2: [11.8] clearTools() cleanly clears all 8 tools", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  assert.equal(context.getTools().length, 8);
  context.clearTools();
  assert.equal(context.getTools().length, 0);

  for (const name of EXPECTED_STUDIO_TOOL_NAMES) {
    assert.equal(context.hasTool(name), false);
  }
});

// ============================================================================
// Suite 12: M2 Prompt Budget & Character Length Compliance (<500 tool, <150 param)
// ============================================================================

test("webmcp-m2: [12.1] Tool Description Budgets: Every tool description is < 500 characters", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  for (const tool of tools) {
    assert.ok(
      tool.description.length < BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH,
      `Tool "${tool.name}" description length (${tool.description.length}) must be < ${BUDGET_LIMITS.MAX_TOOL_DESCRIPTION_LENGTH}`
    );
    assert.ok(tool.description.trim().length > 10, `Tool "${tool.name}" description should be descriptive`);
  }
});

test("webmcp-m2: [12.2] Parameter Description Budgets: Every property description is < 150 characters", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  for (const tool of tools) {
    if (tool.parameters?.properties) {
      for (const [propKey, propDef] of Object.entries(tool.parameters.properties)) {
        assert.ok(
          propDef.description.length < BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH,
          `Property "${propKey}" in tool "${tool.name}" description length (${propDef.description.length}) must be < ${BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH}`
        );
        assert.ok(propDef.description.trim().length > 5, `Property "${propKey}" in tool "${tool.name}" description too short`);
      }
    }
  }
});

test("webmcp-m2: [12.3] Nested Parameter Description Budgets: Array items and object properties (< 150 chars)", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  const pipelineTool = tools.find((t) => t.name === "build_filter_pipeline")!;
  assert.ok(pipelineTool);
  assert.ok(pipelineTool.parameters?.properties?.operations);

  const opsProp = pipelineTool.parameters.properties.operations;
  assert.ok(opsProp.items);
  if (opsProp.items.description) {
    assert.ok(
      opsProp.items.description.length < BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH,
      `Pipeline operations items description (${opsProp.items.description.length}) must be < 150`
    );
  }

  if (opsProp.items.properties) {
    for (const [childKey, childDef] of Object.entries(opsProp.items.properties)) {
      assert.ok(
        childDef.description.length < BUDGET_LIMITS.MAX_PARAM_DESCRIPTION_LENGTH,
        `Pipeline nested property "${childKey}" description (${childDef.description.length}) must be < 150`
      );
    }
  }
});

test("webmcp-m2: [12.4] analyzeToolBudget evaluates all 8 tools as 100% compliant (overallCompliant: true)", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  for (const tool of tools) {
    const analysis = analyzeToolBudget(tool);
    assert.equal(analysis.toolName, tool.name);
    assert.equal(analysis.descriptionBudgetOk, true, `Tool "${tool.name}" description budget must be ok`);
    assert.equal(analysis.parameterBudgetsOk, true, `Tool "${tool.name}" parameter budgets must be ok`);
    assert.equal(analysis.overallCompliant, true, `Tool "${tool.name}" must be overall compliant`);

    for (const param of analysis.parameterBudgets) {
      assert.equal(param.budgetOk, true, `Tool "${tool.name}" param "${param.property}" must be ok`);
    }
  }
});

test("webmcp-m2: [12.5] Schema property structural conformance (type: object, valid types, enums)", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  for (const tool of tools) {
    if (tool.parameters) {
      assert.equal(tool.parameters.type, "object", `Tool "${tool.name}" parameters.type must be "object"`);
      assert.ok(typeof tool.parameters.properties === "object", `Tool "${tool.name}" properties must be object`);
    }
  }

  // Check apply_filter enum covers FILTER_TOOLS_CATALOG IDs
  const applyTool = tools.find((t) => t.name === "apply_filter")!;
  const toolEnum = applyTool.parameters?.properties?.tool?.enum as string[];
  assert.ok(Array.isArray(toolEnum));
  assert.ok(toolEnum.includes("crop_image"));
  assert.ok(toolEnum.includes("adjust_brightness"));
  assert.ok(toolEnum.includes("blur_image"));
  assert.ok(toolEnum.includes("grayscale_image"));
});

// ============================================================================
// Suite 13: M2 Security Annotations & Hints Verification
// ============================================================================

test("webmcp-m2: [13.1] Read-Only Speculative Execution: inspect_image and export_canvas_image have readOnlyHint: true", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  const inspectTool = tools.find((t) => t.name === "inspect_image")!;
  assert.equal(inspectTool.readOnlyHint, true, "inspect_image must have readOnlyHint: true");

  const exportTool = tools.find((t) => t.name === "export_canvas_image")!;
  assert.equal(exportTool.readOnlyHint, true, "export_canvas_image must have readOnlyHint: true");

  const mutatingTools = [
    "apply_filter",
    "crop_canvas",
    "build_filter_pipeline",
    "load_preset_image",
    "set_comparison_slider",
    "undo_canvas_action",
  ];

  for (const name of mutatingTools) {
    const t = tools.find((tool) => tool.name === name)!;
    assert.equal(t.readOnlyHint, false, `Mutating tool "${name}" must have readOnlyHint: false`);
  }
});

test("webmcp-m2: [13.2] Untrusted Content Fencing: load_preset_image has untrustedContentHint: true", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  const loadTool = tools.find((t) => t.name === "load_preset_image")!;
  assert.equal(loadTool.untrustedContentHint, true, "load_preset_image must have untrustedContentHint: true");

  const otherTools = tools.filter((t) => t.name !== "load_preset_image");
  for (const t of otherTools) {
    assert.equal(t.untrustedContentHint, false, `Tool "${t.name}" must have untrustedContentHint: false`);
  }
});

test("webmcp-m2: [13.3] Destructive Operation Safety: All 8 tools have destructiveHint: false", () => {
  const adapter = new MockStudioCanvasAdapter();
  const tools = createStudioWebMCPTools(adapter);

  for (const tool of tools) {
    assert.equal(tool.destructiveHint, false, `Tool "${tool.name}" must have destructiveHint: false`);
  }
});

test("webmcp-m2: [13.4] Security hints preservation across registration, retrieval, and debug inspection", () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const inspect = context.getTool("inspect_image")!;
  assert.equal(inspect.readOnlyHint, true);
  assert.equal(inspect.untrustedContentHint, false);

  const load = context.getTool("load_preset_image")!;
  assert.equal(load.readOnlyHint, false);
  assert.equal(load.untrustedContentHint, true);

  const crop = context.getTool("crop_canvas")!;
  assert.equal(crop.readOnlyHint, false);
  assert.equal(crop.untrustedContentHint, false);
  assert.equal(crop.destructiveHint, false);
});

// ============================================================================
// Suite 14: M2 Mock Adapter Execution (All 8 Tools)
// ============================================================================

test("webmcp-m2: [14.1] apply_filter: applies filter with parameters and returns structured result", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("apply_filter", {
    tool: "grayscale_image",
    params: {},
    output_format: "png",
  });

  assert.ok(result);
  assert.ok(result.processedImage.startsWith("data:image/png;base64,PROCESSED_GRAYSCALE_IMAGE"));
  assert.ok(result.metadata);
  assert.equal(result.metadata.format, "png");
  assert.equal(typeof result.executionTimeMs, "number");

  assert.equal(adapter.calls.applyFilter.length, 1);
  assert.equal(adapter.calls.applyFilter[0].tool, "grayscale_image");
  assert.equal(adapter.pipelineSteps.length, 1);
});

test("webmcp-m2: [14.2] crop_canvas: crops canvas with rectangular bounds and returns result", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("crop_canvas", {
    left: 50,
    top: 50,
    width: 400,
    height: 300,
  });

  assert.ok(result);
  assert.ok(result.processedImage.startsWith("data:image/png;base64,CROPPED_50_50_400_300"));
  assert.equal(result.metadata.width, 400);
  assert.equal(result.metadata.height, 300);

  assert.equal(adapter.calls.cropImage.length, 1);
  assert.deepEqual(adapter.calls.cropImage[0], {
    left: 50,
    top: 50,
    width: 400,
    height: 300,
    signal: undefined,
  });
});

test("webmcp-m2: [14.3] build_filter_pipeline: executes multi-step filter pipeline atomically", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const operations = [
    { tool: "adjust_brightness", params: { factor: 20 } },
    { tool: "blur_image", params: { sigma: 2.5 } },
    { tool: "sharpen_image", params: { sigma: 1.0 } },
  ];

  const result: any = await context.executeTool("build_filter_pipeline", {
    operations,
    output_format: "png",
  });

  assert.ok(result);
  assert.ok(result.processedImage.startsWith("data:image/png;base64,PIPELINE_APPLIED_3_STEPS"));
  assert.equal(adapter.calls.buildPipeline.length, 1);
  assert.equal(adapter.pipelineSteps.length, 3);
});

test("webmcp-m2: [14.4] inspect_image: non-mutating query returns comprehensive metadata and history", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({
    initialPipelineSteps: [{ tool: "grayscale_image", params: {} }],
    initialSliderPos: 75,
    initialZoom: 1.5,
  });
  registerStudioWebMCPTools(context, adapter);

  const result: StudioInspectionResult = await context.executeTool("inspect_image", {
    include_history: true,
  });

  assert.equal(result.hasImage, true);
  assert.equal(result.dimensions.width, 800);
  assert.equal(result.dimensions.height, 600);
  assert.equal(result.format, "png");
  assert.equal(result.channels, 4);
  assert.equal(result.colorSpace, "srgb");
  assert.equal(result.pipelineLength, 1);
  assert.deepEqual(result.pipelineSteps, [{ tool: "grayscale_image", params: {} }]);
  assert.equal(result.sliderPosition, 75);
  assert.equal(result.zoomLevel, 1.5);
});

test("webmcp-m2: [14.5] inspect_image: respects include_history: false option", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({
    initialPipelineSteps: [{ tool: "grayscale_image", params: {} }],
  });
  registerStudioWebMCPTools(context, adapter);

  const result: StudioInspectionResult = await context.executeTool("inspect_image", {
    include_history: false,
  });

  assert.equal(result.pipelineLength, 1);
  assert.deepEqual(result.pipelineSteps, []);
});

test("webmcp-m2: [14.6] load_preset_image: loads preset by index (0, 1, 2)", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("load_preset_image", {
    preset_index: 1,
  });

  assert.deepEqual(result, { success: true, loaded: true });
  assert.equal(adapter.calls.loadPreset.length, 1);
  assert.equal(adapter.calls.loadPreset[0].presetIndex, 1);
  assert.ok(adapter.getImage()?.startsWith("data:image/png;base64,PRESET_LOADED_1"));
});

test("webmcp-m2: [14.7] load_preset_image: loads preset by external image URL", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const testUrl = "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800";
  const result: any = await context.executeTool("load_preset_image", {
    image_url: testUrl,
  });

  assert.deepEqual(result, { success: true, loaded: true });
  assert.equal(adapter.calls.loadPreset.length, 1);
  assert.equal(adapter.calls.loadPreset[0].imageUrl, testUrl);
  assert.ok(adapter.getImage()?.startsWith(`data:image/png;base64,URL_LOADED_${testUrl}`));
});

test("webmcp-m2: [14.8] set_comparison_slider: updates split position and viewport zoom", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("set_comparison_slider", {
    position: 65,
    zoom: 2.0,
  });

  assert.equal(result.sliderPosition, 65);
  assert.equal(result.zoom, 2.0);
  assert.equal(adapter.getSliderPos(), 65);
  assert.equal(adapter.getZoom(), 2.0);
});

test("webmcp-m2: [14.9] set_comparison_slider: maintains existing zoom when zoom parameter is omitted", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({ initialZoom: 1.75 });
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("set_comparison_slider", {
    position: 30,
  });

  assert.equal(result.sliderPosition, 30);
  assert.equal(result.zoom, 1.75);
  assert.equal(adapter.getZoom(), 1.75);
});

test("webmcp-m2: [14.10] undo_canvas_action: handles undo_last (pops last filter step)", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  // Apply 2 filters first
  await context.executeTool("apply_filter", { tool: "adjust_brightness", params: { factor: 10 } });
  await context.executeTool("apply_filter", { tool: "blur_image", params: { sigma: 2.0 } });
  assert.equal(adapter.pipelineSteps.length, 2);

  // Undo last
  const result: any = await context.executeTool("undo_canvas_action", { action: "undo_last" });
  assert.equal(result.action, "undo_last");
  assert.equal(result.remainingSteps, 1);
  assert.equal(result.restored, true);
  assert.equal(adapter.pipelineSteps.length, 1);
});

test("webmcp-m2: [14.11] undo_canvas_action: handles reset_all (restores original canvas state)", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  // Apply filters
  await context.executeTool("apply_filter", { tool: "adjust_brightness", params: { factor: 10 } });
  await context.executeTool("apply_filter", { tool: "blur_image", params: { sigma: 2.0 } });

  // Reset all
  const result: any = await context.executeTool("undo_canvas_action", { action: "reset_all" });
  assert.equal(result.action, "reset_all");
  assert.equal(result.remainingSteps, 0);
  assert.equal(result.restored, true);
  assert.equal(adapter.pipelineSteps.length, 0);
  assert.equal(adapter.getImage(), adapter.getOriginalImage());
});

test("webmcp-m2: [14.12] export_canvas_image: exports active image with format and quality options", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const result: any = await context.executeTool("export_canvas_image", {
    format: "webp",
    quality: 85,
  });

  assert.ok(result);
  assert.ok(result.imageBase64);
  assert.equal(result.format, "webp");
  assert.equal(typeof result.sizeBytes, "number");
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
  assert.equal(adapter.calls.exportImage.length, 1);
  assert.deepEqual(adapter.calls.exportImage[0], { format: "webp", quality: 85 });
});

// ============================================================================
// Suite 15: M2 Parameter Validation & Error Handling
// ============================================================================

test("webmcp-m2: [15.1] apply_filter: missing required tool parameter throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("apply_filter", {} as any),
    { name: "TypeError", message: /Missing required parameter "tool" for tool "apply_filter"/ }
  );
});

test("webmcp-m2: [15.2] apply_filter: unknown tool ID not in catalog enum throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("apply_filter", { tool: "invalid_unsupported_filter" }),
    { name: "TypeError", message: /Invalid value "invalid_unsupported_filter" for parameter "tool"/ }
  );
});

test("webmcp-m2: [15.3] crop_canvas: missing required width or height throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: 0, top: 0, width: 200 } as any),
    { name: "TypeError", message: /Missing required parameter "height" for tool "crop_canvas"/ }
  );

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: 0, top: 0, height: 200 } as any),
    { name: "TypeError", message: /Missing required parameter "width" for tool "crop_canvas"/ }
  );
});

test("webmcp-m2: [15.4] crop_canvas: negative bounds (left < 0, top < 0, width < 1, height < 1) throw TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: -10, top: 0, width: 100, height: 100 }),
    { name: "TypeError", message: /Parameter "left" \(-10\) is less than minimum allowed 0/ }
  );

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: 0, top: -5, width: 100, height: 100 }),
    { name: "TypeError", message: /Parameter "top" \(-5\) is less than minimum allowed 0/ }
  );

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: 0, top: 0, width: 0, height: 100 }),
    { name: "TypeError", message: /Parameter "width" \(0\) is less than minimum allowed 1/ }
  );

  await assert.rejects(
    async () => context.executeTool("crop_canvas", { left: 0, top: 0, width: 100, height: -1 }),
    { name: "TypeError", message: /Parameter "height" \(-1\) is less than minimum allowed 1/ }
  );
});

test("webmcp-m2: [15.5] build_filter_pipeline: empty operations array throws WebMCPValidationError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("build_filter_pipeline", { operations: [] }),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "operations");
      assert.ok(err.message.includes("empty"));
      return true;
    }
  );
});

test("webmcp-m2: [15.6] build_filter_pipeline: pipeline exceeding maximum 5 operations throws WebMCPValidationError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const sixOps = [
    { tool: "blur_image" },
    { tool: "sharpen_image" },
    { tool: "adjust_brightness" },
    { tool: "grayscale_image" },
    { tool: "invert_colors" },
    { tool: "sepia_tone" },
  ];

  await assert.rejects(
    async () => context.executeTool("build_filter_pipeline", { operations: sixOps }),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "operations");
      assert.ok(err.message.includes("exceed"));
      return true;
    }
  );
});

test("webmcp-m2: [15.7] load_preset_image: omitting both preset_index and image_url throws WebMCPValidationError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("load_preset_image", {}),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "preset_index");
      return true;
    }
  );
});

test("webmcp-m2: [15.8] load_preset_image: invalid preset_index outside [0, 2] throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("load_preset_image", { preset_index: -1 }),
    { name: "TypeError", message: /less than minimum allowed 0/ }
  );

  await assert.rejects(
    async () => context.executeTool("load_preset_image", { preset_index: 3 }),
    { name: "TypeError", message: /greater than maximum allowed 2/ }
  );
});

test("webmcp-m2: [15.9] set_comparison_slider: position out of bounds (< 0 or > 100) throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("set_comparison_slider", { position: -1 }),
    { name: "TypeError", message: /less than minimum allowed 0/ }
  );

  await assert.rejects(
    async () => context.executeTool("set_comparison_slider", { position: 101 }),
    { name: "TypeError", message: /greater than maximum allowed 100/ }
  );
});

test("webmcp-m2: [15.10] set_comparison_slider: zoom out of bounds (< 0.5 or > 3.0) throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("set_comparison_slider", { position: 50, zoom: 0.2 }),
    { name: "TypeError", message: /less than minimum allowed 0.5/ }
  );

  await assert.rejects(
    async () => context.executeTool("set_comparison_slider", { position: 50, zoom: 3.5 }),
    { name: "TypeError", message: /greater than maximum allowed 3/ }
  );
});

test("webmcp-m2: [15.11] undo_canvas_action: invalid action string not in enum throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("undo_canvas_action", { action: "delete_everything" as any }),
    { name: "TypeError", message: /Invalid value "delete_everything" for parameter "action"/ }
  );
});

test("webmcp-m2: [15.12] export_canvas_image: invalid format not in enum throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("export_canvas_image", { format: "bmp" as any }),
    { name: "TypeError", message: /Invalid value "bmp" for parameter "format"/ }
  );
});

test("webmcp-m2: [15.13] export_canvas_image: quality out of range (< 1 or > 100) throws TypeError", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  await assert.rejects(
    async () => context.executeTool("export_canvas_image", { quality: 0 }),
    { name: "TypeError", message: /less than minimum allowed 1/ }
  );

  await assert.rejects(
    async () => context.executeTool("export_canvas_image", { quality: 105 }),
    { name: "TypeError", message: /greater than maximum allowed 100/ }
  );
});

test("webmcp-m2: [15.14] Empty Canvas Guard: executing mutating tools when canvas is empty throws WebMCPValidationError", async () => {
  const context = new ModelContextPolyfill();
  const emptyAdapter = new MockStudioCanvasAdapter({
    initialImage: null,
    initialOriginalImage: null,
  });
  registerStudioWebMCPTools(context, emptyAdapter);

  // apply_filter with empty canvas
  await assert.rejects(
    async () => context.executeTool("apply_filter", { tool: "grayscale_image" }),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "image");
      return true;
    }
  );

  // crop_canvas with empty canvas
  await assert.rejects(
    async () => context.executeTool("crop_canvas", { width: 100, height: 100 }),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "image");
      return true;
    }
  );

  // build_filter_pipeline with empty canvas
  await assert.rejects(
    async () => context.executeTool("build_filter_pipeline", { operations: [{ tool: "grayscale_image" }] }),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "image");
      return true;
    }
  );

  // export_canvas_image with empty canvas
  await assert.rejects(
    async () => context.executeTool("export_canvas_image", {}),
    (err: any) => {
      assert.equal(err.name, "WebMCPValidationError");
      assert.equal(err.field, "image");
      return true;
    }
  );
});

test("webmcp-m2: [15.15] Adapter Runtime Error Wrapping: unhandled adapter error is wrapped in WebMCPExecutionError", async () => {
  const context = new ModelContextPolyfill();
  const failingAdapter = new MockStudioCanvasAdapter({
    simulateErrorOnTool: "blur_image",
  });
  registerStudioWebMCPTools(context, failingAdapter);

  await assert.rejects(
    async () => context.executeTool("apply_filter", { tool: "blur_image" }),
    (err: any) => {
      assert.equal(err.name, "WebMCPExecutionError");
      assert.equal(err.toolName, "apply_filter");
      assert.ok(err.message.includes("Simulated engine failure"));
      return true;
    }
  );
});

test("webmcp-m2: [15.16] inspect_image: returns hasImage: false when no image is loaded in canvas", async () => {
  const context = new ModelContextPolyfill();
  const emptyAdapter = new MockStudioCanvasAdapter({
    initialImage: null,
    initialOriginalImage: null,
    initialMetadata: null,
  });
  registerStudioWebMCPTools(context, emptyAdapter);

  const result: StudioInspectionResult = await context.executeTool("inspect_image", {});
  assert.equal(result.hasImage, false);
  assert.equal(result.isModified, false);
  assert.equal(result.dimensions.width, undefined);
  assert.equal(result.dimensions.height, undefined);
});

// ============================================================================
// Suite 16: M2 AbortSignal Cancellation Propagation & Concurrent Scenarios
// ============================================================================

test("webmcp-m2: [16.1] Pre-flight Cancellation: all 8 tools reject immediately with AbortError without invoking adapter", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const controller = new AbortController();
  controller.abort("User cancelled upfront");

  for (const name of EXPECTED_STUDIO_TOOL_NAMES) {
    const params = name === "crop_canvas"
      ? { width: 100, height: 100 }
      : name === "set_comparison_slider"
      ? { position: 50 }
      : name === "build_filter_pipeline"
      ? { operations: [{ tool: "grayscale_image" }] }
      : name === "apply_filter"
      ? { tool: "grayscale_image" }
      : {};

    await assert.rejects(
      async () => context.executeTool(name, params, { signal: controller.signal }),
      (err: any) => {
        assert.equal(err.name, "AbortError");
        return true;
      },
      `Tool "${name}" must reject with AbortError on pre-flight abort`
    );
  }

  // Verify adapter was NEVER called
  assert.equal(adapter.calls.applyFilter.length, 0);
  assert.equal(adapter.calls.cropImage.length, 0);
  assert.equal(adapter.calls.buildPipeline.length, 0);
  assert.equal(adapter.calls.loadPreset.length, 0);
  assert.equal(adapter.calls.setSlider.length, 0);
  assert.equal(adapter.calls.undoAction.length, 0);
  assert.equal(adapter.calls.exportImage.length, 0);
});

test("webmcp-m2: [16.2] In-flight Cancellation for apply_filter: aborting active execution aborts adapter operation", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({ applyFilterDelayMs: 200 });
  registerStudioWebMCPTools(context, adapter);

  let failureEvent: any = null;
  context.addEventListener("toolexecutionfailed", (e: any) => {
    failureEvent = e.detail;
  });

  const controller = new AbortController();
  const promise = context.executeTool(
    "apply_filter",
    { tool: "blur_image", params: { sigma: 5 } },
    { signal: controller.signal }
  );

  setTimeout(() => controller.abort("Filter timeout"), 20);

  await assert.rejects(
    async () => promise,
    (err: any) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );

  assert.ok(failureEvent);
  assert.equal(failureEvent.name, "apply_filter");
  assert.equal(failureEvent.error.name, "AbortError");
});

test("webmcp-m2: [16.3] In-flight Cancellation for load_preset_image: remote load aborts cleanly", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({ loadPresetDelayMs: 200 });
  registerStudioWebMCPTools(context, adapter);

  const controller = new AbortController();
  const promise = context.executeTool(
    "load_preset_image",
    { preset_index: 0 },
    { signal: controller.signal }
  );

  setTimeout(() => controller.abort("User changed preset"), 20);

  await assert.rejects(
    async () => promise,
    (err: any) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );
});

test("webmcp-m2: [16.4] Signal Forwarding: options.signal is passed directly into adapter mutation methods", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter();
  registerStudioWebMCPTools(context, adapter);

  const controller = new AbortController();
  const signal = controller.signal;

  await context.executeTool("apply_filter", { tool: "grayscale_image" }, { signal });
  assert.equal(adapter.calls.applyFilter[0].signal, signal);

  await context.executeTool("crop_canvas", { width: 200, height: 200 }, { signal });
  assert.equal(adapter.calls.cropImage[0].signal, signal);

  await context.executeTool("build_filter_pipeline", { operations: [{ tool: "blur_image" }] }, { signal });
  assert.equal(adapter.calls.buildPipeline[0].signal, signal);

  await context.executeTool("load_preset_image", { preset_index: 2 }, { signal });
  assert.equal(adapter.calls.loadPreset[0].signal, signal);
});

test("webmcp-m2: [16.5] High Concurrency Isolation: 20 simultaneous tool calls with alternating aborts", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({ applyFilterDelayMs: 40 });
  registerStudioWebMCPTools(context, adapter);

  const tasks: Promise<unknown>[] = [];
  const controllers: AbortController[] = [];

  for (let i = 0; i < 20; i++) {
    const c = new AbortController();
    controllers.push(c);
    const p = context.executeTool(
      "apply_filter",
      { tool: "grayscale_image" },
      { signal: c.signal }
    );
    tasks.push(p);

    if (i % 2 === 0) {
      setTimeout(() => c.abort(`Abort #${i}`), 10);
    }
  }

  const results = await Promise.allSettled(tasks);
  assert.equal(results.length, 20);

  let aborted = 0;
  let fulfilled = 0;

  for (const r of results) {
    if (r.status === "rejected") {
      assert.equal((r.reason as Error).name, "AbortError");
      aborted++;
    } else {
      fulfilled++;
    }
  }

  assert.equal(aborted, 10, "10 even indexed executions must be rejected with AbortError");
  assert.equal(fulfilled, 10, "10 odd indexed executions must be fulfilled");
});

test("webmcp-m2: [16.6] DevTools Debug Harness simulateAgentCall operates on all 8 Studio tools", async () => {
  const mockDoc: any = {};
  const mockWin: any = {};
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const origWin = Object.getOwnPropertyDescriptor(globalThis, "window");

  try {
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: mockWin,
      configurable: true,
      writable: true,
    });

    const context = installModelContextPolyfill({ force: true });
    const adapter = new MockStudioCanvasAdapter();
    registerStudioWebMCPTools(context, adapter);

    const harness = mockWin.__WEBMCP_DEBUG__;
    assert.ok(harness);

    const simRes = await harness.simulateAgentCall("inspect_image", { include_history: true });
    assert.equal(simRes.success, true);
    assert.equal(simRes.tool, "inspect_image");
    assert.ok(simRes.result);
    assert.equal(simRes.result.hasImage, true);
  } finally {
    if (origDoc) {
      Object.defineProperty(globalThis, "document", origDoc);
    } else {
      delete (globalThis as any).document;
    }
    if (origWin) {
      Object.defineProperty(globalThis, "window", origWin);
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("webmcp-m2: [16.7] In-flight Cancellation for build_filter_pipeline: pipeline execution aborts cleanly", async () => {
  const context = new ModelContextPolyfill();
  const adapter = new MockStudioCanvasAdapter({ applyFilterDelayMs: 200 });
  registerStudioWebMCPTools(context, adapter);

  const controller = new AbortController();
  const promise = context.executeTool(
    "build_filter_pipeline",
    { operations: [{ tool: "blur_image" }, { tool: "sharpen_image" }] },
    { signal: controller.signal }
  );

  setTimeout(() => controller.abort("Pipeline cancelled"), 15);

  await assert.rejects(
    async () => promise,
    (err: any) => {
      assert.equal(err.name, "AbortError");
      return true;
    }
  );
});


