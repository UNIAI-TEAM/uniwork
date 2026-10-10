"use client";

import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { useOptionalWS } from "./provider";
import { WS_SCOPE_MEETING, lookupRetryDelayMs } from "./scopes";

type MeetingHold = {
  count: number;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | null;
  stopListening: () => void;
};

/**
 * How many mounted screens hold each meeting open, per socket. The server
 * keeps one subscription per scope and socket, so the last screen to let go
 * is the one that unsubscribes: the room closing must not cut the detail
 * page that is still showing the same meeting.
 */
const holds = new WeakMap<WSClient, Map<string, MeetingHold>>();

function isAnswerFor(msg: WSMessage, meetingId: string): Record<string, unknown> | null {
  const payload = msg.payload as Record<string, unknown> | null | undefined;
  if (!payload || payload.scope !== WS_SCOPE_MEETING || payload.id !== meetingId) return null;
  return payload;
}

function startHold(client: WSClient, meetingId: string): MeetingHold {
  const hold: MeetingHold = { count: 1, attempt: 0, retry: null, stopListening: () => {} };
  hold.stopListening = client.onAny((msg) => {
    const type = msg.type as string;
    if (type !== "subscribe_ack" && type !== "subscribe_error") return;
    const payload = isAnswerFor(msg, meetingId);
    if (!payload) return;
    if (type === "subscribe_ack") {
      hold.attempt = 0;
      return;
    }
    // A refusal is an answer; only a failed lookup is worth asking again.
    if (payload.error !== "lookup_failed" || hold.retry !== null) return;
    hold.retry = setTimeout(() => {
      hold.retry = null;
      client.subscribe(WS_SCOPE_MEETING, meetingId);
    }, lookupRetryDelayMs(hold.attempt));
    hold.attempt += 1;
  });
  client.subscribe(WS_SCOPE_MEETING, meetingId);
  return hold;
}

function holdMeetingScope(client: WSClient, meetingId: string): () => void {
  let byMeeting = holds.get(client);
  if (!byMeeting) {
    byMeeting = new Map();
    holds.set(client, byMeeting);
  }
  const counts = byMeeting;
  const existing = counts.get(meetingId);
  if (existing) existing.count += 1;
  else counts.set(meetingId, startHold(client, meetingId));

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const hold = counts.get(meetingId);
    if (!hold) return;
    hold.count -= 1;
    if (hold.count > 0) return;
    counts.delete(meetingId);
    if (hold.retry !== null) clearTimeout(hold.retry);
    hold.stopListening();
    client.unsubscribe(WS_SCOPE_MEETING, meetingId);
  };
}

/**
 * Subscribe the workspace socket to one meeting while the calling screen is
 * mounted. The server sends a meeting's in-room events only to sockets that
 * hold it open; `useRealtimeSync` turns them into the same invalidations as
 * before. The socket replays the subscription after a reconnect, a new
 * socket (token rotation) gets its own, and a check the server could not
 * complete is asked again. Pass an empty id to hold nothing — a guest
 * listens on the lobby socket instead.
 */
export function useMeetingScope(meetingId: string): void {
  const client = useOptionalWS()?.client ?? null;
  useEffect(() => {
    if (!client || !meetingId) return;
    return holdMeetingScope(client, meetingId);
  }, [client, meetingId]);
}
