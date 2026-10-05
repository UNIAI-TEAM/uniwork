"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

export type MeetingBackgroundPreset = "none" | "blur" | "classroom" | "nature" | "custom";

export type MeetingViewLayout = "auto" | "tiled" | "spotlight" | "sidebar";

export const MEETING_VIEW_LAYOUTS: readonly MeetingViewLayout[] = [
  "auto",
  "tiled",
  "spotlight",
  "sidebar",
] as const;

export const MIN_MEETING_TILES = 4;
export const MAX_MEETING_TILES = 16;
export const DEFAULT_MEETING_TILES = 6;

/** Past this many people on the roster, a newcomer joins with the mic off unless they chose otherwise. */
export const CROWDED_MEETING_SIZE = 10;

/**
 * Whether prejoin starts with the mic on: the person's last choice when they
 * made one; otherwise on, except in a crowded meeting, where an open mic is
 * noise for everyone (and churn for the room's speaker detection).
 */
export function prejoinMicOn(remembered: boolean | null, rosterSize: number | undefined): boolean {
  if (remembered !== null) return remembered;
  return rosterSize === undefined || rosterSize <= CROWDED_MEETING_SIZE;
}

export interface MeetingRoomPreferencesState {
  mirrorCamera: boolean;
  showExpandedLabels: boolean;
  /** When true, the in-room control bar hides when the pointer leaves the video tile area. */
  controlBarAutoHide: boolean;
  background: MeetingBackgroundPreset;
  /** Data URL for user-uploaded virtual backgrounds. */
  customBackgroundDataUrl: string | null;
  viewLayout: MeetingViewLayout;
  maxTiles: number;
  hideTilesWithoutVideo: boolean;
  /** The mic choice last made in prejoin; null until the person makes one. */
  joinWithMic: boolean | null;
  setMirrorCamera: (value: boolean) => void;
  setShowExpandedLabels: (value: boolean) => void;
  setControlBarAutoHide: (value: boolean) => void;
  setBackground: (value: MeetingBackgroundPreset) => void;
  setCustomBackgroundDataUrl: (value: string | null) => void;
  setViewLayout: (value: MeetingViewLayout) => void;
  setMaxTiles: (value: number) => void;
  setHideTilesWithoutVideo: (value: boolean) => void;
  setJoinWithMic: (value: boolean) => void;
}

export const MEETING_BACKGROUND_PRESETS: readonly MeetingBackgroundPreset[] = [
  "none",
  "blur",
  "classroom",
  "nature",
  "custom",
] as const;

/** Public paths for bundled preset images (served by the web host). */
export const MEETING_BACKGROUND_IMAGE_PATHS = {
  classroom: "/meetings/backgrounds/classroom.svg",
  nature: "/meetings/backgrounds/nature.svg",
} as const;

export function resolveMeetingBackgroundImagePath(
  background: MeetingBackgroundPreset,
  customBackgroundDataUrl: string | null,
): string | null {
  switch (background) {
    case "classroom":
      return MEETING_BACKGROUND_IMAGE_PATHS.classroom;
    case "nature":
      return MEETING_BACKGROUND_IMAGE_PATHS.nature;
    case "custom":
      return customBackgroundDataUrl;
    default:
      return null;
  }
}

export const useMeetingRoomPreferencesStore = create<MeetingRoomPreferencesState>()(
  persist(
    (set) => ({
      mirrorCamera: true,
      showExpandedLabels: true,
      controlBarAutoHide: false,
      background: "none",
      customBackgroundDataUrl: null,
      viewLayout: "auto",
      maxTiles: DEFAULT_MEETING_TILES,
      hideTilesWithoutVideo: false,
      joinWithMic: null,
      setMirrorCamera: (mirrorCamera) => set({ mirrorCamera }),
      setShowExpandedLabels: (showExpandedLabels) => set({ showExpandedLabels }),
      setControlBarAutoHide: (controlBarAutoHide) => set({ controlBarAutoHide }),
      setBackground: (background) => set({ background }),
      setCustomBackgroundDataUrl: (customBackgroundDataUrl) =>
        set({ customBackgroundDataUrl }),
      setViewLayout: (viewLayout) => set({ viewLayout }),
      setMaxTiles: (maxTiles) =>
        set({ maxTiles: Math.min(MAX_MEETING_TILES, Math.max(MIN_MEETING_TILES, maxTiles)) }),
      setHideTilesWithoutVideo: (hideTilesWithoutVideo) => set({ hideTilesWithoutVideo }),
      setJoinWithMic: (joinWithMic) => set({ joinWithMic }),
    }),
    {
      name: "uniwork-meeting-room-preferences",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({
        mirrorCamera: state.mirrorCamera,
        showExpandedLabels: state.showExpandedLabels,
        controlBarAutoHide: state.controlBarAutoHide,
        background: state.background,
        customBackgroundDataUrl: state.customBackgroundDataUrl,
        viewLayout: state.viewLayout,
        maxTiles: state.maxTiles,
        hideTilesWithoutVideo: state.hideTilesWithoutVideo,
        joinWithMic: state.joinWithMic,
      }),
    },
  ),
);
