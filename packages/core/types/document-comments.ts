import { z } from "zod";
import { ActorSchema } from "./actor";
import { CommentReactionSchema } from "./task-collaboration";

// ---- Document comments (G1-07; UNI-681 lane 07b; G8-03) -------------------
// Re-exported from types/document, which stays the public path.
// Document comments reuse the comment_reactions shape from types/
// task-collaboration.ts (keyed by comment_id) and mirror the task comment
// DTO: enum-ish fields stay lenient strings so a server that ships a new
// value degrades instead of failing the parse, and only `type`/`kind` narrow -
// the document routes accept "comment" and "discussion" (G8-03), never a
// system row. `type` is the pre-G8 name of `kind`; both carry the stored
// comment_type, and every row that existed before the change reads back as
// "discussion" (G8-D5).

export const DOCUMENT_COMMENT_KINDS = ["comment", "discussion"] as const;
export type DocumentCommentKind = (typeof DOCUMENT_COMMENT_KINDS)[number];

/** The stored anchor object (contract-collab section 4.1): a JSON object with
 *  `format` and `v`, whose closed per-format schema lives on the server. The
 *  client keeps it opaque and never lets an anchor it does not know cost the
 *  comment: a malformed value reads as "no anchor". */
const DocumentCommentAnchorSchema = z.record(z.string(), z.unknown()).nullable().catch(null);

export const DocumentCommentSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  author_id: z.string().optional().default(""),
  author_kind: z.string().optional().default("human"),
  author: ActorSchema.optional(),
  body: z.string(),
  parent_id: z.string().nullish(),
  type: z.string().optional().default("discussion"),
  kind: z.string().optional().default("discussion"),
  anchor: DocumentCommentAnchorSchema.nullish().transform((v) => v ?? null),
  anchor_version_id: z.string().nullish(),
  anchor_state: z.string().nullish(),
  deleted_at: z.string().nullish(),
  deleted_by_id: z.string().nullish(),
  deleted_by_kind: z.string().nullish(),
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
export type DocumentComment = Omit<z.infer<typeof DocumentCommentSchema>, "type" | "kind"> & {
  type: DocumentCommentKind;
  kind: DocumentCommentKind;
};

/** One name-table entry of the mention chips in a list answer (contract-collab
 *  section 2.1): the current display name, or `unavailable` when the account
 *  is gone - the client then keeps the label written in the token. */
export const DocumentCommentMentionSchema = z.object({
  user_id: z.string(),
  display_name: z.string().optional().default(""),
  avatar_url: z.string().optional().default(""),
  state: z.string().optional().default("ok"),
});
export type DocumentCommentMention = z.infer<typeof DocumentCommentMentionSchema>;

/** One edit-history row (contract-collab section 2.7): the body a later edit
 *  replaced and the revision number that body carried. */
export const DocumentCommentRevisionSchema = z.object({
  id: z.string(),
  revision: z.number().optional().default(0),
  body: z.string().optional().default(""),
  created_by_id: z.string().optional().default(""),
  created_by_kind: z.string().optional().default("human"),
  created_at: z.string().optional().default(""),
});
export type DocumentCommentRevision = z.infer<typeof DocumentCommentRevisionSchema>;

export const DocumentCommentEnvelopeSchema = z.object({ comment: DocumentCommentSchema });
// The list answer has two shapes (contract-collab section 2.1): a full list
// and the unchanged probe, which carries the token alone. `comments` is
// optional here so the probe parses; the endpoint decides which shape arrived
// and a caller must keep its list when neither can be proven.
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
export const DocumentCommentRevisionListEnvelopeSchema = z.object({
  revisions: z.array(DocumentCommentRevisionSchema),
});
export type DocumentCommentListEnvelope = Omit<
  z.infer<typeof DocumentCommentListEnvelopeSchema>,
  "comments"
> & { comments?: DocumentComment[] };
