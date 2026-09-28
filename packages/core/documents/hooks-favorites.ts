"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  favoriteDocument,
  listDocumentFavorites,
  unfavoriteDocument,
} from "../api/endpoints/document-favorites";
import { documentKeys } from "./keys";
import { requireVerifiableFavorite } from "./verify";

// Document favorites hooks (G1-07, UNI-681; lane 07b). The list is
// organization-scoped (the endpoint is), and every favorite/unfavorite
// invalidates the whole `favoritesRoot` prefix: the document.favorited /
// document.unfavorited frames are user-scoped and never name the
// organization, so the small prefix is the honest key to refresh. The
// document itself is not invalidated - the server has no per-document
// favorite field; the list is the only cache that carries the bookmark.

export function useDocumentFavorites(orgId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: documentKeys.favorites(orgId),
    queryFn: ({ signal }) => listDocumentFavorites(orgId, signal),
    enabled: (opts?.enabled ?? true) && !!orgId,
  });
}

export function useFavoriteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) =>
      requireVerifiableFavorite(await favoriteDocument(documentId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.favoritesRoot }),
  });
}

export function useUnfavoriteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => unfavoriteDocument(documentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.favoritesRoot }),
  });
}
