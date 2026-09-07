"use client";

import { create } from "zustand";

/** Client state of the Ask UNI panel (⌘J): open/closed and which conversation is showing. */
interface AiPanelStore {
  open: boolean;
  conversationId: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  select: (conversationId: string | null) => void;
}

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  open: false,
  conversationId: null,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  select: (conversationId) => set({ conversationId }),
}));
