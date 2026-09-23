"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { deviceFailureFromError } from "./voice-call-media";
import type { VoiceCallDeviceError } from "./voice-call-overlay-types";
import type { VoiceCallConnectionState } from "./voice-call-room-context";
import {
  participantScreenShareKey,
  VOICE_CALL_CONNECT_TIMEOUT_MS,
} from "./voice-call-room-types";

export type VoiceCallRoomConnectionRefs = {
  roomRef: MutableRefObject<Room | null>;
  remoteVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  remoteScreenShareElRef: MutableRefObject<HTMLVideoElement | null>;
  remoteVideoTrackRef: MutableRefObject<RemoteTrack | null>;
  remoteScreenShareTrackRef: MutableRefObject<RemoteTrack | null>;
  videoElByIdentityRef: MutableRefObject<Map<string, HTMLVideoElement | null>>;
  videoTrackByIdentityRef: MutableRefObject<Map<string, RemoteTrack | LocalTrack>>;
  onDisconnectedRef: MutableRefObject<() => void>;
  onConnectFailedRef: MutableRefObject<(() => void) | undefined>;
  /**
   * What the person last chose for mic and camera. A manual reconnect builds a
   * new room; it must come back the way they left it, never unmuted.
   */
  micWantedRef: MutableRefObject<boolean>;
  cameraWantedRef: MutableRefObject<boolean>;
};

export type VoiceCallRoomConnectionSetters = {
  setConnectionState: Dispatch<SetStateAction<VoiceCallConnectionState>>;
  setRemoteParticipantCount: Dispatch<SetStateAction<number>>;
  setNeedsAudioUnlock: Dispatch<SetStateAction<boolean>>;
  setMuted: Dispatch<SetStateAction<boolean>>;
  setCameraEnabled: Dispatch<SetStateAction<boolean>>;
  setRemoteCameraEnabled: Dispatch<SetStateAction<boolean>>;
  setScreenShareEnabled: Dispatch<SetStateAction<boolean>>;
  setRemoteScreenShareEnabled: Dispatch<SetStateAction<boolean>>;
  setDeviceError: Dispatch<SetStateAction<VoiceCallDeviceError | null>>;
  clearParticipantTiles: () => void;
};

/**
 * Disconnects that mean the call itself is over (someone ended it, we were
 * removed, we left). Anything else — a dropped signal, a server restart —
 * is a lost connection the viewer can retry instead of a silent hang-up.
 */
const CALL_OVER_REASONS = new Set<DisconnectReason | undefined>([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.ROOM_CLOSED,
]);

export function useVoiceCallRoomConnection(
  url: string,
  token: string,
  initialCameraEnabled: boolean,
  attempt: number,
  refs: VoiceCallRoomConnectionRefs,
  setters: VoiceCallRoomConnectionSetters,
  attachLocalVideo: () => void,
  attachLocalScreenShare: () => void,
  syncAudioPlaybackState: (room: Room) => void,
  syncParticipantTiles: () => void,
): void {
  useEffect(() => {
    let disposed = false;
    let failed = false;
    let everConnected = false;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    refs.roomRef.current = room;
    // One hidden <audio> per remote audio track, forgotten when the track goes.
    const audioElsBySid = new Map<string, HTMLMediaElement[]>();
    const videoElByIdentity = refs.videoElByIdentityRef.current;
    const videoTrackByIdentity = refs.videoTrackByIdentityRef.current;
    setters.setConnectionState("connecting");

    const clearConnectTimeout = () => {
      if (connectTimeoutId != null) {
        clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
    };

    const failConnect = () => {
      if (disposed || failed) return;
      failed = true;
      clearConnectTimeout();
      void room.disconnect();
      if (refs.onConnectFailedRef.current) {
        refs.onConnectFailedRef.current();
      } else {
        refs.onDisconnectedRef.current();
      }
    };

    const attachAudio = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Audio) return;
      const sid = track.sid;
      if (!sid || audioElsBySid.has(sid)) return;
      const el = track.attach();
      el.style.display = "none";
      document.body.appendChild(el);
      audioElsBySid.set(sid, [el]);
      void el.play().catch(() => undefined);
    };

    const detachAudio = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const detached = track.detach();
      const sid = track.sid;
      const owned = sid ? (audioElsBySid.get(sid) ?? []) : [];
      for (const el of [...detached, ...owned]) el.remove();
      if (sid) audioElsBySid.delete(sid);
    };

    const attachExistingRemoteTracks = () => {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track;
          if (!track || track.kind !== Track.Kind.Audio) continue;
          attachAudio(track, publication, participant);
        }
      }
    };

    const attachVideo = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      if (publication.source === Track.Source.Camera) {
        videoTrackByIdentity.set(participant.identity, track);
        refs.remoteVideoTrackRef.current = track;
        const el = videoElByIdentity.get(participant.identity);
        if (el) track.attach(el);
        if (refs.remoteVideoElRef.current && !refs.remoteVideoElRef.current.srcObject) {
          track.attach(refs.remoteVideoElRef.current);
        }
        syncParticipantTiles();
        return;
      }
      if (publication.source === Track.Source.ScreenShare) {
        const key = participantScreenShareKey(participant.identity);
        videoTrackByIdentity.set(key, track);
        refs.remoteScreenShareTrackRef.current = track;
        const el = videoElByIdentity.get(key);
        if (el) track.attach(el);
        if (refs.remoteScreenShareElRef.current && !refs.remoteScreenShareElRef.current.srcObject) {
          track.attach(refs.remoteScreenShareElRef.current);
        }
        syncParticipantTiles();
      }
    };

    const onTrackUnsubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        detachAudio(track);
        return;
      }
      if (track.kind !== Track.Kind.Video) return;
      const key =
        publication.source === Track.Source.ScreenShare
          ? participantScreenShareKey(participant.identity)
          : publication.source === Track.Source.Camera
            ? participant.identity
            : null;
      if (!key) return;
      track.detach();
      videoTrackByIdentity.delete(key);
      const el = videoElByIdentity.get(key);
      if (el) el.srcObject = null;
      if (refs.remoteVideoTrackRef.current === track) refs.remoteVideoTrackRef.current = null;
      if (refs.remoteScreenShareTrackRef.current === track) refs.remoteScreenShareTrackRef.current = null;
      syncParticipantTiles();
    };

    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      const screen = publication.source === Track.Source.ScreenShare;
      if (!screen && publication.source !== Track.Source.Camera) return;
      if (screen) {
        setters.setScreenShareEnabled(true);
        attachLocalScreenShare();
      } else {
        setters.setCameraEnabled(true);
        attachLocalVideo();
      }
      const track = publication.track;
      if (track) {
        const identity = room.localParticipant.identity;
        const key = screen ? participantScreenShareKey(identity) : identity;
        videoTrackByIdentity.set(key, track);
        const el = videoElByIdentity.get(key);
        if (el) track.attach(el);
      }
      syncParticipantTiles();
    };

    const onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
      const screen = publication.source === Track.Source.ScreenShare;
      if (!screen && publication.source !== Track.Source.Camera) return;
      publication.track?.detach();
      const identity = room.localParticipant.identity;
      videoTrackByIdentity.delete(screen ? participantScreenShareKey(identity) : identity);
      if (screen) setters.setScreenShareEnabled(false);
      else setters.setCameraEnabled(false);
      syncParticipantTiles();
    };

    const syncRemoteCount = () => {
      if (disposed) return;
      setters.setRemoteParticipantCount(room.remoteParticipants.size);
      syncParticipantTiles();
    };

    const reportDevice = (kind: VoiceCallDeviceError["kind"], err: unknown) => {
      if (disposed) return;
      setters.setDeviceError({ kind, failure: deviceFailureFromError(err) });
    };

    const onConnectedEvent = () => {
      if (disposed) return;
      everConnected = true;
      clearConnectTimeout();
      setters.setConnectionState("connected");
      syncRemoteCount();
      attachExistingRemoteTracks();
      void (async () => {
        try {
          await room.startAudio();
        } catch {
          if (!disposed) setters.setNeedsAudioUnlock(true);
        }
        syncAudioPlaybackState(room);
        // The mic state shown is the one LiveKit reports after trying, never
        // an assumed "on": a blocked mic reads as off, with a notice saying why.
        if (refs.micWantedRef.current) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (err) {
            reportDevice("audioinput", err);
          }
        }
        if (!disposed) setters.setMuted(!room.localParticipant.isMicrophoneEnabled);
        if (refs.cameraWantedRef.current) {
          try {
            await room.localParticipant.setCameraEnabled(true);
            if (!disposed) attachLocalVideo();
          } catch (err) {
            reportDevice("videoinput", err);
          }
          if (!disposed) setters.setCameraEnabled(room.localParticipant.isCameraEnabled);
        }
        syncParticipantTiles();
      })();
    };

    const onDisconnectedEvent = (reason?: DisconnectReason) => {
      if (disposed || failed) return;
      clearConnectTimeout();
      if (!everConnected) {
        failConnect();
        return;
      }
      if (CALL_OVER_REASONS.has(reason)) {
        refs.onDisconnectedRef.current();
        return;
      }
      setters.setConnectionState("lost");
    };

    const onReconnecting = () => {
      if (!disposed) setters.setConnectionState("reconnecting");
    };
    const onReconnected = () => {
      if (disposed) return;
      setters.setConnectionState("connected");
      syncRemoteCount();
    };

    const onAudioPlaybackStatusChanged = () => {
      if (disposed) return;
      syncAudioPlaybackState(room);
    };

    const onMediaDevicesError = (error: Error, kind?: MediaDeviceKind) => {
      const device = kind === "videoinput" ? "videoinput" : "audioinput";
      reportDevice(device, error);
      if (disposed) return;
      if (device === "audioinput") setters.setMuted(!room.localParticipant.isMicrophoneEnabled);
      else setters.setCameraEnabled(room.localParticipant.isCameraEnabled);
    };

    // Who is speaking and whose mic is off live on the tiles.
    const onTileStateChange = () => {
      if (!disposed) syncParticipantTiles();
    };

    const handlers = [
      [RoomEvent.TrackSubscribed, attachAudio],
      [RoomEvent.TrackSubscribed, attachVideo],
      [RoomEvent.TrackUnsubscribed, onTrackUnsubscribed],
      [RoomEvent.LocalTrackPublished, onLocalTrackPublished],
      [RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished],
      [RoomEvent.ParticipantConnected, syncRemoteCount],
      [RoomEvent.ParticipantDisconnected, syncRemoteCount],
      [RoomEvent.Connected, onConnectedEvent],
      [RoomEvent.Disconnected, onDisconnectedEvent],
      [RoomEvent.Reconnecting, onReconnecting],
      [RoomEvent.SignalReconnecting, onReconnecting],
      [RoomEvent.Reconnected, onReconnected],
      [RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackStatusChanged],
      [RoomEvent.MediaDevicesError, onMediaDevicesError],
      [RoomEvent.ActiveSpeakersChanged, onTileStateChange],
      [RoomEvent.TrackMuted, onTileStateChange],
      [RoomEvent.TrackUnmuted, onTileStateChange],
    ] as const;
    for (const [event, handler] of handlers) {
      room.on(event, handler as never);
    }

    connectTimeoutId = setTimeout(() => {
      if (disposed || room.state === ConnectionState.Connected) return;
      failConnect();
    }, VOICE_CALL_CONNECT_TIMEOUT_MS);

    void room.connect(url, token, { autoSubscribe: true }).catch(() => {
      failConnect();
    });

    return () => {
      disposed = true;
      clearConnectTimeout();
      for (const [event, handler] of handlers) {
        room.off(event, handler as never);
      }
      for (const els of audioElsBySid.values()) {
        for (const el of els) el.remove();
      }
      audioElsBySid.clear();
      refs.remoteVideoTrackRef.current = null;
      refs.remoteScreenShareTrackRef.current = null;
      // The <video> bindings belong to the mounted stage and survive a
      // reconnect attempt; only the tracks die with this room.
      videoTrackByIdentity.clear();
      void room.disconnect();
      refs.roomRef.current = null;
      setters.setConnectionState("connecting");
      setters.setRemoteParticipantCount(0);
      setters.clearParticipantTiles();
      setters.setNeedsAudioUnlock(false);
      setters.setCameraEnabled(false);
      setters.setRemoteCameraEnabled(false);
      setters.setScreenShareEnabled(false);
      setters.setRemoteScreenShareEnabled(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters are stable for the room lifetime
  }, [
    url,
    token,
    initialCameraEnabled,
    attempt,
    attachLocalVideo,
    attachLocalScreenShare,
    syncAudioPlaybackState,
    syncParticipantTiles,
  ]);
}
