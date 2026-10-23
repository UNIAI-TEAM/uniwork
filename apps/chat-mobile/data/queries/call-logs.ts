// The calls tab's one source: GET /api/v1/workspaces/{ws}/chat/call-logs
// (server ChatService.ListCallLogs), newest first, one cursor page at a time.
// Lenient like data/schemas.ts: a row that does not parse is dropped, not
// the page, and a drifted body reads as an empty last page.
import { infiniteQueryOptions } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { z } from "zod";
import { api } from "../api";

const CallLogSchema = z.object({
  message_id: z.string(),
  room_id: z.string(),
  room_kind: z.string().catch(""),
  room_name: z.string().catch(""),
  peer_user_id: z.string().optional().catch(undefined),
  call_id: z.string().catch(""),
  outcome: z.string().catch(""),
  video: z.boolean().catch(false),
  caller_id: z.string().catch(""),
  caller_name: z.string().catch(""),
  duration_seconds: z.number().catch(0),
  ended_at: z.string().catch(""),
  participants: z.array(z.object({ user_id: z.string(), display_name: z.string().catch("") })).catch([]),
});

export type CallLog = z.infer<typeof CallLogSchema>;

export interface CallLogPage {
  call_logs: CallLog[];
  next_cursor: string | null;
}

const CallLogPageSchema = z.object({
  call_logs: z.array(CallLogSchema.nullable().catch(null)).transform((rows) => rows.filter((row) => row !== null)),
  next_cursor: z.string().nullable().catch(null),
});

const EMPTY_PAGE: CallLogPage = { call_logs: [], next_cursor: null };

export async function fetchCallLogs(wsId: string, cursor: string | null, signal?: AbortSignal): Promise<CallLogPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const raw = await api.request(`/api/v1/workspaces/${encodeURIComponent(wsId)}/chat/call-logs${query}`, { signal });
  return parseWithFallback<CallLogPage>(raw, CallLogPageSchema, EMPTY_PAGE, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/call-logs",
  });
}

export const callLogsOptions = (wsId: string) =>
  infiniteQueryOptions({
    queryKey: ["chat-call-logs", wsId] as const,
    queryFn: ({ pageParam, signal }) => fetchCallLogs(wsId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page: CallLogPage) => page.next_cursor ?? undefined,
  });
