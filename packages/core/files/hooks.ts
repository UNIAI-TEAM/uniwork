"use client";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { resolveWorkspaceFiles } from "../api/endpoints/files";
import { useAuthStore } from "../auth/store";
import type { FileDisposition } from "../types/file";
import { fileKeys } from "./keys";

interface UseResolvedUploadsOptions {
  disposition?: FileDisposition;
  enabled?: boolean;
}

/**
 * Metadata and a read URL for the caller's own staged uploads in a workspace
 * (a preview before the module that asked for the upload claims them).
 *
 * The URL is a view, not data: keep the `file_id`, never store the URL in
 * rich text or a draft. Nothing here refreshes it - no interval, no refetch on
 * focus or reconnect, no retry - so an expired URL stays expired until the
 * next ordinary data load resolves again (T1-Q7). The key carries the signed-in
 * user and the workspace, and logout clears the whole query cache
 * (`CoreProvider`), so a second account never sees the first one's answer.
 */
export function useResolvedUploads(
  wsId: string,
  fileIds: readonly string[],
  { disposition = "inline", enabled = true }: UseResolvedUploadsOptions = {},
) {
  const principalId = useAuthStore((s) => (s.status === "authed" ? (s.user?.id ?? "") : ""));
  return useQuery({
    queryKey: fileKeys.uploadBatch(principalId, wsId, fileIds, disposition),
    queryFn: ({ signal }) => resolveWorkspaceFiles(wsId, fileIds, disposition, signal),
    enabled: enabled && !!principalId && !!wsId && fileIds.length > 0,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/**
 * Drop every resolved-file answer of one principal, e.g. when the active
 * account changes without a full logout.
 */
export function clearResolvedFiles(queryClient: QueryClient, principalId?: string): void {
  queryClient.removeQueries({
    queryKey: principalId ? fileKeys.principal(principalId) : fileKeys.all,
  });
}
