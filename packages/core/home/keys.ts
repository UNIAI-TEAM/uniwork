import type { Query } from "@tanstack/react-query";

/**
 * Workspace-scoped: the home screen is one person's view of one workspace.
 * Kept apart from the hooks so modules the home hooks import (notifications)
 * can refresh the home summary without an import cycle.
 */
export const homeKeys = {
  all: ["home"] as const,
  summary: (wsId: string) => ["home", wsId, "summary"] as const,
  prefs: (wsId: string) => ["home", wsId, "prefs"] as const,
};

/** Every workspace's home summary, for changes that are not tied to one workspace. */
export const isHomeSummary = (query: Query): boolean => query.queryKey[0] === "home" && query.queryKey[2] === "summary";
