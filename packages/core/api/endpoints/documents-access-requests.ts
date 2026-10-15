import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Access requests on one document (access addendum §3, §4.3; W-DOC07,
// UNI-1631). The create answer is uniform on purpose: 202 {"status":"sent"}
// for every well-formed id, so it never proves the document exists. The only
// refusals the requester sees are about their own row: 409
// access_request_pending and 429 access_request_cooldown
// (fields.retry_after_seconds); the hooks and the locked card branch on those
// codes. Mutations resolve null when the answer cannot prove the write.

const enc = encodeURIComponent;

/** The levels a request may ask for or an approval may grant (never manage). */
export type DocumentAccessRequestLevel = "view" | "comment" | "edit";

export interface CreateDocumentAccessRequestBody {
  requested_level?: DocumentAccessRequestLevel;
  /** At most 500 characters after trimming; the server answers 400 past that. */
  message?: string;
  /** Always sent as a pair; the server drops a source the caller cannot read. */
  source_kind?: "task" | "meeting";
  source_id?: string;
}

const SentSchema = z.object({ status: z.string() });
export type DocumentAccessRequestSent = z.infer<typeof SentSchema>;

/** POST /api/v1/documents/{documentID}/access-requests — ask the people who
 *  manage the document for a level. */
export async function createDocumentAccessRequest(
  documentId: string,
  body: CreateDocumentAccessRequestBody,
  signal?: AbortSignal,
): Promise<DocumentAccessRequestSent | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/access-requests`, {
    method: "POST",
    body,
    signal,
  });
  return parseWithFallback<DocumentAccessRequestSent | null>(raw, SentSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/access-requests",
  });
}

// Lenient row: enums stay strings, optional text reads as empty, and a source
// that does not parse reads as "from a link" (null) rather than dropping the row.
const SourceSchema = z.object({ kind: z.string(), id: z.string(), title: z.string().catch("").default("") });

const RequestRowSchema = z.object({
  id: z.string(),
  requester_id: z.string(),
  requester_name: z.string().catch("").default(""),
  requested_level: z.string().catch("view").default("view"),
  message: z.string().nullable().catch("").default("").transform((v) => v ?? ""),
  source: SourceSchema.nullable().catch(null).default(null),
  created_at: z.string().catch("").default(""),
  expires_at: z.string().catch("").default(""),
});
export type DocumentAccessRequest = z.infer<typeof RequestRowSchema>;

const ListSchema = z.object({
  requests: z.array(z.unknown()).transform((rows) =>
    rows.flatMap((row) => {
      const parsed = RequestRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

/** GET /api/v1/documents/{documentID}/access-requests — the pending, unexpired
 *  requests; empty for a reader who does not administer the document. */
export async function listDocumentAccessRequests(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentAccessRequest[]> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/access-requests`, { signal });
  const parsed = parseWithFallback<{ requests: DocumentAccessRequest[] }>(raw, ListSchema, { requests: [] }, {
    endpoint: "GET /api/v1/documents/{id}/access-requests",
  });
  return parsed.requests;
}

const DecisionSchema = z.object({
  id: z.string(),
  status: z.string(),
  share_id: z.string().catch("").default(""),
});
export type DocumentAccessRequestDecision = z.infer<typeof DecisionSchema>;

export interface ApproveDocumentAccessRequestBody {
  /** Defaults to the requested level on the server. */
  level?: DocumentAccessRequestLevel;
}

/** POST …/access-requests/{requestID}/approve — grant the requester a level.
 *  `share_id` is empty when the requester already had it. 409
 *  access_request_closed when it was handled, expired or archived. */
export async function approveDocumentAccessRequest(
  documentId: string,
  requestId: string,
  body: ApproveDocumentAccessRequestBody,
  signal?: AbortSignal,
): Promise<DocumentAccessRequestDecision | null> {
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/access-requests/${enc(requestId)}/approve`,
    { method: "POST", body, signal },
  );
  return parseWithFallback<DocumentAccessRequestDecision | null>(raw, DecisionSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/access-requests/{requestId}/approve",
  });
}

/** POST …/access-requests/{requestID}/decline — close the request; the
 *  requester is told it was declined, never why. */
export async function declineDocumentAccessRequest(
  documentId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<DocumentAccessRequestDecision | null> {
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/access-requests/${enc(requestId)}/decline`,
    { method: "POST", signal },
  );
  return parseWithFallback<DocumentAccessRequestDecision | null>(raw, DecisionSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/access-requests/{requestId}/decline",
  });
}
