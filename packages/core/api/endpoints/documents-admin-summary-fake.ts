// FAKE until DOC-05 (b) lands: swap for the real admin-summary endpoint
// (permission-levels addendum §4 item 7; UNI-1413/1628). Written by W-DOC06
// (UNI-1630) against the SDO the access addendum §2.5 names; delete this file
// and its test when the real one is on the root.
import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** Metadata only — never content. Unknown enums stay strings (lenient). */
const AdminSummarySchema = z.object({
  id: z.string(),
  title: z.string().catch("").default(""),
  kind: z.string().catch("").default(""),
  visibility: z.string(),
  organization_id: z.string().catch("").default(""),
  // The document's own workspace (the server's DocumentAdminSummaryDocumentDTO
  // sends it); empty when absent, and an empty id never matches a merged share.
  workspace_id: z.string().catch("").default(""),
  revision: z.string().catch("").default(""),
  owner_kind: z.string().nullable().optional().catch(undefined),
  archived_at: z.string().nullable().optional().catch(undefined),
  acl_owner: z.object({ user_id: z.string() }).nullable().optional().catch(undefined),
});
export type DocumentAdminSummaryFake = z.infer<typeof AdminSummarySchema>;

// The real SDO's envelope is not on the root yet: read `{summary: …}`,
// `{document: …}` or the bare object.
const AdminSummaryEnvelope = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return obj.summary ?? obj.document ?? raw;
  }
  return raw;
}, AdminSummarySchema);

/** GET /api/v1/documents/{documentID}/admin-summary — canAdminister() only. */
export async function getDocumentAdminSummaryFake(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentAdminSummaryFake | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/admin-summary`, { signal });
  return parseWithFallback<DocumentAdminSummaryFake | null>(raw, AdminSummaryEnvelope, null, {
    endpoint: "GET /api/v1/documents/{id}/admin-summary",
  });
}
