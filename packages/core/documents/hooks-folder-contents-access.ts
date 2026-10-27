"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  getFolderContentsAccessBatch,
  updateFolderContentsAccess,
  type FolderContentsAccessInput,
} from "../api/endpoints/documents-folder-contents-access";
import { documentKeys } from "./keys";

// Folder contents access (UNI-2244): preview a bulk access change for every
// document in a folder's subtree, apply it, and follow a background batch.
// Folders have no ACL; the write lands on each document, so the document keys
// under the workspace root are what a finished write refreshes.

export const folderContentsAccessKeys = {
  all: (wsId: string) => ["folder-contents-access", wsId] as const,
  batch: (wsId: string, folderId: string, batchId: string) =>
    [...folderContentsAccessKeys.all(wsId), "batch", folderId, batchId] as const,
};

/** How often a queued or running batch is asked again. */
const BATCH_POLL_MS = 2000;

export interface FolderContentsAccessVars {
  folderId: string;
  input: FolderContentsAccessInput;
}

/** Dry run: resolves the `dry_run` result (counts only) and writes nothing, so it touches no cache. */
export function usePreviewFolderContentsAccess(wsId: string) {
  return useMutation({
    mutationKey: [...folderContentsAccessKeys.all(wsId), "preview"],
    mutationFn: ({ folderId, input }: FolderContentsAccessVars) => updateFolderContentsAccess(folderId, input, { dryRun: true }),
  });
}

/**
 * Apply: resolves `sync` (written in the request) or `background` (queued).
 * A sync write changed documents now, so the workspace documents refetch; a
 * background batch refreshes them when it completes (`useFolderContentsAccessBatch`).
 */
export function useApplyFolderContentsAccess(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...folderContentsAccessKeys.all(wsId), "apply"],
    mutationFn: ({ folderId, input }: FolderContentsAccessVars) => updateFolderContentsAccess(folderId, input, { dryRun: false }),
    onSuccess: async (result) => {
      if (result.kind === "sync") await qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/**
 * Progress of a background batch. Disabled while `batchId` is null; polls
 * every 2 s while queued or running and stops once completed or failed. The
 * workspace documents are invalidated when it reaches `completed`.
 */
export function useFolderContentsAccessBatch(wsId: string, folderId: string, batchId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: folderContentsAccessKeys.batch(wsId, folderId, batchId ?? ""),
    queryFn: () => getFolderContentsAccessBatch(folderId, batchId!),
    enabled: !!wsId && !!folderId && batchId !== null,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "queued" || status === "running" ? BATCH_POLL_MS : false;
    },
  });
  const completed = query.data?.status === "completed";
  useEffect(() => {
    if (completed) void qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
  }, [completed, qc, wsId, batchId]);
  return query;
}
