// What the device store hands back is untrusted: another build wrote it (an
// older store version, an OTA that has since rolled back), or a crash cut a
// write short. Every record a queue reads back passes these schemas first,
// nested fields included, so nothing that reaches a send, a delivery or a
// render was cast from disk. One bad entry is dropped alone; the rest of the
// queue survives. Pure: the stores (data/stores/*) call it from their merge.
import { z } from "zod";

const id = z.string().min(1);
const finite = z.number().finite();

const PendingFileSchema = z.object({
  uri: id,
  name: z.string(),
  mimeType: z.string().optional(),
  size: finite.nonnegative().optional(),
});

// packages/core/chat/reminder-utils.ts › ReminderRepeat.
const ReminderSchema = z.object({
  body: z.string(),
  remindAt: id,
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
});

/** lib/send-pipeline.ts › PendingSend, as the outbox (data/stores/chat-send-store.ts) writes it. */
export const PendingSendSchema = z
  .object({
    workspaceId: id,
    roomId: id,
    senderId: id,
    clientMsgId: id,
    body: z.string(),
    replyToMessageId: id.optional(),
    threadRootId: id.optional(),
    file: PendingFileSchema.optional(),
    voiceDurationMs: finite.nonnegative().optional(),
    reminder: ReminderSchema.optional(),
    createdAt: finite,
    status: z.enum(["queued", "sending", "failed"]),
  })
  // A voice message is its clip: without the file there is nothing to send.
  .refine((entry) => entry.voiceDurationMs === undefined || entry.file !== undefined, { message: "voice without its clip" });

const OpBaseSchema = z.object({
  key: id,
  workspaceId: id,
  roomId: id,
  userId: id,
  createdAt: finite,
});

/** data/stores/pending-ops-store.ts › PendingOp, without the delivery bookkeeping a restart resets. */
export const PendingOpSchema = z.discriminatedUnion("kind", [
  OpBaseSchema.extend({ kind: z.literal("read") }),
  OpBaseSchema.extend({ kind: z.literal("reaction"), messageId: id, emoji: id, on: z.boolean(), base: z.boolean() }),
  OpBaseSchema.extend({ kind: z.literal("vote"), messageId: id, optionIds: z.array(id), base: z.array(id) }),
]);

/** The entries of a persisted list that read under `schema`; anything else, including a non-list, is none. */
export function readPersistedList<S extends z.ZodType>(schema: S, value: unknown): Array<z.output<S>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

/** One step that rewrites a store's persisted state from version `n` to `n + 1`. */
export type PersistedStep = (state: unknown) => unknown;

/**
 * zustand's `migrate` for a store at `current`: a state written at an older
 * version runs every step from its version up, in order. One written by a
 * newer build (an OTA rolled back past it) is passed on as it is, never
 * discarded: the store's merge reads what it can through its schema, which is
 * what keeps a rollback from losing unsent messages. zustand without a
 * `migrate` would drop the whole state on any version change.
 */
export function migratePersisted(state: unknown, from: number, current: number, steps: Readonly<Record<number, PersistedStep>>): unknown {
  let next = state;
  for (let version = from; version < current; version += 1) {
    const step = steps[version];
    if (step) next = step(next);
  }
  return next;
}

/** One field of a persisted state read as unknown, without trusting its shape. */
export function persistedField(state: unknown, key: string): unknown {
  return state !== null && typeof state === "object" ? Reflect.get(state, key) : undefined;
}
