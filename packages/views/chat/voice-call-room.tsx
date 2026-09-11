"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

const CONNECT_TIMEOUT_MS = 25_000;

type VoiceCallRoomContextValue = {
  room: Room | null;
  connected: boolean;
  remoteParticipantCount: number;
  needsAudioUnlock: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  remoteCameraEnabled: boolean;
  toggleMute: () => void;
  toggleCamera: () => Promise<boolean>;
  unlockAudio: () => Promise<boolean>;
  bindLocalVideo: (el: HTMLVideoElement | null) => void;
  bindRemoteVideo: (el: HTMLVideoElement | null) => void;
};

const VoiceCallRoomContext = createContext<VoiceCallRoomContextValue>({
  room: null,
  connected: false,
  remoteParticipantCount: 0,
  needsAudioUnlock: false,
  muted: false,
  cameraEnabled: false,
  remoteCameraEnabled: false,
  toggleMute: () => undefined,
  toggleCamera: async () => false,
  unlockAudio: async () => false,
  bindLocalVideo: () => undefined,
  bindRemoteVideo: () => undefined,
});

export function useVoiceCallRoom() {
  return useContext(VoiceCallRoomContext);
}

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
  const remoteVideoTrackRef = useRef<RemoteTrack | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  const onConnectFailedRef = useRef(onConnectFailed);
  const onConnectedRef = useRef(onConnected);
  const [connected, setConnected] = useState(false);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(false);

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

  const bindLocalVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoElRef.current = el;
      if (el) attachLocalVideo();
    },
    [attachLocalVideo],
  );

  const bindRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoElRef.current = el;
    const track = remoteVideoTrackRef.current;
    if (el && track) {
      track.attach(el);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const attachedAudioSids = new Set<string>();

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
      if (onConnectFailedRef.current) {
        onConnectFailedRef.current();
      } else {
        onDisconnectedRef.current();
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
      audioElsRef.current.push(el);
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
      _publication: RemoteTrackPublication,
      _participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      remoteVideoTrackRef.current = track;
      setRemoteCameraEnabled(true);
      if (remoteVideoElRef.current) {
        track.attach(remoteVideoElRef.current);
      }
    };

    const detachVideo = (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Video) return;
      track.detach();
      if (remoteVideoTrackRef.current === track) {
        remoteVideoTrackRef.current = null;
        setRemoteCameraEnabled(false);
      }
    };

    const onLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.Camera) return;
      setCameraEnabled(true);
      attachLocalVideo();
    };

    const onLocalTrackUnpublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.Camera) return;
      publication.track?.detach();
      setCameraEnabled(false);
    };

    const syncRemoteCount = () => {
      if (disposed) return;
      setRemoteParticipantCount(room.remoteParticipants.size);
    };

    const onConnectedEvent = () => {
      if (disposed) return;
      clearConnectTimeout();
      setConnected(true);
      syncRemoteCount();
      attachExistingRemoteTracks();
      void (async () => {
        try {
          await room.startAudio();
        } catch {
          if (!disposed) setNeedsAudioUnlock(true);
        }
        syncAudioPlaybackState(room);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (!disposed) setMuted(false);
        } catch {
          if (!disposed) setMuted(true);
        }
        if (initialCameraEnabled) {
          try {
            await room.localParticipant.setCameraEnabled(true);
            if (!disposed) {
              setCameraEnabled(true);
              attachLocalVideo();
            }
          } catch {
            if (!disposed) setCameraEnabled(false);
          }
        }
        onConnectedRef.current?.();
      })();
    };

    const onParticipantChange = () => {
      syncRemoteCount();
    };

    const onDisconnectedEvent = () => {
      if (disposed) return;
      clearConnectTimeout();
      onDisconnectedRef.current();
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
      if (!disposed) setMuted(true);
    };
    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);

    connectTimeoutId = setTimeout(() => {
      if (disposed || room.state === ConnectionState.Connected) return;
      failConnect();
    }, CONNECT_TIMEOUT_MS);

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
      for (const el of audioElsRef.current) {
        el.remove();
      }
      audioElsRef.current = [];
      attachedAudioSids.clear();
      remoteVideoTrackRef.current = null;
      localVideoElRef.current = null;
      remoteVideoElRef.current = null;
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
      setRemoteParticipantCount(0);
      setNeedsAudioUnlock(false);
      setCameraEnabled(false);
      setRemoteCameraEnabled(false);
    };
  }, [url, token, initialCameraEnabled, attachLocalVideo, syncAudioPlaybackState]);

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
      } else {
        attachLocalVideo();
      }
      return true;
    } catch {
      return false;
    }
  }, [cameraEnabled, attachLocalVideo]);

  const value = useMemo(
    () => ({
      room: roomRef.current,
      connected,
      remoteParticipantCount,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      remoteCameraEnabled,
      toggleMute,
      toggleCamera,
      unlockAudio,
      bindLocalVideo,
      bindRemoteVideo,
    }),
    [
      connected,
      remoteParticipantCount,
      needsAudioUnlock,
      muted,
      cameraEnabled,
      remoteCameraEnabled,
      toggleMute,
      toggleCamera,
      unlockAudio,
      bindLocalVideo,
      bindRemoteVideo,
    ],
  );

  return <VoiceCallRoomContext.Provider value={value}>{children}</VoiceCallRoomContext.Provider>;
}
