"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { draftWriteOwner, registerDraftCleanup } from "../../drafts/cleanup-registry";
import { defaultStorage } from "../../platform/storage";

/**
 * Persist key, shared between the store and its cleanup registration so the
 * two can never drift — a drifted key is exactly the leak the registry exists
 * to prevent.
 */
const COMMENT_DRAFT_STORAGE_KEY = "uniwork_task_comment_drafts";

type CommentDraftState = {
  drafts: Record<string, string>;
  /** Id of the user who wrote `drafts`, persisted with them; see `isOwnedBy`. */
  ownerId: string | null;
  draftFor: (key: string) => string;
  setDraft: (key: string, body: string) => void;
  clearDraft: (key: string) => void;
};

/**
 * What a person typed but has not sent. Keyed by composer, so a task's main box
 * and each reply box keep their own text. A blank draft is deleted rather than
 * stored, or the map grows forever as people open boxes they never use.
 *
 * Not workspace-scoped storage: keys are `taskId` or `taskId:parentId`, and
 * task ids are globally unique ULIDs, so there is no cross-workspace
 * collision risk the way there is for view-mode-style keys.
 */
export const useCommentDraftStore = create<CommentDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      ownerId: null,
      draftFor: (key) => get().drafts[key] ?? "",
      // Both writes are refused while signed out, and record the signed-in
      // user as the owner otherwise: see `draftWriteOwner`.
      setDraft: (key, body) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const next = { ...state.drafts };
          if (body.trim() === "") delete next[key];
          else next[key] = body;
          return { drafts: next, ownerId };
        });
      },
      clearDraft: (key) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next, ownerId };
        });
      },
    }),
    {
      name: COMMENT_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);

/**
 * Logout / workspace-delete cleanup. Registered at module load, which is the
 * registry's contract — `drafts/register-all-drafts` imports this module so
 * the registration has run before any cleanup path executes.
 *
 * `workspaceScoped: false`: this store persists through `defaultStorage`, not
 * `createWorkspaceAwareStorage`, so the real localStorage key is the bare
 * `uniwork_task_comment_drafts` with no `:slug` suffix. Claiming true would
 * make cleanup remove a `...:slug` key that never existed and leave the real
 * one behind. The keys inside the map are `taskId` or `taskId:parentId` and
 * task ids are globally unique ULIDs, so there is no cross-workspace
 * collision that scoping would have to resolve.
 *
 * Drafts saved before the store recorded an owner hydrate with `ownerId` null,
 * so they belong to no one who signs in and are released at the first sign-in.
 */
registerDraftCleanup({
  storageKey: COMMENT_DRAFT_STORAGE_KEY,
  workspaceScoped: false,
  resetInMemory: () => useCommentDraftStore.setState({ drafts: {}, ownerId: null }),
  isOwnedBy: (userId) => {
    const { drafts, ownerId } = useCommentDraftStore.getState();
    return ownerId === userId || Object.keys(drafts).length === 0;
  },
});
