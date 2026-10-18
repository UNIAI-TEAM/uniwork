"use client";
import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentLink,
  getDocumentSettings,
  getDocumentShares,
  listDocumentAccessLogs,
  listShareCandidates,
  revokeDocumentLink,
  revokeDocumentShare,
  setDocumentPublicLinks,
  shareDocument,
  shareDocumentBatch,
  updateDocumentAccess,
  type ListDocumentAccessLogsOpts,
  type ShareDocumentBatchBody,
  type ShareDocumentBody,
  type UpdateDocumentAccessBody,
} from "../api/endpoints/documents-sharing";
import { documentKeys } from "./keys";
import {
  requireVerifiableAccessUpdate,
  requireVerifiableLink,
  requireVerifiableSettings,
  requireVerifiableShare,
  requireVerifiableShareBatch,
} from "./verify";

// Documents sharing hooks (C-01 §5.3/§5.4; UNI-679, G1-05b; SH-W1 UNI-1784):
// the access overview, unified access update + preview, candidate search,
// grant/revoke, link create/revoke, the access log and the organization
// public-links switch.

const ACCESS_LOG_PAGE_SIZE = 50;

/** Who has access: my level always; grants/links at manage level. */
export function useDocumentShares(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.shares(wsId, documentId),
    queryFn: ({ signal }) => getDocumentShares(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** Share-picker candidates (people, workspaces, organization) with existing
 *  direct levels (SH-W1). The server pages them users -> workspaces ->
 *  organization, so later groups are reachable only by following `next_cursor`
 *  (`fetchNextPage`); `items` is every loaded page, flattened in server order. */
export function useDocumentShareCandidates(
  wsId: string,
  documentId: string,
  opts?: { q?: string; limit?: number; enabled?: boolean },
) {
  const q = opts?.q?.trim() ?? "";
  const query = useInfiniteQuery({
    queryKey: documentKeys.shareCandidates(wsId, documentId, q),
    queryFn: ({ pageParam, signal }) =>
      listShareCandidates(documentId, { q, cursor: pageParam || undefined, limit: opts?.limit }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  return { ...query, items };
}

/** Unified batch grant/update/revoke with optional dry_run impact preview (SH-W1).
 *  When `dry_run` is true, no queries are invalidated; on a real write,
 *  `shares`, `detail` (including `shareCandidates`), and `listRoot` invalidate. */
export function useUpdateDocumentAccess(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateDocumentAccessBody) =>
      requireVerifiableAccessUpdate(await updateDocumentAccess(documentId, body), body),
    onSuccess: (_data, variables) => {
      if (variables.dry_run) return;
      return Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.listRoot(wsId) }),
      ]);
    },
  });
}

/**
 * The organization public-links switch, readable by the same owners/admins
 * who may change it (G1-08). Both the read and the write answer in the same
 * cache entry, so the toggle reflects whichever landed last.
 */
export function useDocumentSettings(orgId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.settings(orgId),
    queryFn: ({ signal }) => getDocumentSettings(orgId, signal),
    enabled: (opts?.enabled ?? true) && !!orgId,
  });
}

/** Grant (or move) one principal's level on a document. A share naming the
 *  document's own workspace - `documentWorkspaceId`, which may differ from the
 *  route/cache `wsId` - is merged into its home row (SH-S1), so that answer
 *  carries no share id and still counts as the write it is; both keys
 *  invalidate as for a visibility move. An empty `documentWorkspaceId` never
 *  falls back to `wsId`: every answer without a row identity then throws. */
export function useShareDocument(wsId: string, documentId: string, documentWorkspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ShareDocumentBody) =>
      requireVerifiableShare(await shareDocument(documentId, body), documentWorkspaceId),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        // UNI-1851 F2: the grant lands the document in the caller's Shared by
        // me list; refresh its root (prefix of every filtered key) without
        // waiting for the document.shared frame.
        qc.invalidateQueries({ queryKey: documentKeys.sharedByMe(wsId) }),
      ]),
  });
}

/** Grant one level to several people at once (UNI-1641); all or nothing. A
 *  422 principal_not_in_organization names the refused ids — read them with
 *  sharePrincipalsNotInOrganization. */
export function useShareDocumentBatch(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ShareDocumentBatchBody) =>
      requireVerifiableShareBatch(await shareDocumentBatch(documentId, body)),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.sharedByMe(wsId) }),
      ]),
  });
}

/** Revoke one live grant. */
export function useRevokeDocumentShare(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string) => revokeDocumentShare(documentId, shareId),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
        // UNI-1851 F2: the revoked grant can drop the document from the
        // caller's Shared by me list before document.share_revoked arrives.
        qc.invalidateQueries({ queryKey: documentKeys.sharedByMe(wsId) }),
      ]),
  });
}

/** Mint an anonymous view link. The envelope carries the raw token once. */
export function useCreateDocumentLink(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (expiresInDays?: number) =>
      requireVerifiableLink(await createDocumentLink(documentId, expiresInDays)),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
  });
}

/** Revoke a public link; the next anonymous read is 404. */
export function useRevokeDocumentLink(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => revokeDocumentLink(documentId, linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
  });
}

/** Manage-only access log, newest first. */
export function useDocumentAccessLogs(
  wsId: string,
  documentId: string,
  opts?: ListDocumentAccessLogsOpts & { enabled?: boolean },
) {
  const action = opts?.action ?? "";
  return useInfiniteQuery({
    queryKey: documentKeys.accessLogs(wsId, documentId, action),
    queryFn: ({ pageParam, signal }) =>
      listDocumentAccessLogs(
        documentId,
        { cursor: pageParam || undefined, limit: opts?.limit ?? ACCESS_LOG_PAGE_SIZE, action: opts?.action },
        signal,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
  });
}

/** Flip the organization public-links switch (owners/admins only). */
export function useSetDocumentPublicLinks(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      requireVerifiableSettings(await setDocumentPublicLinks(orgId, enabled)),
    onSuccess: (settings) =>
      qc.setQueryData(documentKeys.settings(orgId), settings),
  });
}
