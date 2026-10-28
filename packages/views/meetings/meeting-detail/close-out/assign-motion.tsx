"use client";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { NumberFlow } from "@uniwork/ui/components/ui/number-flow";
import { UI_EASE_OUT, UI_EASE_SETTLE } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * A count line ("9 chờ giao · 5 đã giao") whose numbers roll when they change.
 * Assistive tech (and a text query) reads it once, as the plain sentence.
 */
export function Rolling({ text }: { text: string }) {
  const parts = text.split(/(\d+)/);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{parts.map((part, i) => (i % 2 === 1 ? <NumberFlow key={i} value={Number(part)} /> : part))}</span>
    </>
  );
}

/** Pops in .6 → 1.08 → 1 over 360ms (spec "Mặt người, dấu ✓ bật"). */
export const POP: Pick<HTMLMotionProps<"span">, "initial" | "animate" | "transition"> = {
  initial: { scale: 0.6, opacity: 0 },
  animate: { scale: [0.6, 1.08, 1], opacity: 1 },
  transition: { duration: 0.36, ease: UI_EASE_SETTLE },
};

/** A filled success circle whose ✓ draws itself (clip G); `className` sizes the circle. */
export function DrawnCheck({ className }: { className?: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-success-solid text-on-solid", className)}
      {...(reduced ? {} : POP)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-[62%]">
        <motion.path
          d="M20 6 9 17l-5-5"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: 0.12, ease: UI_EASE_OUT }}
        />
      </svg>
    </motion.span>
  );
}

const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

/** The undo's countdown (clip G): a 20px ring that empties over `seconds`; still under reduced motion. */
export function CountdownRing({ seconds }: { seconds: number }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5 -rotate-90">
      <circle cx={10} cy={10} r={RING_R} fill="none" strokeWidth={2} className="stroke-border" />
      <motion.circle
        cx={10}
        cy={10}
        r={RING_R}
        fill="none"
        strokeWidth={2}
        className="stroke-primary"
        strokeDasharray={RING_C}
        initial={{ strokeDashoffset: 0 }}
        animate={{ strokeDashoffset: reduced ? 0 : RING_C }}
        transition={{ duration: seconds, ease: "linear" }}
      />
    </svg>
  );
}
