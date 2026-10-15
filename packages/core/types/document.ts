import { z } from "zod";
import { ActorSchema } from "./actor";

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

export const DOCUMENT_KINDS = ["page", "file", "folder"] as const;
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

// ---- G1-05b (UNI-679, C-01 §5.1/§5.3/§5.4) --------------------------------
// Collections, tree, sharing, public links, access log and the organization
// settings. Same leniency rules as above: server enums parse as z.string(),
// the exported types narrow, and every list that cannot degrade safely has
// its caller throw instead of rendering an empty page.

const DocumentPathItemSchema = z.object({ id: z.string(), title: z.string() });

export const DocumentSummarySchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string(),
  parent_id: z.string().nullable().optional(),
  kind: z.string(),
  title: z.string(),
  icon: z.string().nullable().optional(),
  visibility: z.string().optional().default("workspace"),
  revision: z.string(),
  current_version: z.number().optional().default(0),
  position: z.number().optional().default(0),
  // Size of the current file version (0 for pages and folders) and where the
  // document came from. Newer fields: a drifted value reads as absent rather
  // than failing the whole page.
  size_bytes: z.number().nullable().optional().catch(undefined),
  origin: z.string().nullable().optional().catch(undefined),
  snippet: z.string().nullable().optional(),
  // The viewer's level on this row (every list route carries it); a drifted
  // value reads as absent, which the views treat as view-only.
  my_level: z.string().nullable().optional().catch(undefined),
  via: z.string().nullable().optional(),
  owner_kind: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  created_by: z.string().optional().default(""),
  created_by_kind: z.string().optional().default("human"),
  updated_by: z.string().optional().default(""),
  updated_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  // Folders contract v1.0 (FD-05/FD-06): the ancestors a search row sits
  // under, root first, cut at the first one the caller cannot read. Optional
  // on the wire; missing or not an array reads as [] (a row at the root), and
  // a malformed ancestor cuts the path there, as the server does.
  path: z
    .unknown()
    .optional()
    .transform((raw) => {
      if (!Array.isArray(raw)) return [];
      const prefix: z.infer<typeof DocumentPathItemSchema>[] = [];
      for (const item of raw) {
        const parsed = DocumentPathItemSchema.safeParse(item);
        if (!parsed.success) break;
        prefix.push(parsed.data);
      }
      return prefix;
    }),
});
/** Uploaded bytes, or something UniWork made (page, folder, blank file, converted copy). */
export type DocumentOrigin = "upload" | "created";

// The parser always fills `path` ([] when absent); the type keeps it optional
// so a row a view builds by hand (a favorite, a fixture) need not carry one.
type DocumentSummaryWire = Omit<z.infer<typeof DocumentSummarySchema>, "path"> & {
  path?: z.infer<typeof DocumentPathItemSchema>[];
};

export type DocumentSummary = Omit<
  DocumentSummaryWire,
  "kind" | "visibility" | "my_level" | "via" | "owner_kind" | "origin"
> & {
  kind: DocumentKind;
  origin?: DocumentOrigin | null;
  visibility: DocumentVisibility;
  my_level?: DocumentAccessLevel | null;
  via?: DocumentAccessVia | null;
  owner_kind?: DocumentOwnerKind | null;
};

export const DocumentListSchema = z.object({
  documents: z.array(DocumentSummarySchema),
  next_cursor: z.string().nullable().optional(),
});
export type DocumentList = Omit<z.infer<typeof DocumentListSchema>, "documents"> & {
  documents: DocumentSummaryWire[];
};

/** Archive/restore answer: the moved document, its batch id and the ids that
 *  actually changed. Restore only recovers nodes of its own batch. */
export const DocumentArchiveSchema = z.object({
  document: DocumentSchema,
  batch_id: z.string().nullable().optional(),
  affected: z.array(z.string()).optional().default([]),
});
export type DocumentArchive = Omit<z.infer<typeof DocumentArchiveSchema>, "document"> & {
  document: Document;
};

/**
 * What archiving a subtree would move (folders contract v1.0, addendum §3.4).
 * Under the cap: `folders`/`documents` exclude the root, `total` includes it.
 * Past the cap the server does not count: only `too_large` and `max_nodes`.
 * A count that is missing, negative or fractional fails the parse, so a
 * drifted answer can never read as "0 items" in the delete dialog.
 */
export type DocumentArchiveImpact =
  | { too_large: false; folders: number; documents: number; total: number; max_nodes: number }
  | { too_large: true; max_nodes: number };

const count = z.number().int().nonnegative();

export const DocumentArchiveImpactSchema = z
  .object({
    folders: count.optional(),
    documents: count.optional(),
    total: count.optional(),
    max_nodes: count,
    too_large: z.boolean().optional().default(false),
  })
  .transform((raw, ctx): DocumentArchiveImpact => {
    if (raw.too_large) return { too_large: true, max_nodes: raw.max_nodes };
    if (raw.folders === undefined || raw.documents === undefined || raw.total === undefined) {
      ctx.addIssue({ code: "custom", message: "archive impact without counts" });
      return z.NEVER;
    }
    return {
      too_large: false,
      folders: raw.folders,
      documents: raw.documents,
      total: raw.total,
      max_nodes: raw.max_nodes,
    };
  });

/** One sidebar node; `children` recurse to TREE_MAX_LEVEL levels
 *  (packages/core/documents/folder-limits.ts). */
export interface DocumentTreeNode {
  id: string;
  parent_id?: string | null;
  title: string;
  icon?: string | null;
  kind: DocumentKind;
  position: number;
  children: DocumentTreeNode[];
}

export const DocumentTreeNodeSchema: z.ZodType<DocumentTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    parent_id: z.string().nullable().optional(),
    title: z.string(),
    icon: z.string().nullable().optional(),
    kind: z.string(),
    position: z.number().optional().default(0),
    children: z.array(DocumentTreeNodeSchema).optional().default([]),
  }),
) as unknown as z.ZodType<DocumentTreeNode>;

export const DocumentTreeSchema = z.object({ documents: z.array(DocumentTreeNodeSchema) });
export type DocumentTree = z.infer<typeof DocumentTreeSchema>;

export const DocumentPersonAccessSchema = z.object({
  user_id: z.string(),
  level: z.string(),
  via: z.string().optional().default(""),
});
export type DocumentPersonAccess = Omit<z.infer<typeof DocumentPersonAccessSchema>, "level" | "via"> & {
  level: DocumentAccessLevel;
  via: DocumentAccessVia;
};

export const DocumentShareSchema = z.object({
  id: z.string(),
  principal_type: z.string(),
  principal_id: z.string(),
  level: z.string(),
  active: z.boolean().optional().default(true),
  effective_level: z.string().nullable().optional(),
  effective_via: z.string().nullable().optional(),
  granted_by: z.string().optional().default(""),
  granted_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
});
export type DocumentShare = Omit<z.infer<typeof DocumentShareSchema>, "level" | "effective_level" | "effective_via"> & {
  level: DocumentAccessLevel;
  effective_level?: DocumentAccessLevel | null;
  effective_via?: DocumentAccessVia | null;
};

export const DocumentLinkSchema = z.object({
  id: z.string(),
  expires_at: z.string().nullable().optional(),
  view_count: z.number().optional().default(0),
  created_by: z.string().optional().default(""),
  created_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
});
export type DocumentLink = z.infer<typeof DocumentLinkSchema>;

/** The access overview: my level always; grants/links/acl-owner only at manage. */
export const DocumentAccessSchema = z.object({
  my_level: z.string(),
  via: z.string().optional().default(""),
  acl_owner: DocumentPersonAccessSchema.nullable().optional(),
  shares: z.array(DocumentShareSchema).optional(),
  links: z.array(DocumentLinkSchema).optional(),
});
export type DocumentAccess = Omit<z.infer<typeof DocumentAccessSchema>, "my_level" | "via"> & {
  my_level: DocumentAccessLevel;
  via: DocumentAccessVia;
};

export const DocumentShareEnvelopeSchema = z.object({ share: DocumentShareSchema });
export type DocumentShareEnvelope = { share: DocumentShare };

/** A batch grant (UNI-1641): one live row per distinct principal, in request order. */
export const DocumentShareBatchSchema = z.object({ shares: z.array(DocumentShareSchema) });
export type DocumentShareBatch = { shares: DocumentShare[] };

/** A freshly minted link: the raw token rides this answer exactly once. */
export const DocumentLinkEnvelopeSchema = z.object({
  link: DocumentLinkSchema,
  token: z.string(),
  url: z.string(),
});
export type DocumentLinkEnvelope = { link: DocumentLink; token: string; url: string };

export const DocumentAccessLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  via: z.string().optional().default(""),
  version: z.number().nullable().optional(),
  actor_kind: z.string(),
  actor_id: z.string().nullable().optional(),
  actor: ActorSchema.nullable().optional(),
  share_link_id: z.string().nullable().optional(),
  occurred_at: z.string().optional().default(""),
});
export type DocumentAccessLog = Omit<z.infer<typeof DocumentAccessLogSchema>, "action" | "via"> & {
  action: string;
  via: DocumentAccessVia;
};

export const DocumentAccessLogListSchema = z.object({
  logs: z.array(DocumentAccessLogSchema),
  next_cursor: z.string().nullable().optional(),
});
export type DocumentAccessLogList = z.infer<typeof DocumentAccessLogListSchema>;

export const DocumentSettingsSchema = z.object({
  organization_id: z.string(),
  public_links_enabled: z.boolean(),
  updated_by: z.string().nullable().optional(),
  updated_by_kind: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type DocumentSettings = z.infer<typeof DocumentSettingsSchema>;

/** The anonymous view: title + kind, sanitized page content or a download path. */
export const PublicDocumentSchema = z.object({
  title: z.string(),
  kind: z.string(),
  content: DocumentContentSchema.optional(),
  download_url: z.string().nullable().optional(),
});
export type PublicDocument = Omit<z.infer<typeof PublicDocumentSchema>, "kind"> & { kind: DocumentKind };

export const PublicDocumentEnvelopeSchema = z.object({ document: PublicDocumentSchema });
export type PublicDocumentEnvelope = { document: PublicDocument };

// Comments live in their own module (G8-03); this file stays their public path.
export * from "./document-comments";

// ---- Favorites (G1-07; UNI-681 lane 07b) ------------------------------------

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

export const DocumentFavoriteEnvelopeSchema = z.object({ favorite: DocumentFavoriteSchema });
export const DocumentFavoriteListEnvelopeSchema = z.object({
  favorites: z.array(DocumentFavoriteSchema),
});
