"use client";
import { useRoomContext } from "@livekit/components-react";
import { useEffect, useRef } from "react";
import { applyMeetingRoomToken } from "./meeting-room-token";
import { proactiveTokenRefreshDelayMs } from "./meeting-token-refresh";

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
    const schedule = (iso?: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const delay = proactiveTokenRefreshDelayMs(iso);
      if (delay == null) return;
      timerRef.current = setTimeout(() => {
        void (async () => {
          const next = await refreshRef.current();
          if (!next?.token) {
            schedule(expiresRef.current);
            return;
          }
          applyMeetingRoomToken(room, next.token);
          schedule(next.expires_at ?? expiresRef.current);
        })();
      }, delay);
    };
    schedule(expiresRef.current);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [room, expiresAt]);

  return null;
}
