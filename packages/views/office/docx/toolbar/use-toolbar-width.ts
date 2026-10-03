import { useEffect, useState, type RefObject } from "react";

/** Window width assumed when nothing can be measured (no DOM yet). */
const FALLBACK_WIDTH = Number.POSITIVE_INFINITY;

/** The command strip's width, so the shell can collapse low-priority groups.
 * A layout-less DOM (jsdom/qt) measures 0, which falls back to innerWidth. */
export function useToolbarWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? FALLBACK_WIDTH : window.innerWidth));
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : typeof window === "undefined" ? FALLBACK_WIDTH : window.innerWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [ref]);
  return width;
}
