"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Track, Room, type LocalTrack, type RemoteTrack } from "livekit-client";
import { VoiceCallRoomContext, useVoiceCallRoom } from "./voice-call-room-context";
import {
  participantScreenShareKey,
  type VoiceCallParticipantTile,
} from "./voice-call-room-types";
import { useVoiceCallRoomConnection } from "./use-voice-call-room-connection";

export type { VoiceCallParticipantTile } from "./voice-call-room-types";
export { useVoiceCallRoom } from "./voice-call-room-context";

/** LiveKit room for native chat voice/video calls (no data channels). */
export function VoiceCallRoom({
  url,
  token,
  initialCameraEnabled = false,
  onDisconnected,
  onConnectFailed,
  onConnected,
  children,
}: {
  url: string;
  token: string;
  initialCameraEnabled?: boolean;
  onDisconnected: () => void;
  onConnectFailed?: () => void;
  onConnected?: () => void;
  children: ReactNode;
}) {
  const roomRef = useRef<Room | null>(null);
  const audioElsRef = useRef<HTMLMediaElement[]>([]);
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
  const onConnectedRef = useRef(onConnected);
  const [connected, setConnected] = useState(false);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [remoteScreenShareEnabled, setRemoteScreenShareEnabled] = useState(false);
  const [participantTiles, setParticipantTiles] = useState<VoiceCallParticipantTile[]>([]);

  onDisconnectedRef.current = onDisconnected;
  onConnectFailedRef.current = onConnectFailed;
  onConnectedRef.current = onConnected;

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
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    pub?.track?.attach(el);
  }, []);

  const attachLocalScreenShare = useCallback(() => {
    const room = roomRef.current;
    const el = localScreenShareElRef.current;
    if (!room || !el) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    pub?.track?.attach(el);
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
    if (el && track) {
      track.attach(el);
    }
  }, []);

  const bindRemoteScreenShare = useCallback((el: HTMLVideoElement | null) => {
    remoteScreenShareElRef.current = el;
    const track = remoteScreenShareTrackRef.current;
    if (el && track) {
      track.attach(el);
    }
  }, []);

  const syncParticipantTiles = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipantTiles([]);
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
    setParticipantTiles(tiles);
    setRemoteCameraEnabled(anyRemoteVideo);
    setRemoteScreenShareEnabled(anyRemoteScreenShare);
  }, []);

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
    {
      roomRef,
      audioElsRef,
      localVideoElRef,
      remoteVideoElRef,
      localScreenShareElRef,
      remoteScreenShareElRef,
      remoteVideoTrackRef,
      remoteScreenShareTrackRef,
      videoElByIdentityRef,
      videoTrackByIdentityRef,
      onDisconnectedRef,
      onConnectFailedRef,
      onConnectedRef,
    },
    {
      setConnected,
      setRemoteParticipantCount,
      setNeedsAudioUnlock,
      setMuted,
      setCameraEnabled,
      setRemoteCameraEnabled,
      setScreenShareEnabled,
      setRemoteScreenShareEnabled,
      setParticipantTiles,
    },
    attachLocalVideo,
    attachLocalScreenShare,
    syncAudioPlaybackState,
    syncParticipantTiles,
  );

  const toggleMute = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    void room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    const next = !cameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      if (!next) {
        room.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.detach();
        videoTrackByIdentityRef.current.delete(room.localParticipant.identity);
      } else {
        attachLocalVideo();
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (track) {
          videoTrackByIdentityRef.current.set(room.localParticipant.identity, track);
          const el = videoElByIdentityRef.current.get(room.localParticipant.identity);
          if (el) track.attach(el);
        }
      }
      syncParticipantTiles();
      return true;
    } catch {
      return false;
    }
  }, [cameraEnabled, attachLocalVideo, syncParticipantTiles]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    const next = !screenShareEnabled;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenShareEnabled(next);
      if (!next) {
        room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.detach();
        videoTrackByIdentityRef.current.delete(participantScreenShareKey(room.localParticipant.identity));
      } else {
        attachLocalScreenShare();
        const track = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
        if (track) {
          const key = participantScreenShareKey(room.localParticipant.identity);
          videoTrackByIdentityRef.current.set(key, track);
          const el = videoElByIdentityRef.current.get(key);
          if (el) track.attach(el);
        }
      }
      syncParticipantTiles();
      return true;
    } catch {
      return false;
    }
  }, [screenShareEnabled, attachLocalScreenShare, syncParticipantTiles]);

  const value = useMemo(
    () => ({
      room: roomRef.current,
      connected,
      remoteParticipantCount,
      participantTiles,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      remoteCameraEnabled,
      screenShareEnabled,
      remoteScreenShareEnabled,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      unlockAudio,
      bindLocalVideo,
      bindRemoteVideo,
      bindLocalScreenShare,
      bindRemoteScreenShare,
      bindParticipantVideo,
      bindParticipantScreenShare,
    }),
    [
      connected,
      remoteParticipantCount,
      participantTiles,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      remoteCameraEnabled,
      screenShareEnabled,
      remoteScreenShareEnabled,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      unlockAudio,
      bindLocalVideo,
      bindRemoteVideo,
      bindLocalScreenShare,
      bindRemoteScreenShare,
      bindParticipantVideo,
      bindParticipantScreenShare,
    ],
  );

  return <VoiceCallRoomContext.Provider value={value}>{children}</VoiceCallRoomContext.Provider>;
}
