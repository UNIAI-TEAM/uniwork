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

/** States a new edit must not overwrite: the banner/problem stays visible.
 *  `error` is included so a terminal/stop banner the coordinator keeps does not
 *  diverge from the store on the next keystroke (G3-01-R3). */
const STICKY_STATES: readonly OfficeState[] = ["saving", "conflict", "blocked", "readonly", "incompatible", "error"];

export const useOfficeStore = create<OfficeSessionState>((set) => ({
  ...EMPTY_STATE,
  setTab: (tabId) => set({ tabId }),
  setSelection: (selection) => set({ selection }),
  setIdentity: (identity) =>
    set({
      identity: identity ? { ...identity } : null,
      dirtyGeneration: 0,
      saveState: "ready",
    }),
  setDirtyGeneration: (dirtyGeneration) =>
    set((state) => ({
      dirtyGeneration,
      saveState: STICKY_STATES.includes(state.saveState) ? state.saveState : "dirty",
    })),
  setSaveState: (saveState) => set({ saveState }),
  reset: () => set({ ...EMPTY_STATE }),
}));
