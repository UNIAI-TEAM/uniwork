"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";

type CommentDraftState = {
  drafts: Record<string, string>;
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
      draftFor: (key) => get().drafts[key] ?? "",
      setDraft: (key, body) =>
        set((state) => {
          const next = { ...state.drafts };
          if (body.trim() === "") delete next[key];
          else next[key] = body;
          return { drafts: next };
        }),
      clearDraft: (key) =>
        set((state) => {
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next };
        }),
    }),
    {
      name: "uniwork_task_comment_drafts",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);
