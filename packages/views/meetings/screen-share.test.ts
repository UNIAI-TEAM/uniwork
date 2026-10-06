import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Room } from "livekit-client";
import {
  leaveShareFullscreen,
  markScreenShareStopByUser,
  ownSharePreview,
  screenShareErrorKey,
  screenShareStopsByUser,
  screenShareSupported,
  takeScreenShareStopByUser,
  useTileFullscreen,
} from "./screen-share";

function namedError(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  if (original) Object.defineProperty(navigator, "mediaDevices", original);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("screenShareSupported", () => {
  it("is true only where getDisplayMedia exists", () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: () => {} } });
    expect(screenShareSupported()).toBe(true);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    expect(screenShareSupported()).toBe(false);
  });
});

describe("ownSharePreview", () => {
  const track = (settings: Record<string, unknown>) => ({ getSettings: () => settings }) as unknown as MediaStreamTrack;

  it("draws a shared tab, holds a window back, never draws a whole screen", () => {
    expect(ownSharePreview(track({ displaySurface: "browser" }))).toBe("shown");
    // The window may be the one holding the meeting: drawn, it would mirror
    // itself for the whole room, so it starts hidden.
    expect(ownSharePreview(track({ displaySurface: "window" }))).toBe("hidden");
    expect(ownSharePreview(track({ displaySurface: "monitor" }))).toBe("none");
  });

  it("stays safe when the browser does not say what was picked", () => {
    expect(ownSharePreview(track({}))).toBe("none");
    expect(ownSharePreview(undefined)).toBe("none");
  });
});

describe("useTileFullscreen", () => {
  const restore: Array<() => void> = [];
  function stub(target: object, key: string, value: unknown) {
    const own = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    restore.push(() => {
      if (own) Object.defineProperty(target, key, own);
      else Reflect.deleteProperty(target, key);
    });
  }
  afterEach(() => {
    for (const undo of restore.splice(0).reverse()) undo();
  });

  /** A browser with the element Fullscreen API, as desktop browsers and iPad Safari have. */
  function elementFullscreen() {
    stub(document, "fullscreenEnabled", true);
    stub(document, "fullscreenElement", null);
    const enter = vi.fn(function (this: Element) {
      stub(document, "fullscreenElement", this);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      stub(document, "fullscreenElement", null);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    stub(Element.prototype, "requestFullscreen", enter);
    stub(document, "exitFullscreen", exit);
    return { enter, exit };
  }

  function setup(enabled = true) {
    const tile = { current: document.createElement("div") };
    const video = { current: document.createElement("video") };
    const hook = renderHook(() => useTileFullscreen(tile, video, enabled));
    return { tile, video, hook };
  }

  it("puts the tile itself in full screen, so its overlays come along, and follows Escape", () => {
    const { enter, exit } = elementFullscreen();
    const { tile, hook } = setup();
    expect(hook.result.current).toMatchObject({ available: true, active: false });

    act(() => hook.result.current.toggle());
    expect(enter.mock.contexts[0]).toBe(tile.current);
    expect(hook.result.current.active).toBe(true);

    act(() => hook.result.current.toggle());
    expect(exit).toHaveBeenCalledOnce();
    expect(hook.result.current.active).toBe(false);

    // Escape is the browser's: only the fullscreenchange event says so.
    act(() => hook.result.current.toggle());
    act(() => {
      stub(document, "fullscreenElement", null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(hook.result.current.active).toBe(false);
  });

  it("does not claim another element's full screen", () => {
    elementFullscreen();
    const { hook } = setup();
    act(() => {
      stub(document, "fullscreenElement", document.createElement("div"));
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(hook.result.current.active).toBe(false);
  });

  it("falls back to the video's own player on iPhone Safari", () => {
    stub(document, "fullscreenEnabled", false);
    const enterVideo = vi.fn();
    stub(HTMLVideoElement.prototype, "webkitEnterFullscreen", enterVideo);
    const { video, hook } = setup();
    expect(hook.result.current.available).toBe(true);
    act(() => hook.result.current.toggle());
    expect(enterVideo.mock.contexts[0]).toBe(video.current);
  });

  it("swallows the iPhone player's refusal before the video has loaded", () => {
    stub(document, "fullscreenEnabled", false);
    // Safari throws InvalidStateError while readyState < HAVE_METADATA.
    stub(
      HTMLVideoElement.prototype,
      "webkitEnterFullscreen",
      vi.fn(() => {
        throw new DOMException("not ready", "InvalidStateError");
      }),
    );
    const { hook } = setup();
    expect(() => act(() => hook.result.current.toggle())).not.toThrow();
  });

  it("can be left from elsewhere, so a vote that needs this viewer is not hidden behind it", () => {
    const { exit } = elementFullscreen();
    const { hook } = setup();
    leaveShareFullscreen();
    expect(exit).not.toHaveBeenCalled();

    act(() => hook.result.current.toggle());
    act(() => leaveShareFullscreen());
    expect(exit).toHaveBeenCalledOnce();
    expect(hook.result.current.active).toBe(false);
  });

  it("leaves another element's full screen alone", () => {
    const { exit } = elementFullscreen();
    setup();
    stub(document, "fullscreenElement", document.createElement("div"));
    leaveShareFullscreen();
    expect(exit).not.toHaveBeenCalled();
  });

  it("closes the iPhone player when it shows the share", () => {
    stub(document, "fullscreenEnabled", false);
    stub(HTMLVideoElement.prototype, "webkitEnterFullscreen", vi.fn());
    const exitVideo = vi.fn();
    stub(HTMLVideoElement.prototype, "webkitExitFullscreen", exitVideo);
    const { video, hook } = setup();
    leaveShareFullscreen();
    expect(exitVideo).not.toHaveBeenCalled();

    stub(video.current, "webkitDisplayingFullscreen", true);
    leaveShareFullscreen();
    expect(exitVideo.mock.contexts[0]).toBe(video.current);
    hook.unmount();
  });

  it("holds a screen-sized layer while the iPhone player shows the share", () => {
    stub(document, "fullscreenEnabled", false);
    stub(HTMLVideoElement.prototype, "webkitEnterFullscreen", vi.fn());
    const release = vi.fn();
    const hold = vi.fn((_video: HTMLVideoElement) => release);
    const tile = { current: document.createElement("div") };
    const video = { current: document.createElement("video") };
    document.body.append(video.current);
    const hook = renderHook(() => useTileFullscreen(tile, video, true, hold));

    video.current.dispatchEvent(new Event("webkitbeginfullscreen"));
    expect(hold).toHaveBeenCalledOnce();
    expect(hold.mock.calls[0]?.[0]).toBe(video.current);
    expect(release).not.toHaveBeenCalled();

    video.current.dispatchEvent(new Event("webkitendfullscreen"));
    expect(release).toHaveBeenCalledOnce();

    // Closed by unmount (the share ended) while the player is up.
    video.current.dispatchEvent(new Event("webkitbeginfullscreen"));
    hook.unmount();
    expect(release).toHaveBeenCalledTimes(2);
    video.current.remove();
  });

  it("offers nothing where neither exists, or on a tile that is not a share", () => {
    stub(document, "fullscreenEnabled", false);
    expect(setup().hook.result.current.available).toBe(false);
    elementFullscreen();
    expect(setup(false).hook.result.current.available).toBe(false);
  });
});

describe("screenShareErrorKey", () => {
  it("treats a closed picker as no error and an OS block as one", () => {
    expect(screenShareErrorKey(namedError("NotAllowedError", "Permission denied"))).toBeNull();
    expect(screenShareErrorKey(namedError("NotAllowedError", "Permission denied by system"))).toBe(
      "meetings.shareBlockedBySystem",
    );
  });

  it("names an unsupported browser and a capture that would not start", () => {
    expect(screenShareErrorKey(namedError("NotSupportedError"))).toBe("meetings.shareUnsupported");
    expect(screenShareErrorKey(namedError("NotReadableError"))).toBe("meetings.shareFailed");
    expect(screenShareErrorKey(namedError("AbortError"))).toBe("meetings.shareFailed");
  });
});

describe("screen-share stop intent", () => {
  it("is consumed once per room", () => {
    const room = {} as Room;
    expect(takeScreenShareStopByUser(room)).toBe(false);
    markScreenShareStopByUser(room);
    expect(takeScreenShareStopByUser(room)).toBe(true);
    expect(takeScreenShareStopByUser(room)).toBe(false);
  });

  it("is counted per room, and the count outlives taking the mark", () => {
    const room = {} as Room;
    expect(screenShareStopsByUser(room)).toBe(0);
    markScreenShareStopByUser(room);
    takeScreenShareStopByUser(room);
    expect(screenShareStopsByUser(room)).toBe(1);
    expect(screenShareStopsByUser({} as Room)).toBe(0);
  });
});
