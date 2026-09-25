"use client";

import { useSyncExternalStore } from "react";

/**
 * How many CSS pixels one `rem` is right now. The directory's windowing has to
 * know its row heights in pixels, but the rows themselves are sized in rem so
 * they grow with the reader's text size (WCAG 1.4.4); a height fixed in pixels
 * left a 200% text setting with cards drawn over each other. Re-read on
 * resize, which is when a text-size change reaches an open page.
 */
const BASE = 16;

function read(): number {
  if (typeof window === "undefined") return BASE;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : BASE;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useRemPx(): number {
  return useSyncExternalStore(subscribe, read, () => BASE);
}
