// The messages the signed-in person reported (lib/reported-messages.ts), hidden from them as soon as the report
// is sent: a conversation shows "You reported this message" in its place, with a way to see it once (components/
// chat/reported-message-row.tsx). Kept in the encrypted device store like the drafts, so the message stays hidden
// after a restart; auth/store.ts hydrates it at boot and clears it on sign-out. A revealed message is shown for
// this run only.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { migratePersisted, persistedField, type PersistedStep } from "@/lib/persisted-records";
import { readReportedMessages, rememberReported } from "@/lib/reported-messages";
import { deviceStateStorage } from "../storage/device-store";

interface ReportedMessagesState {
  /** message id → when it was reported (ms). */
  reported: Record<string, number>;
  /** Messages the person chose to see again this run. */
  revealed: Record<string, true>;
  hide: (messageId: string, at?: number) => void;
  reveal: (messageId: string) => void;
  clearAll: () => void;
}

/** The kept shape; a change to what an entry means bumps it with a step in STEPS. */
const VERSION = 1;
const STEPS: Record<number, PersistedStep> = {};

export const useReportedMessagesStore = create<ReportedMessagesState>()(
  persist(
    (set) => ({
      reported: {},
      revealed: {},
      hide: (messageId, at = Date.now()) =>
        set((state) => {
          const revealed = { ...state.revealed };
          delete revealed[messageId];
          return { reported: rememberReported(state.reported, messageId, at), revealed };
        }),
      reveal: (messageId) => set((state) => ({ revealed: { ...state.revealed, [messageId]: true } })),
      clearAll: () => set({ reported: {}, revealed: {} }),
    }),
    {
      name: "chat-reported-messages",
      version: VERSION,
      migrate: (state, version) => ({ reported: readReportedMessages(persistedField(migratePersisted(state, version, VERSION, STEPS), "reported")) }),
      // Written only after the boot read, as the drafts (stores/draft-store.ts).
      storage: createJSONStorage(() => ({
        ...deviceStateStorage,
        setItem: (name: string, value: string): Promise<void> | void =>
          useReportedMessagesStore.persist.hasHydrated() ? deviceStateStorage.setItem(name, value) : undefined,
      })),
      skipHydration: true,
      partialize: (state) => ({ reported: state.reported }),
      // A report made before the read wins over the record on disk.
      merge: (persisted, current) => ({
        ...current,
        reported: { ...readReportedMessages(persistedField(persisted, "reported")), ...current.reported },
      }),
    },
  ),
);

export async function hydrateReportedMessagesStore(): Promise<void> {
  await useReportedMessagesStore.persist.rehydrate();
}
