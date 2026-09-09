import { create } from "zustand";

export type EditorConfigState = {
  cdnDomain: string;
  cdnSigned: boolean;
};

/** Zustand store + hook for editor CDN config. */
export const useConfigStore = create<EditorConfigState>(() => ({
  cdnDomain: "",
  cdnSigned: false,
}));
