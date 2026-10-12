import { z } from "zod";

export const EmailHubAccountSchema = z.object({
  id: z.string(),
  email_address: z.string(),
  provider: z.string(),
  connected_at: z.string(),
  last_sync_at: z.string().optional(),
  // An older server sends none of these; the defaults read as a healthy password account.
  auth_kind: z.string().default("password"),
  needs_reconnect: z.boolean().default(false),
  auth_failed_reason: z.string().default(""),
  // The mail server, so reconnecting a custom account can prefill its form. Each field
  // degrades alone: a drifted value drops that field, never the whole account.
  imap_host: z.string().optional().catch(undefined),
  imap_port: z.number().optional().catch(undefined),
  imap_security: z.string().optional().catch(undefined),
  smtp_host: z.string().optional().catch(undefined),
  smtp_port: z.number().optional().catch(undefined),
  smtp_security: z.string().optional().catch(undefined),
  username: z.string().optional().catch(undefined),
});

/** Which sign-in buttons to show. Anything but `true`, a missing key included, hides that provider. */
export const EmailHubProvidersSchema = z.object({
  google: z.boolean().catch(false),
  microsoft: z.boolean().catch(false),
});

export const EmailHubOAuthStartSchema = z.object({
  authorization_url: z.string(),
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

export const EmailHubSidebarCountsSchema = z.object({
  inbox_unread: z.number().optional().default(0),
  snoozed_total: z.number().optional().default(0),
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
  conversation_message_count: z.number().optional(),
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

export const EmailHubConversationSchema = z.object({
  messages: z.array(EmailHubThreadSchema).optional().default([]),
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

type EmailHubServerSecurity = "tls" | "starttls";

/** A custom IMAP/SMTP server for connect. Keys are the request's JSON names; the password travels beside it. */
export interface EmailHubCustomServer {
  imap_host: string;
  imap_port: number;
  imap_security: EmailHubServerSecurity;
  smtp_host: string;
  smtp_port: number;
  smtp_security: EmailHubServerSecurity;
  /** Login name when it is not the address; empty or absent means the address. */
  username?: string;
}

export type EmailHubAccount = z.infer<typeof EmailHubAccountSchema>;
export type EmailHubProviders = z.infer<typeof EmailHubProvidersSchema>;
export type EmailHubOAuthProvider = "google" | "microsoft";
export type EmailHubWatch = z.infer<typeof EmailHubWatchSchema>;
export type EmailHubInboxWatch = z.infer<typeof EmailHubInboxWatchSchema>;
export type EmailHubSync = z.infer<typeof EmailHubSyncSchema>;
export type EmailHubSidebarCounts = z.infer<typeof EmailHubSidebarCountsSchema>;
export type EmailHubThread = z.infer<typeof EmailHubThreadSchema>;
export type EmailHubCounts = z.infer<typeof EmailHubCountsSchema>;
