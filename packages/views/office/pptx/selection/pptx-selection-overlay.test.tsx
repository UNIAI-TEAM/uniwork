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
    onContextPointerDown: vi.fn(),
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

  it("B4: handles sit on the outline corners, not at a doubled page offset", () => {
    const bounds = { x: 56, y: 175, w: 400, h: 100 };
    const { container } = render(
      <PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={1620} displayHeightPx={911.25} controller={controller({ bounds })} />,
    );
    const outline = container.querySelector("[data-pptx-selection-outline]") as HTMLElement;
    expect(parseFloat(outline.style.left)).toBeCloseTo((56 / 960) * 100, 4);
    expect(parseFloat(outline.style.top)).toBeCloseTo((175 / 540) * 100, 4);
    expect(parseFloat(outline.style.width)).toBeCloseTo((400 / 960) * 100, 4);
    expect(parseFloat(outline.style.height)).toBeCloseTo((100 / 540) * 100, 4);
    // Handles are children of the outline: their offset is a fraction of the outline box.
    const at = (id: string) => container.querySelector(`[data-pptx-handle="${id}"]`) as HTMLElement;
    const pct = (value: string) => parseFloat(/calc\((-?[\d.]+)%/.exec(value)?.[1] ?? "NaN");
    expect(pct(at("nw").style.left)).toBeCloseTo(0, 4);
    expect(pct(at("nw").style.top)).toBeCloseTo(0, 4);
    expect(pct(at("se").style.left)).toBeCloseTo(100, 4);
    expect(pct(at("se").style.top)).toBeCloseTo(100, 4);
    expect(pct(at("n").style.left)).toBeCloseTo(50, 4);
    expect(pct(at("e").style.top)).toBeCloseTo(50, 4);
    expect(pct(at("rotate").style.left)).toBeCloseTo(50, 4);
    expect(pct(at("rotate").style.top)).toBeLessThan(0);
  });

  it("B4: previews and the marquee are drawn in percent of the page", () => {
    const { container } = render(
      <PptxSelectionOverlay
        page={{ widthPx: 960, heightPx: 540 }}
        displayWidthPx={1}
        displayHeightPx={1}
        controller={controller({ previews: [{ sourceId: "a", box: { x: 96, y: 54, w: 192, h: 108 } }], marquee: { x: 480, y: 270, w: 96, h: 54 } })}
      />,
    );
    const preview = container.querySelector("[data-pptx-gesture-preview='a']") as HTMLElement;
    expect(preview.style.left).toBe("10%");
    expect(preview.style.top).toBe("10%");
    expect(preview.style.width).toBe("20%");
    const marquee = container.querySelector("[data-pptx-marquee]") as HTMLElement;
    expect(marquee.style.left).toBe("50%");
    expect(marquee.style.height).toBe("10%");
  });

  it("F-14: a right button press goes to onContextPointerDown without preventing the menu", () => {
    const c = controller({ onContextPointerDown: vi.fn() });
    const { container } = render(<PptxSelectionOverlay page={{ widthPx: 960, heightPx: 540 }} displayWidthPx={960} displayHeightPx={540} controller={c} />);
    const overlay = container.querySelector("[data-pptx-selection-overlay]") as HTMLElement;
    const notPrevented = fireEvent.pointerDown(overlay, { button: 2, clientX: 10, clientY: 10 });
    expect(notPrevented).toBe(true);
    expect(c.onContextPointerDown).toHaveBeenCalledTimes(1);
    expect(c.onPointerDown).not.toHaveBeenCalled();
    fireEvent.pointerDown(overlay, { button: 1, clientX: 10, clientY: 10 });
    expect(c.onContextPointerDown).toHaveBeenCalledTimes(1);
    expect(c.onPointerDown).not.toHaveBeenCalled();
  });
});
