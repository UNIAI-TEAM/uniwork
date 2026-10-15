import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// STAND-IN until worker A's `documents-access-requests.ts` merges (W-DOC07 B,
// UNI-1631). It carries only the manager side of access addendum §4.3 under
// the names and shapes the real file exports, and the one adapter
// (`../../documents/access-requests-adapter.ts`) is the only importer: the
// merge deletes this file and flips that import. Do not add callers.

const enc = encodeURIComponent;

/** The levels a request may ask for or an approval may grant (never manage). */
export type DocumentAccessRequestLevel = "view" | "comment" | "edit";

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

/** GET /api/v1/documents/{documentID}/access-requests: pending, unexpired rows. */
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

interface ApproveDocumentAccessRequestBody {
  /** Defaults to the requested level on the server. */
  level?: DocumentAccessRequestLevel;
}

/** POST …/access-requests/{requestID}/approve; null when the answer proves nothing. */
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

/** POST …/access-requests/{requestID}/decline; null when the answer proves nothing. */
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
