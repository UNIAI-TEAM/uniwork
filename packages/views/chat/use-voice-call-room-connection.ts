"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import {
  participantScreenShareKey,
  VOICE_CALL_CONNECT_TIMEOUT_MS,
  type VoiceCallParticipantTile,
} from "./voice-call-room-types";

export type VoiceCallRoomConnectionRefs = {
  roomRef: MutableRefObject<Room | null>;
  audioElsRef: MutableRefObject<HTMLMediaElement[]>;
  localVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  remoteVideoElRef: MutableRefObject<HTMLVideoElement | null>;
  localScreenShareElRef: MutableRefObject<HTMLVideoElement | null>;
  remoteScreenShareElRef: MutableRefObject<HTMLVideoElement | null>;
  remoteVideoTrackRef: MutableRefObject<RemoteTrack | null>;
  remoteScreenShareTrackRef: MutableRefObject<RemoteTrack | null>;
  videoElByIdentityRef: MutableRefObject<Map<string, HTMLVideoElement | null>>;
  videoTrackByIdentityRef: MutableRefObject<Map<string, RemoteTrack | LocalTrack>>;
  onDisconnectedRef: MutableRefObject<() => void>;
  onConnectFailedRef: MutableRefObject<(() => void) | undefined>;
  onConnectedRef: MutableRefObject<(() => void) | undefined>;
};

export type VoiceCallRoomConnectionSetters = {
  setConnected: Dispatch<SetStateAction<boolean>>;
  setRemoteParticipantCount: Dispatch<SetStateAction<number>>;
  setNeedsAudioUnlock: Dispatch<SetStateAction<boolean>>;
  setMuted: Dispatch<SetStateAction<boolean>>;
  setCameraEnabled: Dispatch<SetStateAction<boolean>>;
  setRemoteCameraEnabled: Dispatch<SetStateAction<boolean>>;
  setScreenShareEnabled: Dispatch<SetStateAction<boolean>>;
  setRemoteScreenShareEnabled: Dispatch<SetStateAction<boolean>>;
  setParticipantTiles: Dispatch<SetStateAction<VoiceCallParticipantTile[]>>;
};

export function useVoiceCallRoomConnection(
  url: string,
  token: string,
  initialCameraEnabled: boolean,
  refs: VoiceCallRoomConnectionRefs,
  setters: VoiceCallRoomConnectionSetters,
  attachLocalVideo: () => void,
  attachLocalScreenShare: () => void,
  syncAudioPlaybackState: (room: Room) => void,
  syncParticipantTiles: () => void,
): void {
  useEffect(() => {
    let disposed = false;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    refs.roomRef.current = room;
    const attachedAudioSids = new Set<string>();
    const videoElByIdentity = refs.videoElByIdentityRef.current;
    const videoTrackByIdentity = refs.videoTrackByIdentityRef.current;

    const clearConnectTimeout = () => {
      if (connectTimeoutId != null) {
        clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
    };

    const failConnect = () => {
      if (disposed) return;
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
      if (!sid || attachedAudioSids.has(sid)) return;
      attachedAudioSids.add(sid);
      const el = track.attach();
      el.style.display = "none";
      document.body.appendChild(el);
      refs.audioElsRef.current.push(el);
      void el.play().catch(() => undefined);
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

    const detachVideo = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      if (publication.source === Track.Source.Camera) {
        track.detach();
        videoTrackByIdentity.delete(participant.identity);
        const el = videoElByIdentity.get(participant.identity);
        if (el) el.srcObject = null;
        if (refs.remoteVideoTrackRef.current === track) {
          refs.remoteVideoTrackRef.current = null;
        }
        syncParticipantTiles();
        return;
      }
      if (publication.source === Track.Source.ScreenShare) {
        track.detach();
        const key = participantScreenShareKey(participant.identity);
        videoTrackByIdentity.delete(key);
        const el = videoElByIdentity.get(key);
        if (el) el.srcObject = null;
        if (refs.remoteScreenShareTrackRef.current === track) {
          refs.remoteScreenShareTrackRef.current = null;
        }
        syncParticipantTiles();
      }
    };

    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        setters.setScreenShareEnabled(true);
        attachLocalScreenShare();
        const track = publication.track;
        if (track) {
          const key = participantScreenShareKey(room.localParticipant.identity);
          videoTrackByIdentity.set(key, track);
          const el = videoElByIdentity.get(key);
          if (el) track.attach(el);
        }
        syncParticipantTiles();
        return;
      }
      if (publication.source !== Track.Source.Camera) return;
      setters.setCameraEnabled(true);
      attachLocalVideo();
      const track = publication.track;
      if (track) {
        videoTrackByIdentity.set(room.localParticipant.identity, track);
        const el = videoElByIdentity.get(room.localParticipant.identity);
        if (el) track.attach(el);
      }
      syncParticipantTiles();
    };

    const onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        publication.track?.detach();
        videoTrackByIdentity.delete(participantScreenShareKey(room.localParticipant.identity));
        setters.setScreenShareEnabled(false);
        syncParticipantTiles();
        return;
      }
      if (publication.source !== Track.Source.Camera) return;
      publication.track?.detach();
      videoTrackByIdentity.delete(room.localParticipant.identity);
      setters.setCameraEnabled(false);
      syncParticipantTiles();
    };

    const syncRemoteCount = () => {
      if (disposed) return;
      setters.setRemoteParticipantCount(room.remoteParticipants.size);
      syncParticipantTiles();
    };

    const onConnectedEvent = () => {
      if (disposed) return;
      clearConnectTimeout();
      setters.setConnected(true);
      syncRemoteCount();
      attachExistingRemoteTracks();
      void (async () => {
        try {
          await room.startAudio();
        } catch {
          if (!disposed) setters.setNeedsAudioUnlock(true);
        }
        syncAudioPlaybackState(room);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (!disposed) setters.setMuted(false);
        } catch {
          if (!disposed) setters.setMuted(true);
        }
        if (initialCameraEnabled) {
          try {
            await room.localParticipant.setCameraEnabled(true);
            if (!disposed) {
              setters.setCameraEnabled(true);
              attachLocalVideo();
            }
          } catch {
            if (!disposed) setters.setCameraEnabled(false);
          }
        }
        syncParticipantTiles();
        refs.onConnectedRef.current?.();
      })();
    };

    const onParticipantChange = () => {
      syncRemoteCount();
    };

    const onDisconnectedEvent = () => {
      if (disposed) return;
      clearConnectTimeout();
      refs.onDisconnectedRef.current();
    };

    const onConnectionStateChanged = (state: ConnectionState) => {
      if (disposed) return;
      if (state === ConnectionState.Connected) {
        clearConnectTimeout();
        return;
      }
      if (state === ConnectionState.Disconnected) {
        clearConnectTimeout();
      }
    };

    const onAudioPlaybackStatusChanged = () => {
      if (disposed) return;
      syncAudioPlaybackState(room);
    };

    room.on(RoomEvent.TrackSubscribed, attachAudio);
    room.on(RoomEvent.TrackSubscribed, attachVideo);
    room.on(RoomEvent.TrackUnsubscribed, detachVideo);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.ParticipantConnected, onParticipantChange);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantChange);
    room.on(RoomEvent.Connected, onConnectedEvent);
    room.on(RoomEvent.Disconnected, onDisconnectedEvent);
    room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackStatusChanged);
    const onMediaDevicesError = () => {
      if (!disposed) setters.setMuted(true);
    };
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    // Who is speaking and whose mic is off live on the tiles.
    const onTileStateChange = () => {
      if (!disposed) syncParticipantTiles();
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onTileStateChange);
    room.on(RoomEvent.TrackMuted, onTileStateChange);
    room.on(RoomEvent.TrackUnmuted, onTileStateChange);

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
      room.off(RoomEvent.TrackSubscribed, attachAudio);
      room.off(RoomEvent.TrackSubscribed, attachVideo);
      room.off(RoomEvent.TrackUnsubscribed, detachVideo);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      room.off(RoomEvent.ParticipantConnected, onParticipantChange);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantChange);
      room.off(RoomEvent.Connected, onConnectedEvent);
      room.off(RoomEvent.Disconnected, onDisconnectedEvent);
      room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlaybackStatusChanged);
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
      room.off(RoomEvent.ActiveSpeakersChanged, onTileStateChange);
      room.off(RoomEvent.TrackMuted, onTileStateChange);
      room.off(RoomEvent.TrackUnmuted, onTileStateChange);
      for (const el of refs.audioElsRef.current) {
        el.remove();
      }
      refs.audioElsRef.current = [];
      attachedAudioSids.clear();
      refs.remoteVideoTrackRef.current = null;
      refs.remoteScreenShareTrackRef.current = null;
      refs.localVideoElRef.current = null;
      refs.remoteVideoElRef.current = null;
      refs.localScreenShareElRef.current = null;
      refs.remoteScreenShareElRef.current = null;
      videoElByIdentity.clear();
      videoTrackByIdentity.clear();
      void room.disconnect();
      refs.roomRef.current = null;
      setters.setConnected(false);
      setters.setRemoteParticipantCount(0);
      setters.setParticipantTiles([]);
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
    attachLocalVideo,
    attachLocalScreenShare,
    syncAudioPlaybackState,
    syncParticipantTiles,
  ]);
}
