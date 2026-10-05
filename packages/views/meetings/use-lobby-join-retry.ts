"use client";

import { useEffect, useRef } from "react";
import type { WSMessage } from "@uniwork/core/api";
import { useOptionalMeetingLobbyWS, useOptionalWS } from "@uniwork/core/realtime";
import {
  isLobbyWaiting,
  joinErrorRetryDelayMs,
  lobbyRetryDelayMs,
  lobbyWsTriggerJitterMs,
  shouldTriggerLobbyJoin,
} from "./room-connection";

/**
 * Event-driven lobby admission: retry POST /join when the host starts or this
 * client's join request is decided. Falls back to exponential backoff only
 * when the workspace WebSocket is not authenticated (disconnected), and waits
 * out a rate limit (429) or an overloaded server (503) before asking again.
 */
export function useLobbyJoinRetry({
  meetingId,
  decision,
  admitted,
  hasJoinError,
  joinError,
  joinRequestId,
  onRetry,
}: {
  meetingId: string;
  decision: string | undefined;
  admitted: boolean;
  /** Transient transport errors should not stop WS-driven retries. */
  hasJoinError: boolean;
  /** The failed /join; a 429/503 is retried after Retry-After, anything else stops. */
  joinError?: unknown;
  /** This client's own pending request, so someone else's approval does not wake it. */
  joinRequestId?: string;
  onRetry: () => void;
}): void {
  const workspaceWS = useOptionalWS();
  const lobbyWS = useOptionalMeetingLobbyWS();
  const client = workspaceWS?.client ?? lobbyWS?.client ?? null;
  const attemptRef = useRef(0);
  // Separate from attemptRef, which resets whenever the lobby stops waiting —
  // and it does stop while a join error is on screen.
  const errorAttemptRef = useRef(0);
  const waiting = isLobbyWaiting(decision) && !admitted && !hasJoinError;
  // The caller's join callback changes identity whenever a join settles; the
  // WS effect reads it through a ref so that churn does not cancel a pending
  // jittered retry triggered by an approval that arrived mid-join. The request
  // id is read the same way, for the same reason.
  const onRetryRef = useRef(onRetry);
  const joinRequestIdRef = useRef(joinRequestId);
  useEffect(() => {
    onRetryRef.current = onRetry;
    joinRequestIdRef.current = joinRequestId;
  });

  useEffect(() => {
    if (!waiting) {
      attemptRef.current = 0;
    }
  }, [waiting]);

  useEffect(() => {
    if (admitted) errorAttemptRef.current = 0;
  }, [admitted]);

  useEffect(() => {
    if (!waiting || !client) return;

    // At most one jittered retry pending: a burst of events (a host admitting
    // a queue) asks once, not once per event. A retry still pending when the
    // lobby stops waiting (admitted, left, unmounted) must not fire a join for
    // a screen that is gone.
    let pending: number | null = null;
    const cancelPending = () => {
      if (pending === null) return;
      window.clearTimeout(pending);
      pending = null;
    };
    const onEvent = (msg: WSMessage) => {
      const payload = (msg.payload ?? {}) as Record<string, string>;
      if (!shouldTriggerLobbyJoin(msg.type, payload, meetingId, joinRequestIdRef.current)) return;
      attemptRef.current = 0;
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        onRetryRef.current();
      }, lobbyWsTriggerJitterMs());
    };

    const offAny = client.onAny(onEvent);
    const offReconnect = client.onReconnect(() => {
      attemptRef.current = 0;
      cancelPending();
      onRetryRef.current();
    });
    return () => {
      offAny();
      offReconnect();
      cancelPending();
    };
  }, [waiting, client, meetingId]);

  useEffect(() => {
    if (admitted || !hasJoinError) return;
    const delay = joinErrorRetryDelayMs(joinError, errorAttemptRef.current);
    if (delay === null) return;
    const id = window.setTimeout(() => {
      errorAttemptRef.current += 1;
      onRetryRef.current();
    }, delay);
    return () => window.clearTimeout(id);
  }, [admitted, hasJoinError, joinError]);

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
