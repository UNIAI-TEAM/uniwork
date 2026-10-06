import { describe, expect, it, vi } from "vitest";
import { canStepHistory, stepHistory, type HistoryHandle } from "./history-step";

function handle(overrides: Partial<HistoryHandle> = {}): HistoryHandle & { generation: number } {
  const state = { generation: 0 };
  return Object.assign(state, {
    getDirtyGeneration: () => state.generation,
    undo: vi.fn(() => { state.generation += 1; }),
    redo: vi.fn(() => { state.generation += 1; }),
    ...overrides,
  });
}

describe("canStepHistory", () => {
  it("is false without the step facet", () => {
    expect(canStepHistory(handle({ undo: undefined }), "undo")).toBe(false);
    expect(canStepHistory(handle({ redo: undefined }), "redo")).toBe(false);
  });

  it("follows canUndo/canRedo when the handle reports its depth", () => {
    const subject = handle({ canUndo: () => false, canRedo: () => true });
    expect(canStepHistory(subject, "undo")).toBe(false);
    expect(canStepHistory(subject, "redo")).toBe(true);
  });

  it("treats a handle without depth as able to step", () => {
    expect(canStepHistory(handle(), "undo")).toBe(true);
  });

  it("calls canUndo with the handle as `this`", () => {
    const subject = { ...handle(), depth: 1, canUndo(this: { depth: number }) { return this.depth > 0; } };
    expect(canStepHistory(subject, "undo")).toBe(true);
  });
});

describe("stepHistory", () => {
  it("reports a change only when the generation moved", () => {
    const subject = handle();
    expect(stepHistory(subject, "undo")).toBe(true);
    expect(subject.undo).toHaveBeenCalledTimes(1);
    expect(stepHistory(subject, "redo")).toBe(true);
    expect(subject.redo).toHaveBeenCalledTimes(1);
  });

  it("an empty stack (no generation change) is not a change", () => {
    const subject = handle({ undo: vi.fn(), redo: vi.fn() });
    expect(stepHistory(subject, "undo")).toBe(false);
    expect(stepHistory(subject, "redo")).toBe(false);
    expect(subject.undo).toHaveBeenCalledTimes(1);
  });

  it("does not step when the handle says the stack is empty", () => {
    const subject = handle({ canUndo: () => false });
    expect(stepHistory(subject, "undo")).toBe(false);
    expect(subject.undo).not.toHaveBeenCalled();
    expect(subject.generation).toBe(0);
  });

  it("an asynchronous step reports false; the host's change notify carries the dirty mark", () => {
    const later: Array<() => void> = [];
    const subject = handle({ undo: vi.fn(() => { later.push(() => { subject.generation += 1; }); }) });
    expect(stepHistory(subject, "undo")).toBe(false);
    later.forEach((run) => run());
    expect(subject.generation).toBe(1);
  });
});
