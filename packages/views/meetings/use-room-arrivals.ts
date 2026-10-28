"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type Participant, type RemoteParticipant } from "livekit-client";
import { DIAL_IN_STATE_ATTRIBUTE, inMeeting } from "./meeting-signals";

/** People already in the room when we connect are not news; only later arrivals are. */
const PRESENCE_SETTLE_MS = 2000;

/**
 * Calls `onChange` when someone joins or leaves the meeting. The initial
 * roster and the re-sync after a reconnect are skipped: a full reconnect
 * unwinds every remote participant (ParticipantDisconnected for each) just
 * before Reconnecting fires, then re-adds them. `onReset` hears that, so a
 * caller can drop what it queued. A phone caller joins held and counts as
 * arriving when the host admits them; agents never count.
 */
export function useRoomArrivals(
  onChange: (kind: "join" | "leave", participant: Participant) => void,
  onReset?: () => void,
) {
  const room = useRoomContext();
  const handlers = useRef({ onChange, onReset });
  useLayoutEffect(() => {
    handlers.current = { onChange, onReset };
  });

  useEffect(() => {
    let readyAt = room.state === ConnectionState.Connected ? Date.now() + PRESENCE_SETTLE_MS : Infinity;
    const report = (kind: "join" | "leave", p: Participant) => {
      if (Date.now() < readyAt || !inMeeting(p)) return;
      handlers.current.onChange(kind, p);
    };
    const onSettle = () => {
      readyAt = Date.now() + PRESENCE_SETTLE_MS;
    };
    const onReconnecting = () => {
      readyAt = Infinity;
      handlers.current.onReset?.();
    };
    const onJoin = (p: RemoteParticipant) => report("join", p);
    const onLeave = (p: RemoteParticipant) => report("leave", p);
    const onAttributes = (changed: Record<string, string>, p: Participant) => {
      if (changed[DIAL_IN_STATE_ATTRIBUTE] === "admitted") report("join", p);
    };

    room
      .on(RoomEvent.Connected, onSettle)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onSettle)
      .on(RoomEvent.ParticipantConnected, onJoin)
      .on(RoomEvent.ParticipantDisconnected, onLeave)
      .on(RoomEvent.ParticipantAttributesChanged, onAttributes);
    return () => {
      room
        .off(RoomEvent.Connected, onSettle)
        .off(RoomEvent.Reconnecting, onReconnecting)
        .off(RoomEvent.Reconnected, onSettle)
        .off(RoomEvent.ParticipantConnected, onJoin)
        .off(RoomEvent.ParticipantDisconnected, onLeave)
        .off(RoomEvent.ParticipantAttributesChanged, onAttributes);
    };
  }, [room]);
}
