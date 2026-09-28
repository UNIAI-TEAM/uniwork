"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveDocument,
  getDocumentTree,
  listDocuments,
  listRecentDocuments,
  listSharedWithMe,
  moveDocument,
  restoreDocument,
  type ListDocumentsOpts,
  type MoveDocumentBody,
} from "../api/endpoints/documents-collections";
import { documentKeys } from "./keys";
import { requireVerifiableArchive, requireVerifiableDocument } from "./verify";

// Documents collection hooks (C-01 §5.1; UNI-679, G1-05b). Keys come from the
// documentKeys factory and every key hangs off the workspace root, so one
// realtime `document.*` invalidation still refreshes list/tree/recent/shared.
// Mutations await the server and only count as success on a verifiable
// answer; a null parse throws "result not verifiable".

const DOCUMENT_PAGE_SIZE = 50;

/** Stable key fragment of a filter object: sorted entries, undefined dropped. */
export function documentFilterKey(filter?: ListDocumentsOpts): string {
  if (!filter) return "";
  const entries = Object.entries(filter)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/**
 * The workspace list as an infinite query: flat list, one tree level
 * (`parentId: ""` = roots) or a search (`q`). The permission filter is the
 * server's, so a page never renders rows the caller cannot read.
 */
export function useDocumentList(wsId: string, filter?: ListDocumentsOpts, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.list(wsId, documentFilterKey(filter)),
    queryFn: ({ pageParam, signal }) =>
      listDocuments(
        wsId,
        { ...filter, cursor: pageParam || undefined, limit: filter?.limit ?? DOCUMENT_PAGE_SIZE },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** The workspace sidebar forest; `root` narrows to one branch. */
export function useDocumentTree(wsId: string, root?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.tree(wsId, root ?? ""),
    queryFn: ({ signal }) => getDocumentTree(wsId, root, signal),
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** Recently opened/edited documents (humans only; agents get 403). */
export function useRecentDocuments(wsId: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.recent(wsId),
    queryFn: ({ pageParam, signal }) =>
      listRecentDocuments(wsId, { cursor: pageParam || undefined, limit: DOCUMENT_PAGE_SIZE }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** Documents the caller received through a share, across the organization.
 *  Paged like the other lists: `next_cursor` drives the next page. */
export function useSharedWithMe(wsId: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.sharedWithMe(wsId),
    queryFn: ({ pageParam, signal }) =>
      listSharedWithMe(wsId, { cursor: pageParam || undefined, limit: DOCUMENT_PAGE_SIZE }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/**
 * Reparent/reorder one document. The caller sends the revision it last saw;
 * a move whose answer cannot prove itself throws "result not verifiable" and
 * keeps the caller's key for the retry.
 */
export function useMoveDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MoveDocumentBody & { documentId: string; idempotencyKey?: string }) => {
      const { documentId, idempotencyKey, ...body } = input;
      return requireVerifiableDocument(await moveDocument(documentId, body, { idempotencyKey }));
    },
    onSuccess: (doc) => {
      qc.setQueryData(documentKeys.detail(wsId, doc.id), doc);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/** Archive a document subtree (manage). Success carries the batch. */
export function useArchiveDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; idempotencyKey?: string }) =>
      requireVerifiableArchive(
        await archiveDocument(input.documentId, { idempotencyKey: input.idempotencyKey }),
      ),
    onSuccess: (res) => {
      qc.setQueryData(documentKeys.detail(wsId, res.document.id), res.document);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/** Restore exactly the nodes one archive batch moved (manage). */
export function useRestoreDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { documentId: string; idempotencyKey?: string }) =>
      requireVerifiableArchive(
        await restoreDocument(input.documentId, { idempotencyKey: input.idempotencyKey }),
      ),
    onSuccess: (res) => {
      qc.setQueryData(documentKeys.detail(wsId, res.document.id), res.document);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}
