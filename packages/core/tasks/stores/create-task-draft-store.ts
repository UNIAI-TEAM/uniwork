"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { draftWriteOwner, registerDraftCleanup } from "../../drafts/cleanup-registry";
import { defaultStorage } from "../../platform/storage";
import type { TaskPriority } from "../../types/task";
import type { Attachment } from "../../types/attachment";

const CREATE_TASK_DRAFT_STORAGE_KEY = "uniwork_create_task_drafts";

export type CreateTaskDraft = {
  title: string;
  description?: string;
  status?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  assigneeKind?: "human" | "agent";
  projectId?: string;
  parentTaskId?: string;
  stage?: string;
  startDate?: string;
  dueDate?: string;
  labelIds?: string[];
  attachments?: Attachment[];
  properties?: Record<string, unknown>;
  idempotencyKey: string;
  /** Monotonic local edit revision used to protect a newer draft from a late response. */
  version?: number;
};

export type CreateTaskSettings = Pick<
  CreateTaskDraft,
  "status" | "priority" | "assigneeId" | "assigneeKind" | "projectId" | "stage"
>;

type CreateTaskDraftState = {
  drafts: Record<string, CreateTaskDraft>;
  settings: Record<string, CreateTaskSettings>;
  ownerId: string | null;
  draftFor: (workspaceId: string) => CreateTaskDraft | null;
  setDraft: (workspaceId: string, draft: CreateTaskDraft) => void;
  settingsFor: (workspaceId: string) => CreateTaskSettings | null;
  setSettings: (workspaceId: string, settings: CreateTaskSettings) => void;
  /** Clear only the submitted draft; a newer draft with another key survives. */
  clearDraft: (
    workspaceId: string,
    submittedIdempotencyKey?: string,
    submittedVersion?: number,
  ) => void;
};

function hasMeaningfulContent(draft: CreateTaskDraft): boolean {
  return Boolean(
    draft.title.trim() ||
      draft.description?.trim() ||
      draft.projectId ||
      draft.parentTaskId ||
      draft.stage ||
      draft.startDate ||
      draft.dueDate ||
      draft.labelIds?.length ||
      draft.attachments?.length ||
      Object.keys(draft.properties ?? {}).length,
  );
}

export const useCreateTaskDraftStore = create<CreateTaskDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      settings: {},
      ownerId: null,
      draftFor: (workspaceId) => get().drafts[workspaceId] ?? null,
      settingsFor: (workspaceId) => get().settings[workspaceId] ?? null,
      setDraft: (workspaceId, draft) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const drafts = { ...state.drafts };
          if (hasMeaningfulContent(draft)) drafts[workspaceId] = draft;
          else delete drafts[workspaceId];
          return { drafts, ownerId };
        });
      },
      setSettings: (workspaceId, settings) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => ({
          settings: { ...state.settings, [workspaceId]: settings },
          ownerId,
        }));
      },
      clearDraft: (workspaceId, submittedIdempotencyKey, submittedVersion) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const current = state.drafts[workspaceId];
          if (
            !current ||
            (submittedIdempotencyKey && current.idempotencyKey !== submittedIdempotencyKey) ||
            (submittedVersion !== undefined && (current.version ?? 0) !== submittedVersion)
          ) {
            return state;
          }
          const drafts = { ...state.drafts };
          delete drafts[workspaceId];
          return { drafts, ownerId };
        });
      },
    }),
    {
      name: CREATE_TASK_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);

registerDraftCleanup({
  storageKey: CREATE_TASK_DRAFT_STORAGE_KEY,
  workspaceScoped: false,
  resetInMemory: () => useCreateTaskDraftStore.setState({ drafts: {}, settings: {}, ownerId: null }),
  isOwnedBy: (userId) => {
    const { drafts, settings, ownerId } = useCreateTaskDraftStore.getState();
    return ownerId === userId || (Object.keys(drafts).length === 0 && Object.keys(settings).length === 0);
  },
});
