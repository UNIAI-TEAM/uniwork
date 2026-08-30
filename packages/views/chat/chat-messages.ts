import { Direction, type MatrixClient } from "matrix-js-sdk";

export interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  ts: number;
  replyToEventId?: string;
  reactions: Record<string, number>;
}

export const CHAT_MESSAGE_INITIAL = 80;
export const CHAT_MESSAGE_PAGE_SIZE = 50;

type TimelineEvent = {
  getId: () => string | undefined;
  getType: () => string;
  getSender: () => string | undefined;
  getTs: () => number;
  getContent: () => Record<string, unknown>;
};

function reactionKeyFromContent(content: Record<string, unknown>): string | null {
  const relates = content["m.relates_to"] as
    | { rel_type?: string; key?: string }
    | undefined;
  if (relates?.rel_type !== "m.annotation") return null;
  return typeof relates.key === "string" ? relates.key : null;
}

function reactionTargetFromContent(content: Record<string, unknown>): string | null {
  const relates = content["m.relates_to"] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  if (relates?.rel_type !== "m.annotation") return null;
  return typeof relates.event_id === "string" ? relates.event_id : null;
}

function replyTargetFromContent(content: Record<string, unknown>): string | undefined {
  const relates = content["m.relates_to"] as
    | { "m.in_reply_to"?: { event_id?: string } }
    | undefined;
  const eventId = relates?.["m.in_reply_to"]?.event_id;
  return typeof eventId === "string" ? eventId : undefined;
}

function buildReactionCounts(events: TimelineEvent[]): Map<string, Record<string, number>> {
  const counts = new Map<string, Record<string, number>>();
  for (const ev of events) {
    if (ev.getType() !== "m.reaction") continue;
    const content = ev.getContent();
    const targetId = reactionTargetFromContent(content);
    const key = reactionKeyFromContent(content);
    if (!targetId || !key) continue;
    const bucket = counts.get(targetId) ?? {};
    bucket[key] = (bucket[key] ?? 0) + 1;
    counts.set(targetId, bucket);
  }
  return counts;
}

function parseMessageEvents(client: MatrixClient, roomId: string): ChatMessage[] {
  const mxRoom = client.getRoom(roomId);
  if (!mxRoom) return [];

  const timelineEvents = mxRoom.getLiveTimeline().getEvents();
  const reactionCounts = buildReactionCounts(timelineEvents);

  return timelineEvents
    .filter((ev) => ev.getType() === "m.room.message")
    .map((ev) => {
      const content = ev.getContent();
      const id = ev.getId() ?? `${ev.getTs()}-${ev.getSender() ?? "?"}`;
      return {
        id,
        sender: ev.getSender() ?? "?",
        body: (content.body as string | undefined) ?? "",
        ts: ev.getTs(),
        replyToEventId: replyTargetFromContent(content),
        reactions: reactionCounts.get(id) ?? {},
      };
    })
    .filter((m) => m.body.length > 0)
    .sort((a, b) => a.ts - b.ts);
}

export function readRoomMessages(
  client: MatrixClient,
  roomId: string,
  options?: { limit?: number },
): ChatMessage[] {
  const all = parseMessageEvents(client, roomId);
  const limit = options?.limit ?? CHAT_MESSAGE_INITIAL;
  if (all.length <= limit) return all;
  return all.slice(-limit);
}

export function countRoomMessages(client: MatrixClient, roomId: string): number {
  return parseMessageEvents(client, roomId).length;
}

export function roomHasOlderTimeline(client: MatrixClient, roomId: string): boolean {
  const room = client.getRoom(roomId);
  if (!room) return false;
  const token = room.getLiveTimeline().getPaginationToken(Direction.Backward);
  return token != null;
}

export async function paginateOlderRoomMessages(client: MatrixClient, roomId: string): Promise<boolean> {
  const room = client.getRoom(roomId);
  if (!room) return false;
  const timeline = room.getLiveTimeline();
  const token = timeline.getPaginationToken(Direction.Backward);
  if (!token) return false;
  await client.paginateEventTimeline(timeline, {
    backwards: true,
    limit: CHAT_MESSAGE_PAGE_SIZE,
  });
  return true;
}

export function findMessageById(messages: ChatMessage[], eventId: string): ChatMessage | undefined {
  return messages.find((message) => message.id === eventId);
}
