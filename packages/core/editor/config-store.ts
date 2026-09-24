"use client";

import { create } from "zustand";

export type EditorConfigState = {
  cdnDomain: string;
  cdnSigned: boolean;
};

/** In-memory CDN config for editor attachment URLs. No localStorage. */
export const useConfigStore = create<EditorConfigState>(() => ({
  cdnDomain: "",
  cdnSigned: false,
}));
