"use client";

import { cn } from "@uniwork/ui/lib/utils";

/* Staggered pulse, not a bounce: it says "someone is typing" without moving
   the line, and stops entirely under prefers-reduced-motion. */
const DOT_DELAYS = ["[animation-delay:0ms]", "[animation-delay:160ms]", "[animation-delay:320ms]"];

export function SidebarTypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          className={cn("inline-block size-1 rounded-full bg-current opacity-70 motion-safe:animate-pulse", delay)}
        />
      ))}
    </span>
  );
}
