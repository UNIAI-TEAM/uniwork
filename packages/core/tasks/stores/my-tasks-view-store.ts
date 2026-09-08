"use client";

import { createStore, type StoreApi } from "zustand/vanilla";
import { persist } from "zustand/middleware";
import type { MyTasksRelation } from "../surface/scope";
import {
  type TaskViewState,
  viewStoreSlice,
  viewStorePersistOptions,
  mergeViewStatePersisted,
} from "./view-store";
import { registerForWorkspaceRehydration } from "../../platform/workspace-storage";

export type MyTasksScope = MyTasksRelation;

export interface MyTasksViewState extends TaskViewState {
  scope: MyTasksScope;
  setScope: (scope: MyTasksScope) => void;
}

const basePersist = viewStorePersistOptions("uniwork_my_tasks_view");

const _myTasksViewStore = createStore<MyTasksViewState>()(
  persist(
    (set) => ({
      ...viewStoreSlice(set as unknown as StoreApi<TaskViewState>["setState"]),
      scope: "assigned" as MyTasksScope,
      setScope: (scope: MyTasksScope) => set({ scope }),
    }),
    {
      name: basePersist.name,
      storage: basePersist.storage,
      partialize: (state: MyTasksViewState) => ({
        ...basePersist.partialize(state),
        scope: state.scope,
      }),
      merge: mergeViewStatePersisted<MyTasksViewState>,
    },
  ),
);

export const myTasksViewStore: StoreApi<MyTasksViewState> = _myTasksViewStore;

registerForWorkspaceRehydration(() => {
  void _myTasksViewStore.persist.rehydrate();
});
