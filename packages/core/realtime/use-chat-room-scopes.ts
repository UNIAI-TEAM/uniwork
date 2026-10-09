"use client";

import { useEffect, useRef } from "react";
import { LOOKUP_RETRY_DELAYS_MS, WS_SCOPE_CHAT, lookupRetryDelayMs } from "./scopes";
import { useOptionalWS } from "./provider";

function roomKey(roomIds: readonly string[]): string {
  if (roomIds.length === 0) return "";
  return [...roomIds].sort().join(",");
}

type LookupRetry = { attempt: number; timer: ReturnType<typeof setTimeout> | null };

/**
 * Subscribe the workspace socket to chat room scopes with incremental
 * diffing so lazy sidebar selection does not churn every frame. A subscribe
 * the server could not check (`lookup_failed`) is asked again with backoff,
 * as `useMeetingScope` does; a refusal (`forbidden`) is final. Retries stop
 * when the backoff table runs out, so a permanent error the server still
 * reports as a lookup failure does not loop: the next reconnect replays it.
 */
export function useChatRoomScopes(roomIds: readonly string[]): void {
  const client = useOptionalWS()?.client ?? null;
  const key = roomKey(roomIds);
  const activeRef = useRef<Set<string>>(new Set());
  const retriesRef = useRef<Map<string, LookupRetry>>(new Map());

  useEffect(() => {
    if (!client) return;
    const retries = retriesRef.current;
    const stopListening = client.onAny((msg) => {
      const type = msg.type as string;
      if (type !== "subscribe_ack" && type !== "subscribe_error") return;
      const payload = msg.payload as Record<string, unknown> | null | undefined;
      if (payload?.scope !== WS_SCOPE_CHAT || typeof payload.id !== "string") return;
      const roomId = payload.id;
      if (type === "subscribe_ack") {
        retries.delete(roomId);
        return;
      }
      if (payload.error !== "lookup_failed" || !activeRef.current.has(roomId)) return;
      const retry = retries.get(roomId) ?? { attempt: 0, timer: null };
      if (retry.timer !== null || retry.attempt >= LOOKUP_RETRY_DELAYS_MS.length) return;
      retry.timer = setTimeout(() => {
        retry.timer = null;
        if (activeRef.current.has(roomId)) client.subscribe(WS_SCOPE_CHAT, roomId);
      }, lookupRetryDelayMs(retry.attempt));
      retry.attempt += 1;
      retries.set(roomId, retry);
    });
    return () => {
      stopListening();
      for (const retry of retries.values()) {
        if (retry.timer !== null) clearTimeout(retry.timer);
      }
      retries.clear();
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
