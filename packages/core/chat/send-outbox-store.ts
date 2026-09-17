"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ComposerMessagePriority } from "./composer-priority";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";

export const CHAT_SEND_OUTBOX_STORAGE_KEY = "uniwork_chat_send_outbox";

/** A queued send older than this is dropped, not delivered: a day-old message posted "now" misleads. */
export const CHAT_SEND_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

export type ChatSendOutboxEntry = {
  workspaceId: string;
  /**
   * The user who wrote the message. The outbox survives logout in a shared
   * browser, and the server's idempotency key is per sender — without this a
   * different user signing in would post the entry under their own name.
   */
  senderId: string;
  roomId: string;
  body: string;
  client_msg_id: string;
  reply_to_message_id?: string;
  priority?: ComposerMessagePriority;
  queued_at: string;
};

type ChatSendOutboxState = {
  entries: ChatSendOutboxEntry[];
  enqueue: (entry: ChatSendOutboxEntry) => void;
  remove: (clientMsgId: string) => void;
  /** Drop entries past the TTL and legacy entries that carry no sender. */
  pruneStale: (now?: number) => void;
  /** Deliverable entries: this workspace, this sender, within the TTL. */
  listForWorkspace: (workspaceId: string, senderId: string, now?: number) => ChatSendOutboxEntry[];
  countForWorkspace: (workspaceId: string, senderId: string, now?: number) => number;
};

function isLive(entry: Partial<ChatSendOutboxEntry>, now: number): entry is ChatSendOutboxEntry {
  if (typeof entry.senderId !== "string" || entry.senderId === "") return false;
  const queuedAt = Date.parse(entry.queued_at ?? "");
  return Number.isFinite(queuedAt) && now - queuedAt <= CHAT_SEND_OUTBOX_TTL_MS;
}

function deliverable(
  entries: ChatSendOutboxEntry[],
  workspaceId: string,
  senderId: string,
  now: number,
): ChatSendOutboxEntry[] {
  if (!senderId) return [];
  return entries.filter(
    (entry) =>
      entry.workspaceId === workspaceId && entry.senderId === senderId && isLive(entry, now),
  );
}

export const useChatSendOutboxStore = create<ChatSendOutboxState>()(
  persist(
    (set, get) => ({
      entries: [],
      enqueue: (entry) => {
        set((state) => {
          if (state.entries.some((item) => item.client_msg_id === entry.client_msg_id)) {
            return state;
          }
          return { entries: [...state.entries, entry] };
        });
      },
      remove: (clientMsgId) => {
        set((state) => ({
          entries: state.entries.filter((entry) => entry.client_msg_id !== clientMsgId),
        }));
      },
      pruneStale: (now = Date.now()) => {
        set((state) => {
          const live = state.entries.filter((entry) => isLive(entry, now));
          return live.length === state.entries.length ? state : { entries: live };
        });
      },
      listForWorkspace: (workspaceId, senderId, now = Date.now()) =>
        deliverable(get().entries, workspaceId, senderId, now),
      countForWorkspace: (workspaceId, senderId, now = Date.now()) =>
        deliverable(get().entries, workspaceId, senderId, now).length,
    }),
    {
      name: CHAT_SEND_OUTBOX_STORAGE_KEY,
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => {
        const raw = (persisted as { entries?: unknown } | undefined)?.entries;
        const now = Date.now();
        const entries = Array.isArray(raw)
          ? (raw as Partial<ChatSendOutboxEntry>[]).filter((entry) => isLive(entry, now))
          : [];
        return { ...current, entries };
      },
    },
  ),
);

registerForWorkspaceRehydration(() => void useChatSendOutboxStore.persist.rehydrate());

export function resetChatSendOutboxForTests(): void {
  useChatSendOutboxStore.setState({ entries: [] });
}
