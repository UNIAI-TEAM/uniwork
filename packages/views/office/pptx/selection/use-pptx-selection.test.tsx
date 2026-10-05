import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxNodeBox } from "../canvas/render-tree";
import { box } from "../canvas/pptx-render-fixtures";
import { usePptxSelection, type PptxSelectionController } from "./use-pptx-selection";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function nodes(): PptxNodeBox[] {
  return [
    { sourceId: "a", type: "shape", box: box({ x: 100, y: 100, w: 100, h: 100 }) },
    { sourceId: "b", type: "shape", box: box({ x: 300, y: 100, w: 100, h: 100 }) },
  ];
}

interface HarnessOptions {
  commitTransform?: (request: unknown) => Promise<unknown>;
  deleteElements?: (slideIndex: number, ids: readonly string[]) => Promise<unknown>;
  onDeleteCommitted?: () => void;
}

function harness(options: HarnessOptions = {}) {
  const controller = { current: null as PptxSelectionController | null };
  function Probe() {
    controller.current = usePptxSelection({
      slideIndex: 0,
      boxes: nodes(),
      page: { widthPx: 960, heightPx: 540 },
      fitWidthPx: 960,
      scale: 1,
      interactive: true,
      ...(options.commitTransform ? { commitTransform: options.commitTransform as never } : {}),
      ...(options.deleteElements ? { deleteElements: options.deleteElements } : {}),
      ...(options.onDeleteCommitted ? { onDeleteCommitted: options.onDeleteCommitted } : {}),
    });
    return null;
  }
  render(<Probe />);
  return controller;
}

describe("usePptxSelection", () => {
  it("selects on click and clears on empty canvas", () => {
    const controller = harness();
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    expect(controller.current!.selection.ids).toEqual(["a"]);
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.bounds).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    act(() => controller.current!.onPointerDown({ x: 800, y: 500 }, false));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual([]);
  });

  it("adds with shift-click and removes with a second shift-click", () => {
    const controller = harness();
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a", "b"]);
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a"]);
  });

  it("marquee-selects on a drag from empty canvas", () => {
    const controller = harness();
    act(() => controller.current!.onPointerDown({ x: 50, y: 50 }, false));
    expect(controller.current!.marquee).toEqual({ x: 50, y: 50, w: 0, h: 0 });
    act(() => controller.current!.onPointerMove({ x: 250, y: 250 }, false));
    expect(controller.current!.marquee).toEqual({ x: 50, y: 50, w: 200, h: 200 });
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a"]);
    expect(controller.current!.marquee).toBeNull();
  });

  it("commits exactly one transform per gesture, never one per move", async () => {
    const commitTransform = vi.fn(async () => undefined);
    const onDeleteCommitted = vi.fn();
    const controller = harness({ commitTransform, onDeleteCommitted });
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerMove({ x: 160, y: 140 }, false));
    act(() => controller.current!.onPointerMove({ x: 170, y: 130 }, false));
    act(() => controller.current!.onPointerMove({ x: 180, y: 120 }, false));
    expect(commitTransform).not.toHaveBeenCalled();
    await act(async () => { controller.current!.onPointerUp(); await Promise.resolve(); });
    expect(commitTransform).toHaveBeenCalledTimes(1);
    expect(commitTransform).toHaveBeenCalledWith(expect.objectContaining({ slideIndex: 0, sourceId: "a", xPx: 130, yPx: 70, wPx: 100, hPx: 100, fitWidthPx: 960 }));
    // The delete channel is not the transform channel: a drag never fires it.
    expect(onDeleteCommitted).not.toHaveBeenCalled();
  });

  it("commits one transform per element on a multi-selection gesture", async () => {
    const commitTransform = vi.fn(async (_request: unknown) => undefined);
    const controller = harness({ commitTransform });
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerMove({ x: 160, y: 150 }, false));
    await act(async () => { controller.current!.onPointerUp(); await Promise.resolve(); });
    expect(commitTransform).toHaveBeenCalledTimes(2);
    expect(commitTransform.mock.calls.map((call) => (call[0] as { sourceId: string }).sourceId)).toEqual(["a", "b"]);
  });

  it("clears selection on Escape via the controller, and deletes when a channel is bound", async () => {
    const deleteElements = vi.fn(async () => undefined);
    const onDeleteCommitted = vi.fn();
    const controller = harness({ deleteElements, onDeleteCommitted });
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.canDelete).toBe(true);
    await act(async () => { controller.current!.deleteSelection(); await Promise.resolve(); });
    expect(deleteElements).toHaveBeenCalledWith(0, ["a"]);
    expect(controller.current!.selection.ids).toEqual([]);
    expect(onDeleteCommitted).toHaveBeenCalledTimes(1);
  });

  it("collapses a click inside a multi-selection onto the clicked element", () => {
    const controller = harness();
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a", "b"]);
    // A click (no movement) on one of the selected elements narrows to it.
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a"]);
  });

  it("does not open a drag on shift-click", () => {
    const commitTransform = vi.fn(async () => undefined);
    const controller = harness({ commitTransform });
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerMove({ x: 400, y: 150 }, true));
    expect(controller.current!.previews).toHaveLength(0);
    act(() => controller.current!.onPointerUp());
    expect(commitTransform).not.toHaveBeenCalled();
  });

  it("reports a refused gesture commit instead of swallowing it", async () => {
    const onError = vi.fn();
    const controller = { current: null as PptxSelectionController | null };
    function Probe() {
      controller.current = usePptxSelection({
        slideIndex: 0,
        boxes: nodes(),
        page: { widthPx: 960, heightPx: 540 },
        fitWidthPx: 960,
        scale: 1,
        interactive: true,
        commitTransform: async () => { throw new Error("refused"); },
        onError,
      });
      return null;
    }
    render(<Probe />);
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerMove({ x: 160, y: 150 }, false));
    await act(async () => { controller.current!.onPointerUp(); await Promise.resolve(); });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("usePptxSelection right-click (F-14)", () => {
  it("selects only the element under the pointer, keeps a selection it is part of, clears on empty canvas", () => {
    const controller = harness();
    act(() => controller.current!.onContextPointerDown({ x: 150, y: 150 }));
    expect(controller.current!.selection.ids).toEqual(["a"]);
    act(() => controller.current!.onContextPointerDown({ x: 350, y: 150 }));
    expect(controller.current!.selection.ids).toEqual(["b"]);
    expect(controller.current!.marquee).toBeNull();
    expect(controller.current!.previews).toEqual([]);
    act(() => controller.current!.onPointerDown({ x: 150, y: 150 }, false));
    act(() => controller.current!.onPointerUp());
    act(() => controller.current!.onPointerDown({ x: 350, y: 150 }, true));
    act(() => controller.current!.onPointerUp());
    expect(controller.current!.selection.ids).toEqual(["a", "b"]);
    act(() => controller.current!.onContextPointerDown({ x: 150, y: 150 }));
    expect(controller.current!.selection.ids).toEqual(["a", "b"]);
    act(() => controller.current!.onContextPointerDown({ x: 800, y: 500 }));
    expect(controller.current!.selection.ids).toEqual([]);
  });
});
