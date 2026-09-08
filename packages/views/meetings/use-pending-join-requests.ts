"use client";

import { useMemo } from "react";
import { useJoinRequests } from "@uniwork/core/meetings";

export function usePendingJoinRequests(meetingId: string | undefined, enabled = true) {
  const query = useJoinRequests(meetingId ?? "");
  const pending = useMemo(
    () => (query.data ?? []).filter((r) => r.status === "PENDING"),
    [query.data],
  );
  return {
    ...query,
    pending,
    count: pending.length,
    enabled: enabled && Boolean(meetingId),
  };
}
