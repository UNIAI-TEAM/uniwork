"use client";

import { create } from "zustand";

type AskUniPanelFocus = {
  kind: "task" | "meeting" | "email_thread" | "document" | "project" | "room" | "thread" | "message";
  id: string;
  /** The object's name for the composer's chip; never sent. */
  label?: string;
};

/** What the dock shows: the conversation or the memory screen. */
type AiPanelView = "thread" | "memory";

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
  view: AiPanelView;
  /** Text the composer takes once (a chip of the memory help strip): it appends it, focuses, then sets this back to null. */
  composerPrefill: string | null;
  /** The strip above the composer that says what UNI remembers and offers starters ("Sửa bằng cách nói với UNI"). */
  memoryHelp: boolean;
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
  setView: (view: AiPanelView) => void;
  setComposerPrefill: (text: string | null) => void;
  setMemoryHelp: (open: boolean) => void;
  /** Back to the conversation with the memory help strip open. */
  openMemoryHelp: () => void;
}

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  open: false,
  conversationId: null,
  pendingFocus: null,
  workspaceId: null,
  page: null,
  focus: null,
  pageDismissed: null,
  view: "thread",
  composerPrefill: null,
  memoryHelp: false,
  bindWorkspace: (wsId) =>
    set((s) =>
      s.workspaceId === wsId
        ? s
        : { workspaceId: wsId, ...(s.workspaceId === null ? {} : { conversationId: null, pendingFocus: null, focus: null, view: "thread" as const, composerPrefill: null, memoryHelp: false }) },
    ),
  setOpen: (open) => set({ open, ...(open ? {} : { pendingFocus: null, view: "thread" as const, memoryHelp: false }) }),
  toggle: () =>
    set((s) => ({ open: !s.open, pendingFocus: s.open ? null : s.pendingFocus, ...(s.open ? { view: "thread" as const, memoryHelp: false } : {}) })),
  select: (conversationId) => set(conversationId === null ? { conversationId, focus: null } : { conversationId }),
  openWithFocus: (focus) => set({ open: true, conversationId: null, pendingFocus: focus }),
  clearPendingFocus: () => set({ pendingFocus: null }),
  setFocus: (focus) => set({ focus }),
  setPage: (page) =>
    set((s) => ({ page, pageDismissed: page && `${page.kind}:${page.id}` === s.pageDismissed ? s.pageDismissed : null })),
  setView: (view) => set({ view }),
  setComposerPrefill: (composerPrefill) => set({ composerPrefill }),
  setMemoryHelp: (memoryHelp) => set({ memoryHelp }),
  openMemoryHelp: () => set({ view: "thread", memoryHelp: true }),
  dismissPage: () => set((s) => ({ pageDismissed: s.page ? `${s.page.kind}:${s.page.id}` : null })),
}));
