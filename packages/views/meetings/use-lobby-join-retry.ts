"use client";

import { useEffect, useRef } from "react";
import type { WSMessage } from "@uniwork/core/api";
import { useOptionalMeetingLobbyWS, useOptionalWS } from "@uniwork/core/realtime";
import {
  isLobbyWaiting,
  lobbyRetryDelayMs,
  lobbyWsTriggerJitterMs,
  shouldTriggerLobbyJoin,
} from "./room-connection";

/**
 * Event-driven lobby admission: retry POST /join when the host starts or a
 * join request is approved. Falls back to exponential backoff only when the
 * workspace WebSocket is not authenticated (disconnected).
 */
export function useLobbyJoinRetry({
  meetingId,
  decision,
  admitted,
  hasJoinError,
  onRetry,
}: {
  meetingId: string;
  decision: string | undefined;
  admitted: boolean;
  /** Transient transport errors should not stop WS-driven retries. */
  hasJoinError: boolean;
  onRetry: () => void;
}): void {
  const workspaceWS = useOptionalWS();
  const lobbyWS = useOptionalMeetingLobbyWS();
  const client = workspaceWS?.client ?? lobbyWS?.client ?? null;
  const attemptRef = useRef(0);
  const waiting = isLobbyWaiting(decision) && !admitted && !hasJoinError;

  useEffect(() => {
    if (!waiting) {
      attemptRef.current = 0;
    }
  }, [waiting]);

  useEffect(() => {
    if (!waiting || !client) return;

    const onEvent = (msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      if (!shouldTriggerLobbyJoin(msg.type, payload, meetingId)) return;
      attemptRef.current = 0;
      window.setTimeout(onRetry, lobbyWsTriggerJitterMs());
    };

    const offAny = client.onAny(onEvent);
    const offReconnect = client.onReconnect(() => {
      attemptRef.current = 0;
      onRetry();
    });
    return () => {
      offAny();
      offReconnect();
    };
  }, [waiting, client, meetingId, onRetry]);

  useEffect(() => {
    if (!waiting) return;
    const providerPreparing = decision === "WAITING_FOR_PROVIDER";
    if (!providerPreparing && client?.isAuthenticated()) return;

    const delay = lobbyRetryDelayMs(attemptRef.current);
    const id = window.setTimeout(() => {
      attemptRef.current += 1;
      onRetry();
    }, delay);
    return () => window.clearTimeout(id);
  }, [waiting, client, decision, meetingId, onRetry]);
}
