"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveDocument,
  getDocumentArchiveImpact,
  getDocumentTree,
  listDocuments,
  listRecentDocuments,
  listSharedByMe,
  listSharedWithMe,
  moveDocument,
  purgeDocument,
  restoreDocument,
  type ListDocumentsBaseOpts,
  type ListDocumentsOpts,
  type MoveDocumentBody,
} from "../api/endpoints/documents-collections";
import { DocumentNotVerifiableError } from "../types/document";
import { useEnsureMyFolder } from "./hooks";
import { documentKeys } from "./keys";
import { requireVerifiableArchive, requireVerifiableDocument } from "./verify";

export { useEnsureMyFolder };

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

/** The library's type/access chips (UNI-1868), shared by every collection
 *  list: the format a row's current version carries, and the level the caller
 *  holds on it. */
export type DocumentListFilters = Pick<ListDocumentsBaseOpts, "format" | "access">;

/** The key fragment of the chip filters: "" when neither is set, so an
 *  unfiltered list keeps the key it had before the chips became query params. */
function documentListFilterKey(filters?: DocumentListFilters): string {
  if (!filters?.format && !filters?.access) return "";
  return documentFilterKey({ format: filters.format, access: filters.access });
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

/** The workspace sidebar forest; `root` narrows to one branch and
 *  `foldersOnly` drops pages and files (its own cache entry). */
export function useDocumentTree(
  wsId: string,
  root?: string,
  opts?: { enabled?: boolean; foldersOnly?: boolean },
) {
  const foldersOnly = opts?.foldersOnly ?? false;
  return useQuery({
    queryKey: documentKeys.tree(wsId, root ?? "", foldersOnly),
    queryFn: ({ signal }) => getDocumentTree(wsId, root, signal, { foldersOnly }),
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/**
 * What archiving a subtree would move, for the delete dialog (FD-06). Runs
 * only while `enabled` (the dialog is open) and is stale at once, so every
 * open asks again; a realtime document frame invalidates it through the
 * workspace root. An unreadable answer is "result not verifiable", never
 * counts, so the dialog keeps its confirmation locked.
 */
export function useDocumentArchiveImpact(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.archiveImpact(wsId, documentId),
    queryFn: async ({ signal }) => {
      const impact = await getDocumentArchiveImpact(documentId, signal);
      if (!impact) throw new DocumentNotVerifiableError();
      return impact;
    },
    staleTime: 0,
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** Recently opened/edited documents (humans only; agents get 403). The
 *  format/access chips filter it server-side and key it like the flat list. */
export function useRecentDocuments(wsId: string, opts?: DocumentListFilters & { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.recent(wsId, documentListFilterKey(opts)),
    queryFn: ({ pageParam, signal }) =>
      listRecentDocuments(
        wsId,
        {
          cursor: pageParam || undefined,
          limit: DOCUMENT_PAGE_SIZE,
          format: opts?.format,
          access: opts?.access,
        },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** Documents the caller received through a share, across the organization.
 *  Paged like the other lists: `next_cursor` drives the next page. */
export function useSharedWithMe(wsId: string, opts?: DocumentListFilters & { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.sharedWithMe(wsId, documentListFilterKey(opts)),
    queryFn: ({ pageParam, signal }) =>
      listSharedWithMe(
        wsId,
        {
          cursor: pageParam || undefined,
          limit: DOCUMENT_PAGE_SIZE,
          format: opts?.format,
          access: opts?.access,
        },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

/** Documents in this workspace that the caller owns and has shared (live
 *  person/group share or workspace visibility; public links and My Folder rows
 *  excluded). Under `documentKeys.workspace(wsId)` so `document.shared`,
 *  `document.share_revoked`, and `document.workspace_access_changed` refresh it. */
export function useSharedByMe(wsId: string, opts?: DocumentListFilters & { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.sharedByMe(wsId, documentListFilterKey(opts)),
    queryFn: ({ pageParam, signal }) =>
      listSharedByMe(
        wsId,
        {
          cursor: pageParam || undefined,
          limit: DOCUMENT_PAGE_SIZE,
          format: opts?.format,
          access: opts?.access,
        },
        signal,
      ),
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

/** Restore the target trashed item and the trashed descendants in its batch
 *  that the caller manages (RESTORE-01). Partial restore may leave unmanaged
 *  descendants in trash and detach the restored root (`parent_id: null`);
 *  invalidating the workspace root refreshes the trash list, the old parent's
 *  list, the workspace root list, and the tree. */
export function useRestoreDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { documentId: string; idempotencyKey?: string }) => {
      const { documentId, idempotencyKey } =
        typeof input === "string" ? { documentId: input, idempotencyKey: undefined } : input;
      return requireVerifiableArchive(await restoreDocument(documentId, { idempotencyKey }));
    },
    onSuccess: (res) => {
      qc.setQueryData(documentKeys.detail(wsId, res.document.id), res.document);
      return qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) });
    },
  });
}

/** Permanently delete a trashed item and the trashed descendants in its batch
 *  that the caller manages (RESTORE-01). Awaits the server (no optimistic
 *  update) and invalidates the workspace document root (trash list, folder
 *  lists, tree and details). */
export function usePurgeDocument(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { documentId: string; idempotencyKey?: string }) => {
      const { documentId, idempotencyKey } =
        typeof input === "string" ? { documentId: input, idempotencyKey: undefined } : input;
      await purgeDocument(documentId, { idempotencyKey });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.workspace(wsId) }),
  });
}
