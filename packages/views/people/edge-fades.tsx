"use client";

import { useEffect, useState, type RefObject } from "react";
import { cn } from "@uniwork/ui/lib/utils";

export interface HorizontalOverflow {
  left: boolean;
  right: boolean;
}

/**
 * Whether a sideways scroller has content hidden past its left and right
 * edges. Re-measured on scroll, when the scroller is resized, and whenever
 * `layoutKey` changes — the content can widen without the box changing size
 * (a column switched on, a chip added).
 */
export function useHorizontalOverflow(
  ref: RefObject<HTMLDivElement | null>,
  layoutKey: string,
): HorizontalOverflow {
  const [state, setState] = useState<HorizontalOverflow>({ left: false, right: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const max = element.scrollWidth - element.clientWidth;
      const next = { left: element.scrollLeft > 1, right: max - element.scrollLeft > 1 };
      setState((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref, layoutKey]);
  return state;
}

/**
 * The edge that has more behind it fades, so something cut off reads as
 * "scroll for more" rather than as the end. Sits in a `relative` parent over
 * the scroller.
 */
export function EdgeFades({ overflow, className }: { overflow: HorizontalOverflow; className?: string }) {
  const fade =
    "pointer-events-none absolute inset-y-0 from-background to-transparent transition-opacity duration-[var(--duration-fast)]";
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(fade, "left-0 w-8 bg-gradient-to-r", overflow.left ? "opacity-100" : "opacity-0", className)}
      />
      <div
        aria-hidden="true"
        className={cn(fade, "right-0 w-10 bg-gradient-to-l", overflow.right ? "opacity-100" : "opacity-0", className)}
      />
    </>
  );
}
