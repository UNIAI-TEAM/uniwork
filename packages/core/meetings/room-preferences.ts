"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

export type MeetingBackgroundPreset = "none" | "blur" | "classroom" | "nature" | "custom";

export interface MeetingRoomPreferencesState {
  mirrorCamera: boolean;
  showExpandedLabels: boolean;
  background: MeetingBackgroundPreset;
  /** Data URL for user-uploaded virtual backgrounds. */
  customBackgroundDataUrl: string | null;
  setMirrorCamera: (value: boolean) => void;
  setShowExpandedLabels: (value: boolean) => void;
  setBackground: (value: MeetingBackgroundPreset) => void;
  setCustomBackgroundDataUrl: (value: string | null) => void;
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
      background: "none",
      customBackgroundDataUrl: null,
      setMirrorCamera: (mirrorCamera) => set({ mirrorCamera }),
      setShowExpandedLabels: (showExpandedLabels) => set({ showExpandedLabels }),
      setBackground: (background) => set({ background }),
      setCustomBackgroundDataUrl: (customBackgroundDataUrl) =>
        set({ customBackgroundDataUrl }),
    }),
    {
      name: "uniwork-meeting-room-preferences",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({
        mirrorCamera: state.mirrorCamera,
        showExpandedLabels: state.showExpandedLabels,
        background: state.background,
        customBackgroundDataUrl: state.customBackgroundDataUrl,
      }),
    },
  ),
);
