"use client";

import { create } from "zustand";

type AskUniPanelFocus = {
  kind: "task" | "meeting" | "email_thread" | "room" | "thread" | "message";
  id: string;
};

/** Client state of the Ask UNI panel (⌘J): open/closed and which conversation is showing. */
interface AiPanelStore {
  open: boolean;
  conversationId: string | null;
  pendingFocus: AskUniPanelFocus | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  select: (conversationId: string | null) => void;
  openWithFocus: (focus: AskUniPanelFocus) => void;
  clearPendingFocus: () => void;
}

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  open: false,
  conversationId: null,
  pendingFocus: null,
  setOpen: (open) => set({ open, ...(open ? {} : { pendingFocus: null }) }),
  toggle: () => set((s) => ({ open: !s.open, pendingFocus: s.open ? null : s.pendingFocus })),
  select: (conversationId) => set({ conversationId }),
  openWithFocus: (focus) => set({ open: true, conversationId: null, pendingFocus: focus }),
  clearPendingFocus: () => set({ pendingFocus: null }),
}));
