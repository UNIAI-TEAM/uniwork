"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const FADE = "1.5rem";

/**
 * For a strip that scrolls sideways with its scrollbar hidden: whether more
 * sits past either edge, and a mask that fades that edge, so a phone reader
 * sees there is another chip to swipe to instead of assuming the row ends.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const style: CSSProperties | undefined =
    edges.start || edges.end
      ? {
          maskImage: `linear-gradient(to right, ${edges.start ? "transparent" : "black"}, black ${FADE}, black calc(100% - ${FADE}), ${edges.end ? "transparent" : "black"})`,
        }
      : undefined;

  return { ref, style, edges };
}
