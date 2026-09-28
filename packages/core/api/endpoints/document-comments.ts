import { z } from "zod";
import {
  DocumentCommentEnvelopeSchema,
  DocumentCommentListEnvelopeSchema,
  type DocumentComment,
} from "../../types/document";
import { CommentReactionSchema, type CommentReaction } from "../../types/task-collaboration";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Document comment endpoints (G1-07, UNI-681; lane 07b). The transport
// returns unknown; every response goes through parseWithFallback, and a
// mutation resolves null when the answer cannot prove the write - the hooks
// turn that into "result not verifiable" so a malformed answer never reads as
// saved. `type` is accepted for wire parity with task comments but the
// document allowlist is "comment" only: the server refuses anything else, and
// this client never sends one.

const enc = encodeURIComponent;

const CommentResponse = DocumentCommentEnvelopeSchema;
const CommentListResponse = DocumentCommentListEnvelopeSchema;
const ReactionResponse = z.object({ reaction: CommentReactionSchema });

export interface CreateDocumentCommentBody {
  body: string;
  /** ULID of the comment this one replies to; the parent must hang on the
   *  same document (the server answers 400 otherwise). */
  parent_id?: string;
}

export interface UpdateDocumentCommentBody {
  body: string;
}

export interface CommentReactionBody {
  emoji: string;
}

/** Extra request controls for the comment create (Idempotency-Key). */
export interface DocumentCommentRequestOpts {
  /** Reused across retries of the same logical create; the server dedupes on
   *  key + payload fingerprint and answers 409 on a mismatch. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function commentPath(documentId: string, commentId?: string, suffix?: string): string {
  const base = `/api/v1/documents/${enc(documentId)}/comments`;
  const withComment = commentId ? `${base}/${enc(commentId)}` : base;
  return suffix ? `${withComment}/${suffix}` : withComment;
}

/** GET /api/v1/documents/{documentID}/comments - the thread, oldest first. */
export async function listDocumentComments(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentComment[]> {
  const raw = await request(commentPath(documentId), { signal });
  return parseWithFallback<{ comments: DocumentComment[] }>(raw, CommentListResponse, {
    comments: [],
  }, {
    endpoint: "GET /api/v1/documents/{id}/comments",
  }).comments;
}

/** POST /api/v1/documents/{documentID}/comments - add (or reply). */
export async function createDocumentComment(
  documentId: string,
  body: CreateDocumentCommentBody,
  opts?: DocumentCommentRequestOpts,
): Promise<DocumentComment | null> {
  const headers: Record<string, string> = {};
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const raw = await request(commentPath(documentId), {
    method: "POST",
    body,
    headers,
    signal: opts?.signal,
  });
  return parseWithFallback<{ comment: DocumentComment } | null>(raw, CommentResponse, null, {
    endpoint: "POST /api/v1/documents/{id}/comments",
  })?.comment ?? null;
}

/** PATCH /api/v1/documents/{documentID}/comments/{commentID} - author or
 *  manage edits the body. */
export async function updateDocumentComment(
  documentId: string,
  commentId: string,
  body: UpdateDocumentCommentBody,
): Promise<DocumentComment | null> {
  const raw = await request(commentPath(documentId, commentId), { method: "PATCH", body });
  return parseWithFallback<{ comment: DocumentComment } | null>(raw, CommentResponse, null, {
    endpoint: "PATCH /api/v1/documents/{id}/comments/{commentId}",
  })?.comment ?? null;
}

/** DELETE /api/v1/documents/{documentID}/comments/{commentID}. */
export async function deleteDocumentComment(documentId: string, commentId: string): Promise<void> {
  await request(commentPath(documentId, commentId), { method: "DELETE" });
}

/** POST .../comments/{commentID}/resolve - mark resolved (edit level). */
export async function resolveDocumentComment(
  documentId: string,
  commentId: string,
): Promise<DocumentComment | null> {
  const raw = await request(commentPath(documentId, commentId, "resolve"), { method: "POST" });
  return parseWithFallback<{ comment: DocumentComment } | null>(raw, CommentResponse, null, {
    endpoint: "POST /api/v1/documents/{id}/comments/{commentId}/resolve",
  })?.comment ?? null;
}

/** DELETE .../comments/{commentID}/resolve - reopen (clear resolution). */
export async function reopenDocumentComment(
  documentId: string,
  commentId: string,
): Promise<DocumentComment | null> {
  const raw = await request(commentPath(documentId, commentId, "resolve"), { method: "DELETE" });
  return parseWithFallback<{ comment: DocumentComment } | null>(raw, CommentResponse, null, {
    endpoint: "DELETE /api/v1/documents/{id}/comments/{commentId}/resolve",
  })?.comment ?? null;
}

/** POST .../comments/{commentID}/reactions - add the caller's emoji. */
export async function addDocumentCommentReaction(
  documentId: string,
  commentId: string,
  body: CommentReactionBody,
): Promise<CommentReaction | null> {
  const raw = await request(commentPath(documentId, commentId, "reactions"), {
    method: "POST",
    body,
  });
  return parseWithFallback<{ reaction: CommentReaction } | null>(raw, ReactionResponse, null, {
    endpoint: "POST /api/v1/documents/{id}/comments/{commentId}/reactions",
  })?.reaction ?? null;
}

/** DELETE .../comments/{commentID}/reactions - remove the caller's emoji. */
export async function removeDocumentCommentReaction(
  documentId: string,
  commentId: string,
  body: CommentReactionBody,
): Promise<void> {
  await request(commentPath(documentId, commentId, "reactions"), { method: "DELETE", body });
}
