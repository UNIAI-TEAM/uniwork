/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- the test wrapper mirrors the
   real canvas surface's role=application tab stop so focus can be asserted. */
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxSelectionOverlay } from "./pptx-selection-overlay";
import type { PptxSelectionController } from "./use-pptx-selection";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function controller(overrides: Partial<PptxSelectionController> = {}): PptxSelectionController {
  return {
    selection: { ids: ["a"] },
    bounds: { x: 100, y: 100, w: 200, h: 100 },
    previews: [],
    marquee: null,
    canDelete: true,
    clear: vi.fn(),
    selectAll: vi.fn(),
    deleteSelection: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    ...overrides,
  };
}

describe("PptxSelectionOverlay", () => {
  it("draws the outline, eight resize handles and the rotate grip", () => {
    const { container } = render(<PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={controller()} />);
    expect(container.querySelector("[data-pptx-selection-outline]")).not.toBeNull();
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]) {
      expect(container.querySelector(`[data-pptx-handle="${handle}"]`)).not.toBeNull();
    }
  });

  it("is aria-hidden so it never becomes a second tab stop", () => {
    const { container } = render(<PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={controller()} />);
    expect(container.querySelector("[data-pptx-selection-overlay]")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders live gesture previews and the marquee", () => {
    const { container } = render(
      <PptxSelectionOverlay
        page={{ widthPx: 960, heightPx: 540 }}
        displayWidthPx={960}
        displayHeightPx={540}
        controller={controller({
          previews: [{ sourceId: "a", box: { x: 110, y: 110, w: 200, h: 100 } }],
          marquee: { x: 10, y: 10, w: 50, h: 50 },
        })}
      />,
    );
    expect(container.querySelector("[data-pptx-gesture-preview='a']")).not.toBeNull();
    expect(container.querySelector("[data-pptx-marquee]")).not.toBeNull();
  });

  it("forwards pointer gestures to the controller with page coordinates", () => {
    const c = controller();
    const { container } = render(<PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={c} />);
    const overlay = container.querySelector("[data-pptx-selection-overlay]") as HTMLElement;
    fireEvent.pointerDown(overlay, { button: 0, clientX: 150, clientY: 150 });
    expect(c.onPointerDown).toHaveBeenCalledWith({ x: 0, y: 0 }, false);
    fireEvent.pointerUp(overlay, { button: 0, clientX: 150, clientY: 150 });
    expect(c.onPointerUp).toHaveBeenCalled();
    fireEvent.pointerCancel(overlay);
    expect(c.onPointerCancel).toHaveBeenCalled();
  });

  it("focuses the canvas on pointer-down so the keyboard bindings stay live (F3)", () => {
    const { container } = render(
      <div data-pptx-canvas role="application" aria-label="Slide canvas" tabIndex={0}>
        <PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={controller()} />
      </div>,
    );
    const overlay = container.querySelector("[data-pptx-selection-overlay]") as HTMLElement;
    fireEvent.pointerDown(overlay, { button: 0, clientX: 10, clientY: 10 });
    expect(document.activeElement).toBe(container.querySelector("[data-pptx-canvas]"));
  });

  it("renders no outline when nothing is selected", () => {
    const { container } = render(<PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={controller({ selection: { ids: [] }, bounds: null })} />);
    expect(container.querySelector("[data-pptx-selection-outline]")).toBeNull();
  });
});
