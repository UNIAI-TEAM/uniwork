// Reads, reactions, poll votes, edits and deletes that work offline (audit P2
// "Realtime"; the read errors were swallowed; "edit-delete-online-only"). The
// cache shows the person's choice at once (lib/optimistic-message.ts; a
// delete takes the message off the timeline); the wish is queued
// (stores/pending-ops-store.ts)
// and delivered in the order it was made, one at a time per workspace, now or
// when the network, the socket or the app comes back, with the outbox's
// 2/5/15/60 s backoff in between. The server's toggles are not idempotent, so
// a delivery that may already have landed (a lost answer, a restart) reads the
// message first and only taps what still differs; a read, an edit (the whole
// body, PATCHed) and a delete (a message already gone is a delete done) are
// idempotent as they are.
// A refusal for good drops the wish and refetches the room, so the cache goes
// back to the server's truth; the reaction and vote callers reject then, for
// the screen to say so. Never a toast for a read: it is reported, not shown.
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { hasReaction, pollTapsToReach, toggledPollChoice, withEdit, withPollChoice, withReaction } from "@/lib/optimistic-message";
import { isRetriableChatSendError } from "@/lib/send-pipeline";
import { applyChatMessageResponse, patchChatMessageDeleted } from "./chat-cache";
import { chatApi, type ChatApi } from "./chat-api";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { chatKeys } from "./queries/chat-keys";
import { RefusedError, bestEffort, reportError } from "./report";
import { createRetryTimers, type RetryTimers } from "./retry-timers";
import { roomWasRead } from "./room-read-signal";
import { usePendingOpsStore, type PendingOp } from "./stores/pending-ops-store";

export interface PendingOpsDeps {
  api: Pick<ChatApi, "markRoomRead" | "toggleReaction" | "votePoll" | "getMessage" | "editMessage" | "deleteMessage">;
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

/** Writes the server's copy unless a newer wish for the same thing came in meanwhile. */
function applyIfCurrent(qc: QueryClient, op: PendingOp, record: ChatMessageRecord | null): void {
  if (find(op.key)?.rev === op.rev) applyChatMessageResponse(qc, op.workspaceId, op.roomId, record, false);
}

const isGone = (error: unknown) => (error as { status?: unknown } | null)?.status === 404;

/** An edit or a delete: idempotent, so delivered as is; a message already gone is a delete done and an edit moot. */
async function deliverChange(qc: QueryClient, op: PendingOp & { kind: "edit" | "delete" }, deps: PendingOpsDeps): Promise<void> {
  const { workspaceId: wsId, roomId } = op;
  try {
    if (op.kind === "edit") applyIfCurrent(qc, op, await deps.api.editMessage(wsId, roomId, op.messageId, op.body));
    else if (!(await deps.api.deleteMessage(wsId, roomId, op.messageId))) throw new Error("chat_message_delete_failed");
  } catch (error) {
    if (!isGone(error)) throw error;
    // Deleted meanwhile (here or elsewhere): the room shows the server's state.
    void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
  }
  // The list's preview may be this message.
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

async function deliver(qc: QueryClient, op: PendingOp, deps: PendingOpsDeps): Promise<void> {
  const { workspaceId: wsId, roomId } = op;
  if (op.kind === "read") {
    if (await deps.api.markRoomRead(wsId, roomId)) clearUnread(qc, wsId, roomId);
    return;
  }
  if (op.kind === "edit" || op.kind === "delete") return deliverChange(qc, op, deps);
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
  // From here the server may have it, whatever the answer: tapping back can no longer be dropped locally.
  usePendingOpsStore.getState().update(op.key, { attempted: true });
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

/** Every workspace this person owes reads, reactions or votes in, whichever one is open (or none). */
export function flushAllPendingOps(qc: QueryClient, userId: string, deps: PendingOpsDeps): Promise<void> {
  const workspaceIds = new Set(
    usePendingOpsStore
      .getState()
      .ops.filter((op) => op.userId === userId)
      .map((op) => op.workspaceId),
  );
  return Promise.all([...workspaceIds].map((wsId) => flushPendingOps(qc, wsId, userId, deps))).then(() => undefined);
}

/** Queues `op` (or, when it now asks for nothing, drops it) and delivers; rejects when the server refused it for good. */
async function enqueue(qc: QueryClient, op: PendingOp | null, dropKey: string, deps: PendingOpsDeps): Promise<void> {
  if (!op) {
    usePendingOpsStore.getState().remove(dropKey);
    return;
  }
  usePendingOpsStore.getState().put(op);
  await flushPendingOps(qc, op.workspaceId, op.userId, deps);
  if (refused.delete(`${op.key}#${op.rev}`)) throw new RefusedError("chat_pending_op_refused");
}

/** Opening a room, reaching its newest message, or leaving it: the badge clears now, the server follows. */
export async function markRoomRead(qc: QueryClient, wsId: string, roomId: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  clearUnread(qc, wsId, roomId);
  // Its notifications come down with the badge (data/notification-tray.ts).
  roomWasRead(roomId);
  const key = `read/${wsId}/${roomId}`;
  const rev = (find(key)?.rev ?? 0) + 1;
  // A refused read was reported by the line; the screen has nothing to say about it.
  await enqueue(qc, { kind: "read", key, workspaceId: wsId, roomId, userId, createdAt: Date.now(), rev, verify: false }, key, deps).catch(
    bestEffort("pending-op", "read refused", "breadcrumb"),
  );
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
  // Tapped back to what the server has, before any delivery was tried: nothing to send. Once one was
  // (it may have landed: a 503 after commit, a lost answer, a restart), the wish stays and is verified.
  const nothingToSend = existing !== undefined && !existing.attempted && on === base;
  const op: PendingOp | null = nothingToSend
    ? null
    : {
        kind: "reaction",
        key,
        workspaceId: wsId,
        roomId,
        userId,
        messageId,
        emoji,
        on,
        base,
        createdAt: existing?.createdAt ?? Date.now(),
        rev: (existing?.rev ?? 0) + 1,
        verify: existing?.verify ?? false,
        attempted: existing?.attempted ?? false,
      };
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
  // As for reactions: only a wish no delivery was tried for may be dropped (some taps may have landed).
  const nothingToSend = existing !== undefined && !existing.attempted && sameChoice(choice, base);
  const op: PendingOp | null = nothingToSend
    ? null
    : {
        kind: "vote",
        key,
        workspaceId: wsId,
        roomId,
        userId,
        messageId,
        optionIds: choice,
        base,
        createdAt: existing?.createdAt ?? Date.now(),
        rev: (existing?.rev ?? 0) + 1,
        verify: true,
        attempted: existing?.attempted ?? false,
      };
  return enqueue(qc, op, key, deps);
}

/**
 * An edit of one's own message: the new body shows at once (an unsent edit
 * shows as edited, offline too) and the server gets it when it can; the last
 * edit wins. Rejects when the server refused it for good (the room refetches).
 */
export function editMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string, body: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  const key = `edit/${wsId}/${messageId}`;
  const existing = find(key);
  const record = cachedMessage(qc, wsId, roomId, messageId);
  if (record) applyChatMessageResponse(qc, wsId, roomId, withEdit(record, body, new Date().toISOString()), false);
  const op: PendingOp = { kind: "edit", key, workspaceId: wsId, roomId, userId, messageId, body, createdAt: existing?.createdAt ?? Date.now(), rev: (existing?.rev ?? 0) + 1, verify: false };
  return enqueue(qc, op, key, deps);
}

/**
 * A delete: the message leaves the timeline at once, and every wish still
 * queued for it (an edit, a reaction, a vote) goes with it — the server will
 * not take them for a message it no longer has. Rejects when the server
 * refused for good (the room refetches and the message comes back).
 */
export function deleteMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string, userId: string, deps: PendingOpsDeps = pendingOpsDeps): Promise<void> {
  const key = `delete/${wsId}/${messageId}`;
  for (const op of usePendingOpsStore.getState().ops) {
    if (op.workspaceId === wsId && "messageId" in op && op.messageId === messageId && op.key !== key) usePendingOpsStore.getState().remove(op.key);
  }
  patchChatMessageDeleted(qc, wsId, roomId, messageId);
  const existing = find(key);
  const op: PendingOp = { kind: "delete", key, workspaceId: wsId, roomId, userId, messageId, createdAt: existing?.createdAt ?? Date.now(), rev: (existing?.rev ?? 0) + 1, verify: false };
  return enqueue(qc, op, key, deps);
}

/** Sign-out: the queued wishes and their timers are the signed-in person's. */
export function clearPendingOps(deps: Pick<PendingOpsDeps, "timers">): void {
  usePendingOpsStore.getState().clear();
  deps.timers.cancelAll();
}
