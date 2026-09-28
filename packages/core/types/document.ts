import { z } from "zod";
import { ActorSchema } from "./actor";
import { CommentReactionSchema } from "./task-collaboration";

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
 * The error_class vocabulary of C-01 §14.5 the client branches on — the same
 * list as API_ERROR_CLASSES in api/http.ts (kept here so types/ stays free of
 * api/ imports; the two tables must not drift). Server codes stay open — new
 * codes map onto these classes — so the union is what save-state and the UI
 * reason about, and an unknown class degrades to `unknown` via
 * classifyDocumentError, never a throw.
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

// ---- Comments + favorites (G1-07; UNI-681 lane 07b) ----------------------
// Document comments reuse the comment_reactions shape from types/
// task-collaboration.ts (keyed by comment_id) and mirror the task comment
// DTO: enum-ish fields stay lenient strings so a server that ships a new
// value degrades instead of failing the parse, and only `type` narrows - the
// document routes accept "comment" alone, so a public client can never mint
// a system row.

export const DOCUMENT_COMMENT_TYPES = ["comment"] as const;
export type DocumentCommentType = (typeof DOCUMENT_COMMENT_TYPES)[number];

export const DocumentCommentSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  author_id: z.string().optional().default(""),
  author_kind: z.string().optional().default("human"),
  author: ActorSchema.optional(),
  body: z.string(),
  parent_id: z.string().nullish(),
  type: z.string().optional().default("comment"),
  revision: z.number().optional().default(0),
  resolved_at: z.string().nullish(),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  display_name: z.string().optional().default(""),
  avatar_url: z.string().optional().default(""),
  // A malformed reaction row costs the reactions, never the comment: the
  // thread parses with a `{ comments: [] }` fallback, so one bad nested row
  // must not throw the whole conversation away.
  reactions: z
    .array(CommentReactionSchema)
    .catch([])
    .nullish()
    .transform((v) => v ?? []),
});
export type DocumentComment = Omit<z.infer<typeof DocumentCommentSchema>, "type"> & {
  type: DocumentCommentType;
};

/** One favorited document in the caller's list: what a favorites panel needs
 *  to open the document, not the full payload (GET /documents/{id} has it). */
export const DocumentFavoriteSchema = z.object({
  document_id: z.string(),
  favorite_id: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  title: z.string().optional().default(""),
  kind: z.string().optional().default("page"),
  icon: z.string().nullish(),
  parent_id: z.string().nullish(),
  favorited_at: z.string().optional().default(""),
});
export type DocumentFavorite = Omit<z.infer<typeof DocumentFavoriteSchema>, "kind"> & {
  kind: DocumentKind;
};

export const DocumentCommentEnvelopeSchema = z.object({ comment: DocumentCommentSchema });
export const DocumentCommentListEnvelopeSchema = z.object({
  comments: z.array(DocumentCommentSchema),
});
export const DocumentFavoriteEnvelopeSchema = z.object({ favorite: DocumentFavoriteSchema });
export const DocumentFavoriteListEnvelopeSchema = z.object({
  favorites: z.array(DocumentFavoriteSchema),
});
