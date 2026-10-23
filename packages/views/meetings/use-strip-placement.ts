"use client";
import { useLayoutEffect, useState, type RefObject } from "react";
import { stripPlacement } from "./conference-layout";

/** Follows the presentation stage's size and says where its strip belongs. */
export function useStripPlacement(ref: RefObject<HTMLElement | null>, active: boolean): "beside" | "below" {
  const [placement, setPlacement] = useState<"beside" | "below">("beside");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setPlacement(stripPlacement(el.clientWidth, el.clientHeight, rem));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active]);
  return placement;
}
