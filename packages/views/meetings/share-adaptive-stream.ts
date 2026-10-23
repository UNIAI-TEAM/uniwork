import { useEffect } from "react";
import {
  RemoteVideoTrack,
  RoomEvent,
  ScreenSharePresets,
  Track,
  type AdaptiveStreamSettings,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  type TrackPublishDefaults,
} from "livekit-client";

/**
 * A screen share goes out as two layers: the captured size (about 1080p) and
 * a 720p backup for older devices that cannot decode 1080p, small tiles and
 * congested links. Without this the SDK sends the captured size plus a
 * half-size 540p layer, which is what Retina viewers ended up watching.
 * A capture 720 px tall or less yields two same-size layers, which is harmless.
 * Cameras are untouched: this option only applies to screen shares.
 */
export const SCREEN_SHARE_PUBLISH_DEFAULTS = {
  screenShareSimulcastLayers: [ScreenSharePresets.h720fps15],
} satisfies TrackPublishDefaults;

/**
 * Makes a subscribed screen share ask for its tile size in device pixels.
 *
 * With adaptiveStream the SDK reports each tile's size to the server, which
 * then sends the smallest layer at least 0.9 x that height. By default the
 * size is in CSS pixels whenever devicePixelRatio <= 2, so on Retina a share
 * tile under ~600 CSS px tall got the 540p layer stretched 2x and text blurred.
 * Counting device pixels (pixelDensity "screen") the server sends 720p only
 * while 720 >= 0.9 x tile CSS height x devicePixelRatio: DPR 2 tiles taller
 * than ~400 CSS px and DPR 3 phone tiles taller than ~270 CSS px get 1080p,
 * DPR 1 tiles up to ~800 CSS px stay on 720p, and congestion still falls back
 * to 720p.
 *
 * Only tile size and congestion pick the layer: a device whose decoder cannot
 * keep up with 1080p is not detected, so a big tile on a weak DPR 1 desktop,
 * or an old DPR 3 phone that decodes VP8 in software, still gets 1080p. (A mediaCapabilities.decodingInfo check that caps such a
 * viewer with publication.setVideoQuality would be the extension.)
 *
 * Only shares get this. Doing it room-wide (adaptiveStream: { pixelDensity:
 * "screen" }) would roughly double camera bandwidth for a Retina grid.
 *
 * The SDK reads devicePixelRatio only when it measures the tile (on attach and
 * on resize), so a window dragged to a screen with another ratio keeps its
 * layer until watchScreenShareSharpness re-measures it.
 *
 * iPhone full screen is the native player (webkitEnterFullscreen): the <video>
 * keeps its tile-sized CSS box, so the SDK would keep asking for the tile's
 * layer (often the 720p backup) while the player fills the screen.
 * holdScreenShareFullscreen covers that window.
 *
 * Caveat: livekit-client has no per-track API for this. RemoteVideoTrack keeps
 * the room's settings in the private field `adaptiveStreamSettings`, which
 * getPixelDensity() reads, and measures in the private updateDimensions()
 * (checked against 2.22.0). The settings object is shared by every track of
 * the room, so it is copied, never mutated. Re-check on livekit-client
 * upgrades; share-adaptive-stream.test.ts fails if either is renamed.
 *
 * A room that sets pixelDensity itself keeps it. Returns whether the track was
 * changed.
 */
export function sharpenScreenShareTrack(
  track: RemoteTrack | undefined,
  source: Track.Source,
): boolean {
  if (source !== Track.Source.ScreenShare) return false;
  if (!(track instanceof RemoteVideoTrack) || !track.isAdaptiveStream) return false;
  const internals = track as unknown as TrackInternals;
  if (!internals.adaptiveStreamSettings) return false;
  if (internals.adaptiveStreamSettings.pixelDensity !== undefined) return false;
  internals.adaptiveStreamSettings = { ...internals.adaptiveStreamSettings, pixelDensity: "screen" };
  remeasure(track);
  return true;
}

const noop = () => {};

/**
 * While an iPhone shows a share in its native player, asks for the screen's
 * size instead of the tile's: the density is raised so that the tile's CSS
 * width counts as the screen's longer side in device pixels (landscape
 * included). Returns the release, which puts the room's settings back and
 * re-measures, so the tile-sized request returns. Element full screen (desktop,
 * iPad) resizes the tile itself and needs none of this.
 *
 * Same private fields and copy-on-write as sharpenScreenShareTrack; a room
 * that set a numeric pixelDensity itself keeps it.
 */
export function holdScreenShareFullscreen(
  track: Track | undefined,
  video: HTMLVideoElement,
): () => void {
  if (!(track instanceof RemoteVideoTrack) || !track.isAdaptiveStream) return noop;
  const internals = track as unknown as TrackInternals;
  const saved = internals.adaptiveStreamSettings;
  if (!saved || typeof saved.pixelDensity === "number") return noop;
  const screenSide =
    typeof screen === "undefined" ? 0 : Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
  const pixelDensity = Math.max(1, screenSide / Math.max(1, video.clientWidth));
  const held: AdaptiveStreamSettings = { ...saved, pixelDensity };
  internals.adaptiveStreamSettings = held;
  remeasure(track);
  return () => {
    // Settings replaced meanwhile (a re-sharpen) are not ours to undo.
    if (internals.adaptiveStreamSettings !== held) return;
    internals.adaptiveStreamSettings = saved;
    remeasure(track);
  };
}

type TrackInternals = {
  adaptiveStreamSettings?: AdaptiveStreamSettings;
  elementInfos?: unknown[];
  updateDimensions?: () => void;
};

/**
 * Re-sends the size of a tile already on screen instead of waiting for its
 * next resize. A track not yet attached is left alone: measuring it would ask
 * the server for 0x0 (the lowest layer) before the tile reports its real size.
 */
function remeasure(track: RemoteVideoTrack) {
  const internals = track as unknown as TrackInternals;
  if ((internals.elementInfos?.length ?? 0) > 0 && typeof internals.updateDimensions === "function") {
    internals.updateDimensions.call(track);
  }
}

/**
 * Calls onChange each time devicePixelRatio changes (window moved to another
 * screen, browser zoom). The query matches only the current ratio, so it is
 * re-armed after every change. Returns the unsubscribe.
 */
function onPixelRatioChange(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  let query: MediaQueryList | undefined;
  const handle = () => {
    query?.removeEventListener("change", handle);
    onChange();
    arm();
  };
  const arm = () => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener("change", handle);
  };
  arm();
  return () => query?.removeEventListener("change", handle);
}

/**
 * Applies sharpenScreenShareTrack to every screen share in the room, now and
 * as they are subscribed, and re-measures the shares on screen whenever the
 * pixel ratio changes. Returns the unsubscribe.
 */
export function watchScreenShareSharpness(room: Room): () => void {
  const onSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication) => {
    sharpenScreenShareTrack(track, publication.source);
  };
  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      sharpenScreenShareTrack(publication.track, publication.source);
    }
  }
  const stopRatio = onPixelRatioChange(() => {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.source !== Track.Source.ScreenShare) continue;
        if (publication.track instanceof RemoteVideoTrack && publication.track.isAdaptiveStream) {
          remeasure(publication.track);
        }
      }
    }
  });
  return () => {
    room.off(RoomEvent.TrackSubscribed, onSubscribed);
    stopRatio();
  };
}

/** watchScreenShareSharpness for the lifetime of a mounted room. */
export function useSharpScreenShares(room: Room | undefined): void {
  useEffect(() => {
    if (!room) return;
    return watchScreenShareSharpness(room);
  }, [room]);
}
