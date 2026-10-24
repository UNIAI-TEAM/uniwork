"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Each frame reveals this share of what is still hidden, so a burst lands in a few hundred milliseconds. */
const CATCH_UP = 10;

/**
 * Streamed text revealed at an even pace: the model's text arrives in bursts every few hundred milliseconds, and this
 * lets the reader watch it being written instead of seeing it jump. Inactive, under reduced motion, or without
 * requestAnimationFrame, the text shows whole. Text that shrinks (a new call) starts again from its first character.
 */
export function useSmoothText(text: string, active: boolean): string {
  const reduce = useReducedMotion() ?? false;
  const smooth = active && !reduce && typeof requestAnimationFrame === "function";
  const [shown, setShown] = useState(text.length);
  const shownRef = useRef(shown);

  useEffect(() => {
    if (!smooth) {
      shownRef.current = text.length;
      setShown(text.length);
      return;
    }
    shownRef.current = Math.min(shownRef.current, text.length);
    let frame = 0;
    const tick = () => {
      const left = text.length - shownRef.current;
      if (left <= 0) return;
      shownRef.current += Math.max(1, Math.ceil(left / CATCH_UP));
      setShown(shownRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, smooth]);

  return smooth ? text.slice(0, Math.min(shown, text.length)) : text;
}
