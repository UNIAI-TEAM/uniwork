"use client";

import type { QueryClient } from "@tanstack/react-query";
import {
  fetchAndPatchChatMessage,
  patchChatMessageDeleted,
  patchChatMentionCreated,
} from "../chat/realtime-cache";
import { chatKeys } from "../chat/hooks";

const DEBOUNCE_MS = 250;

type PendingUpsert = { roomId: string; messageId: string };
type PendingDelete = { roomId: string; messageId: string };
type PendingMention = { roomId: string; senderId: string };

/** Debounced WS chat patches — fetch one message instead of refetching lists. */
export function createChatRealtimePatchScheduler(qc: QueryClient, wsId: string) {
  const upserts = new Map<string, PendingUpsert>();
  const deletes = new Map<string, PendingDelete>();
  const mentions = new Map<string, PendingMention>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushInFlight: Promise<void> | null = null;

  const flush = async () => {
    timer = null;
    const upsertBatch = [...upserts.values()];
    const deleteBatch = [...deletes.values()];
    const mentionBatch = [...mentions.values()];
    upserts.clear();
    deletes.clear();
    mentions.clear();

    for (const entry of deleteBatch) {
      patchChatMessageDeleted(qc, wsId, entry.roomId, entry.messageId);
    }
    for (const entry of mentionBatch) {
      patchChatMentionCreated(qc, wsId, entry.roomId, entry.senderId);
    }
    await Promise.all(
      upsertBatch.map((entry) =>
        fetchAndPatchChatMessage(qc, wsId, entry.roomId, entry.messageId),
      ),
    );
  };

  const scheduleFlush = () => {
    if (timer != null) return;
    timer = setTimeout(() => {
      flushInFlight = flush().finally(() => {
        flushInFlight = null;
      });
    }, DEBOUNCE_MS);
  };

  return {
    scheduleUpsert(roomId: string, messageId: string) {
      deletes.delete(messageId);
      upserts.set(messageId, { roomId, messageId });
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
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
    },
    async dispose() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      if (flushInFlight) await flushInFlight;
      upserts.clear();
      deletes.clear();
      mentions.clear();
    },
  };
}
