"use client";

import { useQuery } from "@tanstack/react-query";
import { getOfficeReleases } from "../api/endpoints/office-releases";

/** A re-check at most this often, and only when the tab comes back into view: no timer, no socket. */
const RECHECK_MS = 10 * 60_000;

// Not workspace-scoped: the manifest is public and the same for every visitor
// of the marketing page, signed in or not.
export const officeReleasesKeys = {
  all: ["office-releases"] as const,
  manifest: () => [...officeReleasesKeys.all, "manifest"] as const,
};

/**
 * The public release manifest. Read in the browser only (the server renders
 * the loading shell). A newer answer replaces `data`; the page decides when to
 * show it, so nothing moves under the reader.
 */
export function useOfficeReleases() {
  return useQuery({
    queryKey: officeReleasesKeys.manifest(),
    queryFn: ({ signal }) => getOfficeReleases(signal),
    staleTime: RECHECK_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
    retry: false,
  });
}
