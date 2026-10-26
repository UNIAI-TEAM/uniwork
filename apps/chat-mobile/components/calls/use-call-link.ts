// The call's network as the person should hear about it (review "no-in-call-reconnecting-ui"): LiveKit restarting
// the connection (Reconnecting, or SignalReconnecting for the signalling channel alone, until Reconnected) is
// "Reconnecting…" on the call screen and in the ongoing notification (nativeCallSync), and a weak link — ours, or a
// participant's (ConnectionQualityChanged: poor or lost) — is a badge, ours first. Each drop is counted
// (data/calls/call-link.ts): recovered and how long it took, or never back once the room lets go.
import { ConnectionQuality, RoomEvent, type Participant, type Room } from "livekit-client";
import { useEffect, useState } from "react";
import { callLinkTracker } from "@/data/calls/call-link";
import { callEngine } from "@/data/calls/call-store";
import { nativeCallSync } from "@/data/calls/call-wiring";

export interface CallLink {
  reconnecting: boolean;
  /** Whose link is weak: ours, someone else's, or nobody's. */
  weak: "self" | "peer" | null;
}

const weakQuality = (quality: ConnectionQuality) => quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;

export function useCallLink(room: Room): CallLink {
  const [reconnecting, setReconnecting] = useState(false);
  const [weakSelf, setWeakSelf] = useState(false);
  const [weakPeers, setWeakPeers] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const notify = (on: boolean) => nativeCallSync.setReconnecting(on, callEngine.store.getState().call);
    const down = () => {
      setReconnecting(true);
      callLinkTracker.reconnecting();
      notify(true);
    };
    const up = () => {
      setReconnecting(false);
      callLinkTracker.reconnected();
      notify(false);
    };
    const gone = () => {
      callLinkTracker.disconnected();
      notify(false);
    };
    const quality = (value: ConnectionQuality, participant: Participant) => {
      const weak = weakQuality(value);
      if (participant.isLocal) {
        setWeakSelf(weak);
        return;
      }
      setWeakPeers((before) => {
        if (before.has(participant.identity) === weak) return before;
        const next = new Set(before);
        if (weak) next.add(participant.identity);
        else next.delete(participant.identity);
        return next;
      });
    };
    room.on(RoomEvent.Reconnecting, down);
    room.on(RoomEvent.SignalReconnecting, down);
    room.on(RoomEvent.Reconnected, up);
    room.on(RoomEvent.Disconnected, gone);
    room.on(RoomEvent.ConnectionQualityChanged, quality);
    return () => {
      room.off(RoomEvent.Reconnecting, down);
      room.off(RoomEvent.SignalReconnecting, down);
      room.off(RoomEvent.Reconnected, up);
      room.off(RoomEvent.Disconnected, gone);
      room.off(RoomEvent.ConnectionQualityChanged, quality);
    };
  }, [room]);

  return { reconnecting, weak: weakSelf ? "self" : weakPeers.size > 0 ? "peer" : null };
}
