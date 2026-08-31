import test from "node:test";
import assert from "node:assert/strict";
import {
  composePipelineState,
  StudioCanvasMutationCoordinator,
  type StudioCanvasState,
} from "@/lib/webmcp/studio-mutation-state";

const initialState: StudioCanvasState = {
  originalImage: "original",
  processedImage: null,
  metadata: null,
  executionTimeMs: undefined,
  pipelineSteps: [],
  sliderPos: 50,
  zoom: 1,
};

function resultState(
  coordinator: StudioCanvasMutationCoordinator,
  image: string,
  tool: string,
): StudioCanvasState {
  const current = coordinator.getState();
  return {
    ...current,
    processedImage: image,
    pipelineSteps: [...current.pipelineSteps, { tool, params: {} }],
  };
}

test("undo_last restores the previous committed canvas image and pipeline", async () => {
  const coordinator = new StudioCanvasMutationCoordinator(initialState);

  await coordinator.enqueue(async () => ({
    state: resultState(coordinator, "image-1", "brightness"),
    result: "image-1",
  }));
  await coordinator.enqueue(async () => ({
    state: resultState(coordinator, "image-2", "contrast"),
    result: "image-2",
  }));

  const undo = coordinator.undo("undo_last");

  assert.equal(undo.state.processedImage, "image-1");
  assert.deepEqual(undo.state.pipelineSteps, [{ tool: "brightness", params: {} }]);
  assert.equal(undo.remainingSteps, 1);
  assert.equal(undo.restored, true);
});

test("queued mutations observe the committed output of the preceding mutation", async () => {
  const coordinator = new StudioCanvasMutationCoordinator(initialState);
  let releaseFirst!: () => void;
  const firstFinished = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondInput: string | null = null;

  const first = coordinator.enqueue(async () => {
    await firstFinished;
    return {
      state: resultState(coordinator, "image-1", "brightness"),
      result: "image-1",
    };
  });
  const second = coordinator.enqueue(async () => {
    secondInput = coordinator.getState().processedImage;
    return {
      state: resultState(coordinator, "image-2", "contrast"),
      result: "image-2",
    };
  });

  await Promise.resolve();
  assert.equal(secondInput, null);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(secondInput, "image-1");
  assert.equal(coordinator.getState().processedImage, "image-2");
  assert.equal(coordinator.getState().pipelineSteps.length, 2);
});

test("a canvas reset waits for an in-flight mutation and prevents stale state from winning", async () => {
  const coordinator = new StudioCanvasMutationCoordinator(initialState);
  let releaseFirst!: () => void;
  const firstFinished = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const inFlight = coordinator.enqueue(async () => {
    await firstFinished;
    return {
      state: resultState(coordinator, "stale-output", "brightness"),
      result: "stale-output",
    };
  });
  const reset = coordinator.enqueueReset({
    ...initialState,
    originalImage: "new-original",
  });

  releaseFirst();
  await Promise.all([inFlight, reset]);

  assert.equal(coordinator.getState().originalImage, "new-original");
  assert.equal(coordinator.getState().processedImage, null);
  assert.equal(coordinator.getState().pipelineSteps.length, 0);
  assert.equal(coordinator.undo("undo_last").state.originalImage, "new-original");
});

test("pipeline composition preserves the active canvas image and prior steps", () => {
  const current: StudioCanvasState = {
    ...initialState,
    processedImage: "active-image",
    pipelineSteps: [{ tool: "brightness", params: { amount: 1 } }],
  };

  const composed = composePipelineState(
    current,
    { processedImage: "pipeline-image", metadata: null, executionTimeMs: 22 },
    [{ tool: "contrast", params: { amount: 2 } }],
  );

  assert.equal(composed.processedImage, "pipeline-image");
  assert.deepEqual(composed.pipelineSteps, [
    { tool: "brightness", params: { amount: 1 } },
    { tool: "contrast", params: { amount: 2 } },
  ]);
});

test("undo invalidates an in-flight mutation so its stale result cannot overwrite the restored canvas", async () => {
  const coordinator = new StudioCanvasMutationCoordinator(initialState);
  await coordinator.enqueue(async () => ({
    state: resultState(coordinator, "image-1", "brightness"),
    result: "image-1",
  }));

  let releaseSecond!: () => void;
  const secondFinished = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const inFlight = coordinator.enqueue(async () => {
    await secondFinished;
    return {
      state: resultState(coordinator, "stale-image-2", "contrast"),
      result: "stale-image-2",
    };
  });

  const undo = coordinator.undo("undo_last");
  assert.equal(undo.state.processedImage, null);

  releaseSecond();
  await inFlight;

  assert.equal(coordinator.getState().processedImage, null);
  assert.equal(coordinator.getState().pipelineSteps.length, 0);
});
