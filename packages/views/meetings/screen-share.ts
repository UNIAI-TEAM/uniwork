import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Room } from "livekit-client";

/**
 * Whether this browser can capture a screen at all. Phone browsers (iOS
 * Safari, Chrome on Android) have no getDisplayMedia, so the control would
 * only ever fail there.
 */
export function screenShareSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * The i18n key for a failed start, or null when the person simply closed the
 * picker. Chrome reports both a cancel and an OS-level block as
 * NotAllowedError; only the block says "system".
 */
export function screenShareErrorKey(error: Error): string | null {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return /system/i.test(error.message) ? "meetings.shareBlockedBySystem" : null;
    case "NotSupportedError":
    case "TypeError":
      return "meetings.shareUnsupported";
    default:
      return "meetings.shareFailed";
  }
}

/**
 * How the presenter's own share is drawn back to them. A tab is drawn: the
 * picker leaves the meeting's own tab out (selfBrowserSurface "exclude"). A
 * window starts hidden behind the card, with a way to show it: it may be the
 * window holding the meeting, and Chrome names no window well enough to tell
 * (labels read "window:<id>:0"), so drawing it could mirror the meeting into
 * itself for the whole room. A whole screen is never drawn, and a browser
 * that does not say what was picked gets that safe answer.
 */
export function ownSharePreview(track: MediaStreamTrack | undefined): "shown" | "hidden" | "none" {
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  if (surface === "browser") return "shown";
  if (surface === "window") return "hidden";
  return "none";
}

type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/**
 * "element" where a tile can go full screen with its overlays; "video" on
 * iPhone Safari, which only puts a <video> in its own player; null otherwise.
 */
function fullscreenSupport(): "element" | "video" | null {
  if (typeof document === "undefined") return null;
  if (document.fullscreenEnabled && typeof Element.prototype.requestFullscreen === "function") return "element";
  if (typeof (HTMLVideoElement.prototype as WebkitVideo).webkitEnterFullscreen === "function") return "video";
  return null;
}

const neverChanges = () => () => {};

// One per share tile that offers full screen: each leaves it if it holds it.
const fullscreenLeaves = new Set<() => void>();

/**
 * Takes a share out of full screen, for what the room cannot show inside it:
 * the tile alone is in the top layer, so a card that needs this viewer (a
 * vote) would open unseen behind it. Anything else's full screen is left be.
 */
export function leaveShareFullscreen(): void {
  for (const leave of fullscreenLeaves) leave();
}

/** How long a full-screen share keeps its overlays up after the last move or key. */
const FULLSCREEN_IDLE_MS = 3000;

/**
 * Full screen for a tile. The tile itself goes full screen, so its name chip
 * and controls come along; Escape and the browser's own exit are followed
 * through fullscreenchange. `idle` says when they should step aside: the tile
 * fills the screen, so hover and focus never end there, and a player's rule
 * (back on a move, a tap or a key, gone after a pause) takes their place.
 */
export function useTileFullscreen(
  tileRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /**
   * Called when iPhone's native player opens on the video; returns what to
   * run when it closes. The player leaves the tile's box as it was, so this
   * is where the share asks for a screen-sized layer (holdScreenShareFullscreen).
   */
  holdNativePlayer?: (video: HTMLVideoElement) => () => void,
) {
  const support = useSyncExternalStore(neverChanges, fullscreenSupport, () => null);
  const [active, setActive] = useState(false);
  const watch = enabled && support === "element";
  const holdRef = useRef(holdNativePlayer);
  useEffect(() => {
    holdRef.current = holdNativePlayer;
  });

  useEffect(() => {
    if (!enabled || support !== "video") return;
    let release: (() => void) | null = null;
    const end = () => {
      release?.();
      release = null;
    };
    // Captured on the document: the video may mount after this runs (a share
    // still loading), and these events do not bubble.
    const onBegin = (event: Event) => {
      const video = videoRef.current;
      if (!video || event.target !== video) return;
      end();
      release = holdRef.current?.(video) ?? null;
    };
    const onEnd = (event: Event) => {
      if (event.target === videoRef.current) end();
    };
    document.addEventListener("webkitbeginfullscreen", onBegin, true);
    document.addEventListener("webkitendfullscreen", onEnd, true);
    return () => {
      document.removeEventListener("webkitbeginfullscreen", onBegin, true);
      document.removeEventListener("webkitendfullscreen", onEnd, true);
      end();
    };
  }, [enabled, support, videoRef]);

  useEffect(() => {
    if (!watch) return;
    const sync = () => setActive(tileRef.current !== null && document.fullscreenElement === tileRef.current);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [watch, tileRef]);

  useEffect(() => {
    if (!enabled || support === null) return;
    const leave = () => {
      if (support === "video") {
        const video = videoRef.current as WebkitVideo | null;
        if (!video?.webkitDisplayingFullscreen) return;
        try {
          video.webkitExitFullscreen?.();
        } catch {
          // Already closing: nothing to leave.
        }
      } else if (tileRef.current !== null && document.fullscreenElement === tileRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
    fullscreenLeaves.add(leave);
    return () => {
      fullscreenLeaves.delete(leave);
    };
  }, [enabled, support, tileRef, videoRef]);

  const on = watch && active;
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!on) return;
    let timer = window.setTimeout(() => setIdle(true), FULLSCREEN_IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), FULLSCREEN_IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown"] as const;
    for (const type of events) document.addEventListener(type, wake, true);
    return () => {
      window.clearTimeout(timer);
      for (const type of events) document.removeEventListener(type, wake, true);
      setIdle(false);
    };
  }, [on]);

  const toggle = () => {
    if (support === "video") {
      // Safari throws InvalidStateError until the video has its metadata (a
      // tile just mounted or resubscribed): the tap does nothing, as it would
      // on a player still loading.
      try {
        (videoRef.current as WebkitVideo | null)?.webkitEnterFullscreen?.();
      } catch {
        // Nothing to show yet.
      }
    } else if (active) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void tileRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  return { available: enabled && support !== null, active: on, idle: on && idle, toggle };
}

// Rooms whose next screen-share stop came from our own controls. A stop that
// did not (the browser's own bar, the OS, a dropped connection) is announced.
const stopsByUser = new WeakSet<Room>();
// How many stops each room's own controls have asked for, kept after the
// watcher takes the mark: a share lock that lands just after asks it too.
const stopCounts = new WeakMap<Room, number>();

export function markScreenShareStopByUser(room: Room): void {
  stopsByUser.add(room);
  stopCounts.set(room, screenShareStopsByUser(room) + 1);
}

/** A count that moves on each stop our own controls ask for in `room`. */
export function screenShareStopsByUser(room: Room): number {
  return stopCounts.get(room) ?? 0;
}

export function takeScreenShareStopByUser(room: Room): boolean {
  const byUser = stopsByUser.has(room);
  stopsByUser.delete(room);
  return byUser;
}
