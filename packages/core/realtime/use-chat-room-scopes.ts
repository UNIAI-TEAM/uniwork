"use client";

import { useEffect, useRef } from "react";
import { WS_SCOPE_CHAT } from "./scopes";
import { useOptionalWS } from "./provider";

function roomKey(roomIds: readonly string[]): string {
  if (roomIds.length === 0) return "";
  return [...roomIds].sort().join(",");
}

/**
 * Subscribe the workspace socket to chat room scopes with incremental
 * diffing so lazy sidebar selection does not churn every frame.
 */
export function useChatRoomScopes(roomIds: readonly string[]): void {
  const client = useOptionalWS()?.client ?? null;
  const key = roomKey(roomIds);
  const activeRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (!client) return;
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
      if (!next.has(id)) client.unsubscribe(WS_SCOPE_CHAT, id);
    }
    activeRef.current = next;
  }, [client, key]);
}
