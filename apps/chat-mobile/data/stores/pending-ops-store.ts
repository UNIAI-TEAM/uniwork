// The small commands the phone owes the server (audit P2 "Realtime"): a room
// read, a reaction, a poll vote, made offline or lost to a dead spot. Each
// carries the state the person wants, not the tap, so replaying it is
// idempotent (data/pending-ops.ts checks the server before it toggles), and
// one entry per thing (room, emoji, poll) keeps only the last wish. Persisted
// in the encrypted device store like the outbox; data/pending-ops.ts is the
// only writer, auth/store.ts hydrates it at boot and clears it on sign-out.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PendingOpSchema, migratePersisted, persistedField, readPersistedList, type PersistedStep } from "@/lib/persisted-records";
import { deviceStateStorage } from "../storage/device-store";

interface OpBase {
  /** One entry per thing: `read/<ws>/<room>`, `reaction/<ws>/<message>/<emoji>`, `vote/<ws>/<message>`. */
  key: string;
  workspaceId: string;
  roomId: string;
  userId: string;
  createdAt: number;
  /** Bumped by each new wish; a delivery finishes an entry only if it is still the one it sent. */
  rev: number;
  /** The last delivery may or may not have reached the server: read its state before toggling. */
  verify: boolean;
  /**
   * A delivery of this wish was tried, so the server may no longer be at
   * `base`: tapping back to `base` must still be delivered (read, then tap
   * what differs). Set before every attempt and on every entry read back.
   */
  attempted?: boolean;
}

export type PendingOp = OpBase &
  (
    | { kind: "read" }
    | { kind: "reaction"; messageId: string; emoji: string; on: boolean; base: boolean }
    | { kind: "vote"; messageId: string; optionIds: string[]; base: string[] }
  );

interface PendingOpsState {
  ops: PendingOp[];
  put: (op: PendingOp) => void;
  update: (key: string, patch: Partial<Pick<OpBase, "verify" | "attempted">>) => void;
  remove: (key: string) => void;
  clear: () => void;
}

/** The queue's persisted shape; a change to what an entry means bumps it with a step in OPS_STEPS. */
const OPS_VERSION = 1;
const OPS_STEPS: Record<number, PersistedStep> = {};

/** Entries read back from disk: each one whole (lib/persisted-records.ts), each verified first (a restart may have cut one short). */
export function rehydratedOps(value: unknown): PendingOp[] {
  // A restart may have cut a delivery short whose request landed: every reaction and vote counts as tried.
  return readPersistedList(PendingOpSchema, value).map((op): PendingOp => ({ ...op, rev: 0, verify: op.kind !== "read", attempted: op.kind !== "read" }));
}

export const usePendingOpsStore = create<PendingOpsState>()(
  persist(
    (set) => ({
      ops: [],
      put: (op) => set((state) => ({ ops: [...state.ops.filter((item) => item.key !== op.key), op] })),
      update: (key, patch) => set((state) => ({ ops: state.ops.map((op) => (op.key === key ? { ...op, ...patch } : op)) })),
      remove: (key) => set((state) => ({ ops: state.ops.filter((op) => op.key !== key) })),
      clear: () => set({ ops: [] }),
    }),
    {
      name: "chat-pending-ops",
      version: OPS_VERSION,
      migrate: (state, version) => ({ ops: rehydratedOps(persistedField(migratePersisted(state, version, OPS_VERSION, OPS_STEPS), "ops")) }),
      // Written only after the boot read, as the outbox (stores/chat-send-store.ts).
      storage: createJSONStorage(() => ({
        ...deviceStateStorage,
        setItem: (name: string, value: string): Promise<void> | void => (usePendingOpsStore.persist.hasHydrated() ? deviceStateStorage.setItem(name, value) : undefined),
      })),
      skipHydration: true,
      partialize: (state) => ({ ops: state.ops }),
      merge: (persisted, current) => ({
        ...current,
        ops: [...rehydratedOps(persistedField(persisted, "ops")), ...current.ops].filter(
          (op, index, all) => all.findIndex((other) => other.key === op.key) === index,
        ),
      }),
    },
  ),
);

export async function hydratePendingOpsStore(): Promise<void> {
  await usePendingOpsStore.persist.rehydrate();
}
