import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * The operator's queue of chat reports in the platform console (store UGC
 * policy, Apple 1.2: every report is acted on within 24 hours). Ids, the
 * reason, the status and when — never the message or the reporter's words.
 */
export type AdminChatReportStatus = "open" | "resolved";

const AdminChatReportSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string().catch(""),
  organization_name: z.string().catch(""),
  organization_status: z.string().catch(""),
  workspace_id: z.string().catch(""),
  room_id: z.string().nullish(),
  message_id: z.string().nullish(),
  target_user_id: z.string(),
  reporter_id: z.string().catch(""),
  reason: z.string(),
  status: z.string(),
  created_at: z.string(),
});
export type AdminChatReport = z.infer<typeof AdminChatReportSchema>;

const AdminChatReportListSchema = z.object({
  reports: z.array(AdminChatReportSchema),
  total: z.number(),
  open_count: z.number().catch(0),
  oldest_open_at: z.string().nullish(),
});
export type AdminChatReportPage = z.infer<typeof AdminChatReportListSchema>;

const ResolvedSchema = z.object({ id: z.string(), status: z.string() });

export interface AdminChatReportQuery {
  status?: AdminChatReportStatus | "";
  limit?: number;
  offset?: number;
}

export const EMPTY_CHAT_REPORT_PAGE: AdminChatReportPage = { reports: [], total: 0, open_count: 0, oldest_open_at: null };

export async function listAdminChatReports(query: AdminChatReportQuery = {}): Promise<AdminChatReportPage> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  params.set("limit", String(query.limit ?? 50));
  params.set("offset", String(query.offset ?? 0));
  const raw = await request(`/api/v1/admin/chat-reports?${params}`);
  return parseWithFallback(raw, AdminChatReportListSchema, EMPTY_CHAT_REPORT_PAGE, { endpoint: "GET /api/v1/admin/chat-reports" });
}

/** Closes one open report with the operator's reason; null when the server's answer is not a receipt. */
export async function resolveAdminChatReport(id: string, reason: string): Promise<{ id: string; status: string } | null> {
  const raw = await request(`/api/v1/admin/chat-reports/${encodeURIComponent(id)}/resolve`, { method: "POST", body: { reason } });
  return parseWithFallback<{ id: string; status: string } | null>(raw, ResolvedSchema, null, { endpoint: "POST /api/v1/admin/chat-reports/:id/resolve" });
}
