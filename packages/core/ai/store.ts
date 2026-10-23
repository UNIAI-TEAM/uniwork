"use client";

import { create } from "zustand";

type AskUniPanelFocus = {
  kind: "task" | "meeting" | "email_thread" | "document" | "project" | "room" | "thread" | "message";
  id: string;
  /** The object's name for the composer's chip; never sent. */
  label?: string;
};

/** Client state of the Ask UNI panel (⌘J): open/closed and which conversation is showing. */
interface AiPanelStore {
  open: boolean;
  conversationId: string | null;
  pendingFocus: AskUniPanelFocus | null;
  workspaceId: string | null;
  /** The object the open page shows; set by the page itself, never persisted. */
  page: AskUniPanelFocus | null;
  /** The object picked by hand (the "+" menu or an entry point); wins over `page`. */
  focus: AskUniPanelFocus | null;
  /** `kind:id` of a page whose chip the reader removed. */
  pageDismissed: string | null;
  /** A conversation belongs to one workspace: switching workspace forgets the open one. */
  bindWorkspace: (wsId: string) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  select: (conversationId: string | null) => void;
  openWithFocus: (focus: AskUniPanelFocus) => void;
  clearPendingFocus: () => void;
  setFocus: (focus: AskUniPanelFocus | null) => void;
  /** Moving to another object forgets the dismissal; a same-object update (a rename) keeps it. */
  setPage: (page: AskUniPanelFocus | null) => void;
  dismissPage: () => void;
}

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  open: false,
  conversationId: null,
  pendingFocus: null,
  workspaceId: null,
  page: null,
  focus: null,
  pageDismissed: null,
  bindWorkspace: (wsId) =>
    set((s) =>
      s.workspaceId === wsId
        ? s
        : { workspaceId: wsId, ...(s.workspaceId === null ? {} : { conversationId: null, pendingFocus: null, focus: null }) },
    ),
  setOpen: (open) => set({ open, ...(open ? {} : { pendingFocus: null }) }),
  toggle: () =>
    set((s) => ({ open: !s.open, pendingFocus: s.open ? null : s.pendingFocus })),
  select: (conversationId) => set(conversationId === null ? { conversationId, focus: null } : { conversationId }),
  openWithFocus: (focus) => set({ open: true, conversationId: null, pendingFocus: focus }),
  clearPendingFocus: () => set({ pendingFocus: null }),
  setFocus: (focus) => set({ focus }),
  setPage: (page) =>
    set((s) => ({ page, pageDismissed: page && `${page.kind}:${page.id}` === s.pageDismissed ? s.pageDismissed : null })),
  dismissPage: () => set((s) => ({ pageDismissed: s.page ? `${s.page.kind}:${s.page.id}` : null })),
}));
