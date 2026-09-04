"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Meeting } from "../types/meeting";
import { meetingKeys } from "../meetings/hooks";

const DEBOUNCE_MS = 250;

/** Debounced, coalesced query invalidation for WS bursts. */
export function createInvalidateScheduler(qc: QueryClient) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    for (const key of pending.values()) {
      void qc.invalidateQueries({ queryKey: key });
    }
    pending.clear();
  };

  return {
    schedule(queryKey: QueryKey) {
      pending.set(JSON.stringify(queryKey), queryKey);
      if (timer != null) return;
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
    dispose() {
      if (timer != null) clearTimeout(timer);
      pending.clear();
      timer = null;
    },
  };
}

/** Skip stale meeting detail refetches when the event version is not newer. */
export function shouldInvalidateMeetingDetail(
  qc: QueryClient,
  meetingId: string,
  eventVersion: string | undefined,
): boolean {
  if (!eventVersion) return true;
  const parsed = Number.parseInt(eventVersion, 10);
  if (!Number.isFinite(parsed)) return true;
  const cached = qc.getQueryData<Meeting>(meetingKeys.detail(meetingId));
  if (cached?.version == null) return true;
  return parsed > cached.version;
}
