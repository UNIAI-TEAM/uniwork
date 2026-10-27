"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

// UNI-2244: the background folder access batches a tab follows. A batch
// outlives the page that started it (the Documents page, the sidebar tree),
// so the list lives here, not in a host's state; one watcher list mounted at
// the workspace shell reads it and says the result once. Entries are keyed by
// workspace and batch id and never repeat: a batch handed over twice (two
// hosts, a remounted host, a 409 naming a running batch) is one entry, and a
// batch that already settled is not taken again.

export interface TrackedFolderAccessBatch {
  wsId: string;
  folderId: string;
  batchId: string;
}

/** Settled keys remembered to refuse a late hand-over; a batch id is never reused, so a small window is enough. */
const SETTLED_MEMORY = 50;

const keyOf = (wsId: string, batchId: string) => `${wsId}\u0000${batchId}`;

interface FolderAccessBatchState {
  batches: TrackedFolderAccessBatch[];
  /** Keys of batches an open dialog is showing: their failure reads inline there, so no toast repeats it. */
  shown: string[];
  settled: string[];
  track: (batch: TrackedFolderAccessBatch) => void;
  settle: (wsId: string, batchId: string) => void;
  show: (wsId: string, batchId: string) => void;
  hide: (wsId: string, batchId: string) => void;
}

export const useFolderAccessBatchStore = create<FolderAccessBatchState>((set) => ({
  batches: [],
  shown: [],
  settled: [],
  track: (batch) =>
    set((state) => {
      const key = keyOf(batch.wsId, batch.batchId);
      if (state.settled.includes(key) || state.batches.some((b) => keyOf(b.wsId, b.batchId) === key)) return state;
      return { batches: [...state.batches, batch] };
    }),
  settle: (wsId, batchId) =>
    set((state) => {
      const key = keyOf(wsId, batchId);
      if (state.settled.includes(key)) return state;
      return {
        batches: state.batches.filter((b) => keyOf(b.wsId, b.batchId) !== key),
        shown: state.shown.filter((k) => k !== key),
        settled: [...state.settled, key].slice(-SETTLED_MEMORY),
      };
    }),
  show: (wsId, batchId) =>
    set((state) => {
      const key = keyOf(wsId, batchId);
      return state.shown.includes(key) ? state : { shown: [...state.shown, key] };
    }),
  hide: (wsId, batchId) =>
    set((state) => {
      const key = keyOf(wsId, batchId);
      return state.shown.includes(key) ? { shown: state.shown.filter((k) => k !== key) } : state;
    }),
}));

/** The batches of one workspace still being followed; other workspaces' entries stay put and are not watched. */
export function useTrackedFolderAccessBatches(wsId: string): TrackedFolderAccessBatch[] {
  return useFolderAccessBatchStore(useShallow((state) => state.batches.filter((b) => b.wsId === wsId)));
}

/** True while an open dialog is showing this batch. */
export function useFolderAccessBatchShown(wsId: string, batchId: string): boolean {
  return useFolderAccessBatchStore((state) => state.shown.includes(keyOf(wsId, batchId)));
}

/** Test seam: the store is module state, so a test file must start each case clean. */
export function resetFolderAccessBatches(): void {
  useFolderAccessBatchStore.setState({ batches: [], shown: [], settled: [] });
}
