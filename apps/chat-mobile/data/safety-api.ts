// Blocking and reporting (Apple 1.2, Google Play's user-generated content
// policy). The block routes are the web's (packages/core/api/endpoints/
// chat-users.ts › getChatBlockStatus, blockChatUser, unblockChatUser, copied:
// ADR 0011); the report route is POST …/chat/reports. safety-api.test.ts
// holds a malformed-response case for each.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { ChatBlockStatusSchema, enc, type ChatBlockStatus } from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import type { ReportBody } from "@/lib/report";
import { api } from "./api";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const StatusSchema = z.object({ status: z.string().optional() });
const ReportSchema = z.object({ id: z.string(), status: z.string().catch("open") });

export type ChatReportReceipt = z.infer<typeof ReportSchema>;

const NOT_BLOCKED: ChatBlockStatus = { blocked_by_me: false, blocked_me: false };

export function createSafetyApi(request: Request) {
  const user = (wsId: string, userId: string) => `/api/v1/workspaces/${enc(wsId)}/chat/users/${enc(userId)}/block`;
  async function ok(raw: Promise<unknown>, endpoint: string): Promise<boolean> {
    return parseWithFallback(await raw, StatusSchema, { status: "" }, { endpoint }).status === "ok";
  }
  return {
    /** Unreadable reads as "not blocked": the composer stays usable and the server still refuses a blocked send. */
    async blockStatus(wsId: string, userId: string, signal?: AbortSignal): Promise<ChatBlockStatus> {
      const raw = await request(user(wsId, userId), { signal });
      return parseWithFallback(raw, ChatBlockStatusSchema, NOT_BLOCKED, { endpoint: "GET /api/v1/workspaces/{ws}/chat/users/{userID}/block" });
    },
    block(wsId: string, userId: string): Promise<boolean> {
      return ok(request(user(wsId, userId), { method: "POST" }), "POST /api/v1/workspaces/{ws}/chat/users/{userID}/block");
    },
    unblock(wsId: string, userId: string): Promise<boolean> {
      return ok(request(user(wsId, userId), { method: "DELETE" }), "DELETE /api/v1/workspaces/{ws}/chat/users/{userID}/block");
    },
    /** The filed report, or null when the 2xx answer drifted (it was still filed). */
    async report(wsId: string, body: ReportBody): Promise<ChatReportReceipt | null> {
      const raw = await request(`/api/v1/workspaces/${enc(wsId)}/chat/reports`, { method: "POST", body: JSON.stringify(body) });
      return parseWithFallback<ChatReportReceipt | null>(raw, ReportSchema, null, { endpoint: "POST /api/v1/workspaces/{ws}/chat/reports" });
    },
  };
}

export type SafetyApi = ReturnType<typeof createSafetyApi>;

export const safetyApi: SafetyApi = createSafetyApi((path, init) => api.request(path, init));
