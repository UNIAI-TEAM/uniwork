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
  startAt?: string;
  dueAt?: string;
  labelIds?: string[];
  attachments?: Attachment[];
  properties?: Record<string, unknown>;
  /** Prompt and actor are separate from the manual description/assignee so mode switches are reversible. */
  agentPrompt?: string;
  agentId?: string;
  idempotencyKey: string;
  /** Monotonic local edit revision used to protect a newer draft from a late response. */
  version?: number;
  /** Present only after the user explicitly sends this composer to the draft tray. */
  savedAt?: string;
};

export type CreateTaskSettings = Pick<
  CreateTaskDraft,
  "status" | "priority" | "assigneeId" | "assigneeKind" | "projectId" | "stage"
>;

type CreateTaskDraftState = {
  drafts: Record<string, Record<string, CreateTaskDraft>>;
  activeDraftIds: Record<string, string>;
  settings: Record<string, CreateTaskSettings>;
  ownerId: string | null;
  draftFor: (workspaceId: string, draftId?: string) => CreateTaskDraft | null;
  draftsFor: (workspaceId: string) => CreateTaskDraft[];
  setDraft: (workspaceId: string, draft: CreateTaskDraft) => void;
  saveDraft: (workspaceId: string, draft: CreateTaskDraft) => void;
  activateDraft: (workspaceId: string, draftId: string) => void;
  deactivateDraft: (workspaceId: string, draftId?: string) => void;
  closeDraft: (workspaceId: string) => void;
  settingsFor: (workspaceId: string) => CreateTaskSettings | null;
  setSettings: (workspaceId: string, settings: CreateTaskSettings) => void;
  /** Clear only the submitted draft; a newer draft with another key survives. */
  clearDraft: (
    workspaceId: string,
    submittedIdempotencyKey?: string,
    submittedVersion?: number,
  ) => void;
};

export function hasMeaningfulCreateTaskDraft(draft: CreateTaskDraft): boolean {
  return Boolean(
    draft.title.trim() ||
      draft.description?.trim() ||
      draft.projectId ||
      draft.parentTaskId ||
      draft.stage ||
      draft.startDate ||
      draft.dueDate ||
      draft.startAt ||
      draft.dueAt ||
      draft.labelIds?.length ||
      draft.attachments?.length ||
      draft.agentPrompt?.trim() ||
      draft.agentId ||
      Object.keys(draft.properties ?? {}).length,
  );
}

export const useCreateTaskDraftStore = create<CreateTaskDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
      draftFor: (workspaceId, draftId) => {
        const id = draftId ?? get().activeDraftIds[workspaceId];
        return id ? get().drafts[workspaceId]?.[id] ?? null : null;
      },
      draftsFor: (workspaceId) =>
        Object.values(get().drafts[workspaceId] ?? {}).filter((draft) => draft.savedAt),
      settingsFor: (workspaceId) => get().settings[workspaceId] ?? null,
      setDraft: (workspaceId, draft) => {
        const ownerId = draftWriteOwner();
        if (ownerId === null) return;
        set((state) => {
          const workspaceDrafts = { ...state.drafts[workspaceId] };
          const activeDraftIds = { ...state.activeDraftIds };
          if (hasMeaningfulCreateTaskDraft(draft)) {
            workspaceDrafts[draft.idempotencyKey] = draft;
            activeDraftIds[workspaceId] = draft.idempotencyKey;
          } else {
            delete workspaceDrafts[draft.idempotencyKey];
            if (activeDraftIds[workspaceId] === draft.idempotencyKey) {
              delete activeDraftIds[workspaceId];
            }
          }
          const drafts = { ...state.drafts };
          if (Object.keys(workspaceDrafts).length > 0) drafts[workspaceId] = workspaceDrafts;
          else delete drafts[workspaceId];
          return { drafts, activeDraftIds, ownerId };
        });
      },
      saveDraft: (workspaceId, draft) => {
        get().setDraft(workspaceId, { ...draft, savedAt: new Date().toISOString() });
      },
      activateDraft: (workspaceId, draftId) => {
        if (!get().drafts[workspaceId]?.[draftId]) return;
        set((state) => ({
          activeDraftIds: { ...state.activeDraftIds, [workspaceId]: draftId },
        }));
      },
      deactivateDraft: (workspaceId, draftId) => {
        set((state) => {
          if (draftId && state.activeDraftIds[workspaceId] !== draftId) return state;
          const activeDraftIds = { ...state.activeDraftIds };
          delete activeDraftIds[workspaceId];
          return { activeDraftIds };
        });
      },
      closeDraft: (workspaceId) => {
        const draftId = get().activeDraftIds[workspaceId];
        if (!draftId) return;
        const draft = get().drafts[workspaceId]?.[draftId];
        if (draft?.savedAt) {
          get().deactivateDraft(workspaceId, draftId);
          return;
        }
        get().clearDraft(workspaceId, draftId);
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
          const draftId = submittedIdempotencyKey ?? state.activeDraftIds[workspaceId];
          const current = draftId ? state.drafts[workspaceId]?.[draftId] : undefined;
          if (
            !current ||
            (submittedVersion !== undefined && (current.version ?? 0) !== submittedVersion)
          ) {
            return state;
          }
          const workspaceDrafts = { ...state.drafts[workspaceId] };
          delete workspaceDrafts[current.idempotencyKey];
          const drafts = { ...state.drafts };
          if (Object.keys(workspaceDrafts).length > 0) drafts[workspaceId] = workspaceDrafts;
          else delete drafts[workspaceId];
          const activeDraftIds = { ...state.activeDraftIds };
          if (activeDraftIds[workspaceId] === current.idempotencyKey) {
            delete activeDraftIds[workspaceId];
          }
          return { drafts, activeDraftIds, ownerId };
        });
      },
    }),
    {
      name: CREATE_TASK_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => defaultStorage),
      version: 2,
      migrate: (persistedState, version) => {
        if (version >= 1) return persistedState as CreateTaskDraftState;
        const legacy = persistedState as Partial<CreateTaskDraftState> & {
          drafts?: Record<string, CreateTaskDraft>;
        };
        const drafts: Record<string, Record<string, CreateTaskDraft>> = {};
        const activeDraftIds: Record<string, string> = {};
        for (const [workspaceId, draft] of Object.entries(legacy.drafts ?? {})) {
          if (!draft?.idempotencyKey) continue;
          drafts[workspaceId] = {
            [draft.idempotencyKey]: { ...draft, savedAt: new Date(0).toISOString() },
          };
          activeDraftIds[workspaceId] = draft.idempotencyKey;
        }
        return { ...legacy, drafts, activeDraftIds } as CreateTaskDraftState;
      },
    },
  ),
);

registerDraftCleanup({
  storageKey: CREATE_TASK_DRAFT_STORAGE_KEY,
  workspaceScoped: false,
  resetInMemory: () =>
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    }),
  isOwnedBy: (userId) => {
    const { drafts, settings, ownerId } = useCreateTaskDraftStore.getState();
    return ownerId === userId || (Object.keys(drafts).length === 0 && Object.keys(settings).length === 0);
  },
});
