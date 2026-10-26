"use client";

import { create } from "zustand";
import type { AiMessage, AskUniTranscriptTurn } from "../types/ai";

export const MAX_TRANSIENT_TURNS = 20;
export const MAX_TRANSIENT_CHARS = 32_000;

export type AskUniPanelFocus = {
  kind: "task" | "meeting" | "email_thread" | "document" | "drive_file" | "project" | "room" | "thread" | "message";
  id: string;
  /** The object's name for the composer's chip; never sent. */
  label?: string;
  /** The caller's Google account email when reading a Drive file; display-only, never sent. */
  accountEmail?: string;
  /** The Google Drive open URL for the file; display-only, never sent. */
  openUrl?: string;
};

/**
 * Sliding window over transient messages (spec §9): drops the oldest turns one
 * by one until at most 20 turns and at most 32,000 total characters remain.
 */
export function buildTransientTranscript(messages: readonly Pick<AiMessage, "role" | "content">[]): {
  transcript: AskUniTranscriptTurn[];
  trimmed: boolean;
} {
  const turns: AskUniTranscriptTurn[] = messages
    .filter(
      (m): m is Pick<AiMessage, "role" | "content"> & { role: "user" | "assistant" } =>
        (m.role === "user" || m.role === "assistant") && m.content.trim() !== "",
    )
    .map((m) => ({ role: m.role, text: m.content }));
  let start = 0;
  let totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (start < turns.length && (turns.length - start > MAX_TRANSIENT_TURNS || totalChars > MAX_TRANSIENT_CHARS)) {
    totalChars -= turns[start]!.text.length;
    start += 1;
  }
  return {
    transcript: start === 0 ? turns : turns.slice(start),
    trimmed: start > 0,
  };
}

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
  /** The focus each conversation was started with: the server does not return it, so it holds for this session. */
  focusByConversation: Record<string, AskUniPanelFocus>;
  /** The latest conversation asked about each meeting, so a meeting's Ask box finds its answer again. */
  conversationByMeeting: Record<string, string>;
  view: AiPanelView;
  /** Text the composer takes once (a chip of the memory help strip): it appends it, focuses, then sets this back to null. */
  composerPrefill: string | null;
  /** The strip above the composer that says what UNI remembers and offers starters ("Sửa bằng cách nói với UNI"). */
  memoryHelp: boolean;
  /** In-memory turns for transient conversations (`drive_file` focus); never persisted. */
  transientMessages: AiMessage[];
  /** True once the sliding window dropped older turns in this transient conversation. */
  transientWindowTrimmed: boolean;
  /** Monotonic counter bumped whenever the transient transcript is cleared, so the stream hook resets. */
  transientEpoch: number;
  /** A conversation belongs to one workspace: switching workspace forgets the open one. */
  bindWorkspace: (wsId: string) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Opening another conversation (or a new one) drops a focus that was meant for a fresh question. */
  select: (conversationId: string | null) => void;
  /** Sets the conversation id announced by a non-transient `run` frame without clearing/bumping transient state. */
  setConversationFromRun: (conversationId: string) => void;
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
  setView: (view: AiPanelView) => void;
  setComposerPrefill: (text: string | null) => void;
  setMemoryHelp: (open: boolean) => void;
  /** Back to the conversation with the memory help strip open. */
  openMemoryHelp: () => void;
  /** Appends turns to the in-memory transient transcript and updates whether the window has slid. */
  appendTransientTurn: (question: AiMessage, answer: AiMessage) => void;
  /** Marks that sending the next transient question slid the transcript window. */
  setTransientWindowTrimmed: (trimmed: boolean) => void;
  /** Clears the in-memory transient transcript. */
  clearTransient: () => void;
}

function remembered(s: AiPanelStore, conversationId: string, focus: AskUniPanelFocus) {
  return {
    focusByConversation: { ...s.focusByConversation, [conversationId]: focus },
    conversationByMeeting:
      focus.kind === "meeting" ? { ...s.conversationByMeeting, [focus.id]: conversationId } : s.conversationByMeeting,
  };
}

function clearedTransient(s: AiPanelStore) {
  const wasTransient =
    s.transientMessages.length > 0 ||
    s.transientWindowTrimmed ||
    (s.conversationId === null &&
      (s.focus?.kind === "drive_file" ||
        s.pendingFocus?.kind === "drive_file" ||
        (!s.focus &&
          s.page?.kind === "drive_file" &&
          s.pageDismissed !== `${s.page.kind}:${s.page.id}`)));
  if (!wasTransient) return {};
  return {
    transientMessages: [],
    transientWindowTrimmed: false,
    transientEpoch: s.transientEpoch + 1,
  };
}

function sameFocusObject(a: AskUniPanelFocus | null, b: AskUniPanelFocus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
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
  | "view"
  | "composerPrefill"
  | "memoryHelp"
  | "transientMessages"
  | "transientWindowTrimmed"
  | "transientEpoch"
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
  view: "thread",
  composerPrefill: null,
  memoryHelp: false,
  transientMessages: [],
  transientWindowTrimmed: false,
  transientEpoch: 0,
};

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  ...EMPTY,
  reset: () => set(EMPTY),
  bindWorkspace: (wsId) =>
    set((s) =>
      s.workspaceId === wsId
        ? s
        : {
            workspaceId: wsId,
            ...(s.workspaceId === null
              ? {}
              : {
                  conversationId: null,
                  pendingFocus: null,
                  focus: null,
                  view: "thread" as const,
                  composerPrefill: null,
                  memoryHelp: false,
                  ...clearedTransient(s),
                }),
          },
    ),
  setOpen: (open) =>
    set((s) => ({
      open,
      ...(open
        ? {}
        : {
            pendingFocus: null,
            view: "thread" as const,
            memoryHelp: false,
            ...(s.focus?.kind === "drive_file" ? { focus: null } : {}),
            ...clearedTransient(s),
          }),
    })),
  toggle: () =>
    set((s) => ({
      open: !s.open,
      pendingFocus: s.open ? null : s.pendingFocus,
      ...(s.open
        ? {
            view: "thread" as const,
            memoryHelp: false,
            ...(s.focus?.kind === "drive_file" ? { focus: null } : {}),
            ...clearedTransient(s),
          }
        : {}),
    })),
  select: (conversationId) =>
    set((s) =>
      conversationId === null
        ? { conversationId, pendingFocus: null, focus: null, ...clearedTransient(s) }
        : {
            conversationId,
            pendingFocus: null,
            ...(s.focus?.kind === "drive_file" ? { focus: null } : {}),
            ...clearedTransient(s),
          },
    ),
  setConversationFromRun: (conversationId) =>
    set((s) => ({
      conversationId,
      pendingFocus: null,
      ...(s.focus?.kind === "drive_file" ? { focus: null } : {}),
    })),
  openWithFocus: (focus) =>
    set((s) => {
      const active = s.focus ?? s.pendingFocus;
      const changed = !sameFocusObject(active, focus);
      return {
        open: true,
        conversationId: null,
        pendingFocus: focus,
        ...(changed ? clearedTransient(s) : {}),
      };
    }),
  openConversation: (conversationId, focus) =>
    set((s) => ({
      open: true,
      conversationId,
      pendingFocus: null,
      focus,
      ...remembered(s, conversationId, focus),
      ...clearedTransient(s),
    })),
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
  setFocus: (focus) =>
    set((s) => {
      const changed = !sameFocusObject(s.focus, focus);
      return {
        focus,
        ...(changed && (s.transientMessages.length > 0 || s.focus?.kind === "drive_file" || focus?.kind === "drive_file")
          ? clearedTransient(s)
          : {}),
      };
    }),
  setPage: (page) =>
    set((s) => {
      const changed = !sameFocusObject(s.page, page);
      return {
        page,
        pageDismissed: page && `${page.kind}:${page.id}` === s.pageDismissed ? s.pageDismissed : null,
        ...(changed && !s.focus && (s.transientMessages.length > 0 || s.page?.kind === "drive_file" || page?.kind === "drive_file")
          ? clearedTransient(s)
          : {}),
      };
    }),
  setView: (view) => set({ view }),
  setComposerPrefill: (composerPrefill) => set({ composerPrefill }),
  setMemoryHelp: (memoryHelp) => set({ memoryHelp }),
  openMemoryHelp: () => set({ view: "thread", memoryHelp: true }),
  dismissPage: () =>
    set((s) => ({
      pageDismissed: s.page ? `${s.page.kind}:${s.page.id}` : null,
      ...(s.page?.kind === "drive_file" &&
      !s.focus &&
      (s.transientMessages.length > 0 || s.transientWindowTrimmed)
        ? clearedTransient(s)
        : {}),
    })),
  appendTransientTurn: (question, answer) =>
    set((s) => {
      const next = [...s.transientMessages, question, answer];
      const { trimmed } = buildTransientTranscript(next);
      return {
        transientMessages: next,
        transientWindowTrimmed: s.transientWindowTrimmed || trimmed,
      };
    }),
  setTransientWindowTrimmed: (trimmed) =>
    set((s) => ({ transientWindowTrimmed: s.transientWindowTrimmed || trimmed })),
  clearTransient: () => set((s) => clearedTransient(s)),
}));
