import {
  DocumentNotVerifiableError,
  type Document,
  type DocumentArchive,
  type DocumentAsset,
  type DocumentComment,
  type DocumentFavorite,
  type DocumentLinkEnvelope,
  type DocumentSettings,
  type DocumentShareEnvelope,
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

/** An archive/restore answer proves the write with the moved document and
 *  its identity; the batch id and affected list are informative. */
export function requireVerifiableArchive(res: DocumentArchive | null | undefined): DocumentArchive {
  if (!res || !res.document?.id || !res.document?.revision) throw new DocumentNotVerifiableError();
  return res;
}

/** A grant answer proves the write with the live share row. */
export function requireVerifiableShare(
  res: DocumentShareEnvelope | null | undefined,
): DocumentShareEnvelope {
  if (!res || !res.share?.id || !res.share?.principal_id || !res.share?.level) {
    throw new DocumentNotVerifiableError();
  }
  return res;
}

/** A link answer proves the write only when the minted row, the raw token
 *  (shown once) and the share path all arrived. */
export function requireVerifiableLink(
  res: DocumentLinkEnvelope | null | undefined,
): DocumentLinkEnvelope {
  if (!res || !res.link?.id || !res.token || !res.url) throw new DocumentNotVerifiableError();
  return res;
}

/** A settings answer proves the write with the organization it belongs to. */
export function requireVerifiableSettings(res: DocumentSettings | null | undefined): DocumentSettings {
  if (!res || !res.organization_id || typeof res.public_links_enabled !== "boolean") {
    throw new DocumentNotVerifiableError();
  }
  return res;
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
