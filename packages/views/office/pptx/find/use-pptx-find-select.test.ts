// UNI-927 X4fix F9 - the find hit intent never selects over the user's own click.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PptxNodeBox } from "../canvas/render-tree";
import { usePptxFindSelect } from "./use-pptx-find-select";

const box = { sourceId: "shape-1" } as PptxNodeBox;

function setup() {
  const selectSlide = vi.fn();
  const select = vi.fn();
  const hook = renderHook(
    ({ slideIndex, ready }: { slideIndex: number; ready: boolean }) =>
      usePptxFindSelect({ slideIndex, selectSlide, boxes: [box], ready, select }),
    { initialProps: { slideIndex: 0, ready: true } },
  );
  return { hook, selectSlide, select };
}

describe("usePptxFindSelect", () => {
  it("moves to the hit's slide and selects its element once that slide is ready", () => {
    const { hook, selectSlide, select } = setup();
    act(() => hook.result.current({ slideIndex: 1, elementId: "shape-1" }));
    expect(selectSlide).toHaveBeenCalledWith(1);
    hook.rerender({ slideIndex: 1, ready: false });
    expect(select).not.toHaveBeenCalled();
    hook.rerender({ slideIndex: 1, ready: true });
    expect(select).toHaveBeenCalledWith(["shape-1"]);
  });

  it("drops the pending hit when the user presses a pointer while the slide builds", () => {
    const { hook, select } = setup();
    act(() => hook.result.current({ slideIndex: 1, elementId: "shape-1" }));
    hook.rerender({ slideIndex: 1, ready: false });
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    hook.rerender({ slideIndex: 1, ready: true });
    expect(select).not.toHaveBeenCalled();
  });

  it("drops the pending hit when the panel reports none (closed)", () => {
    const { hook, select } = setup();
    act(() => hook.result.current({ slideIndex: 1, elementId: "shape-1" }));
    hook.rerender({ slideIndex: 1, ready: false });
    act(() => hook.result.current(null));
    hook.rerender({ slideIndex: 1, ready: true });
    expect(select).not.toHaveBeenCalled();
  });
});
