"use client";

import { create } from "zustand";
import type { ComposerMessagePriority } from "./composer-priority";

export type PendingChatDeliveryStatus = "sending" | "queued";

export type PendingChatMessage = {
  workspaceId: string;
  roomId: string;
  client_msg_id: string;
  body: string;
  senderId: string;
  createdAt: number;
  reply_to_message_id?: string;
  /** When set, the optimistic bubble belongs in a thread panel, not the main timeline. */
  thread_root_id?: string;
  priority?: ComposerMessagePriority;
  status: PendingChatDeliveryStatus;
};

type PendingChatMessagesState = {
  entries: PendingChatMessage[];
  upsert: (entry: PendingChatMessage) => void;
  remove: (clientMsgId: string) => void;
  listForRoom: (workspaceId: string, roomId: string) => PendingChatMessage[];
};

export const usePendingChatMessagesStore = create<PendingChatMessagesState>((set, get) => ({
  entries: [],
  upsert: (entry) => {
    set((state) => {
      const without = state.entries.filter((item) => item.client_msg_id !== entry.client_msg_id);
      return { entries: [...without, entry] };
    });
  },
  remove: (clientMsgId) => {
    set((state) => ({
      entries: state.entries.filter((entry) => entry.client_msg_id !== clientMsgId),
    }));
  },
  listForRoom: (workspaceId, roomId) =>
    get().entries.filter(
      (entry) => entry.workspaceId === workspaceId && entry.roomId === roomId,
    ),
}));

export function resetPendingChatMessagesForTests(): void {
  usePendingChatMessagesStore.setState({ entries: [] });
}
