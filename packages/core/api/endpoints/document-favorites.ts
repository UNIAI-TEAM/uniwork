import { z } from "zod";
import {
  DocumentFavoriteEnvelopeSchema,
  DocumentFavoriteListEnvelopeSchema,
  type DocumentFavorite,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Document favorites endpoints (G1-07, UNI-681; lane 07b). Favorites are the
// caller's own bookmarks, so there is no workspace argument: the add/remove
// act on one document and the list is organization-scoped (the server
// re-checks the caller's live access on every row).

const enc = encodeURIComponent;

const FavoriteResponse = DocumentFavoriteEnvelopeSchema;
const FavoriteListResponse = DocumentFavoriteListEnvelopeSchema;
const StatusResponse = z.object({ status: z.string() });

/** GET /api/v1/orgs/{orgID}/documents/favorites - newest first, only rows
 *  the caller can still read. */
export async function listDocumentFavorites(
  orgId: string,
  signal?: AbortSignal,
): Promise<DocumentFavorite[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/documents/favorites`, { signal });
  return parseWithFallback<{ favorites: DocumentFavorite[] }>(raw, FavoriteListResponse, {
    favorites: [],
  }, {
    endpoint: "GET /api/v1/orgs/{orgId}/documents/favorites",
  }).favorites;
}

/** POST /api/v1/documents/{documentID}/favorite - idempotent: a repeat answers
 *  the live row, so the caller can reconcile from the response either way. */
export async function favoriteDocument(documentId: string): Promise<DocumentFavorite | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/favorite`, { method: "POST" });
  return parseWithFallback<{ favorite: DocumentFavorite } | null>(raw, FavoriteResponse, null, {
    endpoint: "POST /api/v1/documents/{id}/favorite",
  })?.favorite ?? null;
}

/** DELETE /api/v1/documents/{documentID}/favorite - idempotent; removing an
 *  absent favorite still answers 200. Returns whether the {status:"ok"}
 *  envelope was proven, so a malformed answer never reads as a saved change. */
export async function unfavoriteDocument(documentId: string): Promise<boolean> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/favorite`, { method: "DELETE" });
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "DELETE /api/v1/documents/{id}/favorite",
  }).status === "ok";
}
