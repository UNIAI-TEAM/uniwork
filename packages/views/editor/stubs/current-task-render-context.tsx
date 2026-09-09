"use client";
import { createContext, useContext, type ReactNode } from "react";

type Ctx = { taskId?: string; identifier?: string } | null;
const CurrentTaskCtx = createContext<Ctx>(null);
export function CurrentTaskRenderProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <CurrentTaskCtx.Provider value={value}>{children}</CurrentTaskCtx.Provider>;
}
export function useCurrentTask() {
  return useContext(CurrentTaskCtx);
}
