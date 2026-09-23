import { z } from "zod";
import {
  EmailHubAccountListSchema,
  EmailHubAccountSchema,
  EmailHubSyncSchema,
  EmailHubThreadListSchema,
  EmailHubThreadSchema,
  EmailHubInboxWatchSchema,
  EmailHubWatchSchema,
  type EmailHubAccount,
  type EmailHubInboxWatch,
  type EmailHubSync,
  type EmailHubThread,
  type EmailHubThreadFilters,
  type EmailHubWatch,
} from "../../types/email-hub";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

const EMPTY_ACCOUNTS = { accounts: [] as EmailHubAccount[] };
const EMPTY_THREADS = { threads: [] as EmailHubThread[], counts: { total: 0, unread: 0 }, next_cursor: "" };
const EMPTY_WATCH: EmailHubWatch = { changed: false, synced: false, at: "" };
const EMPTY_INBOX_WATCH: EmailHubInboxWatch = { subscribed: false };
const EMPTY_SYNC: EmailHubSync = { synced: false };

export async function listEmailHubAccounts(workspaceId: string) {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/accounts`);
  return parseWithFallback(raw, EmailHubAccountListSchema, EMPTY_ACCOUNTS, {
    endpoint: "GET /api/v1/workspaces/{ws}/email-hub/accounts",
  });
}

export async function connectEmailHubAccount(workspaceId: string, emailAddress: string, appPassword: string) {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/accounts`, {
    method: "POST",
    body: { email_address: emailAddress, app_password: appPassword },
  });
  return parseWithFallback<EmailHubAccount | null>(raw, EmailHubAccountSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/accounts",
  });
}

export async function disconnectEmailHubAccount(workspaceId: string, accountId: string) {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/accounts/${enc(accountId)}`, {
    method: "DELETE",
  });
}

export async function listEmailHubThreads(
  workspaceId: string,
  accountId: string,
  folder = "INBOX",
  filters: EmailHubThreadFilters = {},
  before?: string,
  limit = 50,
) {
  const q = new URLSearchParams({ account_id: accountId, folder, limit: String(limit) });
  if (filters.q) q.set("q", filters.q);
  if (filters.from) q.set("from", filters.from);
  if (filters.unreadOnly) q.set("unread", "1");
  if (filters.hasAttachmentsOnly) q.set("has_attachments", "1");
  if (before) q.set("before", before);
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/threads?${q}`);
  return parseWithFallback(raw, EmailHubThreadListSchema, EMPTY_THREADS, {
    endpoint: "GET /api/v1/workspaces/{ws}/email-hub/threads",
  });
}

export function emailHubAttachmentPath(
  workspaceId: string,
  threadId: string,
  attachmentId: string,
  accountId: string,
) {
  const q = new URLSearchParams({ account_id: accountId });
  return `/api/v1/workspaces/${enc(workspaceId)}/email-hub/threads/${enc(threadId)}/attachments/${enc(attachmentId)}?${q}`;
}

export async function downloadEmailHubAttachment(
  workspaceId: string,
  threadId: string,
  attachmentId: string,
  accountId: string,
) {
  return requestBlob(emailHubAttachmentPath(workspaceId, threadId, attachmentId, accountId));
}

function mergeAbortSignals(primary?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs) return primary;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => {
    clearTimeout(timer);
    ctrl.abort();
  };
  primary?.addEventListener("abort", onAbort, { once: true });
  ctrl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      primary?.removeEventListener("abort", onAbort);
    },
    { once: true },
  );
  return ctrl.signal;
}

export async function getEmailHubThread(
  workspaceId: string,
  accountId: string,
  threadId: string,
  fetchBody = false,
  markRead = false,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams({ account_id: accountId });
  if (fetchBody) q.set("body", "1");
  if (markRead) q.set("mark_read", "1");
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/threads/${enc(threadId)}?${q}`, {
    signal: mergeAbortSignals(signal, fetchBody ? 28_000 : 10_000),
  });
  return parseWithFallback<EmailHubThread | null>(raw, EmailHubThreadSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/email-hub/threads/{id}",
  });
}

export async function syncEmailHub(
  workspaceId: string,
  accountId: string,
  folder?: string,
  force?: boolean,
  live?: boolean,
  reconcile?: boolean,
) {
  const q = new URLSearchParams({ account_id: accountId });
  if (folder) q.set("folder", folder);
  if (force) q.set("force", "1");
  if (live) q.set("live", "1");
  if (reconcile) q.set("reconcile", "1");
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/sync?${q}`, { method: "POST" });
  return parseWithFallback(raw, EmailHubSyncSchema, EMPTY_SYNC, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/sync",
  });
}

export async function watchEmailHub(workspaceId: string, accountId: string) {
  const q = new URLSearchParams({ account_id: accountId });
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/watch?${q}`, { method: "POST" });
  return parseWithFallback(raw, EmailHubWatchSchema, EMPTY_WATCH, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/watch",
  });
}

export async function subscribeEmailHubInboxWatch(workspaceId: string, accountId: string) {
  const q = new URLSearchParams({ account_id: accountId });
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/inbox-watch?${q}`, {
    method: "POST",
  });
  return parseWithFallback(raw, EmailHubInboxWatchSchema, EMPTY_INBOX_WATCH, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/inbox-watch",
  });
}

export async function unsubscribeEmailHubInboxWatch(workspaceId: string, accountId: string) {
  const q = new URLSearchParams({ account_id: accountId });
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/inbox-watch?${q}`, {
    method: "DELETE",
  });
  return parseWithFallback(raw, EmailHubInboxWatchSchema, EMPTY_INBOX_WATCH, {
    endpoint: "DELETE /api/v1/workspaces/{ws}/email-hub/inbox-watch",
  });
}

export interface SendEmailHubAttachmentInput {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface SendEmailHubInput {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: SendEmailHubAttachmentInput[];
  sendAt?: string;
  replyToThreadId?: string;
}

export const EmailHubScheduledSendSchema = z.object({
  scheduled: z.literal(true),
  id: z.string(),
  send_at: z.string(),
  subject: z.string(),
  to: z.array(z.string()),
  account_id: z.string(),
});

export type EmailHubScheduledSend = z.infer<typeof EmailHubScheduledSendSchema>;

export async function sendEmailHub(workspaceId: string, input: SendEmailHubInput) {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/send`, {
    method: "POST",
    body: {
      account_id: input.accountId,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      attachments: input.attachments?.map((att) => ({
        filename: att.filename,
        content_type: att.contentType,
        content_base64: att.contentBase64,
      })),
      send_at: input.sendAt,
      reply_to_thread_id: input.replyToThreadId,
    },
  });
  const scheduled = parseWithFallback<EmailHubScheduledSend | null>(
    raw,
    EmailHubScheduledSendSchema,
    null,
    { endpoint: "POST /api/v1/workspaces/{ws}/email-hub/send" },
  );
  if (scheduled?.scheduled) return scheduled;
  return parseWithFallback<EmailHubThread | null>(raw, EmailHubThreadSchema, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/email-hub/send",
  });
}

export type PatchEmailHubThreadInput = {
  accountId: string;
  isRead?: boolean;
  isStarred?: boolean;
};

export async function patchEmailHubThread(
  workspaceId: string,
  threadId: string,
  input: PatchEmailHubThreadInput,
) {
  const body: Record<string, unknown> = { account_id: input.accountId };
  if (input.isRead !== undefined) body.is_read = input.isRead;
  if (input.isStarred !== undefined) body.is_starred = input.isStarred;
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/threads/${enc(threadId)}`, {
    method: "PATCH",
    body,
  });
  return parseWithFallback<EmailHubThread | null>(raw, EmailHubThreadSchema, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}/email-hub/threads/{id}",
  });
}

export type EmailHubMoveTarget = "INBOX" | "ARCHIVE" | "TRASH";

export const EmailHubScheduledSendItemSchema = z.object({
  id: z.string(),
  send_at: z.string(),
  subject: z.string(),
  to: z.array(z.string()),
  status: z.string(),
});

export const EmailHubScheduledSendListSchema = z.object({
  scheduled: z.array(EmailHubScheduledSendItemSchema),
});

export type EmailHubScheduledSendItem = z.infer<typeof EmailHubScheduledSendItemSchema>;

const EMPTY_SCHEDULED_SENDS: { scheduled: EmailHubScheduledSendItem[] } = { scheduled: [] };

export async function listEmailHubScheduledSends(workspaceId: string, accountId: string) {
  const q = new URLSearchParams({ account_id: accountId });
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/scheduled-sends?${q}`);
  return parseWithFallback(raw, EmailHubScheduledSendListSchema, EMPTY_SCHEDULED_SENDS, {
    endpoint: "GET /api/v1/workspaces/{ws}/email-hub/scheduled-sends",
  });
}

export async function cancelEmailHubScheduledSend(workspaceId: string, accountId: string, scheduledId: string) {
  const q = new URLSearchParams({ account_id: accountId });
  await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/scheduled-sends/${enc(scheduledId)}?${q}`, {
    method: "DELETE",
  });
}

export async function moveEmailHubThread(
  workspaceId: string,
  threadId: string,
  accountId: string,
  moveTo: EmailHubMoveTarget,
) {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/email-hub/threads/${enc(threadId)}`, {
    method: "PATCH",
    body: { account_id: accountId, move_to: moveTo },
  });
}
