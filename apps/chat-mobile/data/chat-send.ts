// Sending a chat message from the phone, mirroring the web's send path
// (packages/core/chat/{deliver-chat-text-message,send-retry}.ts and
// use-chat-send-outbox-flush.ts): every send carries a client_msg_id the
// server deduplicates on, so a retry after a lost answer cannot post twice.
//
// Every send goes through the outbox (audit R1–R3): text, a photo or a
// document, a voice clip and a reminder are written to the persisted queue
// (stores/chat-send-store.ts) first, with their file copied out of the cache
// (outbox-files.ts), and leave it only once the server answered. A room has
// two lines, each strictly in the order it was written and one at a time:
// text (text, thread replies, reminders) and media (photos, files, clips).
// Text written after a photo waits for it, so the room reads as it was
// written, unless that upload has been on the wire MEDIA_OVERTAKE_MS or waits
// for a retry: then the words go and the photo lands when it lands, as on
// Telegram and WhatsApp, instead of a slow upload holding every word behind
// it. A transient failure stops that line and retries it on its own jittered
// 2/5/15/60 s backoff (retry-timers.ts, keyed by line), at once on a network edge, a socket
// reconnect or a return to the app, for every workspace this person has
// messages waiting in (owed.ts). A refusal for good stays "failed" until the
// person retries or discards it; the room's next messages go on without it.
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { isPermanentChatSendRefusal, runWithChatSendRetry, type PendingFile, type PendingSend } from "@/lib/send-pipeline";
import { applyChatMessageResponse } from "./chat-cache";
import { chatApi, type ChatApi } from "./chat-api";
import { outboxFiles, type OutboxFiles } from "./outbox-files";
import { createRetryTimers, type RetryTimers } from "./retry-timers";
import { useChatSendStore } from "./stores/chat-send-store";

export interface ChatSendDeps {
  api: Pick<ChatApi, "sendMessage" | "sendThreadMessage" | "sendFileMessage" | "sendVoiceMessage">;
  isOnline: () => boolean;
  retry?: typeof runWithChatSendRetry;
  files: OutboxFiles;
  timers: RetryTimers;
  /** The clock and the wait of the text line behind an upload; the real ones by default. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Text may pass an earlier photo, file or clip whose upload has been on the wire this long. */
export const MEDIA_OVERTAKE_MS = 4_000;
/** A message the server refused for good, kept this long for the person to retry or discard, then dropped with its file. */
export const FAILED_SEND_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The app's wiring: the chat API, TanStack's online flag (NetInfo, data/query-client.ts), the outbox directory. */
export const chatSendDeps: ChatSendDeps = {
  api: chatApi,
  isOnline: () => onlineManager.isOnline(),
  files: outboxFiles,
  timers: createRetryTimers(),
};

export interface ChatSendInput {
  workspaceId: string;
  roomId: string;
  senderId: string;
  body: string;
  replyToMessageId?: string;
  threadRootId?: string;
  file?: PendingFile;
  voiceDurationMs?: number;
  reminder?: PendingSend["reminder"];
}

/** The server's bounds on a clip (chat_voice_message.go): 1 ms to 2 minutes. */
const MAX_VOICE_MS = 120_000;

function deliver(entry: PendingSend, deps: ChatSendDeps) {
  const { workspaceId, roomId, clientMsgId } = entry;
  if (entry.file && entry.voiceDurationMs !== undefined) {
    return deps.api.sendVoiceMessage(workspaceId, roomId, {
      uri: entry.file.uri,
      duration_ms: Math.min(MAX_VOICE_MS, Math.max(1, Math.round(entry.voiceDurationMs))),
      client_msg_id: clientMsgId,
      reply_to_message_id: entry.replyToMessageId,
    });
  }
  if (entry.file) {
    return deps.api.sendFileMessage(workspaceId, roomId, {
      file: entry.file,
      client_msg_id: clientMsgId,
      reply_to_message_id: entry.replyToMessageId,
    });
  }
  if (entry.reminder) {
    const { body, remindAt, repeat } = entry.reminder;
    return deps.api.sendMessage(workspaceId, roomId, { client_msg_id: clientMsgId, reminder: { body, remind_at: remindAt, repeat } });
  }
  if (entry.threadRootId) {
    return deps.api.sendThreadMessage(workspaceId, roomId, entry.threadRootId, { body: entry.body, client_msg_id: clientMsgId });
  }
  return deps.api.sendMessage(workspaceId, roomId, {
    body: entry.body,
    client_msg_id: clientMsgId,
    reply_to_message_id: entry.replyToMessageId,
  });
}

type Lane = "text" | "media";
const laneOf = (entry: PendingSend): Lane => (entry.file ? "media" : "text");

const senderKey = (workspaceId: string, senderId: string) => `${workspaceId}\n${senderId}`;
const lineKey = (workspaceId: string, roomId: string, senderId: string, lane: Lane) => `${workspaceId}\n${roomId}\n${senderId}\n${lane}`;

type Outcome = "sent" | "failed" | "transient";

type SendObserver = (outcome: "sent" | "failed", msSinceWritten: number) => void;
const sendObservers = new Set<SendObserver>();

/**
 * Hears every send that ends — delivered, with the time since it was written (offline waits included), or failed for
 * good — for the product counters (data/analytics.ts). A transient failure is not an end. Returns the unsubscribe.
 */
export function observeChatSends(observer: SendObserver): () => void {
  sendObservers.add(observer);
  return () => void sendObservers.delete(observer);
}

// createdAt is the wall clock (sendChatMessage), so the time since is too.
function ended(entry: PendingSend, outcome: "sent" | "failed"): void {
  const ms = Math.max(0, Date.now() - entry.createdAt);
  for (const observer of sendObservers) observer(outcome, ms);
}

/** When each upload in flight went on the wire, by clientMsgId. */
const onWireSince = new Map<string, number>();
/** Media lines waiting for their backoff after a transient failure: text behind them goes. */
const mediaRetrying = new Set<string>();

/**
 * One delivery of one entry; the entry leaves the queue on "sent" only. A
 * file that is gone (the OS purged the picker's cache the copy fell back to)
 * would fail every upload as a network error and hold the room's line for
 * ever: it fails for good instead, so the line moves on and the person can
 * discard it.
 */
async function deliverOnce(qc: QueryClient, entry: PendingSend, deps: ChatSendDeps): Promise<Outcome> {
  const file = entry.file ? deps.files.resolve(entry.clientMsgId, entry.file) : undefined;
  if (file === null) {
    useChatSendStore.getState().setStatus(entry.clientMsgId, "failed");
    ended(entry, "failed");
    return "failed";
  }
  useChatSendStore.getState().setStatus(entry.clientMsgId, "sending");
  if (file) onWireSince.set(entry.clientMsgId, (deps.now ?? Date.now)());
  try {
    const message = await (deps.retry ?? runWithChatSendRetry)(() => deliver({ ...entry, file }, deps));
    // No message back (a drifted answer) is still a post the server took: the room refetches.
    applyChatMessageResponse(qc, entry.workspaceId, entry.roomId, message, true);
    useChatSendStore.getState().remove(entry.clientMsgId);
    deps.files.release(entry.clientMsgId);
    ended(entry, "sent");
    return "sent";
  } catch (err: unknown) {
    const permanent = isPermanentChatSendRefusal(err);
    useChatSendStore.getState().setStatus(entry.clientMsgId, permanent ? "failed" : "queued");
    if (permanent) ended(entry, "failed");
    return permanent ? "failed" : "transient";
  } finally {
    onWireSince.delete(entry.clientMsgId);
  }
}

const sameLine = (entry: PendingSend, workspaceId: string, roomId: string, senderId: string) =>
  entry.workspaceId === workspaceId && entry.roomId === roomId && entry.senderId === senderId;

/** The next entry of a room's line: the oldest one waiting. */
function nextQueued(workspaceId: string, roomId: string, senderId: string, lane: Lane): PendingSend | undefined {
  return useChatSendStore
    .getState()
    .entries.filter((e) => e.status === "queued" && sameLine(e, workspaceId, roomId, senderId) && laneOf(e) === lane)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

/**
 * How long a text entry still waits for the room's media written before it:
 * 0 when there is none, when that line waits for a retry, or when its upload
 * has been on the wire MEDIA_OVERTAKE_MS. One not on the wire yet holds it the
 * whole time (its line starts it now).
 */
function mediaHold(entry: PendingSend, deps: ChatSendDeps): number {
  const { workspaceId, roomId, senderId } = entry;
  if (mediaRetrying.has(lineKey(workspaceId, roomId, senderId, "media"))) return 0;
  const { entries } = useChatSendStore.getState();
  const at = entries.indexOf(entry);
  // Written before it: an earlier time, or the same millisecond and earlier in the queue (the order of upserts).
  const head = entries
    .filter(
      (e, i) =>
        e.status !== "failed" &&
        sameLine(e, workspaceId, roomId, senderId) &&
        laneOf(e) === "media" &&
        (e.createdAt < entry.createdAt || (e.createdAt === entry.createdAt && i < at)),
    )
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!head) return 0;
  const since = onWireSince.get(head.clientMsgId);
  return since === undefined ? MEDIA_OVERTAKE_MS : Math.max(0, MEDIA_OVERTAKE_MS - ((deps.now ?? Date.now)() - since));
}

// One line per room and lane. An ask while it runs shares it: the line reads
// the queue again after every message, so an entry added meanwhile is not
// missed. The line leaves the map in the same tick it reads an empty queue.
const lines = new Map<string, Promise<void>>();

function pumpLine(qc: QueryClient, workspaceId: string, roomId: string, senderId: string, lane: Lane, deps: ChatSendDeps): Promise<void> {
  const key = lineKey(workspaceId, roomId, senderId, lane);
  const running = lines.get(key);
  if (running) return running;
  const run = (async () => {
    // Registered below before the line reads anything: a finish in this tick must not outlive its entry in the map.
    await Promise.resolve();
    if (lane === "media") mediaRetrying.delete(key);
    try {
      for (let entry = nextQueued(workspaceId, roomId, senderId, lane); entry; entry = nextQueued(workspaceId, roomId, senderId, lane)) {
        if (!deps.isOnline()) return;
        const hold = lane === "text" ? mediaHold(entry, deps) : 0;
        if (hold > 0) {
          // Order first: the photo before it goes, or has been going long enough to let the words pass.
          await Promise.race([pumpLine(qc, workspaceId, roomId, senderId, "media", deps), (deps.sleep ?? realSleep)(hold)]);
          continue;
        }
        const outcome = await deliverOnce(qc, entry, deps);
        // The backoff is the line's own: a text that goes must not cancel the photo's retry, nor a failing room stretch another's wait.
        if (outcome === "sent") deps.timers.reset(key);
        if (outcome === "transient") {
          if (lane === "media") mediaRetrying.add(key);
          // The rest of the line waits behind it: order before speed.
          deps.timers.schedule(key, () => void pumpLine(qc, workspaceId, roomId, senderId, lane, deps));
          return;
        }
      }
    } finally {
      lines.delete(key);
    }
  })();
  lines.set(key, run);
  return run;
}

/** Both lines of a room: the media line first, so an upload is on the wire before the text line weighs it. */
function pumpRoom(qc: QueryClient, workspaceId: string, roomId: string, senderId: string, deps: ChatSendDeps): Promise<void> {
  const media = pumpLine(qc, workspaceId, roomId, senderId, "media", deps);
  return Promise.all([media, pumpLine(qc, workspaceId, roomId, senderId, "text", deps)]).then(() => undefined);
}

/** A new message from the composer: on screen at once, in the room's line, sent now or when the network is back. */
export async function sendChatMessage(qc: QueryClient, input: ChatSendInput, deps: ChatSendDeps): Promise<void> {
  const entry: PendingSend = { ...input, clientMsgId: newChatClientMsgId(), createdAt: Date.now(), status: "queued" };
  const store = useChatSendStore.getState();
  store.upsert(entry);
  if (entry.file) {
    const kept = await deps.files.keep(entry.clientMsgId, entry.file);
    // Discarded while its file was copied: the copy goes too.
    if (!useChatSendStore.getState().entries.some((e) => e.clientMsgId === entry.clientMsgId)) {
      deps.files.release(entry.clientMsgId);
      return;
    }
    useChatSendStore.getState().setFile(entry.clientMsgId, kept);
  }
  return pumpLine(qc, entry.workspaceId, entry.roomId, entry.senderId, laneOf(entry), deps);
}

/** The person taps "retry" on a message that did not go: back in its room's line. */
export function retryPendingSend(qc: QueryClient, entry: PendingSend, deps: ChatSendDeps): Promise<void> {
  if (entry.status === "failed") useChatSendStore.getState().setStatus(entry.clientMsgId, "queued");
  return pumpLine(qc, entry.workspaceId, entry.roomId, entry.senderId, laneOf(entry), deps);
}

// One flush per workspace and sender at a time; an ask meanwhile makes it look once more.
const flushes = new Map<string, { run: Promise<void>; again: boolean }>();

/** Deliver this sender's queued messages of one workspace: every room's line, each oldest first. */
export function flushQueuedSends(qc: QueryClient, workspaceId: string, senderId: string, deps: ChatSendDeps): Promise<void> {
  const key = senderKey(workspaceId, senderId);
  const running = flushes.get(key);
  if (running) {
    running.again = true;
    return running.run;
  }
  const flush = { run: Promise.resolve(), again: true };
  flush.run = (async () => {
    await Promise.resolve();
    try {
      while (flush.again && deps.isOnline()) {
        flush.again = false;
        const roomIds = new Set(
          useChatSendStore
            .getState()
            .entries.filter((e) => e.status === "queued" && e.workspaceId === workspaceId && e.senderId === senderId)
            .map((e) => e.roomId),
        );
        await Promise.all([...roomIds].map((roomId) => pumpRoom(qc, workspaceId, roomId, senderId, deps)));
      }
    } finally {
      flushes.delete(key);
    }
  })();
  flushes.set(key, flush);
  return flush.run;
}

/** Failed sends past FAILED_SEND_TTL_MS (a workspace left, a room closed): nobody will retry them, their files go. */
function dropExpiredFailures(senderId: string, deps: ChatSendDeps): void {
  const now = (deps.now ?? Date.now)();
  for (const entry of useChatSendStore.getState().entries) {
    if (entry.senderId === senderId && entry.status === "failed" && now - entry.createdAt > FAILED_SEND_TTL_MS)
      discardPendingSend(entry.clientMsgId, deps);
  }
}

/**
 * Every workspace this sender has messages waiting in, whichever one is open
 * (or none, on the workspace picker): the outbox is the account's, not the
 * screen's. Failures nobody retried for FAILED_SEND_TTL_MS leave first.
 */
export function flushAllQueuedSends(qc: QueryClient, senderId: string, deps: ChatSendDeps): Promise<void> {
  dropExpiredFailures(senderId, deps);
  const workspaceIds = new Set(
    useChatSendStore
      .getState()
      .entries.filter((e) => e.status === "queued" && e.senderId === senderId)
      .map((e) => e.workspaceId),
  );
  return Promise.all([...workspaceIds].map((workspaceId) => flushQueuedSends(qc, workspaceId, senderId, deps))).then(() => undefined);
}

/** The person gave up on a send that did not go. */
export function discardPendingSend(clientMsgId: string, deps: Pick<ChatSendDeps, "files">): void {
  useChatSendStore.getState().remove(clientMsgId);
  deps.files.release(clientMsgId);
}

/** Sign-out: the queue, its files and its timers are the signed-in person's. */
export function clearChatOutbox(deps: Pick<ChatSendDeps, "files" | "timers">): void {
  useChatSendStore.getState().clear();
  deps.timers.cancelAll();
  deps.files.releaseAll();
}
