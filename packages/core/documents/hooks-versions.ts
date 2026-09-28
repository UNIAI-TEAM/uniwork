"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitDocumentVersion,
  createDocumentVersion,
  getDocumentVersion,
  listDocumentVersions,
  restoreDocumentVersion,
  type CommitDocumentVersionBody,
} from "../api/endpoints/documents-versions";
import { DocumentNotVerifiableError } from "../types/document";
import { documentKeys } from "./keys";
import { requireVerifiableVersionResult } from "./verify";

// Version endpoints live beside the document hooks; every key carries wsId
// and every mutation answer is verified before it may count as success.

const VERSION_PAGE_SIZE = 50;

/**
 * Infinite version list for one document (metadata rows, newest first).
 * Pages live inside one cache entry under documentKeys.versions — the same
 * prefix the commit/restore mutations invalidate.
 */
export function useDocumentVersions(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.versions(wsId, documentId),
    queryFn: ({ pageParam, signal }) =>
      listDocumentVersions(documentId, { cursor: pageParam, limit: VERSION_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** One version row; page versions carry their content here. */
export function useDocumentVersion(
  wsId: string,
  documentId: string,
  versionNo: number | undefined,
) {
  return useQuery({
    queryKey: documentKeys.version(wsId, documentId, versionNo ?? 0),
    queryFn: ({ signal }) => getDocumentVersion(documentId, versionNo ?? 0, signal),
    enabled: !!wsId && !!documentId && versionNo !== undefined && versionNo > 0,
  });
}

/** A named manual checkpoint of the working copy. */
export function useCreateDocumentVersion(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { label?: string; idempotencyKey?: string }) => {
      const version = await createDocumentVersion(
        documentId,
        { label: input.label },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!version?.id || !(version.version > 0)) throw new DocumentNotVerifiableError();
      return version;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.versions(wsId, documentId) }),
  });
}

/**
 * The single save shape for file documents (C-01 §14.4): claim a staged
 * upload_id on a base revision, with the idempotency key the caller minted
 * for this write — retries of the same write carry the same key.
 */
export function useCommitDocumentVersion(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CommitDocumentVersionBody & { idempotencyKey: string }) => {
      const { idempotencyKey, ...body } = input;
      return requireVerifiableVersionResult(
        await commitDocumentVersion(documentId, body, { idempotencyKey }),
      );
    },
    onSuccess: (res) => {
      qc.setQueryData(documentKeys.detail(wsId, documentId), res.document);
      return qc.invalidateQueries({ queryKey: documentKeys.versions(wsId, documentId) });
    },
  });
}

/**
 * Make versionNo the working copy. The response proves the write with the
 * bumped document + the new restore version row; a missing piece throws
 * "result not verifiable" and the version drawer keeps its state.
 */
export function useRestoreDocumentVersion(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { versionNo: number; idempotencyKey?: string; baseRevision?: string }) =>
      requireVerifiableVersionResult(
        await restoreDocumentVersion(documentId, input.versionNo, {
          idempotencyKey: input.idempotencyKey,
          // File restores must name the base revision; page restores omit it.
          baseRevision: input.baseRevision,
        }),
      ),
    onSuccess: (res) => {
      qc.setQueryData(documentKeys.detail(wsId, documentId), res.document);
      return qc.invalidateQueries({ queryKey: documentKeys.versions(wsId, documentId) });
    },
  });
}
