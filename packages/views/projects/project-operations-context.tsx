"use client";

import { createContext, useContext } from "react";
import type { PutProjectBody } from "@uniwork/core/api/endpoints/projects";

/** Hosts can own persistence while the shared project list keeps its normal controls. */
export const ProjectOperationsContext = createContext<{
  update: (id: string, patch: Omit<PutProjectBody, "revision">) => void;
  pin: (id: string, pinned: boolean) => void;
  remove: (id: string) => void;
} | null>(null);

export const useProjectOperations = () => useContext(ProjectOperationsContext);
