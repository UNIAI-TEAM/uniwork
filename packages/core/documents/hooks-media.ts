"use client";
import { useQuery } from "@tanstack/react-query";
import { downloadDocumentFile } from "../api/endpoints/documents";
import { documentKeys } from "./keys";

/**
 * The bytes of one file version for the image viewer, typed with the
 * document's own MIME so it renders whatever Content-Type the proxy sent.
 *
 * Prototype of UNI-2166 step 1: the bytes come through the bearer download
 * route as a Blob, which logs a "download" access row and holds the whole file
 * in memory. Step 2 replaces this with the short-lived signed media URL
 * (`POST /documents/{id}/media-url`), which streams with Range and records
 * "view"; the viewer keeps this hook's `{ data, isPending, isError, refetch }`
 * shape so only this file changes.
 */
export function useDocumentMediaBlob(
  wsId: string,
  documentId: string,
  versionId: string,
  mimeType: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: documentKeys.media(wsId, documentId, versionId),
    queryFn: async ({ signal }) => {
      const blob = await downloadDocumentFile(documentId, undefined, signal);
      return new Blob([blob], { type: mimeType });
    },
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId && !!versionId,
    // The bytes behind one version id never change.
    staleTime: Infinity,
    // A large image is not kept in memory for long once the page is left.
    gcTime: 60_000,
  });
}
