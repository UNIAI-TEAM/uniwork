"use client";

import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";

/**
 * What the create surfaces may offer for "Restricted" (DOC-02). Files can only
 * be restricted when the server declares `documents.create_visibility`: an
 * older server drops the unknown field and would create a workspace-wide file
 * for someone who asked for a restricted one. A missing, unknown or still
 * loading answer reads as "no" (capabilityState degrades to unavailable).
 */
export function useFilesRestrictable(): boolean {
  const { data } = usePublicConfig();
  if (!data) return false;
  return capabilityState(data, "documents.create_visibility").status === "available";
}
