import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Width assumed when nothing can be measured (SSR, a DOM without layout or
 * ResizeObserver such as jsdom): lay the ribbon out at full size. */
const UNMEASURED = Number.POSITIVE_INFINITY;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The content width of the ribbon body, tracked with a ResizeObserver and a
 * layout fallback. A zero width (no layout engine) reads as unmeasured, and an
 * unmeasured width lays the body out at its declared size: groups, captions and
 * icons all visible. The layout fallback reads the rendered width after commit
 * and once more on the next frame, so a host that never fires ResizeObserver
 * (Electron before the first layout pass, a DOM without one) still measures
 * instead of staying collapsed.
 */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(UNMEASURED);
  // True once the observer reported a positive width; the layout fallback
  // yields to it so a stale frame read cannot clobber the real measurement.
  const observed = useRef(false);

  // The layout fallback is declared first so its per-element reset runs before
  // the observer can report a width; a synchronous ResizeObserver callback (the
  // test stub) then wins the flag for the same element.
  useIsoLayoutEffect(() => {
    if (!element) {
      observed.current = false;
      setWidth(UNMEASURED);
      return undefined;
    }
    observed.current = false;
    const read = () => {
      if (observed.current) return;
      const measured = element.clientWidth;
      if (measured > 0) setWidth(measured);
    };
    read();
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(read) : 0;
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [element]);

  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? element.clientWidth;
      if (measured > 0) {
        observed.current = true;
        setWidth(measured);
      } else if (!observed.current) {
        setWidth(UNMEASURED);
      }
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
