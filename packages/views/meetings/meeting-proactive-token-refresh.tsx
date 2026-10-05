"use client";
import { useRoomContext } from "@livekit/components-react";
import { useEffect, useRef } from "react";
import { applyMeetingRoomToken } from "./meeting-room-token";
import { proactiveTokenRefreshDelayMs, tokenRefreshRetryDelayMs } from "./meeting-token-refresh";

/**
 * Schedules POST /join before the LiveKit JWT expires and patches the token
 * into the connected room engine — no room.connect() remount (preserves chat).
 */
export function MeetingProactiveTokenRefresh({
  expiresAt,
  onRefresh,
}: {
  expiresAt?: string;
  onRefresh: () => Promise<{ token: string; expires_at?: string } | null>;
}) {
  const room = useRoomContext();
  const expiresRef = useRef(expiresAt);
  expiresRef.current = expiresAt;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The token being refreshed; a failed attempt retries against it.
    let currentExpiry = expiresRef.current;
    let cancelled = false;
    const run = (delay: number | null) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (delay == null) return;
      timerRef.current = setTimeout(() => {
        void (async () => {
          const next = await refreshRef.current();
          if (cancelled) return;
          if (!next?.token) {
            run(tokenRefreshRetryDelayMs(currentExpiry));
            return;
          }
          applyMeetingRoomToken(room, next.token);
          currentExpiry = next.expires_at ?? currentExpiry;
          run(proactiveTokenRefreshDelayMs(currentExpiry));
        })();
      }, delay);
    };
    run(proactiveTokenRefreshDelayMs(currentExpiry));
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [room, expiresAt]);

  return null;
}
