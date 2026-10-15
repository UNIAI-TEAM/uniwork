"use client";

import type { QueryClient } from "@tanstack/react-query";
import {
  fetchAndPatchChatMessage,
  patchChatMessageDeleted,
  patchChatMentionCreated,
  patchChatMessageLinked,
  patchChatThreadLinked,
} from "../chat/realtime-cache";
import { chatKeys } from "../chat/hooks";

const DEBOUNCE_MS = 250;
/** Spread the flush so every member online does not fetch in the same instant. */
const JITTER_MS = 250;
/** A sidebar reload costs queries per room: once per this long per tab, whatever the message rate. */
const ROOMS_REFRESH_MIN_MS = 5_000;
/** Spread held reloads so every member online does not reload on the same tick. */
const ROOMS_JITTER_MS = 2_000;

type PendingUpsert = { roomId: string; messageId: string; created: boolean; senderId?: string };
type PendingDelete = { roomId: string; messageId: string };
type PendingMention = { roomId: string; senderId: string };

/**
 * Debounced WS chat patches — fetch one message instead of refetching lists,
 * and only for rooms whose timeline is loaded (`fetchAndPatchChatMessage`).
 */
export function createChatRealtimePatchScheduler(qc: QueryClient, wsId: string) {
  const upserts = new Map<string, PendingUpsert>();
  const deletes = new Map<string, PendingDelete>();
  const mentions = new Map<string, PendingMention>();
  let roomsActivityPending = false;
  let lastRoomsRefresh = -Infinity;
  let roomsTimer: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushInFlight: Promise<void> | null = null;

  const flush = async () => {
    timer = null;
    const upsertBatch = [...upserts.values()];
    const deleteBatch = [...deletes.values()];
    const mentionBatch = [...mentions.values()];
    const refreshRooms = roomsActivityPending;
    upserts.clear();
    deletes.clear();
    mentions.clear();
    roomsActivityPending = false;

    for (const entry of deleteBatch) {
      patchChatMessageDeleted(qc, wsId, entry.roomId, entry.messageId);
    }
    for (const entry of mentionBatch) {
      patchChatMentionCreated(qc, wsId, entry.roomId, entry.senderId);
    }
    // allSettled: one message gone (404) must not drop the rest of the batch
    // or the sidebar refresh below.
    await Promise.allSettled(
      upsertBatch.map((entry) =>
        fetchAndPatchChatMessage(qc, wsId, entry.roomId, entry.messageId, entry.created, entry.senderId),
      ),
    );
    // After preview patches: server unread/mention counts win (avoids +1 then
    // refetch=1 racing into badge=2 when message.created + room.activity both fire).
    // cancelRefetch: false — a sidebar load already in flight answers this
    // frame too; aborting it would not stop the server from running it.
    if (refreshRooms) {
      lastRoomsRefresh = Date.now();
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) }, { cancelRefetch: false });
    }
  };

  const scheduleFlush = () => {
    if (timer != null) return;
    timer = setTimeout(() => {
      flushInFlight = flush().finally(() => {
        flushInFlight = null;
      });
    }, DEBOUNCE_MS + Math.random() * JITTER_MS);
  };

  return {
    scheduleUpsert(roomId: string, messageId: string, created = false, senderId?: string) {
      deletes.delete(messageId);
      const pending = upserts.get(messageId);
      upserts.set(messageId, {
        roomId,
        messageId,
        created: created || (pending?.created ?? false),
        senderId: senderId ?? pending?.senderId,
      });
      scheduleFlush();
    },
    scheduleDelete(roomId: string, messageId: string) {
      upserts.delete(messageId);
      deletes.set(messageId, { roomId, messageId });
      scheduleFlush();
    },
    scheduleMention(roomId: string, senderId: string) {
      mentions.set(`${roomId}:${senderId}`, { roomId, senderId });
      scheduleFlush();
    },
    scheduleRoomActivity() {
      if (roomsTimer != null || roomsActivityPending) return;
      const wait = lastRoomsRefresh + ROOMS_REFRESH_MIN_MS - Date.now();
      if (wait <= 0) {
        roomsActivityPending = true;
        scheduleFlush();
        return;
      }
      // Its own timer: upserts keep the short debounce while the sidebar waits.
      roomsTimer = setTimeout(() => {
        roomsTimer = null;
        roomsActivityPending = true;
        scheduleFlush();
      }, wait + Math.random() * ROOMS_JITTER_MS);
    },
    scheduleMessageLinked(roomId: string, messageId: string) {
      patchChatMessageLinked(qc, wsId, roomId, messageId);
    },
    scheduleThreadLinked(roomId: string, threadRootId: string) {
      patchChatThreadLinked(qc, wsId, roomId, threadRootId);
    },
    async dispose() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      if (roomsTimer != null) clearTimeout(roomsTimer);
      roomsTimer = null;
      if (flushInFlight) await flushInFlight;
      upserts.clear();
      deletes.clear();
      mentions.clear();
      roomsActivityPending = false;
    },
  };
}
