"use client";

import { useMemo } from "react";
import { useNow as useSharedNow } from "../meetings/use-now";

/**
 * A clock that ticks once a minute, so "4 phút trước" keeps moving while the
 * inbox sits open instead of freezing until the next refetch. Every row reads
 * the one shared clock (meetings/use-now), so a long inbox runs one timer,
 * not one per row, and all rows move on the same tick.
 */
export function useNow(intervalMs = 60_000): Date {
  const ms = useSharedNow(intervalMs);
  return useMemo(() => new Date(ms), [ms]);
}
