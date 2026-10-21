"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

interface AskModelChoice {
  /** Model key; "" means Auto. */
  model: string;
  /** "low" | "medium" | "high"; "" means Auto. */
  effort: string;
  setModel: (key: string) => void;
  setEffort: (effort: string) => void;
}

/** The asker's model and effort pick, remembered per device (R17). */
export const useAskModelChoice = create<AskModelChoice>()(
  persist(
    (set) => ({
      model: "",
      effort: "",
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
    }),
    {
      name: "uniwork_ask_uni_model",
      storage: createJSONStorage(() => defaultStorage),
      version: 1,
      partialize: (s) => ({ model: s.model, effort: s.effort }),
    },
  ),
);
