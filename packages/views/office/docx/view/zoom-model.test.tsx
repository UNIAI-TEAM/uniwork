// UNI-924 A6 (docx-genoffice-parity): the zoom model math and the attachable
// controller (custom property, fit modes, Ctrl+wheel, Ctrl+0).
import { describe, expect, it } from "vitest";
import {
  DOCX_ZOOM_DEFAULT_PERCENT,
  DOCX_ZOOM_MAX_PERCENT,
  DOCX_ZOOM_MIN_PERCENT,
  DOCX_ZOOM_PRESETS,
  clampDocxZoomPercent,
  docxZoomOptions,
  fitDocxZoomPercent,
  stepDocxZoomPercent,
} from "./zoom-model";
import {
  DOCX_ZOOM_DATA_ATTRIBUTE,
  DOCX_ZOOM_STYLE_ELEMENT_ID,
  createDocxZoomController,
  installDocxZoomStyles,
} from "./zoom-controller";
import { DOCX_ZOOM_CSS_VAR, docxZoomFactorOf } from "./zoom-factor";

/** jsdom has no layout: hand the controller a measurable fake element. */
function sizedElement(width: number, height: number): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: height, configurable: true });
  return element;
}

// US Letter at 96 dpi, the shape sectionPageBox produces.
const PAGE = { widthPx: 816, heightPx: 1056 };

describe("DOCX zoom model", () => {
  it("clamps to 50-200 and falls back to 100 for junk", () => {
    expect(clampDocxZoomPercent(10)).toBe(DOCX_ZOOM_MIN_PERCENT);
    expect(clampDocxZoomPercent(500)).toBe(DOCX_ZOOM_MAX_PERCENT);
    expect(clampDocxZoomPercent(100.4)).toBe(100);
    expect(clampDocxZoomPercent(Number.NaN)).toBe(DOCX_ZOOM_DEFAULT_PERCENT);
  });

  it("steps in fixed 10% stops and stops at the range edges", () => {
    expect(stepDocxZoomPercent(100, 1)).toBe(110);
    expect(stepDocxZoomPercent(100, -1)).toBe(90);
    expect(stepDocxZoomPercent(DOCX_ZOOM_MAX_PERCENT, 1)).toBe(DOCX_ZOOM_MAX_PERCENT);
    expect(stepDocxZoomPercent(DOCX_ZOOM_MIN_PERCENT, -1)).toBe(DOCX_ZOOM_MIN_PERCENT);
  });

  it("offers the presets plus the live value when it is not a preset", () => {
    expect(docxZoomOptions(100)).toEqual([...DOCX_ZOOM_PRESETS]);
    expect(docxZoomOptions(137)).toEqual([50, 75, 100, 125, 137, 150, 200]);
  });

  it("fits width to the viewport minus the padding, floored and clamped", () => {
    const base = { availableHeightPx: 1056, pageWidthPx: PAGE.widthPx, pageHeightPx: PAGE.heightPx };
    expect(fitDocxZoomPercent("width", { ...base, availableWidthPx: 848 })).toBe(98);
    expect(fitDocxZoomPercent("width", { ...base, availableWidthPx: 1200 })).toBe(141);
    expect(fitDocxZoomPercent("width", { ...base, availableWidthPx: 4000 })).toBe(DOCX_ZOOM_MAX_PERCENT);
    expect(fitDocxZoomPercent("width", { ...base, availableWidthPx: 300 })).toBe(DOCX_ZOOM_MIN_PERCENT);
  });

  it("fits page to the smaller ratio and refuses unmeasurable boxes", () => {
    const base = { availableWidthPx: 1200, pageWidthPx: PAGE.widthPx, pageHeightPx: PAGE.heightPx };
    expect(fitDocxZoomPercent("page", { ...base, availableHeightPx: 800 })).toBe(71);
    expect(fitDocxZoomPercent("page", { ...base, availableHeightPx: 800, pageWidthPx: 0 })).toBeNull();
    expect(fitDocxZoomPercent("page", { ...base, availableHeightPx: 800, availableWidthPx: 40 })).toBeNull();
    expect(fitDocxZoomPercent("page", { ...base, availableHeightPx: 0 })).toBeNull();
  });
});

describe("DOCX zoom controller", () => {
  it("attaches the zoom property, installs the rule once and reads the factor back", () => {
    installDocxZoomStyles(document);
    const controller = createDocxZoomController();
    const zoomElement = sizedElement(PAGE.widthPx, PAGE.heightPx);
    const scrollElement = sizedElement(848, 900);
    controller.attach({ zoomElement, scrollElement, pageSize: PAGE });

    expect(zoomElement.hasAttribute(DOCX_ZOOM_DATA_ATTRIBUTE)).toBe(true);
    expect(zoomElement.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("1");
    expect(docxZoomFactorOf(zoomElement)).toBe(1);

    controller.setPercent(125);
    expect(zoomElement.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("1.25");
    expect(docxZoomFactorOf(zoomElement)).toBe(1.25);

    const styles = document.querySelectorAll(`#${DOCX_ZOOM_STYLE_ELEMENT_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain("zoom:var(--docx-zoom,1)");
    controller.dispose();
  });

  it("steps, clamps and resets through the public commands", () => {
    const controller = createDocxZoomController();
    const seen: number[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.percent));

    expect(controller.getState()).toEqual({ percent: 100, mode: "manual" });
    controller.zoomIn();
    expect(controller.getState().percent).toBe(110);
    controller.zoomOut();
    controller.zoomOut();
    expect(controller.getState().percent).toBe(90);
    controller.setPercent(500);
    expect(controller.getState().percent).toBe(DOCX_ZOOM_MAX_PERCENT);
    controller.reset();
    expect(controller.getState()).toEqual({ percent: 100, mode: "manual" });
    expect(seen).toEqual([110, 100, 90, 200, 100]);

    unsubscribe();
    controller.setPercent(75);
    expect(seen).toHaveLength(5);
    controller.dispose();
  });

  it("fits to the fake scroll element and refits only while a fit mode is active", () => {
    const controller = createDocxZoomController();
    const zoomElement = document.createElement("div");
    const scrollElement = sizedElement(848, 1056);
    controller.attach({ zoomElement, scrollElement, pageSize: PAGE });

    controller.fit("width");
    expect(controller.getState()).toEqual({ percent: 98, mode: "fit-width" });

    Object.defineProperty(scrollElement, "clientWidth", { value: 2000, configurable: true });
    controller.setPageSize(PAGE);
    expect(controller.getState()).toEqual({ percent: 200, mode: "fit-width" });

    controller.setPercent(100);
    Object.defineProperty(scrollElement, "clientWidth", { value: 848, configurable: true });
    controller.setPageSize(PAGE);
    expect(controller.getState()).toEqual({ percent: 100, mode: "manual" });
    controller.dispose();
  });

  it("zooms with Ctrl+wheel, resets with Ctrl+0, and leaves plain wheel alone", () => {
    const controller = createDocxZoomController();
    const zoomElement = document.createElement("div");
    const scrollElement = document.createElement("div");
    controller.attach({ zoomElement, scrollElement, pageSize: PAGE });

    const wheelIn = new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, cancelable: true });
    scrollElement.dispatchEvent(wheelIn);
    expect(wheelIn.defaultPrevented).toBe(true);
    expect(controller.getState().percent).toBe(110);

    const wheelOut = new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, cancelable: true });
    scrollElement.dispatchEvent(wheelOut);
    expect(controller.getState().percent).toBe(100);

    const plain = new WheelEvent("wheel", { deltaY: -120, cancelable: true });
    scrollElement.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(controller.getState().percent).toBe(100);

    controller.setPercent(150);
    const reset = new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true });
    scrollElement.dispatchEvent(reset);
    expect(reset.defaultPrevented).toBe(true);
    expect(controller.getState().percent).toBe(100);
    controller.dispose();
  });

  it("detaches listeners and the property, and ignores events afterwards", () => {
    const controller = createDocxZoomController();
    const zoomElement = document.createElement("div");
    const scrollElement = document.createElement("div");
    controller.attach({ zoomElement, scrollElement, pageSize: PAGE });
    controller.setPercent(125);

    controller.detach();
    expect(zoomElement.hasAttribute(DOCX_ZOOM_DATA_ATTRIBUTE)).toBe(false);
    expect(zoomElement.style.getPropertyValue(DOCX_ZOOM_CSS_VAR)).toBe("");
    expect(docxZoomFactorOf(zoomElement)).toBe(1);

    const wheel = new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, cancelable: true });
    scrollElement.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    // The zoom is a view setting; it survives the surface unmounting.
    expect(controller.getState().percent).toBe(125);
    controller.dispose();
  });

  it("keeps a page size set before the surface attaches", () => {
    const controller = createDocxZoomController();
    // The wiring may learn the page box before it finds the .doc-zoom element.
    controller.setPageSize(PAGE);
    controller.attach({ zoomElement: document.createElement("div"), scrollElement: sizedElement(848, 1056) });
    controller.fit("width");
    expect(controller.getState()).toEqual({ percent: 98, mode: "fit-width" });
    controller.dispose();
  });

  it("reads a missing or malformed factor as 1", () => {
    expect(docxZoomFactorOf(null)).toBe(1);
    expect(docxZoomFactorOf(undefined)).toBe(1);
    const element = document.createElement("div");
    element.style.setProperty(DOCX_ZOOM_CSS_VAR, "nope");
    expect(docxZoomFactorOf(element)).toBe(1);
  });
});
