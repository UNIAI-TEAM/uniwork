"use client";

import { create } from "zustand";

/**
 * The app-wide modals a global shortcut or a sidebar action can open. Adding
 * one here is what lets the command palette and the shortcut layer reach it
 * without importing the screen that renders it.
 */
export type ModalType = "create-task" | "create-meeting" | "invite-members" | null;

interface ModalStore {
  modal: ModalType;
  data: Record<string, unknown> | null;
  open: (modal: NonNullable<ModalType>, data?: Record<string, unknown> | null) => void;
  close: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  modal: null,
  data: null,
  open: (modal, data = null) => set({ modal, data }),
  close: () => set({ modal: null, data: null }),
}));
