"use client";

import { create } from "zustand";
import { draftWriteOwner, registerDraftCleanup } from "../drafts/cleanup-registry";

/**
 * Registry key only: the chat draft lives in memory, as it always has, so
 * nothing is ever written under it. Registering still gives logout and a
 * change of user the reset that keeps one person's unsent text from showing
 * up for the next.
 */
const CHAT_COMPOSER_DRAFT_KEY = "uniwork_chat_composer_drafts";

type ChatComposerDraftState = {
  drafts: Record<string, string>;
  /** Id of the user who wrote `drafts`; see `isOwnedBy`. */
  ownerId: string | null;
  setDraft: (key: string, body: string) => void;
  clearDraft: (key: string) => void;
};

/**
 * What someone is typing in a chat composer, keyed by conversation. It lives
 * here rather than in the chat page's state so a keystroke re-renders the
 * composer that reads it, not the page, the sidebar and the timeline around
 * it. A blank draft is deleted rather than kept.
 */
export const useChatComposerDraftStore = create<ChatComposerDraftState>()((set) => ({
  drafts: {},
  ownerId: null,
  setDraft: (key, body) => {
    const ownerId = draftWriteOwner();
    if (ownerId === null || !key) return;
    set((state) => {
      if ((state.drafts[key] ?? "") === body) return state;
      const next = { ...state.drafts };
      if (body === "") delete next[key];
      else next[key] = body;
      return { drafts: next, ownerId };
    });
  },
  clearDraft: (key) => {
    const ownerId = draftWriteOwner();
    if (ownerId === null) return;
    set((state) => {
      if (!(key in state.drafts)) return state;
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next, ownerId };
    });
  },
}));

/** The current draft for one conversation, read outside React (on send). */
export function readChatComposerDraft(key: string): string {
  return useChatComposerDraftStore.getState().drafts[key] ?? "";
}

registerDraftCleanup({
  storageKey: CHAT_COMPOSER_DRAFT_KEY,
  workspaceScoped: false,
  resetInMemory: () => useChatComposerDraftStore.setState({ drafts: {}, ownerId: null }),
  isOwnedBy: (userId) => {
    const { drafts, ownerId } = useChatComposerDraftStore.getState();
    return ownerId === userId || Object.keys(drafts).length === 0;
  },
});
