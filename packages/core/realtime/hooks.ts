"use client";

import { useEffect } from "react";
import type { WSEventType } from "../types/events";
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
