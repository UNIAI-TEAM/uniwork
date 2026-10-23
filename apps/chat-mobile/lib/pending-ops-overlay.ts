// The person's queued reactions, votes, edits and deletes laid over the
// server's copy of a timeline each time it is drawn, the way the outbox's
// sends are (lib/send-pipeline.ts). data/pending-ops.ts also writes each wish
// into the cache once, but a refetch that lands before the wish is delivered
// (the network-back edge refetches the room while the queue is still in its
// backoff) would put the server's older copy back on screen: a deleted
// message reappearing, an edit showing its old body, for as long as a minute.
// Laid over at render instead, a wish shows until it leaves the queue, as
// Linear's sync engine and WhatsApp rebase server snapshots on pending
// mutations. Rows without a wish keep their object, so their rows do not
// redraw (lib/timeline-display.ts).
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { withEdit, withPollChoice, withReaction } from "./optimistic-message";

/** The slice of a queued wish (data/stores/pending-ops-store.ts › PendingOp) the overlay reads. */
export type OverlayOp =
  | { kind: "read" }
  | { kind: "reaction"; messageId: string; emoji: string; on: boolean }
  | { kind: "vote"; messageId: string; optionIds: readonly string[] }
  | { kind: "edit"; messageId: string; body: string; createdAt: number }
  | { kind: "delete"; messageId: string };

type MessageOp = Exclude<OverlayOp, { kind: "read" }>;

function signature(op: MessageOp): string {
  switch (op.kind) {
    case "reaction":
      return `r:${op.emoji}:${op.on}`;
    case "vote":
      return `v:${op.optionIds.join(",")}`;
    case "edit":
      return `e:${op.createdAt}:${op.body}`;
    case "delete":
      return "d";
  }
}

/** One message with its wishes on it; null when one of them deletes it. */
function applied(record: ChatMessageRecord, ops: readonly MessageOp[]): ChatMessageRecord | null {
  let next = record;
  for (const op of ops) {
    if (op.kind === "delete") return null;
    if (op.kind === "reaction") next = withReaction(next, op.emoji, op.on);
    else if (op.kind === "vote") next = withPollChoice(next, op.optionIds);
    else next = withEdit(next, op.body, new Date(op.createdAt).toISOString());
  }
  return next;
}

// The same record under the same wishes gives back the same object, render after render.
const memo = new WeakMap<ChatMessageRecord, { key: string; out: ChatMessageRecord | null }>();

/**
 * `records` with the viewer's wishes for them applied; the same array when
 * none applies. `ops` are one room's (data/stores/pending-ops-store.ts ›
 * selectRoomOps), oldest first.
 */
export function overlayPendingOps(records: ChatMessageRecord[], ops: readonly OverlayOp[], viewerId: string): ChatMessageRecord[] {
  const byMessage = new Map<string, MessageOp[]>();
  for (const op of ops) {
    if (op.kind === "read") continue;
    const list = byMessage.get(op.messageId) ?? [];
    list.push(op);
    byMessage.set(op.messageId, list);
  }
  if (byMessage.size === 0 || !records.some((record) => byMessage.has(record.id))) return records;
  return records.flatMap((record) => {
    const mine = byMessage.get(record.id);
    if (!mine) return [record];
    const key = `${viewerId}\n${mine.map(signature).join("\n")}`;
    const cached = memo.get(record);
    const out = cached?.key === key ? cached.out : applied(record, mine);
    memo.set(record, { key, out });
    return out ? [out] : [];
  });
}
