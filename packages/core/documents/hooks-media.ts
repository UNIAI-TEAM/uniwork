"use client";
import { useQuery } from "@tanstack/react-query";
import { downloadDocumentFile } from "../api/endpoints/documents";
import { documentKeys } from "./keys";

/**
 * The bytes of one file version for the image viewer, typed with the
 * document's own MIME so it renders whatever Content-Type the proxy sent.
 *
 * Fetches through `GET /api/v1/documents/{id}/download?intent=view` so the
 * server records a "view" access row rather than a "download".
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
      const blob = await downloadDocumentFile(documentId, undefined, signal, "view");
      return new Blob([blob], { type: mimeType });
    },
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId && !!versionId,
    // The bytes behind one version id never change, and the key sits outside the workspace invalidation prefix.
    staleTime: Infinity,
    // A large image is not kept in memory for long once the page is left.
    gcTime: 60_000,
  });
}
