import { z } from "zod";
import type {
  DocumentAccessLevel,
  DocumentAccessVia,
  DocumentKind,
  DocumentOwnerKind,
  DocumentVisibility,
} from "./document";
import {
  DocumentCommentMentionSchema,
  DocumentCommentSchema as BaseDocumentCommentSchema,
  type DocumentComment as BaseDocumentComment,
} from "./document-comments";

// DOC-05 (UNI-1628) + G8-18 (UNI-1413) wire schemas: break-glass grants,
// admin-summary metadata, comment mentions_without_access, mention candidate
// can_view, and typed access error shapes (contract-g8-18-doc-05.md v0.1).

export const DocumentPersonAccessSchema = z.object({
  user_id: z.string(),
  level: z.string(),
  via: z.string().optional().default(""),
});
export type DocumentPersonAccess = Omit<
  z.infer<typeof DocumentPersonAccessSchema>,
  "level" | "via"
> & {
  level: DocumentAccessLevel;
  via: DocumentAccessVia;
};

/** One live emergency-access grant (DOC-05, contract-g8-18-doc-05.md §3). */
export const DocumentBreakGlassGrantSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  actor_id: z.string().min(1),
  actor_name: z
    .string()
    .nullish()
    .catch("")
    .transform((v) => v ?? ""),
  level: z.string().optional().default("view"),
  reason: z.string().optional().default(""),
  granted_at: z.string().min(1),
  expires_at: z.string().min(1),
});
export type DocumentBreakGlassGrant = Omit<
  z.infer<typeof DocumentBreakGlassGrantSchema>,
  "level"
> & {
  level: DocumentAccessLevel;
};

export const DocumentBreakGlassGrantEnvelopeSchema = z.object({
  grant: DocumentBreakGlassGrantSchema,
});
export type DocumentBreakGlassGrantEnvelope = {
  grant: DocumentBreakGlassGrant;
};

/** Metadata-only document header returned by GET /documents/{id}/admin-summary (DOC-05). */
export const DocumentAdminSummaryDocumentSchema = z.object({
  id: z.string().min(1),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string().min(1),
  parent_id: z.string().nullable().optional(),
  kind: z.string().min(1),
  title: z.string(),
  icon: z.string().nullable().optional(),
  visibility: z.string().optional().default("restricted"),
  size_bytes: z
    .number()
    .nullable()
    .optional()
    .catch(0)
    .transform((v) => v ?? 0),
  archived_at: z.string().nullable().optional(),
  // Waits S-DOC06: card (a) does not send these yet. Absent keeps the
  // fallback (not owned, no revision); a malformed value reads as absent.
  owner_kind: z.string().nullable().optional().catch(undefined),
  revision: z.string().nullable().optional().catch(undefined),
  created_by: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
});
export type DocumentAdminSummaryDocument = Omit<
  z.infer<typeof DocumentAdminSummaryDocumentSchema>,
  "kind" | "visibility" | "owner_kind"
> & {
  kind: DocumentKind;
  visibility: DocumentVisibility;
  owner_kind?: DocumentOwnerKind | null;
};

/** GET /api/v1/documents/{id}/admin-summary answer (DOC-05, contract-g8-18-doc-05.md §3). */
export const DocumentAdminSummarySchema = z.object({
  document: DocumentAdminSummaryDocumentSchema,
  acl_owner: DocumentPersonAccessSchema.nullable()
    .optional()
    .catch(null)
    .transform((v) => v ?? null),
  my_level: z.string().optional().default(""),
  via: z.string().optional().default(""),
  admin_scope: z.boolean().optional().catch(undefined),
  my_grant: DocumentBreakGlassGrantSchema.nullable()
    .optional()
    .catch(null)
    .transform((v) => v ?? null),
});
export type DocumentAdminSummary = Omit<
  z.infer<typeof DocumentAdminSummarySchema>,
  "document" | "acl_owner" | "my_level" | "via" | "my_grant"
> & {
  document: DocumentAdminSummaryDocument;
  acl_owner: DocumentPersonAccess | null;
  my_level: DocumentAccessLevel | "";
  via: DocumentAccessVia | "";
  my_grant: DocumentBreakGlassGrant | null;
};

/** One mentioned user who cannot read the document on comment create/update (G8-18). */
export const DocumentCommentMentionWithoutAccessSchema = z.object({
  user_id: z.string().min(1),
  display_name: z
    .string()
    .nullish()
    .catch(undefined)
    .transform((v) => v ?? undefined),
  can_share: z.boolean(),
});
export type DocumentCommentMentionWithoutAccess = {
  user_id: string;
  display_name?: string;
  can_share: boolean;
};

export const DocumentCommentSchema = BaseDocumentCommentSchema.extend({
  mentions_without_access: z
    .unknown()
    .optional()
    .transform((raw): DocumentCommentMentionWithoutAccess[] | undefined => {
      if (raw === undefined || raw === null) return undefined;
      if (!Array.isArray(raw)) return [];
      const items: DocumentCommentMentionWithoutAccess[] = [];
      for (const item of raw) {
        const parsed = DocumentCommentMentionWithoutAccessSchema.safeParse(item);
        if (parsed.success) {
          items.push(
            parsed.data.display_name !== undefined
              ? parsed.data
              : { user_id: parsed.data.user_id, can_share: parsed.data.can_share },
          );
        }
      }
      return items;
    }),
});
export type DocumentComment = BaseDocumentComment & {
  mentions_without_access?: DocumentCommentMentionWithoutAccess[];
};

export const DocumentCommentEnvelopeSchema = z.object({ comment: DocumentCommentSchema });
export const DocumentCommentListEnvelopeSchema = z.object({
  comments: z.array(DocumentCommentSchema).optional(),
  mentions: z
    .array(DocumentCommentMentionSchema)
    .catch([])
    .nullish()
    .transform((v) => v ?? []),
  list_token: z.string().optional().default(""),
  unchanged: z.boolean().optional(),
});
export type DocumentCommentListEnvelope = Omit<
  z.infer<typeof DocumentCommentListEnvelopeSchema>,
  "comments"
> & { comments?: DocumentComment[] };

/** One mention picker candidate (G8-06 + G8-18 `can_view`). */
export const MentionCandidateSchema = z.object({
  user_id: z.string().min(1),
  display_name: z
    .string()
    .nullish()
    .catch("")
    .transform((v) => v ?? ""),
  avatar_url: z.string().optional().catch(undefined),
  email: z.string().optional().catch(undefined),
  can_view: z.boolean().optional().catch(undefined),
});
export type MentionCandidate = z.infer<typeof MentionCandidateSchema>;

export interface DocumentRestrictedError {
  kind: "document_restricted";
  code: "document_restricted";
  canBreakGlass: boolean;
  status: number;
  message: string;
}

export interface BreakGlassRequiredError {
  kind: "break_glass_required";
  code: "break_glass_required";
  status: number;
  message: string;
}

export interface BreakGlassReasonInvalidError {
  kind: "break_glass_reason_invalid";
  code: "break_glass_reason_invalid";
  min: number;
  max: number;
  length?: number;
  status: number;
  message: string;
}

export type DocumentAccessError =
  | DocumentRestrictedError
  | BreakGlassRequiredError
  | BreakGlassReasonInvalidError;
