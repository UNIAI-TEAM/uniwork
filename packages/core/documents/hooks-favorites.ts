"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listFavoriteDocuments } from "../api/endpoints/documents-collections";
import {
  favoriteDocument,
  listDocumentFavorites,
  unfavoriteDocument,
} from "../api/endpoints/document-favorites";
import { documentKeys } from "./keys";
import { requireVerifiableFavorite, requireVerifiableStatus } from "./verify";

// Document favorites hooks (G1-07, UNI-681; lane 07b). The list is
// organization-scoped (the endpoint is), and every favorite/unfavorite
// invalidates the whole `favoritesRoot` prefix: the document.favorited /
// document.unfavorited frames are user-scoped and never name the
// organization, so the small prefix is the honest key to refresh. The
// document itself is not invalidated - the server has no per-document
// favorite field; the list is the only cache that carries the bookmark.
// UNI-2045 SV-2 adds the workspace's starred rows (`favoriteList`), which the
// toggles refresh too.

const FAVORITE_PAGE_SIZE = 50;

/** Every org favorites list, and every workspace's starred rows. */
function invalidateFavorites(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: documentKeys.favoritesRoot }),
    qc.invalidateQueries({
      queryKey: documentKeys.all,
      predicate: (query) => query.queryKey.length === 3 && query.queryKey[2] === "favorites",
    }),
  ]);
}

export function useDocumentFavorites(orgId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.favorites(orgId),
    queryFn: ({ signal }) => listDocumentFavorites(orgId, signal),
    enabled: (opts?.enabled ?? true) && !!orgId,
  });
}

/** The workspace's starred rows, newest star first, paged on the server's cursor. */
export function useWorkspaceFavoriteDocuments(wsId: string, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: documentKeys.favoriteList(wsId),
    queryFn: ({ pageParam, signal }) =>
      listFavoriteDocuments(wsId, { cursor: pageParam || undefined, limit: FAVORITE_PAGE_SIZE }, signal),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: (opts?.enabled ?? true) && !!wsId,
  });
}

export function useFavoriteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      requireVerifiableFavorite(await favoriteDocument(documentId)),
    onSuccess: () => invalidateFavorites(qc),
  });
}

export function useUnfavoriteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      requireVerifiableStatus(await unfavoriteDocument(documentId)),
    onSuccess: () => invalidateFavorites(qc),
  });
}
