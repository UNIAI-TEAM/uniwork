import { z } from "zod";

/** Mirrors server/internal/handler/dto/sdo/ai.go. Lenient on the wire. */
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
});
export type AiCapabilities = z.infer<typeof AiCapabilitiesSchema>;

export const AiCitationSchema = z.object({
  source_id: z.string(),
  quote: z.string().optional().default(""),
  kind: z.string().optional().default(""),
  title: z.string().optional().default(""),
  href: z.string().optional().default(""),
});
export type AiCitation = z.infer<typeof AiCitationSchema>;

export const AiMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  citations: z.array(AiCitationSchema).optional().default([]),
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

export interface AskUniInput {
  conversation_id?: string;
  question: string;
  focus?: { kind: "task" | "meeting"; id: string };
  locale?: string;
}
