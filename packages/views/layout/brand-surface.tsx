"use client";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The machined-tray container: a translucent outer shell with a hairline, a
 * padded gap, and the real surface seated inside it on concentric corners.
 * Outer radius is the ramp's 3xl; the inner one subtracts the 6px gap so the
 * curves stay parallel.
 */
export function Bezel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-3xl bg-surface/55 p-1.5 ring-1 ring-border/60", className)}>
      <div className="rounded-[calc(var(--radius-3xl)-0.375rem)] bg-surface shadow-floating">{children}</div>
    </div>
  );
}

/** Heavy, damped settle: the curve of the entrance on this screen. */
export const SETTLE = [0.32, 0.72, 0, 1] as const;

/**
 * Rises once on arrival: up from below, out of a blur, into focus, each piece
 * a beat after the one before. The owner chose this slower, softer entrance
 * over the 200ms product default for the signed-out screens (2026-09-17). With
 * reduced motion it is simply there, and `filter` is cleared once settled
 * because a leftover `blur(0px)` is still a filter, and a filtered ancestor
 * becomes the containing block for anything fixed-position inside the form.
 */
export function Rise({ index, children }: { index: number; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 40, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.9, delay: 0.06 + index * 0.09, ease: SETTLE }}
    >
      {children}
    </motion.div>
  );
}
