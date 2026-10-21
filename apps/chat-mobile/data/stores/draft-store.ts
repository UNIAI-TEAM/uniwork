// The drafts of the signed-in person (lib/drafts.ts): what they were writing
// in each room and thread, and the message it quotes, persisted in the
// encrypted device store like the outbox, so leaving a room or the app being
// killed keeps it. The composer reads its draft when it mounts and writes it
// back as the person types (debounced there); a send clears it. auth/store.ts
// hydrates it at boot and clears it on sign-out, as it does the outbox.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isEmptyDraft, readDrafts, type Draft, type DraftReply } from "@/lib/drafts";
import { migratePersisted, persistedField, type PersistedStep } from "@/lib/persisted-records";
import { deviceStateStorage } from "../storage/device-store";

interface DraftState {
  drafts: Record<string, Draft>;
  /** The composer's text; an empty text with no quote removes the draft. */
  setText: (key: string, text: string) => void;
  /** The message the draft quotes, or none. */
  setReply: (key: string, reply: DraftReply | null) => void;
  /** Sent: nothing left to keep. */
  clear: (key: string) => void;
  clearAll: () => void;
}

/** The drafts' persisted shape; a change to what a draft means bumps it with a step in DRAFT_STEPS. */
const DRAFT_VERSION = 1;
const DRAFT_STEPS: Record<number, PersistedStep> = {};

function put(drafts: Record<string, Draft>, key: string, next: Omit<Draft, "updatedAt">): Record<string, Draft> {
  const rest = { ...drafts };
  delete rest[key];
  return isEmptyDraft(next) ? rest : { ...rest, [key]: { ...next, updatedAt: Date.now() } };
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setText: (key, text) =>
        set((state) => {
          const current = state.drafts[key];
          if ((current?.text ?? "") === text) return state;
          return { drafts: put(state.drafts, key, { ...current, text }) };
        }),
      setReply: (key, reply) =>
        set((state) => {
          const current = state.drafts[key];
          if ((current?.reply?.id ?? null) === (reply?.id ?? null)) return state;
          return { drafts: put(state.drafts, key, { text: current?.text ?? "", ...(reply ? { reply } : {}) }) };
        }),
      clear: (key) =>
        set((state) => {
          if (!(key in state.drafts)) return state;
          const rest = { ...state.drafts };
          delete rest[key];
          return { drafts: rest };
        }),
      clearAll: () => set({ drafts: {} }),
    }),
    {
      name: "chat-drafts",
      version: DRAFT_VERSION,
      migrate: (state, version) => ({ drafts: readDrafts(persistedField(migratePersisted(state, version, DRAFT_VERSION, DRAFT_STEPS), "drafts"), Date.now()) }),
      // Written only after the boot read, as the outbox (stores/chat-send-store.ts).
      storage: createJSONStorage(() => ({
        ...deviceStateStorage,
        setItem: (name: string, value: string): Promise<void> | void => (useDraftStore.persist.hasHydrated() ? deviceStateStorage.setItem(name, value) : undefined),
      })),
      skipHydration: true,
      partialize: (state) => ({ drafts: state.drafts }),
      // A draft written before the read (none in practice) wins over the one on disk.
      merge: (persisted, current) => ({ ...current, drafts: { ...readDrafts(persistedField(persisted, "drafts"), Date.now()), ...current.drafts } }),
    },
  ),
);

export async function hydrateDraftStore(): Promise<void> {
  await useDraftStore.persist.rehydrate();
}

/** The draft of one composer, read once when it mounts. */
export function readDraft(key: string): Draft | undefined {
  return useDraftStore.getState().drafts[key];
}
