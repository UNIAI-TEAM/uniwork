import { z } from "zod";
import {
  ChatMessageSchema,
  TranscriptSegmentSchema,
  type MeetingChatMessage,
  type MeetingTranscriptSegment,
} from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * One page of an in-room feed (chat, transcript), oldest first. No cursor is
 * the newest page; `before` walks back; `after` reads only what arrived since
 * (the server re-sends a few seconds of overlap, so callers merge by id).
 */
export type MeetingFeedPage<T> = {
  items: T[];
  /** Pass as `before` for the page older than `items`; "" when there is none. */
  olderCursor: string;
  /** Pass as `after` to read what arrives later; "" when the server gave none. */
  afterCursor: string;
  /** A delta filled its page: rows may lie past it, so read the newest page again. */
  hasMoreAfter: boolean;
};

export type MeetingFeedQuery = { before?: string; after?: string; limit?: number; signal?: AbortSignal };

/** One malformed row is dropped, not the whole page. */
function lenientRows<S extends z.ZodTypeAny>(schema: S) {
  return z
    .array(z.unknown())
    .nullish()
    .transform((items) => {
      const out: z.infer<S>[] = [];
      for (const item of items ?? []) {
        const parsed = schema.safeParse(item);
        if (parsed.success) out.push(parsed.data as z.infer<S>);
      }
      return out;
    });
}

const cursor = z.string().optional().catch(undefined);
const Cursors = {
  older_cursor: cursor,
  after_cursor: cursor,
  has_more_after: z.boolean().optional().catch(undefined),
};
const ChatPageResponse = z.object({ messages: lenientRows(ChatMessageSchema), ...Cursors });
const TranscriptPageResponse = z.object({ segments: lenientRows(TranscriptSegmentSchema), ...Cursors });

function feedPath(meetingId: string, feed: "chat" | "transcript", q: MeetingFeedQuery): string {
  const p = new URLSearchParams();
  if (q.before) p.set("before", q.before);
  if (q.after) p.set("after", q.after);
  if (q.limit) p.set("limit", String(q.limit));
  const qs = p.toString();
  return `/api/v1/meetings/${encodeURIComponent(meetingId)}/${feed}${qs ? `?${qs}` : ""}`;
}

function toPage<T>(
  items: T[],
  raw: { older_cursor?: string; after_cursor?: string; has_more_after?: boolean },
): MeetingFeedPage<T> {
  return {
    items,
    olderCursor: raw.older_cursor ?? "",
    afterCursor: raw.after_cursor ?? "",
    hasMoreAfter: raw.has_more_after ?? false,
  };
}

export async function listMeetingChatPage(
  meetingId: string,
  q: MeetingFeedQuery = {},
): Promise<MeetingFeedPage<MeetingChatMessage>> {
  const raw = await request(feedPath(meetingId, "chat", q), { signal: q.signal });
  const page = parseWithFallback<z.infer<typeof ChatPageResponse>>(
    raw,
    ChatPageResponse,
    { messages: [] },
    { endpoint: "listMeetingChatPage" },
  );
  return toPage(page.messages, page);
}

export async function listTranscriptPage(
  meetingId: string,
  q: MeetingFeedQuery = {},
): Promise<MeetingFeedPage<MeetingTranscriptSegment>> {
  const raw = await request(feedPath(meetingId, "transcript", q), { signal: q.signal });
  const page = parseWithFallback<z.infer<typeof TranscriptPageResponse>>(
    raw,
    TranscriptPageResponse,
    { segments: [] },
    { endpoint: "listTranscriptPage" },
  );
  return toPage(page.segments, page);
}
