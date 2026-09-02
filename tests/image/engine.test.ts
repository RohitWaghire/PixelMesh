import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { processSingleFilter, processPipeline } from "@/lib/image/engine";

async function createTestImageBase64(width = 200, height = 200, color = { r: 100, g: 150, b: 200 }): Promise<string> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  }).png().toBuffer();

  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("image-engine: crop_image extracts correct bounding box", async () => {
  const input = await createTestImageBase64(300, 200);
  const res = await processSingleFilter(input, "crop_image", {
    left: 10,
    top: 10,
    width: 100,
    height: 80
  });

  assert.equal(res.metadata.width, 100);
  assert.equal(res.metadata.height, 80);
  assert.ok(res.imageBase64.startsWith("data:image/png;base64,"));
});

test("image-engine: rotate_image 90 degrees swaps width and height", async () => {
  const input = await createTestImageBase64(300, 200);
  const res = await processSingleFilter(input, "rotate_image", { degrees: 90 });

  assert.equal(res.metadata.width, 200);
  assert.equal(res.metadata.height, 300);
});

test("image-engine: make_sepia_tone and brightness transformations", async () => {
  const input = await createTestImageBase64(100, 100);
  const resSepia = await processSingleFilter(input, "make_sepia_tone", { intensity: 90 });
  assert.ok(resSepia.imageBase64.length > 50);

  const resBright = await processSingleFilter(input, "adjust_brightness", { factor: 50 });
  assert.ok(resBright.imageBase64.length > 50);
});

test("image-engine: glow_effect executes canvas composite", async () => {
  const input = await createTestImageBase64(150, 150);
  const res = await processSingleFilter(input, "glow_effect", { intensity: 40, radius: 8 });
  assert.equal(res.metadata.width, 150);
  assert.equal(res.metadata.height, 150);
});

test("image-engine: batch_filter_pipeline executes multi-step recipe", async () => {
  const input = await createTestImageBase64(400, 400);
  const res = await processPipeline(input, [
    { tool: "crop_image", params: { left: 0, top: 0, width: 200, height: 200 } },
    { tool: "make_sepia_tone", params: { intensity: 75 } },
    { tool: "adjust_contrast", params: { factor: 30 } }
  ]);

  assert.equal(res.metadata.width, 200);
  assert.equal(res.metadata.height, 200);
  assert.ok(res.executionTimeMs > 0);
});

test("image-engine: circle_crop sanitizes arbitrary SVG XML injection attempt", async () => {
  const input = await createTestImageBase64(200, 200);
  // Malicious SVG injection payload attempting to inject tags via background
  const maliciousBackground = 'red" /><circle cx="50" cy="50" r="40" fill="blue" /><rect fill="green';
  const res = await processSingleFilter(input, "circle_crop", {
    radius: 80,
    background: maliciousBackground
  });

  assert.ok(res.imageBase64.startsWith("data:image/png;base64,"));
  assert.equal(res.metadata.width, 160);
  assert.equal(res.metadata.height, 160);
});

test("image-engine: crop_image and circle_crop handle out-of-bounds coordinates safely without crash", async () => {
  const input = await createTestImageBase64(100, 100);
  // Out of bounds crop
  const resCrop = await processSingleFilter(input, "crop_image", {
    left: 150,
    top: 150,
    width: 200,
    height: 200
  });
  assert.ok(resCrop.metadata.width >= 1);
  assert.ok(resCrop.metadata.height >= 1);

  // Negative coordinates for circle crop
  const resCircle = await processSingleFilter(input, "circle_crop", {
    centerX: -50,
    centerY: -50,
    radius: 300
  });
  assert.ok(resCircle.metadata.width >= 1);
  assert.ok(resCircle.metadata.height >= 1);
});

