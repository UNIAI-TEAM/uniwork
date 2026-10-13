import { z } from "zod";
import {
  DocumentCommentEnvelopeSchema,
  DocumentCommentListEnvelopeSchema,
  DocumentCommentRevisionListEnvelopeSchema,
  type DocumentComment,
  type DocumentCommentKind,
  type DocumentCommentMention,
  type DocumentCommentRevision,
} from "../../types/document";
import { CommentReactionSchema, type CommentReaction } from "../../types/task-collaboration";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Document comment endpoints (G1-07, UNI-681; lane 07b; G8-03). The transport
// returns unknown; every response goes through parseWithFallback, and a
// mutation resolves null when the answer cannot prove the write - the hooks
// turn that into "result not verifiable" so a malformed answer never reads as
// saved. `kind` is the thread flow since G8-03; `type` survives for wire
// parity with task comments and never decides the kind.

const enc = encodeURIComponent;

const CommentResponse = DocumentCommentEnvelopeSchema;
const CommentListResponse = DocumentCommentListEnvelopeSchema;
const RevisionListResponse = DocumentCommentRevisionListEnvelopeSchema;
const ReactionResponse = z.object({ reaction: CommentReactionSchema });
const StatusResponse = z.object({ status: z.string() });

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

/** Query controls for the thread read (G8-03): `kind` narrows to one thread
 *  flow, `sinceToken` is the listToken of the caller's previous full list. */
export interface ListDocumentCommentsOptions {
  kind?: DocumentCommentKind;
  sinceToken?: string;
  signal?: AbortSignal;
}

/** The thread read's two proven shapes (contract-collab section 2.1): a full
 *  list, or `unchanged` with the token alone - the caller keeps the list it
 *  already holds. The unchanged shape carries no `comments` on purpose, so a
 *  caller can never write an empty list over the cached one. */
export type DocumentCommentList =
  | { unchanged: true; listToken: string }
  | {
      unchanged: false;
      comments: DocumentComment[];
      mentions: DocumentCommentMention[];
      listToken: string;
    };

/** GET /api/v1/documents/{documentID}/comments - the thread, oldest first.
 *  Resolves null when the answer proves neither shape (malformed, or missing
 *  both `unchanged` and a parseable `comments`), so the caller keeps its list
 *  instead of clearing it; the web query sends no sinceToken at all. */
export async function listDocumentComments(
  documentId: string,
  opts?: ListDocumentCommentsOptions,
): Promise<DocumentCommentList | null> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.sinceToken) params.set("since_token", opts.sinceToken);
  const query = params.toString();
  const raw = await request(query ? `${commentPath(documentId)}?${query}` : commentPath(documentId), {
    signal: opts?.signal,
  });
  const page = parseWithFallback<z.infer<typeof CommentListResponse> | null>(
    raw,
    CommentListResponse,
    null,
    { endpoint: "GET /api/v1/documents/{id}/comments" },
  );
  if (!page) return null;
  if (page.unchanged === true && page.list_token !== "") {
    return { unchanged: true, listToken: page.list_token };
  }
  // A reply without `unchanged` is the pre-G8 server: a parsed comments array
  // is a full list. Without one there is nothing to write.
  if (!page.comments) return null;
  return {
    unchanged: false,
    comments: page.comments,
    mentions: page.mentions,
    listToken: page.list_token,
  };
}

/** GET /api/v1/documents/{documentID}/comments/{commentID}/revisions - the
 *  edit history, newest first (G8-03). Resolves null on a malformed answer so
 *  the caller keeps what it had; a tombstoned comment is the server's 409. */
export async function listDocumentCommentRevisions(
  documentId: string,
  commentId: string,
  opts?: { signal?: AbortSignal },
): Promise<DocumentCommentRevision[] | null> {
  const raw = await request(commentPath(documentId, commentId, "revisions"), {
    signal: opts?.signal,
  });
  const parsed = parseWithFallback<{ revisions: DocumentCommentRevision[] } | null>(
    raw,
    RevisionListResponse,
    null,
    { endpoint: "GET /api/v1/documents/{id}/comments/{commentId}/revisions" },
  );
  return parsed?.revisions ?? null;
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

/** DELETE /api/v1/documents/{documentID}/comments/{commentID}. The server
 *  proves the delete with {status:"ok"}; the endpoint returns whether that
 *  envelope was proven, so a malformed answer never reads as a saved delete. */
export async function deleteDocumentComment(
  documentId: string,
  commentId: string,
): Promise<boolean> {
  const raw = await request(commentPath(documentId, commentId), { method: "DELETE" });
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "DELETE /api/v1/documents/{id}/comments/{commentId}",
  }).status === "ok";
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

/** DELETE .../comments/{commentID}/reactions - remove the caller's emoji.
 *  Same {status:"ok"} proof as the comment delete. */
export async function removeDocumentCommentReaction(
  documentId: string,
  commentId: string,
  body: CommentReactionBody,
): Promise<boolean> {
  const raw = await request(commentPath(documentId, commentId, "reactions"), {
    method: "DELETE",
    body,
  });
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "DELETE /api/v1/documents/{id}/comments/{commentId}/reactions",
  }).status === "ok";
}
