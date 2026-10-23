import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

export const DEMO_TEAM_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type DemoStatus = "new" | "in_progress" | "completed";
export interface DemoRequestInput {
  full_name: string; work_email: string; company_name: string;
  team_size: typeof DEMO_TEAM_SIZES[number]; message: string; locale: "en" | "vi";
}
const DemoRequestSchema = z.object({
  id: z.string(), full_name: z.string(), work_email: z.string(), company_name: z.string(),
  team_size: z.string(), message: z.string(), locale: z.string(), status: z.string(),
  created_at: z.string(), updated_at: z.string(),
});
export type DemoRequest = z.infer<typeof DemoRequestSchema>;
const ReceiptSchema = z.object({ request_id: z.string() });
const ListSchema = z.object({ requests: z.array(DemoRequestSchema), total: z.number() });
const UpdateSchema = z.object({ request: DemoRequestSchema });
export interface DemoRequestQuery { status?: string; limit?: number; offset?: number }
export async function createDemoRequest(body: DemoRequestInput, key: string) {
  const raw = await request("/api/v1/demo-requests", { method: "POST", body, skipRefresh: true, headers: { "Idempotency-Key": key } });
  return parseWithFallback(raw, ReceiptSchema, { request_id: "" }, { endpoint: "POST /api/v1/demo-requests" });
}
export async function listDemoRequests(query: DemoRequestQuery) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  params.set("limit", String(query.limit ?? 20)); params.set("offset", String(query.offset ?? 0));
  const raw = await request(`/api/v1/admin/demo-requests?${params}`);
  return parseWithFallback<{ requests: DemoRequest[]; total: number }>(raw, ListSchema, { requests: [], total: 0 }, { endpoint: "GET /api/v1/admin/demo-requests" });
}
export async function updateDemoRequest(id: string, body: { status: DemoStatus; reason: string }): Promise<DemoRequest | null> {
  const raw = await request(`/api/v1/admin/demo-requests/${encodeURIComponent(id)}`, { method: "PATCH", body });
  return parseWithFallback<{ request: DemoRequest | null }>(raw, UpdateSchema, { request: null }, { endpoint: "PATCH /api/v1/admin/demo-requests/:id" }).request;
}
