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
});

export const EmailHubAccountListSchema = z.object({
  accounts: z.array(EmailHubAccountSchema),
});

export const EmailHubThreadListSchema = z.object({
  threads: z.array(EmailHubThreadSchema),
  counts: EmailHubCountsSchema,
  next_cursor: z.string().optional(),
});

export type EmailHubAttachment = z.infer<typeof EmailHubAttachmentSchema>;

export interface EmailHubThreadFilters {
  q?: string;
  from?: string;
  unreadOnly?: boolean;
  hasAttachmentsOnly?: boolean;
}

export type EmailHubAccount = z.infer<typeof EmailHubAccountSchema>;
export type EmailHubWatch = z.infer<typeof EmailHubWatchSchema>;
export type EmailHubInboxWatch = z.infer<typeof EmailHubInboxWatchSchema>;
export type EmailHubSync = z.infer<typeof EmailHubSyncSchema>;
export type EmailHubThread = z.infer<typeof EmailHubThreadSchema>;
export type EmailHubCounts = z.infer<typeof EmailHubCountsSchema>;
