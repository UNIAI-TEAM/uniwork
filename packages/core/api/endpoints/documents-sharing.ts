import {
  DocumentAccessSchema,
  DocumentAccessLogListSchema,
  DocumentLinkEnvelopeSchema,
  DocumentSettingsSchema,
  DocumentShareEnvelopeSchema,
  type DocumentAccess,
  type DocumentAccessLevel,
  type DocumentAccessLogList,
  type DocumentLinkEnvelope,
  type DocumentSettings,
  type DocumentShareEnvelope,
} from "../../types/document";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Document sharing endpoints (C-01 §5.3/§5.4; UNI-679, G1-05b): the access
// overview, grant/revoke, public-link create/revoke, the manage-only access
// log and the organization public-links switch. Mutations resolve null when
// the answer cannot prove the write; the hooks turn that into "result not
// verifiable" and keep the caller's state.

const enc = encodeURIComponent;

/** GET /api/v1/documents/{documentID}/shares — my level always; grants,
 *  acl owner and live links only for a caller at manage level. */
export async function getDocumentShares(
  documentId: string,
  signal?: AbortSignal,
): Promise<DocumentAccess | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/shares`, { signal });
  return parseWithFallback<DocumentAccess | null>(raw, DocumentAccessSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/shares",
  });
}

export interface ShareDocumentBody {
  principal_type: "user" | "workspace" | "organization";
  principal_id: string;
  level: DocumentAccessLevel;
}

/** POST /api/v1/documents/{documentID}/shares — grant a level to a principal
 *  inside the document's organization. An existing live grant for the same
 *  principal is replaced in one transaction. */
export async function shareDocument(
  documentId: string,
  body: ShareDocumentBody,
  signal?: AbortSignal,
): Promise<DocumentShareEnvelope | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/shares`, {
    method: "POST",
    body,
    signal,
  });
  return parseWithFallback<DocumentShareEnvelope | null>(raw, DocumentShareEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/shares",
  });
}

/** DELETE /api/v1/documents/{documentID}/shares/{shareID} — revoke one live
 *  grant. The transport throws on failure; there is no body to verify. */
export async function revokeDocumentShare(
  documentId: string,
  shareId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(`/api/v1/documents/${enc(documentId)}/shares/${enc(shareId)}`, {
    method: "DELETE",
    signal,
  });
}

/** POST /api/v1/documents/{documentID}/links — an anonymous view link.
 *  Requires the `documents.public_links` entitlement and the organization
 *  switch; the raw token rides this answer exactly once. */
export async function createDocumentLink(
  documentId: string,
  expiresInDays?: number,
  signal?: AbortSignal,
): Promise<DocumentLinkEnvelope | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/links`, {
    method: "POST",
    body: expiresInDays === undefined ? {} : { expires_in_days: expiresInDays },
    signal,
  });
  return parseWithFallback<DocumentLinkEnvelope | null>(raw, DocumentLinkEnvelopeSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/links",
  });
}

/** DELETE /api/v1/documents/{documentID}/links/{linkID} — revoke a link; the
 *  next public read with its token is not found. */
export async function revokeDocumentLink(
  documentId: string,
  linkId: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(`/api/v1/documents/${enc(documentId)}/links/${enc(linkId)}`, {
    method: "DELETE",
    signal,
  });
}

export interface ListDocumentAccessLogsOpts {
  cursor?: string;
  limit?: number;
  action?: "view" | "download" | "export" | "link_view";
}

/** GET /api/v1/documents/{documentID}/access-logs — manage-only, newest
 *  first. Throws when the page cannot be trusted rather than showing an
 *  empty log over a document that has entries. */
export async function listDocumentAccessLogs(
  documentId: string,
  opts?: ListDocumentAccessLogsOpts,
  signal?: AbortSignal,
): Promise<DocumentAccessLogList> {
  const p = new URLSearchParams();
  if (opts?.cursor) p.set("cursor", opts.cursor);
  if (opts?.limit !== undefined) p.set("limit", String(opts.limit));
  if (opts?.action) p.set("action", opts.action);
  const q = p.toString();
  const raw = await request(`/api/v1/documents/${enc(documentId)}/access-logs${q ? `?${q}` : ""}`, {
    signal,
  });
  const parsed = parseWithFallback<DocumentAccessLogList | null>(raw, DocumentAccessLogListSchema, null, {
    endpoint: "GET /api/v1/documents/{id}/access-logs",
  });
  if (!parsed) throw new Error("document_access_log_invalid");
  return parsed;
}

/** PUT /api/v1/orgs/{orgID}/documents/settings — the organization's
 *  public-links switch. Owners/admins only; null cannot prove the write. */
export async function setDocumentPublicLinks(
  orgId: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<DocumentSettings | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/documents/settings`, {
    method: "PUT",
    body: { public_links_enabled: enabled },
    signal,
  });
  return parseWithFallback<DocumentSettings | null>(raw, DocumentSettingsSchema, null, {
    endpoint: "PUT /api/v1/orgs/{orgID}/documents/settings",
  });
}

/** GET /api/v1/orgs/{orgID}/documents/settings — the current switch, readable
 *  by the same owners/admins who may change it (G1-08). An untouched
 *  organization answers the default (off). Null cannot prove the read, so the
 *  caller shows an unknown state rather than a fabricated value. */
export async function getDocumentSettings(
  orgId: string,
  signal?: AbortSignal,
): Promise<DocumentSettings | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/documents/settings`, { signal });
  return parseWithFallback<DocumentSettings | null>(raw, DocumentSettingsSchema, null, {
    endpoint: "GET /api/v1/orgs/{orgID}/documents/settings",
  });
}
