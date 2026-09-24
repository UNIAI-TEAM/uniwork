import { z } from "zod";

export const EmailHubAccountSchema = z.object({
  id: z.string(),
  email_address: z.string(),
  provider: z.string(),
  connected_at: z.string(),
  last_sync_at: z.string().optional(),
});

export const EmailHubWatchSchema = z.object({
  changed: z.boolean(),
  synced: z.boolean(),
  at: z.string().optional(),
});

export const EmailHubInboxWatchSchema = z.object({
  subscribed: z.boolean(),
});

export const EmailHubSyncSchema = z.object({
  synced: z.boolean(),
});

export const EmailHubUnreadSchema = z.object({
  unread: z.number().optional().default(0),
});

export const EmailHubCountsSchema = z.object({
  total: z.number(),
  unread: z.number(),
});

export const EmailHubAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
});

export const EmailHubThreadSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  folder: z.string(),
  subject: z.string(),
  snippet: z.string(),
  from_addr: z.string(),
  from_name: z.string().optional(),
  to_addrs: z.array(z.string()),
  sent_at: z.string(),
  is_read: z.boolean(),
  is_starred: z.boolean(),
  has_attachments: z.boolean(),
  attachments: z.array(EmailHubAttachmentSchema).optional(),
  body_text: z.string().optional(),
  body_html: z.string().optional(),
  body_cached: z.boolean(),
  imap_labels: z.array(z.string()).optional().default([]),
  snoozed_until: z.string().optional(),
});

export const EmailHubImapLabelListSchema = z.object({
  labels: z.array(z.string()).optional().default([]),
});

export const EmailHubAccountListSchema = z.object({
  accounts: z.array(EmailHubAccountSchema),
});

export const EmailHubThreadListSchema = z.object({
  threads: z.array(EmailHubThreadSchema),
  counts: EmailHubCountsSchema,
  next_cursor: z.string().optional(),
});

export const EmailHubSummaryActionItemSchema = z.object({
  title: z.string(),
  owner: z.string().optional().default(""),
  due: z.string().optional().default(""),
});

export const EmailHubThreadSummarySchema = z.object({
  summary: z.string(),
  key_points: z.array(z.string()).optional().default([]),
  action_items: z.array(EmailHubSummaryActionItemSchema).optional().default([]),
  needs_reply: z.boolean().optional().default(false),
  reply_hint: z.string().optional().default(""),
  model: z.string().optional().default(""),
  cached: z.boolean().optional().default(false),
  summarized_at: z.string().optional().default(""),
});

export type EmailHubAttachment = z.infer<typeof EmailHubAttachmentSchema>;
export type EmailHubThreadSummary = z.infer<typeof EmailHubThreadSummarySchema>;
export type EmailHubSummaryActionItem = z.infer<typeof EmailHubSummaryActionItemSchema>;

export interface EmailHubThreadFilters {
  q?: string;
  from?: string;
  label?: string;
  unreadOnly?: boolean;
  hasAttachmentsOnly?: boolean;
}

export type EmailHubAccount = z.infer<typeof EmailHubAccountSchema>;
export type EmailHubWatch = z.infer<typeof EmailHubWatchSchema>;
export type EmailHubInboxWatch = z.infer<typeof EmailHubInboxWatchSchema>;
export type EmailHubSync = z.infer<typeof EmailHubSyncSchema>;
export type EmailHubThread = z.infer<typeof EmailHubThreadSchema>;
export type EmailHubCounts = z.infer<typeof EmailHubCountsSchema>;
