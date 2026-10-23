"use client";
import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type TrackPublication,
} from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { markScreenShareStopByUser, takeScreenShareStopByUser } from "./screen-share";
import { PRESENTER_RACE_GRACE_MS, presenterVerdict } from "./single-presenter";

/**
 * One share at a time: when someone starts presenting while we do, ours stops
 * and we are told who took over (like Google Meet, no confirmation). Two
 * shares started together are settled by presenterVerdict, so every client
 * agrees on the one that stays without talking to the others. Mounted once
 * per room.
 */
export function MeetingSinglePresenter() {
  const { t } = useTranslation();
  // Read through a ref: a language switch must not restart the effect and
  // forget when each share started.
  const tRef = useRef(t);
  tRef.current = t;
  const room = useRoomContext();

  useEffect(() => {
    const local = room.localParticipant;
    const ownShare = () => local.getTrackPublication(Track.Source.ScreenShare);
    // When this client saw each remote share being published. LiveKit
    // announces none of the shares already on when we join (nor when we
    // rejoin), so a share missing here started no later than our connection.
    // Reading it as that old, not older, keeps both sides on the same rule: a
    // share started just before we joined is a race settled by identity, and
    // one on for long reads as a takeover on its presenter's side, who stops
    // while the race grace keeps ours on.
    const seenAt = new Map<string, number>();
    let connectedAt = Date.now();
    let ownSince: number | null = ownShare() ? Date.now() : null;
    let stopping = false;
    const graces = new Set<ReturnType<typeof setTimeout>>();

    const yieldTo = (presenter: RemoteParticipant) => {
      if (stopping) return;
      stopping = true;
      // Ours, so the generic "share stopped" notice stays quiet: this one says why.
      markScreenShareStopByUser(room);
      local.setScreenShareEnabled(false).then(
        () => {
          stopping = false;
          toast.info(tRef.current("meetings.presenterTakeover", { name: presenter.name || presenter.identity }));
        },
        () => {
          stopping = false;
          takeScreenShareStopByUser(room);
          toast.error(tRef.current("common.error"));
        },
      );
    };
    const contest = (pub: TrackPublication, presenter: RemoteParticipant) => {
      const mine = ownShare();
      if (ownSince === null || !mine || room.state !== ConnectionState.Connected) return;
      const verdict = presenterVerdict(
        { identity: local.identity, since: ownSince },
        { identity: presenter.identity, since: seenAt.get(pub.trackSid) ?? connectedAt },
      );
      if (verdict === "yield") yieldTo(presenter);
      if (verdict !== "yield-if-still-on") return;
      const grace = setTimeout(() => {
        graces.delete(grace);
        const bothOn =
          ownShare()?.trackSid === mine.trackSid &&
          presenter.getTrackPublication(Track.Source.ScreenShare)?.trackSid === pub.trackSid;
        if (bothOn && room.state === ConnectionState.Connected) yieldTo(presenter);
      }, PRESENTER_RACE_GRACE_MS);
      graces.add(grace);
    };

    const onPublished = (pub: TrackPublication, presenter: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      if (!seenAt.has(pub.trackSid)) seenAt.set(pub.trackSid, Date.now());
      contest(pub, presenter);
    };
    const onUnpublished = (pub: TrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) seenAt.delete(pub.trackSid);
    };
    const onLocalPublished = (pub: TrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      // A reconnect republishes the same share: it keeps its start. Any other
      // publish is a share started now.
      ownSince = room.state === ConnectionState.Reconnecting ? (ownSince ?? Date.now()) : Date.now();
      for (const p of room.remoteParticipants.values()) {
        const share = p.getTrackPublication(Track.Source.ScreenShare);
        if (share) contest(share, p);
      }
    };
    const onLocalUnpublished = (pub: TrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      if (room.state === ConnectionState.Connected) ownSince = null;
    };
    const onConnected = () => {
      connectedAt = Date.now();
      // A share lost with the connection is not coming back as the same one.
      if (!ownShare()) ownSince = null;
    };
    const onDisconnected = () => {
      ownSince = null;
      seenAt.clear();
    };

    room
      .on(RoomEvent.TrackPublished, onPublished)
      .on(RoomEvent.TrackUnpublished, onUnpublished)
      .on(RoomEvent.LocalTrackPublished, onLocalPublished)
      .on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished)
      .on(RoomEvent.Reconnected, onConnected)
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      for (const grace of graces) clearTimeout(grace);
      room
        .off(RoomEvent.TrackPublished, onPublished)
        .off(RoomEvent.TrackUnpublished, onUnpublished)
        .off(RoomEvent.LocalTrackPublished, onLocalPublished)
        .off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished)
        .off(RoomEvent.Reconnected, onConnected)
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  return null;
}
