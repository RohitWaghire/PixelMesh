import assert from "node:assert/strict";
import test from "node:test";
import { canCallTool, declaredInputBytes, hasImageInput, toolCost } from "@/lib/mcp/tool-policy";

test("tool policy: enforces explicit and category scopes", () => {
  assert.equal(canCallTool(["geometry:*"], "crop_image"), true);
  assert.equal(canCallTool(["geometry:*"], "adjust_brightness"), false);
  assert.equal(canCallTool(["filters:*"], "adjust_brightness"), true);
  assert.equal(canCallTool(["filters:*"], "export_image"), false);
});

test("tool policy: detects image inputs and computes billing classes", () => {
  assert.equal(hasImageInput({ image_key: "source.png" }), true);
  assert.equal(hasImageInput({}), false);
  assert.equal(declaredInputBytes({ image_base64: "x".repeat(21) }), 21);
  assert.equal(toolCost("get_image_metadata", 50 * 1024 * 1024), 0);
  assert.equal(toolCost("crop_image", 21 * 1024 * 1024), 5);
  assert.equal(toolCost("batch_filter_pipeline", 1024), 3);
});
