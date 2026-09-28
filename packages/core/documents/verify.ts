import {
  DocumentNotVerifiableError,
  type Document,
  type DocumentAsset,
  type DocumentComment,
  type DocumentFavorite,
  type DocumentUpload,
  type DocumentVersionResult,
} from "../types/document";
import type { CommentReaction } from "../types/task-collaboration";

// Identity checks on mutation answers. An endpoint already returns null when
// its schema rejects the payload, but these guards also prove the response
// carries the fields a caller is about to mark "saved" with — id, revision,
// version — so a `{}` or a half-populated answer can never read as success.

export function requireVerifiableDocument(doc: Document | null | undefined): Document {
  if (!doc || !doc.id || !doc.revision) throw new DocumentNotVerifiableError();
  return doc;
}

export function requireVerifiableVersionResult(
  res: DocumentVersionResult | null | undefined,
): DocumentVersionResult {
  if (
    !res ||
    !res.document?.id ||
    !res.document?.revision ||
    !res.version?.id ||
    !(res.version.version > 0)
  ) {
    throw new DocumentNotVerifiableError();
  }
  return res;
}

export function requireVerifiableUpload(upload: DocumentUpload | null | undefined): DocumentUpload {
  if (!upload || !upload.upload_id || !upload.checksum_sha256 || !upload.claim_expires_at) {
    throw new DocumentNotVerifiableError();
  }
  return upload;
}

export function requireVerifiableAsset(asset: DocumentAsset | null | undefined): DocumentAsset {
  if (!asset || !asset.id || !asset.url || !asset.document_id) {
    throw new DocumentNotVerifiableError();
  }
  return asset;
}

/** A comment answer must name its row, its document and a body; a `{}` or a
 *  half-populated answer never counts as a saved comment. */
export function requireVerifiableComment(
  comment: DocumentComment | null | undefined,
): DocumentComment {
  if (!comment || !comment.id || !comment.document_id || !comment.body) {
    throw new DocumentNotVerifiableError();
  }
  return comment;
}

/** Favorites are idempotent, so the row identity is what proves the write:
 *  without it the client cannot reconcile the list from the answer. */
export function requireVerifiableFavorite(
  favorite: DocumentFavorite | null | undefined,
): DocumentFavorite {
  if (!favorite || !favorite.document_id) throw new DocumentNotVerifiableError();
  return favorite;
}

/** Void mutations - comment delete, reaction removal, unfavorite - prove the
 *  write with the `{status:"ok"}` envelope alone, so that envelope is what the
 *  endpoint reports and the hook requires before invalidating anything. */
export function requireVerifiableStatus(status: boolean): true {
  if (!status) throw new DocumentNotVerifiableError();
  return true;
}

/** A reaction answer must name its row and the comment it hangs on, the same
 *  way a comment answer must name its document. */
export function requireVerifiableReaction(
  reaction: CommentReaction | null | undefined,
): CommentReaction {
  if (!reaction || !reaction.id || !reaction.comment_id) throw new DocumentNotVerifiableError();
  return reaction;
}
