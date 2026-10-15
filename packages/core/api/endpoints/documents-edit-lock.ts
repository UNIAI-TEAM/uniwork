import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Document edit lock endpoints (UNI-1645, addendum §3; contract card (a) §3).
// One live tenure per document, held by one editor instance. `lock_id` is the
// holder's key: only DocumentEditLock carries it, never the summary or a 423.
// Schemas are lenient (enums as strings); a malformed answer degrades to null
// (a write that cannot be proven) or to an empty state, never a throw.

const enc = encodeURIComponent;

/** Which editor holds the tenure; `""` only on a reserved handover tenure. */
export type DocumentEditLockClient = "web_page" | "web_office" | "desktop";

const optionalTime = z.string().nullable().optional();

const DocumentEditLockSchema = z.object({
  lock_id: z.string().min(1),
  document_id: z.string(),
  holder_id: z.string(),
  client: z.string(),
  acquired_at: z.string(),
  expires_at: z.string(),
  offline_hold_until: optionalTime,
  hold_max_until: optionalTime,
  granted_via: z.string(),
  heartbeat_interval_ms: z.number().int().positive(),
  ttl_ms: z.number().int().positive(),
  server_time: z.string(),
});

/** DocumentEditLockSDO: the caller's own tenure (R2, R5, R6, R7). */
export interface DocumentEditLock {
  lock_id: string;
  document_id: string;
  holder_id: string;
  client: string;
  acquired_at: string;
  expires_at: string;
  offline_hold_until?: string | null;
  hold_max_until?: string | null;
  /** acquire | take_over | handover | move_here (open set). */
  granted_via: string;
  heartbeat_interval_ms: number;
  ttl_ms: number;
  server_time: string;
}

const DocumentEditLockSummarySchema = z.object({
  lock_id: z.string().optional(),
  holder_id: z.string(),
  holder_name: z.string().catch(""),
  holder_avatar_url: z.string().nullable().optional(),
  since: z.string(),
  expires_at: z.string(),
  offline_hold_until: optionalTime,
  reserved: z.boolean().catch(false),
  held_by_me: z.boolean().catch(false),
});

/** DocumentEditLockSummarySDO: who holds the document, without the key. */
export interface DocumentEditLockSummary {
  /** Contract v2 C2-1: only for a manage-level caller who is not the holder;
   *  it feeds R5 expected_lock_id. Absent everywhere else. */
  lock_id?: string;
  holder_id: string;
  holder_name: string;
  holder_avatar_url?: string | null;
  since: string;
  expires_at: string;
  offline_hold_until?: string | null;
  /** A handover tenure waiting for the requester to claim it with R2. */
  reserved: boolean;
  /** Same user, maybe another tab or device. */
  held_by_me: boolean;
}

const DocumentEditRequestSchema = z.object({
  request_id: z.string().min(1),
  document_id: z.string(),
  requester_id: z.string(),
  requester_name: z.string().catch(""),
  holder_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  answered_at: optionalTime,
});

/** DocumentEditRequestSDO. */
export interface DocumentEditRequest {
  request_id: string;
  document_id: string;
  requester_id: string;
  requester_name: string;
  holder_id: string;
  /** pending | accepted | declined | cancelled | superseded | expired (open set). */
  status: string;
  created_at: string;
  expires_at: string;
  answered_at?: string | null;
}

// One bad request row must not blank the holder's prompt list: drop it.
const lenientRequests = z
  .array(z.unknown())
  .catch([])
  .transform((rows) =>
    rows.flatMap((row) => {
      const parsed = DocumentEditRequestSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  );

const DocumentEditLockStateSchema = z.object({
  lock: DocumentEditLockSummarySchema.nullable(),
  my_request: DocumentEditRequestSchema.nullable().catch(null),
  pending_requests: lenientRequests.optional(),
  can_take_over: z.boolean().catch(false),
  can_request: z.boolean().catch(false),
  server_time: z.string().catch(""),
});

/** DocumentEditLockStateSDO (R1). */
export interface DocumentEditLockState {
  lock: DocumentEditLockSummary | null;
  my_request: DocumentEditRequest | null;
  /** Only when the caller is the holder. */
  pending_requests: DocumentEditRequest[];
  can_take_over: boolean;
  can_request: boolean;
  server_time: string;
}

const DocumentEditHeartbeatSchema = z.object({
  lock_id: z.string().min(1),
  expires_at: z.string(),
  offline_hold_until: optionalTime,
  server_time: z.string(),
});

/** DocumentEditHeartbeatSDO (R3). */
export interface DocumentEditHeartbeat {
  lock_id: string;
  expires_at: string;
  offline_hold_until?: string | null;
  server_time: string;
}

const base = (documentId: string) => `/api/v1/documents/${enc(documentId)}`;

function parseLock(raw: unknown, endpoint: string): DocumentEditLock | null {
  return parseWithFallback<DocumentEditLock | null>(raw, DocumentEditLockSchema, null, { endpoint });
}

function parseRequest(raw: unknown, endpoint: string): DocumentEditRequest | null {
  return parseWithFallback<DocumentEditRequest | null>(raw, DocumentEditRequestSchema, null, { endpoint });
}

/**
 * R1 GET /api/v1/documents/{documentID}/edit-lock — who holds the document.
 * Null when the answer is malformed: the caller treats the state as unknown
 * (never as "free", which would offer "Edit now" over a live holder).
 */
export async function getDocumentEditLock(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentEditLockState | null> {
  const raw = await request(`${base(documentId)}/edit-lock`, { signal });
  const parsed = parseWithFallback<Omit<DocumentEditLockState, "pending_requests"> & {
    pending_requests?: DocumentEditRequest[];
  } | null>(raw, DocumentEditLockStateSchema, null, { endpoint: "GET /api/v1/documents/{id}/edit-lock" });
  if (!parsed) return null;
  return { ...parsed, pending_requests: parsed.pending_requests ?? [] };
}

export interface AcquireDocumentEditLockBody {
  /** Client-minted ULID, one per editor open. */
  editor_id: string;
  client: DocumentEditLockClient;
  /** "Edit here": only valid while the caller already holds the document. */
  move_from_self?: boolean;
}

/**
 * R2 POST /api/v1/documents/{documentID}/edit-lock — acquire, claim a
 * handover, or move here. 423 document_locked rejects as an ApiError whose
 * fields name the holder (no lock_id).
 */
export async function acquireDocumentEditLock(
  documentId: string,
  body: AcquireDocumentEditLockBody,
  signal?: AbortSignal,
): Promise<DocumentEditLock | null> {
  const raw = await request(`${base(documentId)}/edit-lock`, { method: "POST", body, signal });
  return parseLock(raw, "POST /api/v1/documents/{id}/edit-lock");
}

/**
 * R3 POST …/edit-lock/{lockID}/heartbeat. 409 edit_lock_lost rejects with
 * `fields.reason` (and `by_id`/`by_name` for taken_over / handed_over).
 */
export async function heartbeatDocumentEditLock(
  documentId: string,
  lockId: string,
  signal?: AbortSignal,
): Promise<DocumentEditHeartbeat | null> {
  const raw = await request(`${base(documentId)}/edit-lock/${enc(lockId)}/heartbeat`, {
    method: "POST",
    body: {},
    signal,
  });
  return parseWithFallback<DocumentEditHeartbeat | null>(raw, DocumentEditHeartbeatSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/edit-lock/{lockID}/heartbeat",
  });
}

/**
 * R4 DELETE …/edit-lock/{lockID} — idempotent 204. `keepalive` lets the
 * request outlive the page (pagehide, logout); the transport still attaches
 * the session.
 */
export async function releaseDocumentEditLock(
  documentId: string,
  lockId: string,
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  await request(`${base(documentId)}/edit-lock/${enc(lockId)}`, {
    method: "DELETE",
    keepalive: opts.keepalive,
  });
}

export interface TakeOverDocumentEditLockBody {
  editor_id: string;
  client: DocumentEditLockClient;
  /** The tenure the confirm dialog showed; a stale one answers 409 edit_lock_changed. */
  expected_lock_id: string;
}

/** R5 POST …/edit-lock/take-over (manage). */
export async function takeOverDocumentEditLock(
  documentId: string,
  body: TakeOverDocumentEditLockBody,
): Promise<DocumentEditLock | null> {
  const raw = await request(`${base(documentId)}/edit-lock/take-over`, { method: "POST", body });
  return parseLock(raw, "POST /api/v1/documents/{id}/edit-lock/take-over");
}

/** R6 PUT …/edit-lock/{lockID}/offline-hold — start or renew a hold (desktop session only). */
export async function putDocumentEditHold(documentId: string, lockId: string): Promise<DocumentEditLock | null> {
  const raw = await request(`${base(documentId)}/edit-lock/${enc(lockId)}/offline-hold`, {
    method: "PUT",
    body: {},
  });
  return parseLock(raw, "PUT /api/v1/documents/{id}/edit-lock/{lockID}/offline-hold");
}

/** R7 DELETE …/edit-lock/{lockID}/offline-hold — end the hold (idempotent). */
export async function deleteDocumentEditHold(documentId: string, lockId: string): Promise<DocumentEditLock | null> {
  const raw = await request(`${base(documentId)}/edit-lock/${enc(lockId)}/offline-hold`, { method: "DELETE" });
  return parseLock(raw, "DELETE /api/v1/documents/{id}/edit-lock/{lockID}/offline-hold");
}

/** R8 POST …/edit-requests — ask the holder for the lock (200 returns the caller's pending one). */
export async function createDocumentEditRequest(documentId: string): Promise<DocumentEditRequest | null> {
  const raw = await request(`${base(documentId)}/edit-requests`, { method: "POST", body: {} });
  return parseRequest(raw, "POST /api/v1/documents/{id}/edit-requests");
}

export interface AnswerDocumentEditRequestBody {
  decision: "accept" | "decline";
  /** The holder's own tenure the request was made to. */
  lock_id: string;
}

/** R9 POST …/edit-requests/{requestID}/answer (holder only). */
export async function answerDocumentEditRequest(
  documentId: string,
  requestId: string,
  body: AnswerDocumentEditRequestBody,
): Promise<DocumentEditRequest | null> {
  const raw = await request(`${base(documentId)}/edit-requests/${enc(requestId)}/answer`, {
    method: "POST",
    body,
  });
  return parseRequest(raw, "POST /api/v1/documents/{id}/edit-requests/{requestID}/answer");
}

/** R10 DELETE …/edit-requests/{requestID} — the requester cancels (idempotent 204). */
export async function cancelDocumentEditRequest(documentId: string, requestId: string): Promise<void> {
  await request(`${base(documentId)}/edit-requests/${enc(requestId)}`, { method: "DELETE" });
}
