import { z } from "zod";
import type { DocumentKind } from "./document";

// ---- Favorites (G1-07; UNI-681 lane 07b) ------------------------------------

/** One favorited document in the caller's list: what a favorites panel needs
 *  to open the document, not the full payload (GET /documents/{id} has it). */
export const DocumentFavoriteSchema = z.object({
  document_id: z.string(),
  favorite_id: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  title: z.string().optional().default(""),
  kind: z.string().optional().default("page"),
  icon: z.string().nullish(),
  parent_id: z.string().nullish(),
  favorited_at: z.string().optional().default(""),
});
export type DocumentFavorite = Omit<z.infer<typeof DocumentFavoriteSchema>, "kind"> & {
  kind: DocumentKind;
};

export const DocumentFavoriteEnvelopeSchema = z.object({ favorite: DocumentFavoriteSchema });
export const DocumentFavoriteListEnvelopeSchema = z.object({
  favorites: z.array(DocumentFavoriteSchema),
});
