"use client";
import { useQuery } from "@tanstack/react-query";
import { mintOfficeFrameToken, type OfficeFrameToken } from "../api/endpoints/office-frame";
import { officeKeys } from "./office-hooks";

// Office Docs web frame token (UNI-1013). The host mints it with its session
// and passes it to the frame in the postMessage init; the query re-mints a
// minute before it expires so a long session never hands over a dead token.
// The key carries the workspace id beside the document id.

export const officeFrameKeys = {
  token: (wsId: string, documentId: string) =>
    [...officeKeys.document(wsId, documentId), "frame-token"] as const,
};

/** Re-mint this long before `expires_in` runs out. */
const OFFICE_FRAME_REFRESH_MARGIN_S = 60;

/** Next re-mint delay in ms; false when the token is missing. */
export function officeFrameRefetchInterval(token: OfficeFrameToken | null | undefined): number | false {
  if (!token) return false;
  return Math.max(5, token.expires_in - OFFICE_FRAME_REFRESH_MARGIN_S) * 1000;
}

export function useOfficeFrameToken(wsId: string, documentId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: officeFrameKeys.token(wsId, documentId),
    queryFn: ({ signal }) => mintOfficeFrameToken(documentId, { signal }),
    enabled: (opts.enabled ?? true) && !!wsId && !!documentId,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => officeFrameRefetchInterval(query.state.data),
  });
}
