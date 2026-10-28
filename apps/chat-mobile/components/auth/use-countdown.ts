// Whole seconds left until a deadline, ticking once a second while there are any (core's secondsUntil): the second
// factor's lock, a code that may be mailed again. Zero once it passed, or when there is no deadline.
import { secondsUntil } from "@uniwork/core/auth/sign-in-errors";
import { useEffect, useState } from "react";

const TICK_MS = 1_000;

export function useCountdown(deadlineMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= deadlineMs) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [deadlineMs]);
  return deadlineMs === null ? 0 : secondsUntil(deadlineMs, now);
}
