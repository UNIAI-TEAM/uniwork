import { z } from "zod";

// Wire shape of the document access report (UNI-1643). Mirrors the Go SDO in
// `server/internal/handler/dto/sdo/document_access_report.go`; every enum is a
// plain string so a value a later server adds (`comment`, `break_glass`, ...)
// still parses and the screen labels it "Other". Kept apart from
// `document.ts`, which is already at the line cap.

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
});

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
});

const AccessReportDocumentSchema = z.object({
  document: AccessReportDocumentInfoSchema,
  rows: z.array(AccessReportRowSchema).optional().default([]),
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
  documents: z.array(AccessReportDocumentSchema),
  summary: AccessReportSummarySchema.optional().default({ candidates: 0, documents: 0, rows: 0, skipped: 0 }),
  next_cursor: NullableString,
});

export type DocumentAccessReport = z.infer<typeof DocumentAccessReportSchema>;
export type AccessReportDocument = z.infer<typeof AccessReportDocumentSchema>;
export type AccessReportRow = z.infer<typeof AccessReportRowSchema>;

/** The filters a report page or export runs with; empty = no filter. */
export interface AccessReportFilters {
  personId?: string;
  levels?: string[];
  visibility?: string;
}

export interface AccessReportQuery extends AccessReportFilters {
  folderId?: string;
  cursor?: string;
  limit?: number;
}

export type AccessReportExportFormat = "csv" | "xlsx";
