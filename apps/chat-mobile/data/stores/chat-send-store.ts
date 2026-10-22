// The messages this device is sending: one list whose entries carry
// their status, persisted in the encrypted device store (data/storage/
// device-store.ts), so a message the person sent survives the app being
// killed, the phone restarting or the OS reclaiming it. The web keeps a
// pending store plus an outbox persisted across reloads
// (packages/core/chat/{pending-messages-store,send-outbox-store}.ts); the
// client_msg_id each entry carries makes a replay after a restart safe. A
// message that was on the wire when the process died is "queued" again on
// the next start: the server deduplicates whichever of the two posts lands.
// data/chat-send.ts is the only writer; auth/store.ts hydrates it at boot.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PendingSendSchema, migratePersisted, persistedField, readPersistedList, type PersistedStep } from "@/lib/persisted-records";
import type { PendingSend, SendStatus } from "@/lib/send-pipeline";
import { deviceStateStorage } from "../storage/device-store";

interface ChatSendState {
  entries: PendingSend[];
  upsert: (entry: PendingSend) => void;
  setStatus: (clientMsgId: string, status: SendStatus) => void;
  /** Points a queued entry at its outbox copy (data/outbox-files.ts); a removed entry stays removed. */
  setFile: (clientMsgId: string, file: NonNullable<PendingSend["file"]>) => void;
  remove: (clientMsgId: string) => void;
  clear: () => void;
}

/** The outbox's persisted shape; a change to what an entry means bumps it with a step in OUTBOX_STEPS. */
const OUTBOX_VERSION = 1;
const OUTBOX_STEPS: Record<number, PersistedStep> = {};

/** Entries read back from disk: each one whole (lib/persisted-records.ts), and never "sending" (nothing is on the wire after a restart). */
export function rehydratedEntries(value: unknown): PendingSend[] {
  return readPersistedList(PendingSendSchema, value).map(
    (entry): PendingSend => (entry.status === "sending" ? { ...entry, status: "queued" } : entry),
  );
}

export const useChatSendStore = create<ChatSendState>()(
  persist(
    (set) => ({
      entries: [],
      upsert: (entry) => set((state) => ({ entries: [...state.entries.filter((item) => item.clientMsgId !== entry.clientMsgId), entry] })),
      setStatus: (clientMsgId, status) =>
        set((state) => ({
          entries: state.entries.map((entry) => (entry.clientMsgId === clientMsgId ? { ...entry, status } : entry)),
        })),
      setFile: (clientMsgId, file) =>
        set((state) => ({
          entries: state.entries.map((entry) => (entry.clientMsgId === clientMsgId ? { ...entry, file } : entry)),
        })),
      remove: (clientMsgId) => set((state) => ({ entries: state.entries.filter((entry) => entry.clientMsgId !== clientMsgId) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: "chat-send-outbox",
      version: OUTBOX_VERSION,
      migrate: (state, version) => ({
        entries: rehydratedEntries(persistedField(migratePersisted(state, version, OUTBOX_VERSION, OUTBOX_STEPS), "entries")),
      }),
      // A write before the boot read would replace the queue on disk with an empty one: dropped until then.
      storage: createJSONStorage(() => ({
        ...deviceStateStorage,
        setItem: (name: string, value: string): Promise<void> | void =>
          useChatSendStore.persist.hasHydrated() ? deviceStateStorage.setItem(name, value) : undefined,
      })),
      // Read once at boot (data/auth/store.ts › initialize), never by import: nothing is sent before it.
      skipHydration: true,
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => ({
        ...current,
        // An entry added before the read (none in practice) stays, after the ones from disk.
        entries: [...rehydratedEntries(persistedField(persisted, "entries")), ...current.entries].filter(
          (entry, index, all) => all.findIndex((other) => other.clientMsgId === entry.clientMsgId) === index,
        ),
      }),
    },
  ),
);

/** Boot: the unsent messages of the last run, back on screen and in line to go. */
export async function hydrateChatSendStore(): Promise<void> {
  await useChatSendStore.persist.rehydrate();
}

/** One room's (or one thread's) sends by the signed-in person, for the timeline merge; nobody else's are theirs to see or retry. */
export function selectRoomSends(entries: readonly PendingSend[], workspaceId: string, roomId: string, senderId: string): PendingSend[] {
  return entries.filter((entry) => entry.workspaceId === workspaceId && entry.roomId === roomId && entry.senderId === senderId);
}

/** The rooms of a workspace with a message of this sender waiting for the network: their rows say so. */
export function selectQueuedRoomIds(entries: readonly PendingSend[], workspaceId: string, senderId: string): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.status === "queued" && entry.workspaceId === workspaceId && entry.senderId === senderId)
      .map((entry) => entry.roomId),
  );
}
