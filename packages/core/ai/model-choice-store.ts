"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

interface AskModelChoice {
  /** Model key; "" means Auto. */
  model: string;
  /** "low" | "medium" | "high"; "" means Auto. */
  effort: string;
  /** Epoch ms until which the composer's notes stay folded into their corner sign; 0 shows them. */
  notesHiddenUntil: number;
  setModel: (key: string) => void;
  setEffort: (effort: string) => void;
  hideNotes: (until: number) => void;
  showNotes: () => void;
}

/** The asker's model and effort pick, and how long the composer's notes stay folded, remembered per device (R17). */
export const useAskModelChoice = create<AskModelChoice>()(
  persist(
    (set) => ({
      model: "",
      effort: "",
      notesHiddenUntil: 0,
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      hideNotes: (notesHiddenUntil) => set({ notesHiddenUntil }),
      showNotes: () => set({ notesHiddenUntil: 0 }),
    }),
    {
      name: "uniwork_ask_uni_model",
      storage: createJSONStorage(() => defaultStorage),
      version: 1,
      partialize: (s) => ({ model: s.model, effort: s.effort, notesHiddenUntil: s.notesHiddenUntil }),
    },
  ),
);
