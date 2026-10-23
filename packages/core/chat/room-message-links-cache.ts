import type { QueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type { ChatMessageLinkRecord } from "../api/endpoints/chat-links";
import { chatKeys } from "./chat-keys";
import { groupLinksByMessageId } from "./message-links";

/** Matches the server batch cap for GET .../rooms/{id}/message-links. */
export const ROOM_MESSAGE_LINKS_BATCH = 200;

export type RoomMessageLinksCache = Map<string, ChatMessageLinkRecord[]>;

export function normalizeRoomLinkMessageIds(messageIds: readonly string[]): string[] {
  return [...new Set(messageIds)].sort();
}

export function messageIdsMissingFromCache(
  wantedIds: readonly string[],
  cache: RoomMessageLinksCache | undefined,
): string[] {
  if (!cache || cache.size === 0) return [...wantedIds];
  return wantedIds.filter((id) => !cache.has(id));
}

export function chunkMessageIds(ids: readonly string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize));
  }
  return batches;
}

/** After a batch fetch, every requested id is stored (empty list when it has no links). */
export function mergeBatchIntoRoomLinksCache(
  cache: RoomMessageLinksCache,
  fetchedMessageIds: readonly string[],
  flatLinks: readonly ChatMessageLinkRecord[],
): RoomMessageLinksCache {
  const grouped = groupLinksByMessageId([...flatLinks]);
  const next = new Map(cache);
  for (const id of fetchedMessageIds) {
    next.set(id, grouped.get(id) ?? []);
  }
  return next;
}

/** Subset for the timeline currently on screen. */
export function sliceRoomLinksCache(
  cache: RoomMessageLinksCache,
  visibleIds: readonly string[],
): RoomMessageLinksCache {
  const out = new Map<string, ChatMessageLinkRecord[]>();
  for (const id of visibleIds) {
    if (cache.has(id)) out.set(id, cache.get(id)!);
  }
  return out;
}

const inflightByRoom = new Map<string, Promise<void>>();

async function withRoomLinksFetchLock(roomInflightKey: string, run: () => Promise<void>): Promise<void> {
  const previous = inflightByRoom.get(roomInflightKey);
  if (previous) {
    await previous.catch(() => {});
  }
  const current = run().finally(() => {
    if (inflightByRoom.get(roomInflightKey) === current) {
      inflightByRoom.delete(roomInflightKey);
    }
  });
  inflightByRoom.set(roomInflightKey, current);
  await current;
}

export type ListChatRoomMessageLinks = (
  workspaceId: string,
  roomId: string,
  messageIds: string[],
) => Promise<ChatMessageLinkRecord[]>;

/**
 * Loads links for `messageIds`, fetching only ids not yet in the room cache.
 * Updates React Query under {@link chatKeys.roomMessageLinksRoom}.
 */
export async function ensureRoomMessageLinksLoaded(
  qc: QueryClient,
  input: {
    workspaceId: string;
    roomId: string;
    messageIds: readonly string[];
    listLinks?: ListChatRoomMessageLinks;
  },
): Promise<RoomMessageLinksCache> {
  const listLinks = input.listLinks ?? chat.listChatRoomMessageLinks;
  const roomKey = chatKeys.roomMessageLinksRoom(input.workspaceId, input.roomId);
  const wanted = normalizeRoomLinkMessageIds(input.messageIds);
  if (wanted.length === 0) return new Map();

  const inflightKey = `${input.workspaceId}:${input.roomId}`;

  await withRoomLinksFetchLock(inflightKey, async () => {
    let cache: RoomMessageLinksCache = new Map(qc.getQueryData<RoomMessageLinksCache>(roomKey) ?? []);
    let missing = messageIdsMissingFromCache(wanted, cache);
    while (missing.length > 0) {
      for (const batch of chunkMessageIds(missing, ROOM_MESSAGE_LINKS_BATCH)) {
        const flat = await listLinks(input.workspaceId, input.roomId, batch);
        cache = mergeBatchIntoRoomLinksCache(cache, batch, flat);
        qc.setQueryData(roomKey, cache);
      }
      missing = messageIdsMissingFromCache(wanted, cache);
    }
  });

  const cache = qc.getQueryData<RoomMessageLinksCache>(roomKey) ?? new Map();
  return sliceRoomLinksCache(cache, wanted);
}
