import { renderHook } from "@testing-library/react";
import { createRef, type MutableRefObject } from "react";
import { RemoteVideoTrack, RoomEvent, ScreenSharePresets, Track } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import {
  useVoiceCallRoomConnection,
  type VoiceCallRoomConnectionRefs,
  type VoiceCallRoomConnectionSetters,
} from "./use-voice-call-room-connection";

const lk = vi.hoisted(() => ({
  roomOptions: [] as unknown[],
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
}));

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();
  class FakeRoom {
    state = actual.ConnectionState.Disconnected;
    remoteParticipants = new Map();
    localParticipant = { identity: "me" };
    constructor(options?: unknown) {
      lk.roomOptions.push(options);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!lk.listeners.has(event)) lk.listeners.set(event, new Set());
      lk.listeners.get(event)?.add(handler);
      return this;
    }
    off(event: string, handler: (...args: unknown[]) => void) {
      lk.listeners.get(event)?.delete(handler);
      return this;
    }
    connect() {
      return new Promise<void>(() => {});
    }
    disconnect() {
      return Promise.resolve();
    }
  }
  return { ...actual, Room: FakeRoom };
});

function ref<T>(value: T): MutableRefObject<T> {
  const r = createRef<T>() as MutableRefObject<T>;
  r.current = value;
  return r;
}

function refs(): VoiceCallRoomConnectionRefs {
  return {
    roomRef: ref(null),
    remoteVideoElRef: ref(null),
    remoteScreenShareElRef: ref(null),
    remoteVideoTrackRef: ref(null),
    remoteScreenShareTrackRef: ref(null),
    videoElByIdentityRef: ref(new Map()),
    videoTrackByIdentityRef: ref(new Map()),
    onDisconnectedRef: ref(() => {}),
    onConnectFailedRef: ref(undefined),
    micWantedRef: ref(true),
    cameraWantedRef: ref(false),
  };
}

function setters(): VoiceCallRoomConnectionSetters {
  return {
    setConnectionState: vi.fn(),
    setRemoteParticipantCount: vi.fn(),
    setNeedsAudioUnlock: vi.fn(),
    setMuted: vi.fn(),
    setCameraEnabled: vi.fn(),
    setRemoteCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
    setRemoteScreenShareEnabled: vi.fn(),
    setDeviceError: vi.fn(),
    clearParticipantTiles: vi.fn(),
  };
}

function renderConnection() {
  lk.roomOptions = [];
  lk.listeners.clear();
  return renderHook(() =>
    useVoiceCallRoomConnection(
      "wss://lk.test",
      "tok",
      false,
      0,
      refs(),
      setters(),
      () => {},
      () => {},
      () => {},
      () => {},
    ),
  );
}

function adaptiveShareTrack(): RemoteVideoTrack {
  const media = { id: "media", enabled: true } as unknown as MediaStreamTrack;
  return new RemoteVideoTrack(media, "TR_share", undefined as never, {});
}

function pixelDensity(track: RemoteVideoTrack): unknown {
  return (track as unknown as { adaptiveStreamSettings?: { pixelDensity?: unknown } })
    .adaptiveStreamSettings?.pixelDensity;
}

describe("useVoiceCallRoomConnection screen share quality", () => {
  it("publishes a share as its captured size plus a 720p backup, keeping adaptive stream", () => {
    const { unmount } = renderConnection();
    expect(lk.roomOptions).toEqual([
      {
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { screenShareSimulcastLayers: [ScreenSharePresets.h720fps15] },
      },
    ]);
    unmount();
  });

  it("makes a subscribed screen share ask for device pixels, not a camera", () => {
    const { unmount } = renderConnection();
    const participant = { identity: "ana" };
    const share = adaptiveShareTrack();
    const camera = adaptiveShareTrack();
    const subscribed = [...(lk.listeners.get(RoomEvent.TrackSubscribed) ?? [])];
    for (const handler of subscribed) {
      handler(share, { source: Track.Source.ScreenShare }, participant);
      handler(camera, { source: Track.Source.Camera }, participant);
    }
    expect(pixelDensity(share)).toBe("screen");
    expect(pixelDensity(camera)).toBeUndefined();
    unmount();
    expect(lk.listeners.get(RoomEvent.TrackSubscribed)?.size ?? 0).toBe(0);
  });
});
