// Sending a chat message from the phone, mirroring the web's send path
// (packages/core/chat/{deliver-chat-text-message,send-retry}.ts and
// use-chat-send-outbox-flush.ts): every send carries a client_msg_id the
// server deduplicates on, so a retry after a lost answer cannot post twice.
//
// Every send goes through the outbox (audit R1–R3): text, a photo or a
// document, a voice clip and a reminder are written to the persisted queue
// (stores/chat-send-store.ts) first, with their file copied out of the cache
// (outbox-files.ts), and leave it only once the server answered. A room's
// messages go strictly in the order they were written, one at a time; a
// transient failure stops that room's line and retries it on a jittered
// 2/5/15/60 s backoff (retry-timers.ts), at once on a network edge or a socket
// reconnect (realtime/use-chat-realtime.ts). A refusal for good stays
// "failed" until the person retries or discards it; the room's next messages
// go on without it.
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
}

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

const senderKey = (workspaceId: string, senderId: string) => `${workspaceId}\n${senderId}`;
const roomKey = (workspaceId: string, roomId: string, senderId: string) => `${workspaceId}\n${roomId}\n${senderId}`;

type Outcome = "sent" | "failed" | "transient";

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
    return "failed";
  }
  useChatSendStore.getState().setStatus(entry.clientMsgId, "sending");
  try {
    const message = await (deps.retry ?? runWithChatSendRetry)(() => deliver({ ...entry, file }, deps));
    // No message back (a drifted answer) is still a post the server took: the room refetches.
    applyChatMessageResponse(qc, entry.workspaceId, entry.roomId, message, true);
    useChatSendStore.getState().remove(entry.clientMsgId);
    deps.files.release(entry.clientMsgId);
    return "sent";
  } catch (err: unknown) {
    const permanent = isPermanentChatSendRefusal(err);
    useChatSendStore.getState().setStatus(entry.clientMsgId, permanent ? "failed" : "queued");
    return permanent ? "failed" : "transient";
  }
}

/** The next entry of a room's line: the oldest one waiting. */
function nextQueued(workspaceId: string, roomId: string, senderId: string): PendingSend | undefined {
  return useChatSendStore
    .getState()
    .entries.filter((e) => e.status === "queued" && e.workspaceId === workspaceId && e.roomId === roomId && e.senderId === senderId)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

// One line per room. An ask while it runs shares it: the line reads the queue
// again after every message, so an entry added meanwhile is not missed. The
// line leaves the map in the same tick it reads an empty queue.
const rooms = new Map<string, Promise<void>>();

function pumpRoom(qc: QueryClient, workspaceId: string, roomId: string, senderId: string, deps: ChatSendDeps): Promise<void> {
  const key = roomKey(workspaceId, roomId, senderId);
  const running = rooms.get(key);
  if (running) return running;
  const run = (async () => {
    // Registered below before the line reads anything: a finish in this tick must not outlive its entry in the map.
    await Promise.resolve();
    try {
      for (let entry = nextQueued(workspaceId, roomId, senderId); entry; entry = nextQueued(workspaceId, roomId, senderId)) {
        if (!deps.isOnline()) return;
        const outcome = await deliverOnce(qc, entry, deps);
        if (outcome === "sent") deps.timers.reset(senderKey(workspaceId, senderId));
        if (outcome === "transient") {
          // The rest of the room waits behind it: order before speed.
          deps.timers.schedule(senderKey(workspaceId, senderId), () => void flushQueuedSends(qc, workspaceId, senderId, deps));
          return;
        }
      }
    } finally {
      rooms.delete(key);
    }
  })();
  rooms.set(key, run);
  return run;
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
  return pumpRoom(qc, entry.workspaceId, entry.roomId, entry.senderId, deps);
}

/** The person taps "retry" on a message that did not go: back in its room's line. */
export function retryPendingSend(qc: QueryClient, entry: PendingSend, deps: ChatSendDeps): Promise<void> {
  if (entry.status === "failed") useChatSendStore.getState().setStatus(entry.clientMsgId, "queued");
  return pumpRoom(qc, entry.workspaceId, entry.roomId, entry.senderId, deps);
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
