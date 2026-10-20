"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchEmailHubThread } from "@uniwork/core/email-hub/hooks";

const EMAIL_HUB_LIST_PREFETCH_TOP = 5;
const EMAIL_HUB_HOVER_PREFETCH_MS = 50;

/**
 * Warms thread bodies before they are opened: the first few rows and the
 * neighbours of the open one up front, a hovered row after a short dwell.
 * Returns the hover handler for the list.
 */
export function useEmailHubThreadPrefetch(
  wsId: string,
  accountId: string | null,
  selectedId: string | null,
  rows: readonly { id: string }[],
) {
  const qc = useQueryClient();
  const hoverPrefetchTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = hoverPrefetchTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const prefetchThreadHover = useCallback(
    (id: string) => {
      if (!accountId || id === selectedId) return;
      const timers = hoverPrefetchTimers.current;
      const pending = timers.get(id);
      if (pending !== undefined) window.clearTimeout(pending);
      const timer = window.setTimeout(() => {
        timers.delete(id);
        prefetchEmailHubThread(qc, wsId, accountId, id);
      }, EMAIL_HUB_HOVER_PREFETCH_MS);
      timers.set(id, timer);
    },
    [accountId, qc, selectedId, wsId],
  );

  useEffect(() => {
    if (!accountId || rows.length === 0) return;
    const selectedIdx = selectedId ? rows.findIndex((row) => row.id === selectedId) : -1;
    const prefetchIds = new Set<string>();
    for (const row of rows.slice(0, EMAIL_HUB_LIST_PREFETCH_TOP)) {
      prefetchIds.add(row.id);
    }
    if (selectedIdx >= 0) {
      for (const row of rows.slice(Math.max(0, selectedIdx - 1), selectedIdx + 2)) {
        prefetchIds.add(row.id);
      }
    }
    for (const id of prefetchIds) {
      if (id !== selectedId) prefetchEmailHubThread(qc, wsId, accountId, id);
    }
  }, [accountId, rows, qc, wsId, selectedId]);

  return prefetchThreadHover;
}
