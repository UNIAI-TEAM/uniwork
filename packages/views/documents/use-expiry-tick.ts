"use client";

import { useEffect, useReducer } from "react";

/**
 * Re-renders the caller when the earliest still-future deadline passes, so a
 * view that compares `Date.now()` with a request's `expires_at` (the pending
 * request the banner shows, the prompt a holder can still answer) lets go of
 * it on time instead of at the next unrelated render. Past and absent
 * deadlines are ignored.
 */
export function useExpiryTick(deadlines: ReadonlyArray<string | null | undefined>): void {
  const [ticks, tick] = useReducer((n: number) => n + 1, 0);
  const key = deadlines.join("|");
  useEffect(() => {
    const now = Date.now();
    const future = key
      .split("|")
      .map((iso) => Date.parse(iso))
      .filter((at) => Number.isFinite(at) && at > now);
    if (future.length === 0) return;
    // setTimeout caps at ~24.8 days; a longer wait re-arms on the next render.
    const wait = Math.min(Math.min(...future) - now + 50, 2_000_000_000);
    const timer = setTimeout(tick, wait);
    return () => clearTimeout(timer);
  }, [key, ticks]);
}
