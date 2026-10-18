// The messages this device is sending, for this app session. The web keeps a
// pending store plus an outbox persisted across reloads
// (packages/core/chat/{pending-messages-store,send-outbox-store}.ts); the
// spec asks the phone for an in-session retry, so one list whose entries
// carry their status is enough. data/chat-send.ts is the only writer.
import { create } from "zustand";
import type { PendingSend, SendStatus } from "@/lib/send-pipeline";

interface ChatSendState {
  entries: PendingSend[];
  upsert: (entry: PendingSend) => void;
  setStatus: (clientMsgId: string, status: SendStatus) => void;
  remove: (clientMsgId: string) => void;
  clear: () => void;
}

export const useChatSendStore = create<ChatSendState>((set) => ({
  entries: [],
  upsert: (entry) =>
    set((state) => ({ entries: [...state.entries.filter((item) => item.clientMsgId !== entry.clientMsgId), entry] })),
  setStatus: (clientMsgId, status) =>
    set((state) => ({
      entries: state.entries.map((entry) => (entry.clientMsgId === clientMsgId ? { ...entry, status } : entry)),
    })),
  remove: (clientMsgId) => set((state) => ({ entries: state.entries.filter((entry) => entry.clientMsgId !== clientMsgId) })),
  clear: () => set({ entries: [] }),
}));

/** One room's (or one thread's) sends, for the timeline merge. */
export function selectRoomSends(entries: readonly PendingSend[], workspaceId: string, roomId: string): PendingSend[] {
  return entries.filter((entry) => entry.workspaceId === workspaceId && entry.roomId === roomId);
}
