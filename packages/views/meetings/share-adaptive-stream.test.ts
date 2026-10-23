import { renderHook } from "@testing-library/react";
import {
  RemoteVideoTrack,
  RoomEvent,
  ScreenSharePresets,
  Track,
  TrackEvent,
  type ElementInfo,
  type Room,
} from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  holdScreenShareFullscreen,
  SCREEN_SHARE_PUBLISH_DEFAULTS,
  sharpenScreenShareTrack,
  useSharpScreenShares,
  watchScreenShareSharpness,
} from "./share-adaptive-stream";

// A real SDK track, so a livekit-client upgrade that renames the private
// `adaptiveStreamSettings` field (or changes how it is read) fails here.
function remoteVideo(adaptive: object | null = {}): RemoteVideoTrack {
  const media = { id: "media", enabled: true } as unknown as MediaStreamTrack;
  return new RemoteVideoTrack(media, "TR_video", undefined as never, adaptive ?? undefined);
}

function tile(width: number, height: number): ElementInfo {
  return {
    element: {},
    width: () => width,
    height: () => height,
    visible: true,
    pictureInPicture: false,
    visibilityChangedAt: undefined,
    observe: () => {},
    stopObserving: () => {},
  };
}

function requestedSize(track: RemoteVideoTrack): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    track.once(TrackEvent.VideoDimensionsChanged, resolve);
  });
}

function density(track: RemoteVideoTrack): unknown {
  return (track as unknown as { adaptiveStreamSettings?: { pixelDensity?: unknown } })
    .adaptiveStreamSettings?.pixelDensity;
}

const realDpr = window.devicePixelRatio;
function setDpr(value: number) {
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });
}

const realMatchMedia = window.matchMedia;

/**
 * jsdom has no matchMedia. This one keeps one listener list per query and
 * fires a query's listeners when the ratio leaves it, as a browser does when
 * the window moves to another screen.
 */
function fakePixelRatio(initial: number) {
  setDpr(initial);
  const queries = new Map<string, Set<() => void>>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => {
      const listeners = queries.get(media) ?? new Set<() => void>();
      queries.set(media, listeners);
      return {
        media,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      };
    },
  });
  return {
    change(next: number) {
      const left = queries.get(`(resolution: ${window.devicePixelRatio}dppx)`);
      setDpr(next);
      for (const fn of [...(left ?? [])]) fn();
    },
    listeners: () => [...queries.values()].reduce((n, set) => n + set.size, 0),
  };
}

afterEach(() => {
  setDpr(realDpr);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: realMatchMedia });
  vi.useRealTimers();
});

describe("SCREEN_SHARE_PUBLISH_DEFAULTS", () => {
  it("adds a 720p backup layer under the captured size", () => {
    expect(SCREEN_SHARE_PUBLISH_DEFAULTS.screenShareSimulcastLayers).toEqual([
      ScreenSharePresets.h720fps15,
    ]);
    expect(ScreenSharePresets.h720fps15.height).toBe(720);
  });
});

describe("sharpenScreenShareTrack", () => {
  it("makes a share on a Retina screen ask for its tile in device pixels", async () => {
    setDpr(2);
    const track = remoteVideo();
    vi.useFakeTimers();
    track.observeElementInfo(tile(800, 450));
    const before = requestedSize(track);
    vi.runAllTimers();
    // SDK default: CSS pixels at DPR <= 2, so the server would send 540p.
    await expect(before).resolves.toEqual({ width: 800, height: 450 });

    const after = requestedSize(track);
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(true);
    await expect(after).resolves.toEqual({ width: 1600, height: 900 });
  });

  it("asks for a share attached after subscribe in device pixels, never 0x0 first", async () => {
    setDpr(2);
    const track = remoteVideo();
    const requests = vi.fn();
    track.on(TrackEvent.VideoDimensionsChanged, requests);
    // Subscribe comes before attach: nothing is on screen yet to measure.
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(true);
    expect(requests).not.toHaveBeenCalled();

    vi.useFakeTimers();
    track.observeElementInfo(tile(800, 450));
    const first = requestedSize(track);
    vi.runAllTimers();
    await expect(first).resolves.toEqual({ width: 1600, height: 900 });
    expect(requests).toHaveBeenCalledTimes(1);
  });

  it("counts all three device pixels on a DPR 3 phone, past the SDK's 2x cap", async () => {
    setDpr(3);
    const track = remoteVideo();
    sharpenScreenShareTrack(track, Track.Source.ScreenShare);
    vi.useFakeTimers();
    track.observeElementInfo(tile(693, 390));
    const size = requestedSize(track);
    vi.runAllTimers();
    // A landscape phone tile 390 CSS px tall: 0.9 x 1170 > 720, so 1080p.
    await expect(size).resolves.toEqual({ width: 2079, height: 1170 });
  });

  it("uses a ratio below 2 as is, so a DPR 1 screen asks for CSS pixels", async () => {
    setDpr(1);
    const track = remoteVideo();
    sharpenScreenShareTrack(track, Track.Source.ScreenShare);
    vi.useFakeTimers();
    track.observeElementInfo(tile(800, 450));
    const size = requestedSize(track);
    vi.runAllTimers();
    await expect(size).resolves.toEqual({ width: 800, height: 450 });
  });

  it("copies the room's shared settings instead of mutating them", () => {
    setDpr(2);
    const shared = { pauseVideoInBackground: false };
    const track = remoteVideo(shared);
    sharpenScreenShareTrack(track, Track.Source.ScreenShare);
    expect(shared).toEqual({ pauseVideoInBackground: false });
    expect((track as unknown as { adaptiveStreamSettings: object }).adaptiveStreamSettings).toEqual({
      pauseVideoInBackground: false,
      pixelDensity: "screen",
    });
  });

  it("keeps a pixel density the room set itself", () => {
    const track = remoteVideo({ pixelDensity: 1 });
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(false);
    expect(density(track)).toBe(1);
  });

  it("leaves cameras on the SDK default", () => {
    const track = remoteVideo();
    expect(sharpenScreenShareTrack(track, Track.Source.Camera)).toBe(false);
    expect((track as unknown as { adaptiveStreamSettings: object }).adaptiveStreamSettings).toEqual({});
  });

  it("leaves a track without adaptive stream alone", () => {
    const track = remoteVideo(null);
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(false);
    expect(track.isAdaptiveStream).toBe(false);
  });

  it("ignores a missing track and does nothing twice", () => {
    expect(sharpenScreenShareTrack(undefined, Track.Source.ScreenShare)).toBe(false);
    const track = remoteVideo();
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(true);
    expect(sharpenScreenShareTrack(track, Track.Source.ScreenShare)).toBe(false);
  });
});

describe("holdScreenShareFullscreen", () => {
  const realScreen = Object.getOwnPropertyDescriptor(window, "screen");
  afterEach(() => {
    if (realScreen) Object.defineProperty(window, "screen", realScreen);
  });

  function iPhone(dpr: number, width: number, height: number) {
    setDpr(dpr);
    Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
  }

  function videoOf(width: number): HTMLVideoElement {
    const video = document.createElement("video");
    Object.defineProperty(video, "clientWidth", { configurable: true, value: width });
    return video;
  }

  it("asks for the screen's size while the native player shows the share, then the tile's again", async () => {
    iPhone(3, 390, 844);
    const shared = { pauseVideoInBackground: false };
    const track = remoteVideo(shared);
    sharpenScreenShareTrack(track, Track.Source.ScreenShare);
    vi.useFakeTimers();
    track.observeElementInfo(tile(390, 219));
    const first = requestedSize(track);
    vi.runAllTimers();
    // 0.9 x 657 <= 720: the tile alone gets the 720p backup.
    await expect(first).resolves.toEqual({ width: 1170, height: 657 });

    const held = requestedSize(track);
    const release = holdScreenShareFullscreen(track, videoOf(390));
    // The longer side, 844 x 3 device px, spread over the 390 px tile.
    expect(density(track)).toBeCloseTo((844 * 3) / 390);
    const size = await held;
    expect(size.width).toBe(2532);
    expect(size.height).toBeGreaterThan(720 / 0.9);

    const back = requestedSize(track);
    release();
    expect(density(track)).toBe("screen");
    await expect(back).resolves.toEqual({ width: 1170, height: 657 });
    // The room's own settings object was never touched.
    expect(shared).toEqual({ pauseVideoInBackground: false });
  });

  it("keeps a pixel density the room set itself", () => {
    iPhone(3, 390, 844);
    const track = remoteVideo({ pixelDensity: 1 });
    const release = holdScreenShareFullscreen(track, videoOf(390));
    expect(density(track)).toBe(1);
    release();
    expect(density(track)).toBe(1);
  });

  it("does nothing for a missing track or one without adaptive stream", () => {
    const video = videoOf(390);
    expect(() => holdScreenShareFullscreen(undefined, video)()).not.toThrow();
    const track = remoteVideo(null);
    holdScreenShareFullscreen(track, video)();
    expect(track.isAdaptiveStream).toBe(false);
  });
});

type Handler = (...args: unknown[]) => void;

function fakeRoom(publications: { source: Track.Source; track?: RemoteVideoTrack }[] = []) {
  const handlers = new Map<string, Handler>();
  const room = {
    remoteParticipants: new Map([
      ["p1", { trackPublications: new Map(publications.map((p, i) => [`TR_${i}`, p])) }],
    ]),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return room;
    }),
    off: vi.fn((event: string) => {
      handlers.delete(event);
      return room;
    }),
  };
  return { room: room as unknown as Room, handlers };
}

describe("watchScreenShareSharpness", () => {
  it("sharpens shares already subscribed and each one subscribed later, never cameras", () => {
    setDpr(2);
    const existingShare = remoteVideo();
    const existingCamera = remoteVideo();
    const { room, handlers } = fakeRoom([
      { source: Track.Source.ScreenShare, track: existingShare },
      { source: Track.Source.Camera, track: existingCamera },
      { source: Track.Source.ScreenShare },
    ]);
    const stop = watchScreenShareSharpness(room);
    expect(density(existingShare)).toBe("screen");
    expect(density(existingCamera)).toBeUndefined();

    const laterShare = remoteVideo();
    const laterCamera = remoteVideo();
    handlers.get(RoomEvent.TrackSubscribed)?.(laterShare, { source: Track.Source.ScreenShare });
    handlers.get(RoomEvent.TrackSubscribed)?.(laterCamera, { source: Track.Source.Camera });
    expect(density(laterShare)).toBe("screen");
    expect(density(laterCamera)).toBeUndefined();

    stop();
    expect(handlers.has(RoomEvent.TrackSubscribed)).toBe(false);
  });

  it("re-measures shares on screen when the window moves to a screen with another ratio", async () => {
    const ratio = fakePixelRatio(1);
    const share = remoteVideo();
    const camera = remoteVideo();
    const cameraRequests = vi.fn();
    camera.on(TrackEvent.VideoDimensionsChanged, cameraRequests);
    const { room } = fakeRoom([
      { source: Track.Source.ScreenShare, track: share },
      { source: Track.Source.Camera, track: camera },
    ]);
    const stop = watchScreenShareSharpness(room);
    vi.useFakeTimers();
    share.observeElementInfo(tile(800, 450));
    camera.observeElementInfo(tile(320, 180));
    const first = requestedSize(share);
    vi.runAllTimers();
    // 0.9 x 450 <= 720: the 720p backup on the external monitor.
    await expect(first).resolves.toEqual({ width: 800, height: 450 });
    cameraRequests.mockClear();

    // Dragged to the Retina laptop screen: the tile keeps its CSS size, so
    // only the ratio change can trigger a new request.
    const moved = requestedSize(share);
    ratio.change(2);
    await expect(moved).resolves.toEqual({ width: 1600, height: 900 });
    expect(cameraRequests).not.toHaveBeenCalled();

    // Re-armed for the new ratio, and quiet once stopped.
    const back = requestedSize(share);
    ratio.change(1);
    await expect(back).resolves.toEqual({ width: 800, height: 450 });
    stop();
    expect(ratio.listeners()).toBe(0);
  });

  it("follows the mounted room through the hook", () => {
    const { room, handlers } = fakeRoom();
    const { unmount } = renderHook(() => useSharpScreenShares(room));
    expect(handlers.has(RoomEvent.TrackSubscribed)).toBe(true);
    unmount();
    expect(handlers.has(RoomEvent.TrackSubscribed)).toBe(false);
  });
});
