"use client";
import { useQuery } from "@tanstack/react-query";
import { getPublicDocument } from "../api/endpoints/documents-public";
import { documentKeys } from "./keys";

// The anonymous public view (C-01 §5.3; UNI-679, G1-05b). No session, no
// workspace key: the token is the cache identity and the only credential. A
// malformed body resolves null (the view renders its not-found state), never
// a fabricated document.

/** Read one publicly shared document by its link token. */
export function usePublicDocument(token: string) {
  return useQuery({
    queryKey: documentKeys.public(token),
    queryFn: ({ signal }) => getPublicDocument(token, signal),
    enabled: !!token,
    // A revoked or expired link must not serve a cache hit after the fact.
    staleTime: 0,
    retry: false,
  });
}
