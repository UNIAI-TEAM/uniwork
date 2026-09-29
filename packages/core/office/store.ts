import { create } from "zustand";
import type { OfficeState } from "./error-state";
import type { OfficeIdentity } from "./host-contract";

export interface OfficeIdentityRefs {
  deploymentId: string;
  accountId: string;
  organizationId: string;
  workspaceId: string;
  documentId: string;
  generation: number;
  baseVersionId: string;
  baseRevision: string;
}

export interface OfficeSessionState {
  tabId: string | null;
  selection: string | null;
  identity: OfficeIdentityRefs | null;
  dirtyGeneration: number;
  saveState: OfficeState;
  setTab: (tabId: string | null) => void;
  setSelection: (selection: string | null) => void;
  setIdentity: (identity: OfficeIdentity | null) => void;
  setDirtyGeneration: (generation: number) => void;
  setSaveState: (saveState: OfficeState) => void;
  reset: () => void;
}

const EMPTY_STATE = {
  tabId: null,
  selection: null,
  identity: null,
  dirtyGeneration: 0,
  saveState: "ready" as OfficeState,
};

export const useOfficeStore = create<OfficeSessionState>((set) => ({
  ...EMPTY_STATE,
  setTab: (tabId) => set({ tabId }),
  setSelection: (selection) => set({ selection }),
  setIdentity: (identity) =>
    set({
      identity: identity ? { ...identity } : null,
      dirtyGeneration: identity ? 0 : 0,
      saveState: "ready",
    }),
  setDirtyGeneration: (dirtyGeneration) =>
    set((state) => ({ dirtyGeneration, saveState: state.saveState === "saving" ? "saving" : "dirty" })),
  setSaveState: (saveState) => set({ saveState }),
  reset: () => set({ ...EMPTY_STATE }),
}));
