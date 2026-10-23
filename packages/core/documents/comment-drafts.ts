"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { draftWriteOwner, registerDraftCleanup } from "../drafts/cleanup-registry";
import { defaultStorage } from "../platform/storage";

/**
 * Persist key, shared between the store and its cleanup registration so the
 * two can never drift - a drifted key is exactly the leak the registry exists
 * to prevent.
 */
const DOCUMENT_COMMENT_DRAFT_STORAGE_KEY = "uniwork_document_comment_drafts";

/**
 * Identity of one document comment composer. The draft belongs to the person
 * who typed it: the account id is part of the key, so two accounts on the
 * same browser never share (or even see) each other's unsent text, and the
 * workspace/document/parent segments keep a thread's boxes apart - a reply
 * box and the root box of the same document are different drafts, exactly
 * like task comments.
 */
export interface DocumentCommentDraftTarget {
  accountId: string;
  orgId: string;
  wsId: string;
  documentId: string;
  /** ULID of the comment being replied to; empty/absent is the root box. */
  parentId?: string | null;
}

/** The one key format: `<account>/<org>/<workspace>/<document>/<parent>`. */
export function documentCommentDraftKey(target: DocumentCommentDraftTarget): string {
  return [
    target.accountId,
    target.orgId,
    target.wsId,
    target.documentId,
    target.parentId || "root",
  ].join("/");
}

type DocumentCommentDraftState = {
  drafts: Record<string, string>;
  /** Id of the user who wrote `drafts`, persisted with them; see `isOwnedBy`. */
  ownerId: string | null;
  draftFor: (key: string) => string;
  setDraft: (key: string, body: string) => void;
  clearDraft: (key: string) => void;
};

/** A key is only ever readable/writable by the account it names: the first
 *  segment IS the account id, so a key built for someone else is not this
 *  session's to touch even before the store's owner check. */
function keyBelongsTo(key: string, accountId: string): boolean {
  return key.startsWith(`${accountId}/`);
}

/**
 * What a person typed into a document comment box but has not sent. A blank
 * draft is deleted rather than stored, or the map grows forever as people
 * open boxes they never use.
 *
 * Not workspace-scoped storage: the account/org/workspace segments live in
 * the key, so the persisted map is already tenant- and person-scoped and does
 * not need the `:slug` suffix `createWorkspaceAwareStorage` adds.
 */
export const useDocumentCommentDraftStore = create<DocumentCommentDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      ownerId: null,
      // Reads are refused for a key another account owns and while signed
      // out: a draft is only ever visible to the person who wrote it.
      draftFor: (key) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null || !keyBelongsTo(key, ownerId)) return "";
        return get().drafts[key] ?? "";
      },
      // Both writes are refused while signed out or for another account's
      // key, and record the signed-in user as the owner otherwise.
      setDraft: (key, body) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null || !keyBelongsTo(key, ownerId)) return;
        set((state) => {
          const next = { ...state.drafts };
          if (body.trim() === "") delete next[key];
          else next[key] = body;
          return { drafts: next, ownerId };
        });
      },
      clearDraft: (key) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null || !keyBelongsTo(key, ownerId)) return;
        set((state) => {
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next, ownerId };
        });
      },
    }),
    {
      name: DOCUMENT_COMMENT_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);

/**
 * Cleanup on logout and when a different user signs in; registered at module
 * load, which is the registry's contract (drafts/register-all-drafts imports
 * this module so the registration has run before any cleanup path executes).
 *
 * `workspaceScoped: false`: the store persists through `defaultStorage`, so
 * the real localStorage key is the bare `uniwork_document_comment_drafts`;
 * workspace identity is inside each draft key instead.
 *
 * Drafts saved before the store recorded an owner hydrate with `ownerId`
 * null, so they belong to no one who signs in and are released at the first
 * sign-in.
 */
registerDraftCleanup({
  storageKey: DOCUMENT_COMMENT_DRAFT_STORAGE_KEY,
  workspaceScoped: false,
  resetInMemory: () => useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null }),
  isOwnedBy: (userId) => {
    const { drafts, ownerId } = useDocumentCommentDraftStore.getState();
    return ownerId === userId || Object.keys(drafts).length === 0;
  },
});
