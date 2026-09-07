"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ComposerMessagePriority } from "./composer-priority";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";

export type ChatSendOutboxEntry = {
  workspaceId: string;
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
  listForWorkspace: (workspaceId: string) => ChatSendOutboxEntry[];
  countForWorkspace: (workspaceId: string) => number;
};

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
      listForWorkspace: (workspaceId) =>
        get().entries.filter((entry) => entry.workspaceId === workspaceId),
      countForWorkspace: (workspaceId) =>
        get().entries.filter((entry) => entry.workspaceId === workspaceId).length,
    }),
    {
      name: "uniwork_chat_send_outbox",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);

registerForWorkspaceRehydration(() => void useChatSendOutboxStore.persist.rehydrate());

export function resetChatSendOutboxForTests(): void {
  useChatSendOutboxStore.setState({ entries: [] });
}
