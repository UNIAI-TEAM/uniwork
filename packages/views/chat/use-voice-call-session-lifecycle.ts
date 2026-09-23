"use client";

import { useEffect, useRef, useState } from "react";
import type { VoiceCallEndInit, VoiceCallKind } from "./voice-call-overlay-types";
import type { VoiceCallConnectionState } from "./voice-call-room-context";

/** A group call its starter sits in alone ends after a minute, and says so. */
const GROUP_ALONE_TIMEOUT_MS = 60_000;
/** A 1-1 call where the other side never shows up in the room. */
const DM_PEER_WAIT_MS = 30_000;
/**
 * A full reconnect briefly drops every remote participant; an empty room has
 * to stay empty this long before it counts as "they left".
 */
const PEER_LEFT_GRACE_MS = 3_000;

/**
 * When the call is really live (someone else is in the room — joining an
 * empty room is not "connected"), and when it should end on its own, with
 * the reason handed to the panel instead of a silent close.
 */
export function useVoiceCallSessionLifecycle({
  callKind,
  isCaller,
  connectionState,
  remoteParticipantCount,
  onConnected,
  onLeave,
  onEndForAll,
}: {
  callKind: VoiceCallKind;
  isCaller: boolean;
  connectionState: VoiceCallConnectionState;
  remoteParticipantCount: number;
  onConnected: () => void;
  onLeave: (init?: VoiceCallEndInit) => void;
  onEndForAll: (init?: VoiceCallEndInit) => void;
}) {
  const connected = connectionState === "connected" || connectionState === "reconnecting";
  const live = connected && remoteParticipantCount > 0;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const hadRemoteRef = useRef(false);
  const autoEndRef = useRef(false);
  const endersRef = useRef({ onLeave, onEndForAll });
  endersRef.current = { onLeave, onEndForAll };
  const dm = callKind === "dm";

  useEffect(() => {
    if (live && startedAt == null) {
      setStartedAt(Date.now());
      onConnected();
    }
  }, [live, startedAt, onConnected]);

  useEffect(() => {
    if (remoteParticipantCount > 0) {
      hadRemoteRef.current = true;
      return;
    }
    if (!hadRemoteRef.current || autoEndRef.current || connectionState !== "connected") return;
    const timer = setTimeout(() => {
      if (autoEndRef.current) return;
      autoEndRef.current = true;
      const { onLeave: leave, onEndForAll: endForAll } = endersRef.current;
      if (dm) endForAll({ reason: "peer_left" });
      else if (isCaller) endForAll({ reason: "everyone_left" });
      else leave({ reason: "everyone_left" });
    }, PEER_LEFT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [remoteParticipantCount, connectionState, dm, isCaller]);

  useEffect(() => {
    if (connectionState !== "connected" || remoteParticipantCount > 0) return;
    if (hadRemoteRef.current || autoEndRef.current) return;
    // Someone who joined a group call later waits as long as they like.
    if (!dm && !isCaller) return;
    const timer = setTimeout(
      () => {
        if (autoEndRef.current || hadRemoteRef.current) return;
        autoEndRef.current = true;
        endersRef.current.onEndForAll({ reason: dm ? "peer_unreachable" : "alone" });
      },
      dm ? DM_PEER_WAIT_MS : GROUP_ALONE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [connectionState, remoteParticipantCount, dm, isCaller]);

  return { live, startedAt };
}
