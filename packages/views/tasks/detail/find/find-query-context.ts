"use client";

import { createContext, useContext } from "react";

/**
 * The open find bar's query, "" while the bar is closed. Read only by the
 * timeline, which opens the resolved threads it matches, so a keystroke
 * re-renders the timeline and nothing between it and the find scope.
 */
export const TaskFindQueryContext = createContext("");

export function useTaskFindQuery(): string {
  return useContext(TaskFindQueryContext);
}
