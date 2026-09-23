"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Track, type LocalTrack, type RemoteTrack, type Room } from "livekit-client";
import { deviceFailureFromError } from "./voice-call-media";
import type { VoiceCallDeviceError } from "./voice-call-overlay-types";
import {
  VoiceCallActionsContext,
  VoiceCallMediaContext,
  VoiceCallStatusContext,
  type VoiceCallConnectionState,
} from "./voice-call-room-context";
import {
  participantScreenShareKey,
  sameParticipantTiles,
  type VoiceCallParticipantTile,
} from "./voice-call-room-types";
import { useVoiceCallRoomConnection } from "./use-voice-call-room-connection";

export type { VoiceCallParticipantTile } from "./voice-call-room-types";

/** LiveKit room for native chat voice/video calls (no data channels). */
export function VoiceCallRoom({
  url,
  token,
  initialCameraEnabled = false,
  onDisconnected,
  onConnectFailed,
  children,
}: {
  url: string;
  token: string;
  initialCameraEnabled?: boolean;
  onDisconnected: () => void;
  onConnectFailed?: () => void;
  children: ReactNode;
}) {
  const roomRef = useRef<Room | null>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);
  const localScreenShareElRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenShareElRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoTrackRef = useRef<RemoteTrack | null>(null);
  const remoteScreenShareTrackRef = useRef<RemoteTrack | null>(null);
  const videoElByIdentityRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const videoTrackByIdentityRef = useRef<Map<string, RemoteTrack | LocalTrack>>(new Map());
  const onDisconnectedRef = useRef(onDisconnected);
  const onConnectFailedRef = useRef(onConnectFailed);
  const [attempt, setAttempt] = useState(0);
  const micWantedRef = useRef(true);
  const cameraWantedRef = useRef(initialCameraEnabled);
  const [connectionState, setConnectionState] = useState<VoiceCallConnectionState>("connecting");
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [remoteScreenShareEnabled, setRemoteScreenShareEnabled] = useState(false);
  const [participantTiles, setParticipantTiles] = useState<VoiceCallParticipantTile[]>([]);
  const [deviceError, setDeviceError] = useState<VoiceCallDeviceError | null>(null);

  onDisconnectedRef.current = onDisconnected;
  onConnectFailedRef.current = onConnectFailed;

  const syncAudioPlaybackState = useCallback((room: Room) => {
    setNeedsAudioUnlock(!room.canPlaybackAudio);
  }, []);

  const unlockAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    try {
      await room.startAudio();
      syncAudioPlaybackState(room);
      return room.canPlaybackAudio;
    } catch {
      setNeedsAudioUnlock(true);
      return false;
    }
  }, [syncAudioPlaybackState]);

  const attachLocalVideo = useCallback(() => {
    const room = roomRef.current;
    const el = localVideoElRef.current;
    if (!room || !el) return;
    room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.attach(el);
  }, []);

  const attachLocalScreenShare = useCallback(() => {
    const room = roomRef.current;
    const el = localScreenShareElRef.current;
    if (!room || !el) return;
    room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.attach(el);
  }, []);

  const bindLocalVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoElRef.current = el;
      if (el) attachLocalVideo();
    },
    [attachLocalVideo],
  );

  const bindLocalScreenShare = useCallback(
    (el: HTMLVideoElement | null) => {
      localScreenShareElRef.current = el;
      if (el) attachLocalScreenShare();
    },
    [attachLocalScreenShare],
  );

  const bindRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoElRef.current = el;
    const track = remoteVideoTrackRef.current;
    if (el && track) track.attach(el);
  }, []);

  const bindRemoteScreenShare = useCallback((el: HTMLVideoElement | null) => {
    remoteScreenShareElRef.current = el;
    const track = remoteScreenShareTrackRef.current;
    if (el && track) track.attach(el);
  }, []);

  const syncParticipantTiles = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipantTiles((prev) => (prev.length === 0 ? prev : []));
      setRemoteCameraEnabled(false);
      setRemoteScreenShareEnabled(false);
      return;
    }
    const tiles: VoiceCallParticipantTile[] = [];
    const localPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const localScreenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    tiles.push({
      identity: room.localParticipant.identity,
      name: room.localParticipant.name || room.localParticipant.identity,
      isLocal: true,
      hasVideo: Boolean(localPub?.track) && !localPub?.isMuted,
      hasScreenShare: Boolean(localScreenPub?.track) && !localScreenPub?.isMuted,
      isSpeaking: room.localParticipant.isSpeaking,
      micMuted: !room.localParticipant.isMicrophoneEnabled,
    });
    let anyRemoteVideo = false;
    let anyRemoteScreenShare = false;
    for (const participant of room.remoteParticipants.values()) {
      const pub = participant.getTrackPublication(Track.Source.Camera);
      const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
      const hasVideo = Boolean(pub?.track) && !pub?.isMuted;
      const hasScreenShare = Boolean(screenPub?.track) && !screenPub?.isMuted;
      if (hasVideo) anyRemoteVideo = true;
      if (hasScreenShare) anyRemoteScreenShare = true;
      tiles.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        isLocal: false,
        hasVideo,
        hasScreenShare,
        isSpeaking: participant.isSpeaking,
        micMuted: !participant.isMicrophoneEnabled,
      });
    }
    setParticipantTiles((prev) => (sameParticipantTiles(prev, tiles) ? prev : tiles));
    setRemoteCameraEnabled(anyRemoteVideo);
    setRemoteScreenShareEnabled(anyRemoteScreenShare);
  }, []);

  const clearParticipantTiles = useCallback(() => setParticipantTiles([]), []);

  const bindParticipantVideo = useCallback((identity: string, el: HTMLVideoElement | null) => {
    const prevEl = videoElByIdentityRef.current.get(identity) ?? null;
    if (prevEl === el) return;
    videoElByIdentityRef.current.set(identity, el);
    const track = videoTrackByIdentityRef.current.get(identity);
    if (prevEl && track) prevEl.srcObject = null;
    if (el && track) track.attach(el);
  }, []);

  const bindParticipantScreenShare = useCallback((identity: string, el: HTMLVideoElement | null) => {
    const key = participantScreenShareKey(identity);
    const prevEl = videoElByIdentityRef.current.get(key) ?? null;
    if (prevEl === el) return;
    videoElByIdentityRef.current.set(key, el);
    const track = videoTrackByIdentityRef.current.get(key);
    if (prevEl && track) prevEl.srcObject = null;
    if (el && track) track.attach(el);
  }, []);

  useVoiceCallRoomConnection(
    url,
    token,
    initialCameraEnabled,
    attempt,
    {
      roomRef,
      remoteVideoElRef,
      remoteScreenShareElRef,
      remoteVideoTrackRef,
      remoteScreenShareTrackRef,
      videoElByIdentityRef,
      videoTrackByIdentityRef,
      onDisconnectedRef,
      onConnectFailedRef,
      micWantedRef,
      cameraWantedRef,
    },
    {
      setConnectionState,
      setRemoteParticipantCount,
      setNeedsAudioUnlock,
      setMuted,
      setCameraEnabled,
      setRemoteCameraEnabled,
      setScreenShareEnabled,
      setRemoteScreenShareEnabled,
      setDeviceError,
      clearParticipantTiles,
    },
    attachLocalVideo,
    attachLocalScreenShare,
    syncAudioPlaybackState,
    syncParticipantTiles,
  );

  // Every toggle awaits LiveKit and shows the state LiveKit reports back;
  // on failure the control rolls back and the notice says which device and why.
  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    const enable = !room.localParticipant.isMicrophoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(enable);
      if (enable) setDeviceError((prev) => (prev?.kind === "audioinput" ? null : prev));
      return true;
    } catch (err) {
      setDeviceError({ kind: "audioinput", failure: deviceFailureFromError(err) });
      return false;
    } finally {
      micWantedRef.current = room.localParticipant.isMicrophoneEnabled;
      setMuted(!room.localParticipant.isMicrophoneEnabled);
      syncParticipantTiles();
    }
  }, [syncParticipantTiles]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    const enable = !room.localParticipant.isCameraEnabled;
    const identity = room.localParticipant.identity;
    try {
      await room.localParticipant.setCameraEnabled(enable);
      if (enable) {
        setDeviceError((prev) => (prev?.kind === "videoinput" ? null : prev));
        attachLocalVideo();
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (track) {
          videoTrackByIdentityRef.current.set(identity, track);
          const el = videoElByIdentityRef.current.get(identity);
          if (el) track.attach(el);
        }
      } else {
        room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.detach();
        videoTrackByIdentityRef.current.delete(identity);
      }
      return true;
    } catch (err) {
      setDeviceError({ kind: "videoinput", failure: deviceFailureFromError(err) });
      return false;
    } finally {
      cameraWantedRef.current = room.localParticipant.isCameraEnabled;
      setCameraEnabled(room.localParticipant.isCameraEnabled);
      syncParticipantTiles();
    }
  }, [attachLocalVideo, syncParticipantTiles]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    const enable = !room.localParticipant.isScreenShareEnabled;
    const key = participantScreenShareKey(room.localParticipant.identity);
    try {
      await room.localParticipant.setScreenShareEnabled(enable);
      if (enable) {
        attachLocalScreenShare();
        const track = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
        if (track) {
          videoTrackByIdentityRef.current.set(key, track);
          const el = videoElByIdentityRef.current.get(key);
          if (el) track.attach(el);
        }
      } else {
        room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.detach();
        videoTrackByIdentityRef.current.delete(key);
      }
      return true;
    } catch {
      return false;
    } finally {
      setScreenShareEnabled(room.localParticipant.isScreenShareEnabled);
      syncParticipantTiles();
    }
  }, [attachLocalScreenShare, syncParticipantTiles]);

  const retryConnection = useCallback(() => setAttempt((n) => n + 1), []);

  const connected = connectionState === "connected" || connectionState === "reconnecting";

  const status = useMemo(
    () => ({
      connectionState,
      connected,
      remoteParticipantCount,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      screenShareEnabled,
      deviceError,
    }),
    [
      connectionState,
      connected,
      remoteParticipantCount,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      screenShareEnabled,
      deviceError,
    ],
  );

  const media = useMemo(
    () => ({
      participantTiles,
      remoteCameraEnabled,
      remoteScreenShareEnabled,
      bindLocalVideo,
      bindRemoteVideo,
      bindLocalScreenShare,
      bindRemoteScreenShare,
      bindParticipantVideo,
      bindParticipantScreenShare,
    }),
    [
      participantTiles,
      remoteCameraEnabled,
      remoteScreenShareEnabled,
      bindLocalVideo,
      bindRemoteVideo,
      bindLocalScreenShare,
      bindRemoteScreenShare,
      bindParticipantVideo,
      bindParticipantScreenShare,
    ],
  );

  const actions = useMemo(
    () => ({
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      unlockAudio,
      retryConnection,
    }),
    [toggleMute, toggleCamera, toggleScreenShare, unlockAudio, retryConnection],
  );

  return (
    <VoiceCallActionsContext.Provider value={actions}>
      <VoiceCallStatusContext.Provider value={status}>
        <VoiceCallMediaContext.Provider value={media}>{children}</VoiceCallMediaContext.Provider>
      </VoiceCallStatusContext.Provider>
    </VoiceCallActionsContext.Provider>
  );
}
