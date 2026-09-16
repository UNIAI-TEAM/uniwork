"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks once a minute, so "4 phút trước" keeps moving while the
 * inbox sits open instead of freezing until the next refetch. One interval
 * per subscriber is cheap at this cadence; the value only changes when the
 * minute does, so rows do not re-render between ticks.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
