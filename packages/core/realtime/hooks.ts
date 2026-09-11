"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { WSEventType } from "../types/events";
import type { WSConnectionState } from "../api/ws-client";
import { useWS } from "./provider";

type EventHandler = (payload: unknown, actorId?: string, actorType?: string) => void;

/** Subscribe to one realtime event for the life of the component. */
export function useWSEvent(event: WSEventType, handler: EventHandler): void {
  const { client } = useWS();
  useEffect(() => {
    if (!client) return;
    return client.on(event, handler);
  }, [client, event, handler]);
}

/** Run a callback after the socket reconnects — refetch component-local data. */
export function useWSReconnect(callback: () => void): void {
  const { client } = useWS();
  useEffect(() => {
    if (!client) return;
    return client.onReconnect(callback);
  }, [client, callback]);
}

/** Live workspace WebSocket connection state for status banners. */
export function useWSConnectionState(): {
  state: WSConnectionState;
  hasEverConnected: boolean;
  reconnectNow: () => void;
} {
  const { client } = useWS();
  const state = useSyncExternalStore(
    (onStoreChange) => client?.onConnectionStateChange(onStoreChange) ?? (() => {}),
    () => client?.getConnectionState() ?? "disconnected",
    () => "disconnected" as WSConnectionState,
  );
  const hasEverConnected = client?.hasEverConnected() ?? false;
  const reconnectNow = () => client?.reconnectNow();
  return { state, hasEverConnected, reconnectNow };
}
