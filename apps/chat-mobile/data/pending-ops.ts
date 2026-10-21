// Reads, reactions and poll votes that work offline (audit P2 "Realtime"; the
// read errors were swallowed). The cache shows the person's choice at once
// (lib/optimistic-message.ts); the wish is queued (stores/pending-ops-store.ts)
// and delivered in the order it was made, one at a time per workspace, now or
// when the network, the socket or the app comes back, with the outbox's
// 2/5/15/60 s backoff in between. The server's toggles are not idempotent, so
// a delivery that may already have landed (a lost answer, a restart) reads the
// message first and only taps what still differs; a read is idempotent as is.
// A refusal for good drops the wish and refetches the room, so the cache goes
// back to the server's truth; the reaction and vote callers reject then, for
// the screen to say so. Never a toast for a read: it is reported, not shown.
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { hasReaction, pollTapsToReach, toggledPollChoice, withPollChoice, withReaction } from "@/lib/optimistic-message";
import { isRetriableChatSendError } from "@/lib/send-pipeline";
import { applyChatMessageResponse } from "./chat-cache";
import { chatApi, type ChatApi } from "./chat-api";
import type { RoomTimeline } from "./chat-timeline";
import { chatKeys } from "./queries/chat-keys";
import { reportError } from "./report";
import { createRetryTimers, type RetryTimers } from "./retry-timers";
import { usePendingOpsStore, type PendingOp } from "./stores/pending-ops-store";

export interface PendingOpsDeps {
  api: Pick<ChatApi, "markRoomRead" | "toggleReaction" | "votePoll" | "getMessage">;
  isOnline: () => boolean;
  timers: RetryTimers;
}

export const pendingOpsDeps: PendingOpsDeps = { api: chatApi, isOnline: () => onlineManager.isOnline(), timers: createRetryTimers() };

/** The message as this phone has it: in the room's timeline or one of its loaded threads. */
function cachedMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string): ChatMessageRecord | undefined {
  const timelines = [
    qc.getQueryData<RoomTimeline>(chatKeys.roomMessages(wsId, roomId)),
    ...qc.getQueriesData<RoomTimeline>({ queryKey: chatKeys.roomThreads(wsId, roomId) }).map(([, data]) => data),
  ];
  for (const timeline of timelines) {
    for (const page of timeline?.pages ?? []) {
      const found = page.find((message) => message.id === messageId);
      if (found) return found;
    }
  }
  return undefined;
}

function clearUnread(qc: QueryClient, wsId: string, roomId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) => (room.id === roomId ? { ...room, unread_count: 0, mention_unread_count: 0 } : room)),
  );
}

const find = (key: string) => usePendingOpsStore.getState().ops.find((op) => op.key === key);
const sameChoice = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Errors the network or the session may fix; anything else is a refusal for good. */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return isRetriableChatSendError(error) || status === 401;
}

type Outcome = "done" | "transient" | "refused";

/** Delivered ops whose caller waits for a refusal to show: `<key>#<rev>`. */
const refused = new Set<string>();
// One delivery per thing at a time: a new wish for it meanwhile bumps its rev instead of starting another.
const inFlight = new Set<string>();

/** Writes the server's copy unless a newer wish for the same thing came in meanwhile. */
function applyIfCurrent(qc: QueryClient, op: PendingOp, record: ChatMessageRecord | null): void {
  if (find(op.key)?.rev === op.rev) applyChatMessageResponse(qc, op.workspaceId, op.roomId, record, false);
}

async function deliver(qc: QueryClient, op: PendingOp, deps: PendingOpsDeps): Promise<void> {
  const { workspaceId: wsId, roomId } = op;
  if (op.kind === "read") {
    if (await deps.api.markRoomRead(wsId, roomId)) clearUnread(qc, wsId, roomId);
    return;
  }
  // A vote is always read first (several taps may stand between the server and the wish).
  let record = op.verify ? await deps.api.getMessage(wsId, roomId, op.messageId) : null;
  if (op.verify && !record) {
    // Nothing usable to compare with: no blind toggle, the room shows the server's state.
    void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
    return;
  }
  if (op.kind === "reaction") {
    if (!record || hasReaction(record, op.emoji) !== op.on) record = await deps.api.toggleReaction(wsId, roomId, op.messageId, op.emoji);
  } else {
    const poll = record!.poll;
    for (const optionId of poll ? pollTapsToReach(poll.viewer_option_ids, op.optionIds, poll.settings.allow_multiple) : []) {
      record = await deps.api.votePoll(wsId, roomId, op.messageId, optionId);
    }
  }
  applyIfCurrent(qc, op, record);
}

async function attempt(qc: QueryClient, op: PendingOp, deps: PendingOpsDeps): Promise<Outcome> {
  inFlight.add(op.key);
  try {
    await deliver(qc, op, deps);
    const now = find(op.key);
    // A newer wish came in while this one was on the wire: it goes next, read-before-toggle.
    if (now && now.rev !== op.rev) usePendingOpsStore.getState().update(op.key, { verify: true });
    else usePendingOpsStore.getState().remove(op.key);
    return "done";
  } catch (error) {
    if (isTransient(error)) {
      usePendingOpsStore.getState().update(op.key, { verify: true });
      return "transient";
    }
    usePendingOpsStore.getState().remove(op.key);
    refused.add(`${op.key}#${op.rev}`);
    reportError(error, { source: "pending-op", tags: { kind: op.kind } });
    void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(op.workspaceId, op.roomId) });
    void qc.invalidateQueries({ queryKey: chatKeys.roomThreads(op.workspaceId, op.roomId) });
    return "refused";
  } finally {
    inFlight.delete(op.key);
  }
}

const lineKey = (wsId: string, userId: string) => `ops\n${wsId}\n${userId}`;
const oldest = (wsId: string, userId: string) =>
  usePendingOpsStore
    .getState()
    .ops.filter((op) => op.workspaceId === wsId && op.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt)[0];

const lines = new Map<string, Promise<void>>();

/** Deliver this person's queued reads, reactions and votes of one workspace, oldest first. */
export function flushPendingOps(qc: QueryClient, wsId: string, userId: string, deps: PendingOpsDeps): Promise<void> {
  const key = lineKey(wsId, userId);
  const running = lines.get(key);
  if (running) return running;
  const run = (async () => {
    // Registered below before the line reads anything (data/chat-send.ts › pumpRoom).
    await Promise.resolve();
    try {
      for (let op = oldest(wsId, userId); op; op = oldest(wsId, userId)) {
        if (!deps.isOnline()) return;
        const outcome = await attempt(qc, op, deps);
        if (outcome === "transient") {
          deps.timers.schedule(key, () => void flushPendingOps(qc, wsId, userId, deps));
          return;
        }
        deps.timers.reset(key);
      }
    } finally {
      lines.delete(key);
    }
  })();
  lines.set(key, run);
  return run;
}

/** Queues `op` (or, when it now asks for nothing, drops it) and delivers; rejects when the server refused it for good. */
async function enqueue(qc: QueryClient, op: PendingOp | null, dropKey: string, deps: PendingOpsDeps): Promise<void> {
  if (!op) {
    usePendingOpsStore.getState().remove(dropKey);
    return;
  }
  usePendingOpsStore.getState().put(op);
  await flushPendingOps(qc, op.workspaceId, op.userId, deps);
  if (refused.delete(`${op.key}#${op.rev}`)) throw new Error("chat_pending_op_refused");
}

/** Opening a room, reaching its newest message, or leaving it: the badge clears now, the server follows. */
export async function markRoomRead(qc: QueryClient, wsId: string, roomId: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  clearUnread(qc, wsId, roomId);
  const key = `read/${wsId}/${roomId}`;
  const rev = (find(key)?.rev ?? 0) + 1;
  // A refused read was reported by the line; the screen has nothing to say about it.
  await enqueue(qc, { kind: "read", key, workspaceId: wsId, roomId, userId, createdAt: Date.now(), rev, verify: false }, key, deps).catch(() => undefined);
}

/** One tap on a reaction: shown at once, delivered when it can be. */
export function toggleReaction(qc: QueryClient, wsId: string, roomId: string, messageId: string, emoji: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  const key = `reaction/${wsId}/${messageId}/${emoji}`;
  const existing = find(key);
  const record = cachedMessage(qc, wsId, roomId, messageId);
  const current = existing?.kind === "reaction" ? existing.on : record ? hasReaction(record, emoji) : false;
  const on = !current;
  const base = existing?.kind === "reaction" ? existing.base : current;
  if (record) applyChatMessageResponse(qc, wsId, roomId, withReaction(record, emoji, on), false);
  // Tapped back to what the server has, before anything went: nothing to send.
  const nothingToSend = existing !== undefined && on === base && !inFlight.has(key);
  const op: PendingOp | null = nothingToSend
    ? null
    : { kind: "reaction", key, workspaceId: wsId, roomId, userId, messageId, emoji, on, base, createdAt: existing?.createdAt ?? Date.now(), rev: (existing?.rev ?? 0) + 1, verify: existing?.verify ?? false };
  return enqueue(qc, op, key, deps);
}

/** One tap on a poll option: the choice shows at once, the server is brought to it when it can be. */
export async function votePoll(qc: QueryClient, wsId: string, roomId: string, messageId: string, optionId: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  const record = cachedMessage(qc, wsId, roomId, messageId);
  if (!record?.poll) {
    // Nothing on screen to show a choice on: the server answers now, as before.
    applyChatMessageResponse(qc, wsId, roomId, await deps.api.votePoll(wsId, roomId, messageId, optionId), false);
    return;
  }
  const key = `vote/${wsId}/${messageId}`;
  const existing = find(key);
  const choice = toggledPollChoice(record.poll, optionId);
  const base = existing?.kind === "vote" ? existing.base : record.poll.viewer_option_ids;
  applyChatMessageResponse(qc, wsId, roomId, withPollChoice(record, userId, choice), false);
  const nothingToSend = existing !== undefined && sameChoice(choice, base) && !inFlight.has(key);
  const op: PendingOp | null = nothingToSend
    ? null
    : { kind: "vote", key, workspaceId: wsId, roomId, userId, messageId, optionIds: choice, base, createdAt: existing?.createdAt ?? Date.now(), rev: (existing?.rev ?? 0) + 1, verify: true };
  return enqueue(qc, op, key, deps);
}

/** Sign-out: the queued wishes and their timers are the signed-in person's. */
export function clearPendingOps(deps: Pick<PendingOpsDeps, "timers">): void {
  usePendingOpsStore.getState().clear();
  deps.timers.cancelAll();
}
