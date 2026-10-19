// Ported from packages/core/realtime/use-chat-room-scopes.ts + scopes.ts (web
// hooks are not on the mobile allowlist, ADR 0011); keep the two in parity.
import { useEffect, useRef } from "react";
import { useWSClient } from "./realtime-provider";

/** Realtime scope type the server accepts on subscribe frames for chat rooms. */
const WS_SCOPE_CHAT = "chat" as const;

/**
 * Backoff before asking again for a scope the server could not authorize
 * (`lookup_failed`: its database check timed out or failed). Without a retry
 * the screen would stay deaf to its own events until the socket reconnects,
 * which is exactly when the server is busiest.
 */
export const LOOKUP_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export function lookupRetryDelayMs(attempt: number): number {
  const base = LOOKUP_RETRY_DELAYS_MS[Math.min(attempt, LOOKUP_RETRY_DELAYS_MS.length - 1)]!;
  // ±20 % jitter so scopes that failed together do not retry together.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function roomKey(roomIds: readonly string[]): string {
  return [...roomIds].sort().join(",");
}

type LookupRetry = { attempt: number; timer: ReturnType<typeof setTimeout> | null };

/**
 * Subscribe the workspace socket to chat room scopes with incremental
 * diffing so lazy room selection does not churn every frame. A subscribe
 * the server could not check (`lookup_failed`) is asked again with backoff;
 * a refusal (`forbidden`) is final. Retries stop when the backoff table
 * runs out, so a permanent error the server still reports as a lookup
 * failure does not loop: the next reconnect replays it. The client caps
 * chat scopes at DEFAULT_CHAT_SCOPE_LIMIT (25); callers pick which rooms.
 */
export function useChatScopes(roomIds: readonly string[]): void {
  const client = useWSClient();
  const key = roomKey(roomIds);
  const activeRef = useRef<Set<string>>(new Set());
  const retriesRef = useRef<Map<string, LookupRetry>>(new Map());

  useEffect(() => {
    if (!client) return;
    const retries = retriesRef.current;
    const clearRetries = () => {
      for (const retry of retries.values()) {
        if (retry.timer !== null) clearTimeout(retry.timer);
      }
      retries.clear();
    };
    // A new connection replays every scope: its lookup failures get the full backoff again.
    const stopReconnect = client.onReconnect(clearRetries);
    const stopListening = client.onAny((msg) => {
      if (msg.type !== "subscribe_ack" && msg.type !== "subscribe_error") return;
      const payload = msg.payload as Record<string, unknown> | null | undefined;
      if (payload?.scope !== WS_SCOPE_CHAT || typeof payload.id !== "string") return;
      const roomId = payload.id;
      if (msg.type === "subscribe_ack") {
        retries.delete(roomId);
        return;
      }
      if (payload.error !== "lookup_failed" || !activeRef.current.has(roomId)) return;
      const retry = retries.get(roomId) ?? { attempt: 0, timer: null };
      if (retry.timer !== null || retry.attempt >= LOOKUP_RETRY_DELAYS_MS.length) return;
      // The effect below clears this timer when the room leaves the set.
      retry.timer = setTimeout(() => {
        retry.timer = null;
        client.subscribe(WS_SCOPE_CHAT, roomId);
      }, lookupRetryDelayMs(retry.attempt));
      retry.attempt += 1;
      retries.set(roomId, retry);
    });
    return () => {
      stopListening();
      stopReconnect();
      clearRetries();
      for (const id of activeRef.current) {
        client.unsubscribe(WS_SCOPE_CHAT, id);
      }
      activeRef.current = new Set();
    };
  }, [client]);

  useEffect(() => {
    if (!client) {
      activeRef.current = new Set();
      return;
    }

    const next = new Set(key ? key.split(",") : []);
    const prev = activeRef.current;

    for (const id of next) {
      if (!prev.has(id)) client.subscribe(WS_SCOPE_CHAT, id);
    }
    for (const id of prev) {
      if (next.has(id)) continue;
      client.unsubscribe(WS_SCOPE_CHAT, id);
      const retry = retriesRef.current.get(id);
      if (retry?.timer != null) clearTimeout(retry.timer);
      retriesRef.current.delete(id);
    }
    activeRef.current = next;
  }, [client, key]);
}
