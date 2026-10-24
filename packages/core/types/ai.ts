import { z } from "zod";

/** Mirrors server/internal/handler/dto/sdo/ai.go. Lenient on the wire. */
export const AiModelOptionSchema = z.object({
  key: z.string(),
  // Whose model it is ("anthropic", …); "" when unknown, which reads as UNI's own look.
  provider: z.string().catch(""),
  speed: z.number().catch(0),
  intelligence: z.number().catch(0),
  cost: z.number().catch(0),
  enabled: z.boolean().catch(false),
});
export type AiModelOption = z.infer<typeof AiModelOptionSchema>;

export const AiCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  ask_uni: z.boolean().optional().default(false),
  meeting_summary: z.boolean().optional().default(false),
  quota: z
    .object({
      used_tokens: z.number().optional().default(0),
      limit_tokens: z.number().nullable().optional().default(null),
    })
    .optional()
    .default({ used_tokens: 0, limit_tokens: null }),
  // A malformed list hides the picker; it never turns AI off.
  models: z.array(AiModelOptionSchema).optional().default([]).catch([]),
  auto_model: z.string().catch(""),
  // A malformed flag hides the upload entry; it never turns AI off.
  attachments: z.boolean().catch(false),
  // Ask UNI's write state; a malformed block reads as writes off, never as AI off.
  actions: z
    .object({ enabled: z.boolean().catch(false), ceiling: z.string().catch("off"), mode: z.string().catch("") })
    .catch({ enabled: false, ceiling: "off", mode: "" }),
});
export type AiCapabilities = z.infer<typeof AiCapabilitiesSchema>;

export const AiCitationSchema = z.object({
  source_id: z.string(),
  quote: z.string().optional().default(""),
  kind: z.string().optional().default(""),
  title: z.string().optional().default(""),
  href: z.string().optional().default(""),
  object_id: z.string().optional(),
});
export type AiCitation = z.infer<typeof AiCitationSchema>;
export type AiSource = AiCitation;

/**
 * One tool step, or (kind "think") the thinking before the answer. A round's first step carries the sentence the model
 * wrote before calling (`note`) and its thinking summary (`thought`); both are "" when there were none.
 */
export const AiStepSchema = z.object({
  tool: z.string().catch(""),
  label: z.string().catch(""),
  counts: z.record(z.string(), z.number()).catch({}),
  note: z.string().catch(""),
  thought: z.string().catch(""),
  kind: z.string().catch(""),
});
export type AiStep = z.infer<typeof AiStepSchema>;

export const AiContextRefSchema = z.object({ kind: z.string(), id: z.string(), title: z.string().catch("") });
export type AiContextRef = z.infer<typeof AiContextRefSchema>;

/** A file a question carried. `id` is the attachment row's id (the one that downloads), not the upload's file_id. */
export const AiAttachmentSchema = z.object({
  id: z.string(),
  name: z.string().catch(""),
  mime: z.string().catch(""),
  size: z.number().catch(0),
  // "image" | "pdf" | "text": how Ask UNI reads the file.
  kind: z.string().catch(""),
});
export type AiAttachment = z.infer<typeof AiAttachmentSchema>;

/** The answer's note that it read a file only in part. `read` 0 means only the start of the first unit. */
export const AiFileNoteSchema = z.object({
  name: z.string(),
  // "page" | "slide" | "row" | "paragraph" | "line"; a unit the client does not know reads as a plain count.
  unit: z.string().catch(""),
  read: z.number().catch(0),
  total: z.number().catch(0),
});
export type AiFileNote = z.infer<typeof AiFileNoteSchema>;

/** What the upload route answers: a file stored for the next question, named by `file_id` in `attachment_ids`. */
export const AskUploadedFileSchema = z.object({
  file_id: z.string(),
  name: z.string().catch(""),
  mime: z.string().catch(""),
  size: z.number().catch(0),
  kind: z.string().catch(""),
});
export type AskUploadedFile = z.infer<typeof AskUploadedFileSchema>;

const ProposalRefSchema = z.object({ kind: z.string().catch(""), id: z.string().catch(""), title: z.string().catch("") });

const EMPTY_PREVIEW = {
  target: { kind: "", id: "", title: "" },
  fields: [],
  body: "",
  body_truncated: false,
  audience: { visibility: "", room_members: 0, notifies: [], notifies_more: false },
  refs: [],
};
const EMPTY_RESULT = { object_id: "", href: "", revision: 0, changes: [], note: "" };

/**
 * One row of a proposal card (server AiProposalDTO). Every field degrades on
 * its own; `status` and the other enums stay strings so a value a newer server
 * adds still parses. `from`/`to` are readable values of any shape.
 */
export const AiProposalSchema = z.object({
  id: z.string().catch(""),
  message_id: z.string().catch(""),
  position: z.number().catch(0),
  tool: z.string().catch(""),
  level: z.string().catch(""),
  mode: z.string().catch(""),
  status: z.string().catch("unknown"),
  decision: z.string().catch(""),
  preview: z
    .object({
      target: ProposalRefSchema.catch(EMPTY_PREVIEW.target),
      fields: z
        .array(
          z.object({
            field: z.string().catch(""),
            type: z.string().catch(""),
            from: z.unknown(),
            to: z.unknown(),
            options: z.array(z.string()).catch([]),
          }),
        )
        .catch([]),
      body: z.string().catch(""),
      /** `body` holds only the start of a longer text (a long page): it is shown, never edited. */
      body_truncated: z.boolean().catch(false),
      audience: z
        .object({
          visibility: z.string().catch(""),
          room_members: z.number().catch(0),
          notifies: z.array(ProposalRefSchema).catch([]),
          notifies_more: z.boolean().catch(false),
        })
        .catch(EMPTY_PREVIEW.audience),
      refs: z.array(z.number()).catch([]),
    })
    .catch(EMPTY_PREVIEW),
  result: z
    .object({
      object_id: z.string().catch(""),
      href: z.string().catch(""),
      revision: z.number().catch(0),
      changes: z.array(z.object({ field: z.string().catch(""), from: z.unknown(), to: z.unknown() })).catch([]),
      note: z.string().catch(""),
    })
    .catch(EMPTY_RESULT),
  can_undo: z.boolean().catch(false),
  error_code: z.string().catch(""),
  tainted: z.boolean().catch(false),
  expires_at: z.string().catch(""),
});
/** `expired` and `unknown` are computed by the server at read time; any other string is a status this client does not know. */
export type AiProposal = Omit<z.infer<typeof AiProposalSchema>, "status"> & {
  status: "pending" | "applying" | "applied" | "rejected" | "failed" | "undoing" | "undone" | "expired" | "unknown" | (string & {});
};

export const AiMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  // Machine code for an answer with no text (e.g. "no_sources"); the client renders it in the reader's language.
  notice: z.string().catch(""),
  citations: z.array(AiCitationSchema).optional().default([]),
  // A malformed side list never drops the answer.
  steps: z.array(AiStepSchema).catch([]),
  followups: z.array(z.string()).catch([]),
  focus: AiContextRefSchema.nullable().catch(null),
  mentions: z.array(AiContextRefSchema).catch([]),
  // The model key the asker chose for an answer; "" for Auto and for answers stored before it was kept.
  model: z.string().catch(""),
  // The files a question carried; the server fills them on the asker's message only. A malformed list never drops the turn.
  attachments: z.array(AiAttachmentSchema).catch([]),
  // On an answer: the files UNI read only in part. Same rule.
  file_notes: z.array(AiFileNoteSchema).catch([]),
  // On an answer: the rows UNI proposes, by position; a malformed list never drops the answer.
  proposals: z.array(AiProposalSchema).catch([]),
  created_at: z.string().optional().default(""),
});
export type AiMessage = Omit<z.infer<typeof AiMessageSchema>, "role"> & { role: "user" | "assistant" | (string & {}) };

export const AiConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  // The conversation read something that is not the asker's own words, so UNI applies nothing by itself.
  tainted: z.boolean().catch(false),
});
export type AiConversation = z.infer<typeof AiConversationSchema>;

export const AskUniResponseSchema = z.object({
  conversation_id: z.string(),
  message: AiMessageSchema,
  usage: z
    .object({ input_tokens: z.number().optional().default(0), output_tokens: z.number().optional().default(0) })
    .optional()
    .default({ input_tokens: 0, output_tokens: 0 }),
});
export type AskUniResponse = z.infer<typeof AskUniResponseSchema>;

export const AiUsageRowSchema = z.object({
  day: z.string(),
  capability: z.string(),
  actor_kind: z.string().optional().default("human"),
  workspace_id: z.string().optional().default(""),
  calls: z.number().optional().default(0),
  input_tokens: z.number().optional().default(0),
  output_tokens: z.number().optional().default(0),
  cost_micros: z.number().optional().default(0),
});
export type AiUsageRow = z.infer<typeof AiUsageRowSchema>;

export const AiUsageSummarySchema = z.object({
  from: z.string().optional().default(""),
  to: z.string().optional().default(""),
  rows: z.array(AiUsageRowSchema).optional().default([]),
});
export type AiUsageSummary = z.infer<typeof AiUsageSummarySchema>;

interface AskUniContextRef {
  kind: "task" | "meeting" | "document" | "project" | "member" | "room";
  id: string;
}

export interface AskUniInput {
  conversation_id?: string;
  question: string;
  focus?: {
    kind: "task" | "meeting" | "email_thread" | "document" | "project" | "room" | "thread" | "message";
    id: string;
  };
  /** Up to 5 objects the asker names; each must be readable by them. */
  mentions?: AskUniContextRef[];
  locale?: string;
  /** "" or absent = Auto. */
  model?: string;
  /** "" or absent = medium. */
  effort?: string;
  /** Re-run this answer: the server uses the stored question and supersedes the old answer. */
  regenerate_message_id?: string;
  /** Up to 5 `file_id`s from the upload route, in attach order; the server refuses them together with `regenerate_message_id`. */
  attachment_ids?: string[];
  /** "ask" | "plan" | "auto"; sent only when set, absent = the asker's saved mode. */
  mode?: string;
}

export const AskModelsSchema = z.object({ models: z.array(z.string()) });

export const AskUniStreamUsageSchema = z.object({
  input_tokens: z.number().catch(0),
  output_tokens: z.number().catch(0),
  cache_read_tokens: z.number().catch(0),
  cache_write_tokens: z.number().catch(0),
});
export type AiStreamUsage = z.infer<typeof AskUniStreamUsageSchema>;

export const ChatCatchUpActionItemSchema = z.object({
  title: z.string(),
  owner: z.string().optional().default(""),
  due: z.string().optional().default(""),
  source_message_id: z.string().optional().default(""),
});
export type ChatCatchUpActionItem = z.infer<typeof ChatCatchUpActionItemSchema>;

export const ChatCatchUpHighlightSchema = z.object({
  text: z.string(),
  source_message_id: z.string().optional().default(""),
});
export type ChatCatchUpHighlight = z.infer<typeof ChatCatchUpHighlightSchema>;

export const ChatCatchUpResponseSchema = z.object({
  summary: z.string().optional().default(""),
  highlights: z.array(z.string()).optional().default([]),
  /** Highlights with their source message; empty from a server that predates it. A malformed list never blanks the brief. */
  highlight_items: z.array(ChatCatchUpHighlightSchema).optional().default([]).catch([]),
  /** A malformed list never blanks the brief either. */
  action_items: z.array(ChatCatchUpActionItemSchema).optional().default([]).catch([]),
  message_count: z.number().optional().default(0),
  mode: z.string().optional().default("unread"),
  since: z.string().optional().default(""),
  usage: z
    .object({ input_tokens: z.number().optional().default(0), output_tokens: z.number().optional().default(0) })
    .optional()
    .default({ input_tokens: 0, output_tokens: 0 }),
});
export type ChatCatchUpResponse = z.infer<typeof ChatCatchUpResponseSchema>;

export interface ChatCatchUpInput {
  room_id: string;
  thread_root_id?: string;
  locale?: string;
  /** Room read pointer from before the room was opened (opening marks it read). */
  since?: string;
}
