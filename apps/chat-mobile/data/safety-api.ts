// Blocking and reporting (Apple 1.2, Google Play's user-generated content
// policy). The block routes are core's own (@uniwork/core/api/endpoints/
// chat-users-api, the factory the web binds too) on the app's transport; the
// report route is POST …/chat/reports, which only the phone calls.
// safety-api.test.ts holds a malformed-response case for each.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { createChatUsersApi } from "@uniwork/core/api/endpoints/chat-users-api";
import { enc, type ChatBlockStatus } from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import type { ReportBody } from "@/lib/report";
import { api } from "./api";
import { toChatRequest } from "./chat-api";

type Request = (path: string, init?: RequestInit) => Promise<unknown>;

const ReportSchema = z.object({ id: z.string(), status: z.string().catch("open") });

export type ChatReportReceipt = z.infer<typeof ReportSchema>;

export function createSafetyApi(request: Request) {
  const users = createChatUsersApi(toChatRequest(request));
  return {
    /** Unreadable reads as "not blocked": the composer stays usable and the server still refuses a blocked send. */
    blockStatus(wsId: string, userId: string, signal?: AbortSignal): Promise<ChatBlockStatus> {
      return users.getChatBlockStatus(wsId, userId, signal);
    },
    block(wsId: string, userId: string): Promise<boolean> {
      return users.blockChatUser(wsId, userId);
    },
    unblock(wsId: string, userId: string): Promise<boolean> {
      return users.unblockChatUser(wsId, userId);
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
