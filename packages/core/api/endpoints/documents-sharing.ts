import { z } from "zod";
import {
  DocumentAccessSchema,
  DocumentAccessLogListSchema,
  DocumentLinkEnvelopeSchema,
  DocumentSettingsSchema,
  DocumentShareBatchSchema,
  DocumentShareEnvelopeSchema,
  type DocumentAccess,
  type DocumentAccessLevel,
  type DocumentAccessLogList,
  type DocumentAccessVia,
  type DocumentLinkEnvelope,
  type DocumentSettings,
  type DocumentShareBatch,
  type DocumentShareEnvelope,
} from "../../types/document";
import { ApiError, request } from "../http";
import { parseWithFallback } from "../schema";

// Document sharing endpoints (C-01 §5.3/§5.4; UNI-679, G1-05b; SH-W1 UNI-1784):
// the access overview, unified batch access update + dry_run preview, share
// candidate search, grant/revoke, public-link create/revoke, the manage-only
// access log and the organization public-links switch.

const enc = encodeURIComponent;

export type DocumentPrincipalType = "user" | "workspace" | "organization";
export type DocumentAccessOnExisting = "update" | "keep";

export interface DocumentAccessUpdateItemInput {
  principal_type: DocumentPrincipalType;
  principal_id: string;
  level: DocumentAccessLevel | null;
  on_existing?: DocumentAccessOnExisting;
}

export interface UpdateDocumentAccessBody {
  items: DocumentAccessUpdateItemInput[];
  dry_run?: boolean;
}

export type DocumentAccessResultStatus =
  | "granted"
  | "updated"
  | "revoked"
  | "kept"
  | "unchanged";

// Response enums stay z.string() (CLAUDE.md API Compatibility): a value a newer
// server adds must not fail the parse of a write that already committed. The
// exported types narrow them; every switch over one carries a default.
export const DocumentAccessResultItemSchema = z.object({
  index: z.number().int().min(0),
  status: z.string(),
});
export type DocumentAccessResultItem = {
  index: number;
  status: DocumentAccessResultStatus;
};

export const DocumentAccessPreviewLevelSchema = z.object({
  level: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),
  via: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),
});
export type DocumentAccessPreviewLevel = {
  level: DocumentAccessLevel | "";
  via: DocumentAccessVia | "";
};

export const DocumentAccessPreviewUserSchema = z.object({
  user_id: z.string().min(1),
  before: DocumentAccessPreviewLevelSchema,
  after: DocumentAccessPreviewLevelSchema,
});
export type DocumentAccessPreviewUser = {
  user_id: string;
  before: DocumentAccessPreviewLevel;
  after: DocumentAccessPreviewLevel;
};

export const DocumentAccessPreviewGroupSchema = z.object({
  principal_type: z.string(),
  principal_id: z.string().min(1),
  member_count: z.number().int().min(0),
  losing_count: z.number().int().min(0),
});
export type DocumentAccessPreviewGroup = {
  principal_type: "workspace" | "organization";
  principal_id: string;
  member_count: number;
  losing_count: number;
};

export type DocumentAccessWarningCode = "wide_scope" | "direct_below_group" | "downgrade";

export const DocumentAccessWarningSchema = z.object({
  code: z.string(),
  index: z.number().int().min(0),
});
/** `code` is narrowed for readers; an unknown code still arrives, so branch with a default. */
export type DocumentAccessWarning = { code: DocumentAccessWarningCode; index: number };

export const DocumentAccessPreviewSchema = z.object({
  users: z.array(DocumentAccessPreviewUserSchema).optional().default([]),
  groups: z.array(DocumentAccessPreviewGroupSchema).optional().default([]),
  warnings: z.array(DocumentAccessWarningSchema).optional().default([]),
});
export type DocumentAccessPreview = {
  users: DocumentAccessPreviewUser[];
  groups: DocumentAccessPreviewGroup[];
  warnings: DocumentAccessWarning[];
};

export const DocumentAccessUpdateSchema = z.object({
  batch_id: z.string().optional().default(""),
  dry_run: z.boolean().optional().default(false),
  results: z.array(DocumentAccessResultItemSchema).min(1),
  preview: DocumentAccessPreviewSchema.optional().default({
    users: [],
    groups: [],
    warnings: [],
  }),
});
export type DocumentAccessUpdate = {
  batch_id: string;
  dry_run: boolean;
  results: DocumentAccessResultItem[];
  preview: DocumentAccessPreview;
};

export type DocumentAccessRejectedCode =
  | "principal_not_in_organization"
  | "level_not_allowed"
  | "duplicate_principal"
  | "break_glass_required";

const DocumentAccessRejectedItemSchema = z.object({
  index: z.number().int().min(0),
  principal_type: z.string(),
  principal_id: z.string().min(1),
  code: z.string(),
});
export type DocumentAccessRejectedItem = {
  index: number;
  principal_type: DocumentPrincipalType;
  principal_id: string;
  code: DocumentAccessRejectedCode;
};

export interface DocumentAccessRejectedError {
  code: "document_access_rejected";
  status: number;
  message: string;
  rejected: DocumentAccessRejectedItem[];
}

export function parseDocumentAccessRejected(err: unknown): DocumentAccessRejectedError | null {
  if (!(err instanceof ApiError) || err.code !== "document_access_rejected") return null;
  const rawList = err.fields?.rejected;
  const rejected: DocumentAccessRejectedItem[] = [];
  if (Array.isArray(rawList)) {
    for (const entry of rawList) {
      const parsed = DocumentAccessRejectedItemSchema.safeParse(entry);
      if (parsed.success) rejected.push(parsed.data as DocumentAccessRejectedItem);
    }
  }
  return {
    code: "document_access_rejected",
    status: err.status,
    message: err.message,
    rejected,
  };
}

const KNOWN_SHARE_LEVELS: readonly string[] = ["view", "comment", "edit", "manage"];

export const DocumentShareCandidateSchema = z.object({
  principal_type: z.string(),
  principal_id: z.string().min(1),
  name: z.string(),
  secondary: z.string().optional().default(""),
  direct_level: z
    .string()
    .nullable()
    .optional()
    .default(null)
    .transform((v): DocumentAccessLevel | null =>
      typeof v === "string" && KNOWN_SHARE_LEVELS.includes(v) ? (v as DocumentAccessLevel) : null,
    ),
  is_home_workspace: z.boolean().optional().default(false),
});
export type DocumentShareCandidate = {
  principal_type: DocumentPrincipalType;
  principal_id: string;
  name: string;
  secondary: string;
  direct_level: DocumentAccessLevel | null;
  is_home_workspace: boolean;
};

const SHARE_PRINCIPAL_TYPES: readonly string[] = ["user", "workspace", "organization"];

export const DocumentShareCandidatesSchema = z.object({
  // A row this client cannot share with (a principal type a newer server adds)
  // is dropped on its own; one unknown value never costs the rest of the page.
  items: z.array(z.unknown()).transform((raw): DocumentShareCandidate[] => {
    const out: DocumentShareCandidate[] = [];
    for (const item of raw) {
      const parsed = DocumentShareCandidateSchema.safeParse(item);
      if (parsed.success && SHARE_PRINCIPAL_TYPES.includes(parsed.data.principal_type)) {
        out.push(parsed.data as DocumentShareCandidate);
      }
    }
    return out;
  }),
  next_cursor: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),
});
export type DocumentShareCandidates = { items: DocumentShareCandidate[]; next_cursor: string };

/** PUT /api/v1/documents/{documentID}/access — batch grant/update/revoke with
 *  optional dry_run impact preview (SH-S2/SH-W1). */
export async function updateDocumentAccess(
  documentId: string,
  body: UpdateDocumentAccessBody,
  signal?: AbortSignal,
): Promise<DocumentAccessUpdate | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/access`, {
    method: "PUT",
    body,
    signal,
  });
  return parseWithFallback<DocumentAccessUpdate | null>(raw, DocumentAccessUpdateSchema, null, {
    endpoint: "PUT /api/v1/documents/{id}/access",
  });
}

export interface ListShareCandidatesOpts {
  q?: string;
  cursor?: string;
  limit?: number;
}

/** GET /api/v1/documents/{documentID}/share-candidates — people, workspaces
 *  and the organization in the document's organization, annotated with each
 *  principal's existing direct grant level (SH-S2/SH-W1). */
export async function listShareCandidates(
  documentId: string,
  opts?: ListShareCandidatesOpts,
  signal?: AbortSignal,
): Promise<DocumentShareCandidates> {
  const p = new URLSearchParams();
  const q = opts?.q?.trim() ?? "";
  if (q) p.set("q", q);
  if (opts?.cursor) p.set("cursor", opts.cursor);
  if (opts?.limit !== undefined) p.set("limit", String(opts.limit));
  const qs = p.toString();
  const raw = await request(
    `/api/v1/documents/${enc(documentId)}/share-candidates${qs ? `?${qs}` : ""}`,
    { signal },
  );
  return parseWithFallback<DocumentShareCandidates>(
    raw,
    DocumentShareCandidatesSchema,
    { items: [], next_cursor: "" },
    { endpoint: "GET /api/v1/documents/{id}/share-candidates" },
  );
}

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

export interface ShareDocumentBatchBody {
  principal_ids: string[];
  level: DocumentAccessLevel;
}

/** POST /api/v1/documents/{documentID}/shares/batch — grant one level to up to
 *  50 people of the document's organization in one transaction (UNI-1641).
 *  All or nothing: a refused person answers 422 principal_not_in_organization
 *  with their ids in `fields.principal_ids`, and nothing is written. */
export async function shareDocumentBatch(
  documentId: string,
  body: ShareDocumentBatchBody,
  signal?: AbortSignal,
): Promise<DocumentShareBatch | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/shares/batch`, {
    method: "POST",
    body,
    signal,
  });
  return parseWithFallback<DocumentShareBatch | null>(raw, DocumentShareBatchSchema, null, {
    endpoint: "POST /api/v1/documents/{id}/shares/batch",
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
