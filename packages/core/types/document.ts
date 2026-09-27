import { z } from "zod";

// Wire contract for the Documents API (C-01 §5 + §14; UNI-679, G1-05a).
// The versioned samples in docs/parity/documents-api are the source of truth
// until the routes exist; every schema below parses those samples.
//
// Revision is a decimal string on the wire — a BIGINT revision would lose
// precision past 2^53 as a JSON number. Version ordinals are numbers: they
// are display ordinals, not identity. Ids are opaque ULID strings.
//
// Enums parse as z.string() and narrow back to the exported unions on the
// type: a server that ships a new enum value degrades through a `default`
// branch, never a failed parse.

export const DOCUMENT_KINDS = ["page", "file"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_VISIBILITIES = ["workspace", "restricted"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const DOCUMENT_ACCESS_LEVELS = ["view", "edit", "manage"] as const;
export type DocumentAccessLevel = (typeof DOCUMENT_ACCESS_LEVELS)[number];

export const DOCUMENT_ACCESS_VIA = ["member", "share", "link", "ai_context"] as const;
export type DocumentAccessVia = (typeof DOCUMENT_ACCESS_VIA)[number];

export const DOCUMENT_VERSION_REASONS = ["manual", "auto", "restore", "upload", "agent"] as const;
export type DocumentVersionReason = (typeof DOCUMENT_VERSION_REASONS)[number];

export const DOCUMENT_OWNER_KINDS = ["work_product"] as const;
export type DocumentOwnerKind = (typeof DOCUMENT_OWNER_KINDS)[number];

export const DOCUMENT_DISPOSITIONS = ["attachment", "inline"] as const;
export type DocumentDisposition = (typeof DOCUMENT_DISPOSITIONS)[number];

/**
 * The error_class vocabulary of C-01 §14.5 the client branches on. Server
 * codes stay open — new codes map onto these classes — so the union is what
 * save-state and the UI reason about, and an unknown class degrades to
 * `unknown` via classifyDocumentError, never a throw.
 */
export const DOCUMENT_ERROR_CLASSES = [
  "conflict",
  "gone",
  "quota",
  "permission",
  "missing",
  "incompatible",
  "session",
] as const;
export type DocumentErrorClass = (typeof DOCUMENT_ERROR_CLASSES)[number];

/** Page JSON is validated by packages/core/documents/schema.ts on the edit
 *  path; on the wire it stays opaque so a forward-compatible node never
 *  breaks a metadata read. */
export const DocumentContentSchema = z.unknown();
export type DocumentContent = z.infer<typeof DocumentContentSchema>;

export const DocumentBreadcrumbSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
});
export type DocumentBreadcrumb = z.infer<typeof DocumentBreadcrumbSchema>;

export const DocumentFileSchema = z.object({
  file_id: z.string(),
  version_id: z.string(),
  version: z.number(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  checksum_sha256: z.string(),
});
export type DocumentFile = z.infer<typeof DocumentFileSchema>;

export const DocumentSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string(),
  parent_id: z.string().nullable().optional(),
  kind: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
  visibility: z.string().optional().default("workspace"),
  content: DocumentContentSchema.optional(),
  content_text: z.string().optional().default(""),
  revision: z.string(),
  current_version: z.number().optional().default(0),
  position: z.number().optional().default(0),
  my_level: z.string().optional(),
  via: z.string().optional(),
  file: DocumentFileSchema.nullable().optional(),
  breadcrumbs: z.array(DocumentBreadcrumbSchema).optional().default([]),
  owner_kind: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  created_by: z.string().optional().default(""),
  created_by_kind: z.string().optional().default("human"),
  updated_by: z.string().optional().default(""),
  updated_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
});
export type Document = Omit<
  z.infer<typeof DocumentSchema>,
  "kind" | "visibility" | "my_level" | "via" | "owner_kind"
> & {
  kind: DocumentKind;
  visibility: DocumentVisibility;
  my_level?: DocumentAccessLevel;
  via?: DocumentAccessVia;
  owner_kind?: DocumentOwnerKind | null;
};

export const DocumentVersionSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  version: z.number(),
  kind: z.string().optional().default("page"),
  reason: z.string().optional().default("manual"),
  label: z.string().nullable().optional(),
  content: DocumentContentSchema.optional(),
  file_id: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  size_bytes: z.number().optional().default(0),
  checksum_sha256: z.string().nullable().optional(),
  restored_from: z.number().nullable().optional(),
  engine_name: z.string().nullable().optional(),
  engine_version: z.string().nullable().optional(),
  contract_version: z.string().nullable().optional(),
  protocol_version: z.string().nullable().optional(),
  download_url: z.string().nullable().optional(),
  created_by: z.string().optional().default(""),
  created_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
});
export type DocumentVersion = Omit<z.infer<typeof DocumentVersionSchema>, "kind" | "reason"> & {
  kind: DocumentKind;
  reason: DocumentVersionReason;
};

export const DocumentUploadSchema = z.object({
  upload_id: z.string(),
  checksum_sha256: z.string(),
  size_bytes: z.number(),
  claim_expires_at: z.string(),
});
export type DocumentUpload = z.infer<typeof DocumentUploadSchema>;

export const DocumentAssetSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  url: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  created_at: z.string().optional().default(""),
});
export type DocumentAsset = z.infer<typeof DocumentAssetSchema>;

export const DocumentDownloadSchema = z.object({
  document_id: z.string(),
  file: DocumentFileSchema,
  disposition: z.string().optional().default("attachment"),
});
export type DocumentDownload = Omit<z.infer<typeof DocumentDownloadSchema>, "disposition"> & {
  disposition: DocumentDisposition;
};

// ---- Response envelopes --------------------------------------------------
// Every documents endpoint wraps its payload the same way; the envelope
// schemas are what endpoints/documents*.ts feed parseWithFallback.

export const DocumentEnvelopeSchema = z.object({ document: DocumentSchema });
export const DocumentVersionEnvelopeSchema = z.object({ version: DocumentVersionSchema });
export const DocumentVersionListEnvelopeSchema = z.object({
  versions: z.array(DocumentVersionSchema),
  next_cursor: z.string().nullable().optional(),
});
export const DocumentVersionResultEnvelopeSchema = z.object({
  document: DocumentSchema,
  version: DocumentVersionSchema,
});
export type DocumentVersionResult = {
  document: Document;
  version: DocumentVersion;
};

/** The C-01 §14.5 error envelope: `error.error_class` is what the client
 *  branches on; `fields` carries machine-readable detail (current_revision,
 *  quota meters, required_contract_version). */
export const DocumentErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    error_class: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type DocumentErrorBody = z.infer<typeof DocumentErrorEnvelopeSchema>["error"];

/**
 * A mutation response that cannot prove the write landed. Endpoint functions
 * return null on a failed parse; hooks and the save machine turn that null
 * into this error so the caller never reads "saved" off a fallback: the draft
 * stays dirty and the idempotency key stays live for the retry.
 */
export class DocumentNotVerifiableError extends Error {
  constructor(message: string = "result not verifiable") {
    super(message);
    this.name = "DocumentNotVerifiableError";
  }
}

export function isDocumentNotVerifiable(err: unknown): err is DocumentNotVerifiableError {
  return err instanceof DocumentNotVerifiableError;
}
