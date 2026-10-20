import { z } from "zod";

// Wire shape of the document access report (UNI-1643). Mirrors the Go SDO in
// `server/internal/handler/dto/sdo/document_access_report.go`; every enum is a
// plain string so a value a later server adds (`comment`, `break_glass`, ...)
// still parses and the screen labels it "Other". Kept apart from
// `document.ts`, which is already at the line cap.

/** An array that drops the entries that do not parse instead of failing the page. */
function lenientArray<S extends z.ZodType>(item: S) {
  return z
    .array(z.unknown())
    .transform((entries) => entries.flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data as z.output<S>] : [];
    }));
}

const NullableString = z.string().nullable().optional().transform((v) => v ?? null);

const AccessReportScopeSchema = z.object({
  kind: z.string(),
  workspace_id: z.string().optional().default(""),
  folder_id: NullableString,
  folder_title: NullableString,
});

const AccessReportFilterSchema = z.object({
  person_id: NullableString,
  level: z.array(z.string()).optional().default([]),
  visibility: NullableString,
});

const AccessReportOwnerSchema = z.object({
  id: z.string(),
  name: NullableString,
});

/** A grant a report row can end through the existing revoke routes (UNI-2039 S1). */
export type RevokeTargetKind = "share" | "link" | "break_glass";
export interface AccessReportRevokeTarget {
  kind: RevokeTargetKind;
  id: string;
}

const REVOKE_KINDS: readonly string[] = ["share", "link", "break_glass"];

/** A hint to show the Revoke button; anything unreadable is null, which hides it. */
const RevokeTargetSchema = z
  .unknown()
  .transform((v): AccessReportRevokeTarget | null => {
    if (typeof v !== "object" || v === null) return null;
    const { kind, id } = v as Record<string, unknown>;
    if (typeof kind !== "string" || !REVOKE_KINDS.includes(kind)) return null;
    if (typeof id !== "string" || id === "") return null;
    return { kind: kind as RevokeTargetKind, id };
  })
  .optional()
  .transform((v) => v ?? null);

/** The warning flags the server derives for a document (UNI-2039 S1). */
export type AccessReportFlag = "public_link" | "other_workspace" | "organization" | "direct_manage";
const FLAGS: readonly string[] = ["public_link", "other_workspace", "organization", "direct_manage"];

/**
 * Absent = null, so the screen derives them (`deriveReportFacts`); present but
 * not an array = no flags; an unknown flag is dropped.
 */
const FlagsSchema = z
  .unknown()
  .optional()
  .transform((v): AccessReportFlag[] | null => {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) return [];
    return v.filter((f): f is AccessReportFlag => typeof f === "string" && FLAGS.includes(f));
  });

/** General access of a document: private, the workspace, or the whole organization. */
export interface AccessReportGeneralScope {
  kind: string;
  level: string | null;
}

/** Unreadable = null; `deriveReportFacts` then reads it off `visibility` and the rows. */
const GeneralScopeSchema = z
  .unknown()
  .optional()
  .transform((v): AccessReportGeneralScope | null => {
    if (typeof v !== "object" || v === null) return null;
    const { kind, level } = v as Record<string, unknown>;
    if (typeof kind !== "string" || kind === "") return null;
    return { kind, level: typeof level === "string" ? level : null };
  });

const AccessReportDocumentInfoSchema = z.object({
  id: z.string(),
  title: z.string().optional().default(""),
  kind: z.string().optional().default(""),
  visibility: z.string().optional().default(""),
  path: z
    .array(z.object({ id: z.string(), title: z.string().optional().default("") }))
    .optional()
    .default([]),
  acl_owner: AccessReportOwnerSchema.nullable().optional().transform((v) => v ?? null),
  /** Only with a person filter: that person's level on the document. */
  person_level: z.string().nullable().optional(),
  live_link_count: z.number().optional().default(0),
  updated_at: z.string().optional().default(""),
  general_scope: GeneralScopeSchema,
  flags: FlagsSchema,
  /** Latest access change; the content's `updated_at` when the server omits it. */
  access_changed_at: z.string().nullable().optional(),
  /** The viewer's own level and admin scope, to open the share dialog. */
  my_level: NullableString,
  admin_scope: z.boolean().optional().default(false),
}).transform((d) => ({ ...d, access_changed_at: d.access_changed_at || d.updated_at }));

const AccessReportRowSchema = z.object({
  source: z.string(),
  via: z.string().optional().default(""),
  principal_type: z.string(),
  principal_id: z.string(),
  principal_name: NullableString,
  level: z.string(),
  effective_level: z.string().optional().default("none"),
  active: z.boolean().optional().default(true),
  granted_by: NullableString,
  granted_by_name: NullableString,
  granted_by_kind: NullableString,
  granted_at: NullableString,
  share_id: NullableString,
  /** `direct` | `chat` on a share row; absent until the server sends it (read as direct). */
  origin: NullableString,
  /** A public link's expiry; null = never. */
  expires_at: NullableString,
  revoke_target: RevokeTargetSchema,
});

const AccessReportDocumentSchema = z.object({
  document: AccessReportDocumentInfoSchema,
  rows: lenientArray(AccessReportRowSchema).optional().default([]),
});

const AccessReportSummarySchema = z.object({
  candidates: z.number().optional().default(0),
  documents: z.number().optional().default(0),
  rows: z.number().optional().default(0),
  skipped: z.number().optional().default(0),
});

export const DocumentAccessReportSchema = z.object({
  scope: AccessReportScopeSchema,
  filter: AccessReportFilterSchema.optional().default({ person_id: null, level: [], visibility: null }),
  generated_at: z.string().optional().default(""),
  documents: lenientArray(AccessReportDocumentSchema),
  summary: AccessReportSummarySchema.optional().default({ candidates: 0, documents: 0, rows: 0, skipped: 0 }),
  next_cursor: NullableString,
});

export type DocumentAccessReport = z.infer<typeof DocumentAccessReportSchema>;
export type AccessReportDocument = z.infer<typeof AccessReportDocumentSchema>;
export type AccessReportRow = z.infer<typeof AccessReportRowSchema>;

/** The filters a report page, export or summary runs with; empty = no filter. */
export interface AccessReportFilters {
  personId?: string;
  levels?: string[];
  visibility?: string;
  /** Free text over the document title and the principal name (max 100). */
  q?: string;
  /** `<user|workspace|organization|link>:<id>`; a bare `link` means "anyone with the link". */
  principal?: string;
  scope?: string;
  /** `owner|workspace|direct|chat|link|break_glass`. */
  sources?: string[];
  /** `public_link|outside_workspace|direct_manage`. */
  flag?: string;
  nonDefault?: boolean;
}

/** Server-side order of the document list (only pages sort; exports do not). */
export interface AccessReportSort {
  sort?: "changed" | "title";
  order?: "asc" | "desc";
}

export interface AccessReportQuery extends AccessReportFilters, AccessReportSort {
  folderId?: string;
  cursor?: string;
  limit?: number;
}

const Count = z.number().optional().default(0);

const AccessReportTilesSchema = z.object({
  public_link: Count,
  outside_workspace: Count,
  direct_manage: Count,
  documents: Count,
  restricted: Count,
  workspace: Count,
  organization: Count,
});

/** Whole-scope totals (S6). Null when the answer is not a summary: the tiles show an error, never 0. */
export const AccessReportSummaryTotalsSchema = z.object({
  generated_at: z.string().optional().default(""),
  tiles: AccessReportTilesSchema,
  matching_documents: Count,
  skipped: Count,
  truncated: z.boolean().optional().default(false),
});
export type AccessReportSummaryTotals = z.infer<typeof AccessReportSummaryTotalsSchema>;

const AccessReportPrincipalSchema = z.object({
  principal_type: z.string(),
  principal_id: NullableString,
  principal_name: NullableString,
  kind: z.string().optional().default(""),
  member_count: z.number().nullable().optional().transform((v) => v ?? null),
  document_count: Count,
  levels: z
    .object({ view: Count, comment: Count, edit: Count, manage: Count })
    .optional()
    .default({ view: 0, comment: 0, edit: 0, manage: 0 }),
  main_source: z.string().optional().default(""),
});

/** One row of the by-person table (S7). Null when the answer is not a principal list. */
export const AccessReportPrincipalsSchema = z.object({
  generated_at: z.string().optional().default(""),
  principals: lenientArray(AccessReportPrincipalSchema),
  truncated: z.boolean().optional().default(false),
});
export type AccessReportPrincipals = z.infer<typeof AccessReportPrincipalsSchema>;
export type AccessReportPrincipal = AccessReportPrincipals["principals"][number];

export interface AccessReportPrincipalsQuery {
  folderId?: string;
  q?: string;
  /** `member|home_workspace|other_workspace|organization|link` */
  kind?: string;
  levels?: string[];
  sort?: "count" | "name";
  order?: "asc" | "desc";
}

export type AccessReportExportFormat = "csv" | "xlsx";
