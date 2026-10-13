import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// The comment routes as the editor frame uses them (G8-08, contract-collab §2).
// The frame asks over postMessage; the host answers with the user's session
// through these functions and hands the server's JSON back unchanged, so a field
// this client does not know (anchor, kind, deleted_at, a later addition) still
// reaches the frame. That is why the schemas are loose objects and why this is
// not `document-comments.ts`, whose schemas strip to the D panel's own fields.
// A malformed answer resolves null (the host turns it into an `internal` frame
// error); a failed request throws the transport's ApiError for the protocol's
// HTTP mapping to read.

const enc = encodeURIComponent;

/** A comment as the server wrote it. Only the identity is checked; the frame validates the rest. */
type FrameWireComment = { id: string; document_id: string } & Record<string, unknown>;

const WireComment = z.looseObject({ id: z.string(), document_id: z.string() });
const CommentResponse = z.looseObject({ comment: WireComment });

const ListResponse = z.looseObject({
  comments: z.array(WireComment).optional(),
  mentions: z.array(z.looseObject({})).optional(),
  list_token: z.string().optional().catch(undefined),
  unchanged: z.boolean().optional().catch(undefined),
});

const DeleteResponse = z.looseObject({ status: z.string(), outcome: z.string().optional().catch(undefined) });
const RevisionsResponse = z.looseObject({ revisions: z.array(z.looseObject({})) });
const AnchorsResponse = z.looseObject({
  updated: z.array(z.string()),
  skipped: z.array(z.looseObject({})),
  list_token: z.string(),
});
const CandidatesResponse = z.looseObject({ candidates: z.array(z.looseObject({})) });

/** `unchanged` is its own shape: the frame keeps the list it holds, nothing here may replace it. */
type FrameCommentList =
  | { unchanged: true; list_token: string }
  | { unchanged: false; comments: FrameWireComment[]; mentions: Record<string, unknown>[]; list_token: string };

interface FrameCommentListQuery {
  kind?: string;
  since_token?: string;
}

interface FrameCommentCreateBody {
  kind: string;
  body: string;
  parent_id?: string;
  anchor?: unknown;
  base_version_id?: string;
}

interface FrameCommentAnchorsBody {
  version_id: string;
  anchors: unknown[];
}

function path(documentId: string, ...rest: string[]): string {
  return [`/api/v1/documents/${enc(documentId)}`, ...rest].join("/");
}

/** GET /api/v1/documents/{documentID}/comments - the whole thread, or `unchanged` against `since_token`. */
export async function listFrameComments(
  documentId: string,
  query: FrameCommentListQuery,
  signal?: AbortSignal,
): Promise<FrameCommentList | null> {
  const params = new URLSearchParams();
  if (query.kind) params.set("kind", query.kind);
  if (query.since_token) params.set("since_token", query.since_token);
  const qs = params.toString();
  const raw = await request(`${path(documentId, "comments")}${qs ? `?${qs}` : ""}`, { signal });
  const parsed = parseWithFallback<z.infer<typeof ListResponse> | null>(raw, ListResponse, null, {
    endpoint: "GET /api/v1/documents/{id}/comments (frame)",
  });
  if (!parsed) return null;
  // An unchanged answer names the token only: its empty `comments` is never a list.
  if (parsed.unchanged === true) return parsed.list_token ? { unchanged: true, list_token: parsed.list_token } : null;
  // No `unchanged` (a server before the token): a full list only when `comments` parsed.
  if (!parsed.comments) return null;
  return {
    unchanged: false,
    comments: parsed.comments as FrameWireComment[],
    mentions: (parsed.mentions ?? []) as Record<string, unknown>[],
    list_token: parsed.list_token ?? "",
  };
}

/** POST /api/v1/documents/{documentID}/comments - one Idempotency-Key per Send, kept across its retries. */
export async function createFrameComment(
  documentId: string,
  body: FrameCommentCreateBody,
  opts: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<{ comment: FrameWireComment } | null> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const raw = await request(path(documentId, "comments"), { method: "POST", body, headers, signal: opts.signal });
  return commentOf(raw, "POST /api/v1/documents/{id}/comments (frame)");
}

/** PATCH .../comments/{commentID} - the body only; kind, anchor and parent never change here. */
export async function updateFrameComment(
  documentId: string,
  commentId: string,
  body: { body: string },
  signal?: AbortSignal,
): Promise<{ comment: FrameWireComment } | null> {
  const raw = await request(path(documentId, "comments", enc(commentId)), { method: "PATCH", body, signal });
  return commentOf(raw, "PATCH /api/v1/documents/{id}/comments/{commentId} (frame)");
}

/** POST .../comments/{commentID}/resolve. */
export async function resolveFrameComment(
  documentId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<{ comment: FrameWireComment } | null> {
  const raw = await request(path(documentId, "comments", enc(commentId), "resolve"), { method: "POST", signal });
  return commentOf(raw, "POST /api/v1/documents/{id}/comments/{commentId}/resolve (frame)");
}

/** DELETE .../comments/{commentID}/resolve. */
export async function reopenFrameComment(
  documentId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<{ comment: FrameWireComment } | null> {
  const raw = await request(path(documentId, "comments", enc(commentId), "resolve"), { method: "DELETE", signal });
  return commentOf(raw, "DELETE /api/v1/documents/{id}/comments/{commentId}/resolve (frame)");
}

/**
 * DELETE .../comments/{commentID}: `tombstoned` (replies keep the thread) or `removed`. A server
 * before `outcome` answers {status:"ok"} alone and its delete was a hard one.
 */
export async function deleteFrameComment(
  documentId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<{ outcome: "tombstoned" | "removed" } | null> {
  const raw = await request(path(documentId, "comments", enc(commentId)), { method: "DELETE", signal });
  const parsed = parseWithFallback<z.infer<typeof DeleteResponse> | null>(raw, DeleteResponse, null, {
    endpoint: "DELETE /api/v1/documents/{id}/comments/{commentId} (frame)",
  });
  if (!parsed || parsed.status !== "ok") return null;
  return { outcome: parsed.outcome === "tombstoned" ? "tombstoned" : "removed" };
}

/** GET .../comments/{commentID}/revisions - newest first. */
export async function listFrameCommentRevisions(
  documentId: string,
  commentId: string,
  signal?: AbortSignal,
): Promise<{ revisions: Record<string, unknown>[] } | null> {
  const raw = await request(path(documentId, "comments", enc(commentId), "revisions"), { signal });
  return parseWithFallback<{ revisions: Record<string, unknown>[] } | null>(raw, RevisionsResponse, null, {
    endpoint: "GET /api/v1/documents/{id}/comments/{commentId}/revisions (frame)",
  });
}

/** PUT .../comments/anchors - the editor's anchor map after a Save. */
export async function putFrameCommentAnchors(
  documentId: string,
  body: FrameCommentAnchorsBody,
  signal?: AbortSignal,
): Promise<{ updated: string[]; skipped: Record<string, unknown>[]; list_token: string } | null> {
  const raw = await request(path(documentId, "comments", "anchors"), { method: "PUT", body, signal });
  return parseWithFallback<{ updated: string[]; skipped: Record<string, unknown>[]; list_token: string } | null>(
    raw,
    AnchorsResponse,
    null,
    { endpoint: "PUT /api/v1/documents/{id}/comments/anchors (frame)" },
  );
}

/** GET .../mention-candidates?q=&limit= - who the composer may offer. */
export async function searchFrameMentionCandidates(
  documentId: string,
  query: { q: string; limit?: number },
  signal?: AbortSignal,
): Promise<{ candidates: Record<string, unknown>[] } | null> {
  const params = new URLSearchParams({ q: query.q });
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const raw = await request(`${path(documentId, "mention-candidates")}?${params.toString()}`, { signal });
  return parseWithFallback<{ candidates: Record<string, unknown>[] } | null>(raw, CandidatesResponse, null, {
    endpoint: "GET /api/v1/documents/{id}/mention-candidates (frame)",
  });
}

function commentOf(raw: unknown, endpoint: string): { comment: FrameWireComment } | null {
  const parsed = parseWithFallback<z.infer<typeof CommentResponse> | null>(raw, CommentResponse, null, { endpoint });
  return parsed ? { comment: parsed.comment as FrameWireComment } : null;
}
