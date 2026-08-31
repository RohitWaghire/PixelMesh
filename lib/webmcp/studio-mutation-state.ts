import type { ImageMetadata } from "../image/types";

export interface StudioCanvasPipelineStep {
  tool: string;
  params: Record<string, any>;
}

export interface StudioCanvasState {
  originalImage: string | null;
  processedImage: string | null;
  metadata: ImageMetadata | null;
  executionTimeMs?: number;
  pipelineSteps: StudioCanvasPipelineStep[];
  sliderPos: number;
  zoom: number;
}

export interface StudioCanvasUndoResult {
  state: StudioCanvasState;
  remainingSteps: number;
  restored: boolean;
}

interface CommittedMutation<T> {
  state: StudioCanvasState;
  result: T;
}

export interface StudioCanvasMutationOptions {
  resetHistory?: boolean;
}

function cloneState(state: StudioCanvasState): StudioCanvasState {
  return {
    ...state,
    pipelineSteps: state.pipelineSteps.map((step) => ({
      tool: step.tool,
      params: { ...step.params },
    })),
  };
}

export function composePipelineState(
  current: StudioCanvasState,
  result: Pick<StudioCanvasState, "processedImage" | "metadata" | "executionTimeMs">,
  operations: Array<{ tool: string; params?: Record<string, any> }>,
): StudioCanvasState {
  return {
    ...current,
    ...result,
    pipelineSteps: [
      ...current.pipelineSteps,
      ...operations.map((operation) => ({
        tool: operation.tool,
        params: { ...(operation.params || {}) },
      })),
    ],
  };
}

/**
 * Coordinates Studio canvas state across asynchronous mutations.
 *
 * Each mutation runs after the previous mutation commits, so its input is
 * always the latest active image. Successful mutations become undo snapshots;
 * failed mutations leave the current snapshot untouched.
 */
export class StudioCanvasMutationCoordinator {
  private current: StudioCanvasState;
  private baseline: StudioCanvasState;
  private history: StudioCanvasState[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(initialState: StudioCanvasState) {
    this.current = cloneState(initialState);
    this.baseline = cloneState(initialState);
  }

  getState(): StudioCanvasState {
    return cloneState(this.current);
  }

  update(patch: Partial<StudioCanvasState>): StudioCanvasState {
    this.current = cloneState({ ...this.current, ...patch });
    return this.getState();
  }

  reset(nextState: StudioCanvasState): StudioCanvasState {
    this.current = cloneState(nextState);
    this.baseline = cloneState(nextState);
    this.history = [];
    return this.getState();
  }

  enqueueReset(nextState: StudioCanvasState): Promise<void> {
    return this.enqueue(
      async () => ({ state: nextState, result: undefined }),
      { resetHistory: true },
    );
  }

  enqueue<T>(
    mutation: () => Promise<CommittedMutation<T>>,
    options: StudioCanvasMutationOptions = {},
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const committed = await mutation();
      if (options.resetHistory) {
        this.reset(committed.state);
      } else {
        this.current = cloneState(committed.state);
        this.history.push(this.getState());
      }
      return committed.result;
    });

    // A failed mutation must not prevent later queued mutations from running.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  undo(action: "undo_last" | "reset_all"): StudioCanvasUndoResult {
    if (action === "reset_all") {
      this.history = [];
      this.current = cloneState(this.baseline);
      return {
        state: this.getState(),
        remainingSteps: 0,
        restored: true,
      };
    }

    this.history.pop();
    this.current = cloneState(this.history.at(-1) ?? this.baseline);
    return {
      state: this.getState(),
      remainingSteps: this.history.length,
      restored: true,
    };
  }
}
