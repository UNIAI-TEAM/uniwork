import { z } from "zod";

/** Mirrors server/internal/handler/dto/sdo/ai.go. Lenient on the wire. */
export const AiModelOptionSchema = z.object({
  key: z.string(),
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

export const AiStepSchema = z.object({
  tool: z.string().catch(""),
  label: z.string().catch(""),
  counts: z.record(z.string(), z.number()).catch({}),
});
export type AiStep = z.infer<typeof AiStepSchema>;

export const AiContextRefSchema = z.object({ kind: z.string(), id: z.string(), title: z.string().catch("") });
export type AiContextRef = z.infer<typeof AiContextRefSchema>;

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
  created_at: z.string().optional().default(""),
});
export type AiMessage = Omit<z.infer<typeof AiMessageSchema>, "role"> & { role: "user" | "assistant" | (string & {}) };

export const AiConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
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
  action_items: z.array(ChatCatchUpActionItemSchema).optional().default([]),
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
