"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocumentLink,
  getDocumentSettings,
  getDocumentShares,
  listDocumentAccessLogs,
  revokeDocumentLink,
  revokeDocumentShare,
  setDocumentPublicLinks,
  shareDocument,
  type ListDocumentAccessLogsOpts,
  type ShareDocumentBody,
} from "../api/endpoints/documents-sharing";
import { documentKeys } from "./keys";
import {
  requireVerifiableLink,
  requireVerifiableSettings,
  requireVerifiableShare,
} from "./verify";

// Documents sharing hooks (C-01 §5.3/§5.4; UNI-679, G1-05b): the access
// overview, grant/revoke, link create/revoke, the access log and the
// organization public-links switch. Token-bearing answers are verified before
// they may count as success, so a malformed link create never shows a URL the
// server did not mint.

const ACCESS_LOG_PAGE_SIZE = 50;

/** Who has access: my level always; grants/links at manage level. */
export function useDocumentShares(wsId: string, documentId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.shares(wsId, documentId),
    queryFn: ({ signal }) => getDocumentShares(documentId, signal),
    enabled: (opts?.enabled ?? true) && !!wsId && !!documentId,
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

/** Grant (or move) one principal's level on a document. */
export function useShareDocument(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ShareDocumentBody) =>
      requireVerifiableShare(await shareDocument(documentId, body)),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) }),
        qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) }),
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
