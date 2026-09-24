"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";

export type SubtaskDisplayField = "priority" | "labels" | "progress" | "dueDate" | "assignee";

type State = {
  fields: Record<SubtaskDisplayField, boolean>;
  toggle: (field: SubtaskDisplayField) => void;
};

const defaults: Record<SubtaskDisplayField, boolean> = {
  priority: true,
  labels: true,
  progress: true,
  dueDate: true,
  assignee: true,
};

export const useSubtaskDisplayStore = create<State>()(
  persist(
    (set) => ({
      fields: defaults,
      toggle: (field) => set((state) => ({ fields: { ...state.fields, [field]: !state.fields[field] } })),
    }),
    { name: "uniwork_subtask_display", storage: createJSONStorage(() => defaultStorage), version: 1 },
  ),
);
