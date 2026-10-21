// The small commands the phone owes the server (audit P2 "Realtime"): a room
// read, a reaction, a poll vote, made offline or lost to a dead spot. Each
// carries the state the person wants, not the tap, so replaying it is
// idempotent (data/pending-ops.ts checks the server before it toggles), and
// one entry per thing (room, emoji, poll) keeps only the last wish. Persisted
// in the encrypted device store like the outbox; data/pending-ops.ts is the
// only writer, auth/store.ts hydrates it at boot and clears it on sign-out.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
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
  update: (key: string, patch: Partial<Pick<OpBase, "verify">>) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Entries read back from disk: the ones a delivery can use, each verified first (a restart may have cut one short). */
export function rehydratedOps(value: unknown): PendingOp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown): PendingOp[] => {
    if (!raw || typeof raw !== "object") return [];
    const op = raw as PendingOp;
    if (![op.key, op.workspaceId, op.roomId, op.userId].every(isString) || typeof op.createdAt !== "number") return [];
    const ok =
      op.kind === "read" ||
      (op.kind === "reaction" && isString(op.messageId) && isString(op.emoji) && typeof op.on === "boolean") ||
      (op.kind === "vote" && isString(op.messageId) && Array.isArray(op.optionIds));
    return ok ? [{ ...op, rev: 0, verify: op.kind !== "read" }] : [];
  });
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
      version: 1,
      // Written only after the boot read, as the outbox (stores/chat-send-store.ts).
      storage: createJSONStorage(() => ({
        ...deviceStateStorage,
        setItem: (name: string, value: string): Promise<void> | void => (usePendingOpsStore.persist.hasHydrated() ? deviceStateStorage.setItem(name, value) : undefined),
      })),
      skipHydration: true,
      partialize: (state) => ({ ops: state.ops }),
      merge: (persisted, current) => ({
        ...current,
        ops: [...rehydratedOps((persisted as { ops?: unknown } | undefined)?.ops), ...current.ops].filter(
          (op, index, all) => all.findIndex((other) => other.key === op.key) === index,
        ),
      }),
    },
  ),
);

export async function hydratePendingOpsStore(): Promise<void> {
  await usePendingOpsStore.persist.rehydrate();
}
