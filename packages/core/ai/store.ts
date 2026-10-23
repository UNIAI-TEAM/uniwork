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
  /** The focus each conversation was started with: the server does not return it, so it holds for this session. */
  focusByConversation: Record<string, AskUniPanelFocus>;
  /** The latest conversation asked about each meeting, so a meeting's Ask box finds its answer again. */
  conversationByMeeting: Record<string, string>;
  /** A conversation belongs to one workspace: switching workspace forgets the open one. */
  bindWorkspace: (wsId: string) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Opening another conversation (or a new one) drops a focus that was meant for a fresh question. */
  select: (conversationId: string | null) => void;
  openWithFocus: (focus: AskUniPanelFocus) => void;
  /** Another screen hands the panel a conversation it started, with the focus it was asked with. */
  openConversation: (conversationId: string, focus: AskUniPanelFocus) => void;
  rememberFocus: (conversationId: string, focus: AskUniPanelFocus) => void;
  /** Logout: the next person on this browser starts with nothing of the last one's conversations. */
  reset: () => void;
  /** A deleted conversation must not be continued from a meeting's Ask box. */
  forgetConversation: (conversationId: string) => void;
  clearPendingFocus: () => void;
  setFocus: (focus: AskUniPanelFocus | null) => void;
  /** Moving to another object forgets the dismissal; a same-object update (a rename) keeps it. */
  setPage: (page: AskUniPanelFocus | null) => void;
  dismissPage: () => void;
}

function remembered(s: AiPanelStore, conversationId: string, focus: AskUniPanelFocus) {
  return {
    focusByConversation: { ...s.focusByConversation, [conversationId]: focus },
    conversationByMeeting:
      focus.kind === "meeting" ? { ...s.conversationByMeeting, [focus.id]: conversationId } : s.conversationByMeeting,
  };
}

const EMPTY: Pick<
  AiPanelStore,
  | "open"
  | "conversationId"
  | "pendingFocus"
  | "workspaceId"
  | "page"
  | "focus"
  | "pageDismissed"
  | "focusByConversation"
  | "conversationByMeeting"
> = {
  open: false,
  conversationId: null,
  pendingFocus: null,
  workspaceId: null,
  page: null,
  focus: null,
  pageDismissed: null,
  focusByConversation: {},
  conversationByMeeting: {},
};

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  ...EMPTY,
  reset: () => set(EMPTY),
  bindWorkspace: (wsId) =>
    set((s) =>
      s.workspaceId === wsId
        ? s
        : { workspaceId: wsId, ...(s.workspaceId === null ? {} : { conversationId: null, pendingFocus: null, focus: null }) },
    ),
  setOpen: (open) => set({ open, ...(open ? {} : { pendingFocus: null }) }),
  toggle: () =>
    set((s) => ({ open: !s.open, pendingFocus: s.open ? null : s.pendingFocus })),
  select: (conversationId) =>
    set(conversationId === null ? { conversationId, pendingFocus: null, focus: null } : { conversationId, pendingFocus: null }),
  openWithFocus: (focus) => set({ open: true, conversationId: null, pendingFocus: focus }),
  openConversation: (conversationId, focus) =>
    set((s) => ({ open: true, conversationId, pendingFocus: null, focus, ...remembered(s, conversationId, focus) })),
  rememberFocus: (conversationId, focus) => set((s) => remembered(s, conversationId, focus)),
  forgetConversation: (conversationId) =>
    set((s) => ({
      conversationId: s.conversationId === conversationId ? null : s.conversationId,
      focusByConversation: Object.fromEntries(Object.entries(s.focusByConversation).filter(([id]) => id !== conversationId)),
      conversationByMeeting: Object.fromEntries(
        Object.entries(s.conversationByMeeting).filter(([, id]) => id !== conversationId),
      ),
    })),
  clearPendingFocus: () => set({ pendingFocus: null }),
  setFocus: (focus) => set({ focus }),
  setPage: (page) =>
    set((s) => ({ page, pageDismissed: page && `${page.kind}:${page.id}` === s.pageDismissed ? s.pageDismissed : null })),
  dismissPage: () => set((s) => ({ pageDismissed: s.page ? `${s.page.kind}:${s.page.id}` : null })),
}));
