import {
  DocumentNotVerifiableError,
  type Document,
  type DocumentArchive,
  type DocumentAsset,
  type DocumentComment,
  type DocumentLinkEnvelope,
  type DocumentSettings,
  type DocumentShareBatch,
  type DocumentShareEnvelope,
  type DocumentUpload,
  type DocumentVersionResult,
} from "../types/document";
import type { DocumentFavorite } from "../types/document-favorites";
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

/** A grant answer proves the write with the live share row. One answer proves
 *  a write without a row of its own: a share naming the document's own
 *  workspace is merged into its home row (SH-S1), so the server answers the
 *  moved home-row grant - the same principal and level - with an empty
 *  `share.id`. `homeWorkspaceId` is the document's workspace, the one
 *  principal whose grant may come back that way; every other answer without a
 *  row identity stays unverifiable. */
export function requireVerifiableShare(
  res: DocumentShareEnvelope | null | undefined,
  homeWorkspaceId = "",
): DocumentShareEnvelope {
  if (!res?.share?.principal_id || !res.share?.level) throw new DocumentNotVerifiableError();
  if (res.share.id) return res;
  if (
    homeWorkspaceId !== "" &&
    res.share.principal_type === "workspace" &&
    res.share.principal_id === homeWorkspaceId
  ) {
    return res;
  }
  throw new DocumentNotVerifiableError();
}

/** A batch grant answer proves the write only when it names at least one
 *  live row and every row carries its identity; one half-populated row makes
 *  the whole answer unverifiable. */
export function requireVerifiableShareBatch(
  res: DocumentShareBatch | null | undefined,
): DocumentShareBatch {
  if (
    !res ||
    !res.shares.length ||
    !res.shares.every((row) => !!row.id && !!row.principal_id && !!row.level)
  ) {
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
