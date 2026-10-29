// Whole seconds left until a deadline, ticking once a second while there are any (core's secondsUntil): the second
// factor's lock, a code that may be mailed again. Zero once it passed, or when there is no deadline. A new deadline
// is counted from the moment it arrives, not from the last tick (which may be minutes old on a screen left open), so
// its first frame never flashes a wait it does not have.
import { secondsUntil } from "@uniwork/core/auth/sign-in-errors";
import { useEffect, useState } from "react";

const TICK_MS = 1_000;

export function useCountdown(deadlineMs: number | null): number {
  const [clock, setClock] = useState(() => ({ deadlineMs, now: Date.now() }));
  let { now } = clock;
  if (clock.deadlineMs !== deadlineMs) {
    now = Date.now();
    setClock({ deadlineMs, now });
  }
  useEffect(() => {
    if (deadlineMs === null) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setClock({ deadlineMs, now: at });
      if (at >= deadlineMs) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [deadlineMs]);
  return deadlineMs === null ? 0 : secondsUntil(deadlineMs, now);
}
