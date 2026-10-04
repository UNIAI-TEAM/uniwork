import { useEffect, useLayoutEffect, useState } from "react";

/** Width assumed when nothing can be measured (SSR, a DOM without layout or
 * ResizeObserver such as jsdom): lay the ribbon out at full size. */
const UNMEASURED = Number.POSITIVE_INFINITY;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The content width of the ribbon body, tracked with a ResizeObserver. A
 * zero width (no layout engine) reads as unmeasured. */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(UNMEASURED);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") {
      setWidth(UNMEASURED);
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? element.clientWidth;
      setWidth(measured > 0 ? measured : UNMEASURED);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/**
 * Corrects the label-length estimate against the rendered row: while the row
 * still overflows (scrollWidth > clientWidth) it asks for one more collapse
 * step, up to `maxSteps`. The correction resets whenever the width changes.
 * Without a layout engine both widths are 0 and nothing happens.
 */
export function useOverflowCorrection(
  element: HTMLElement | null,
  width: number,
  maxSteps: number,
  layoutKey: string,
): number {
  const [correction, setCorrection] = useState({ width, extra: 0 });
  const extra = correction.width === width ? correction.extra : 0;
  useIsoLayoutEffect(() => {
    if (!element || !Number.isFinite(width)) return;
    if (element.scrollWidth > element.clientWidth + 1 && extra < maxSteps) {
      setCorrection({ width, extra: extra + 1 });
    }
  }, [element, width, extra, maxSteps, layoutKey]);
  return extra;
}
