// Sending a chat message from the phone, mirroring the web's send path
// (packages/core/chat/{deliver-chat-text-message,send-retry}.ts and
// use-chat-send-outbox-flush.ts): every send carries a client_msg_id the
// server deduplicates on, so a retry after a lost answer cannot post twice.
// Offline, a send waits as "queued" and goes when the network or the socket
// comes back; a refusal for good stays "failed" until the person retries or
// discards it.
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import { isPermanentChatSendRefusal, runWithChatSendRetry, type PendingFile, type PendingSend } from "@/lib/send-pipeline";
import { applyChatMessageResponse } from "./chat-cache";
import { chatApi, type ChatApi } from "./chat-api";
import { useChatSendStore } from "./stores/chat-send-store";

export interface ChatSendDeps {
  api: Pick<ChatApi, "sendMessage" | "sendThreadMessage" | "sendFileMessage">;
  isOnline: () => boolean;
  retry?: typeof runWithChatSendRetry;
}

/** The app's wiring: the chat API and TanStack's online flag (NetInfo, data/query-client.ts). */
export const chatSendDeps: ChatSendDeps = { api: chatApi, isOnline: () => onlineManager.isOnline() };

export interface ChatSendInput {
  workspaceId: string;
  roomId: string;
  senderId: string;
  body: string;
  replyToMessageId?: string;
  threadRootId?: string;
  file?: PendingFile;
}

function deliver(entry: PendingSend, deps: ChatSendDeps) {
  const { workspaceId, roomId, clientMsgId } = entry;
  if (entry.file) {
    return deps.api.sendFileMessage(workspaceId, roomId, {
      file: entry.file,
      client_msg_id: clientMsgId,
      reply_to_message_id: entry.replyToMessageId,
    });
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

// One delivery per message at a time: a flush and a tap on "retry" must not race.
const inFlight = new Map<string, Promise<void>>();

/** Send (again) one pending entry; resolves once it has a final status for now. */
export function deliverPendingSend(qc: QueryClient, entry: PendingSend, deps: ChatSendDeps): Promise<void> {
  const running = inFlight.get(entry.clientMsgId);
  if (running) return running;
  const store = useChatSendStore.getState();
  store.upsert({ ...entry, status: "sending" });
  const run = (deps.retry ?? runWithChatSendRetry)(() => deliver(entry, deps))
    .then((message) => {
      applyChatMessageResponse(qc, entry.workspaceId, entry.roomId, message, true);
      useChatSendStore.getState().remove(entry.clientMsgId);
    })
    .catch((err: unknown) => {
      useChatSendStore.getState().setStatus(entry.clientMsgId, isPermanentChatSendRefusal(err) ? "failed" : "queued");
    })
    .finally(() => inFlight.delete(entry.clientMsgId));
  inFlight.set(entry.clientMsgId, run);
  return run;
}

/** A new message from the composer: on screen at once, sent now or when the network is back. */
export function sendChatMessage(qc: QueryClient, input: ChatSendInput, deps: ChatSendDeps): Promise<void> {
  const entry: PendingSend = { ...input, clientMsgId: newChatClientMsgId(), createdAt: Date.now(), status: "queued" };
  if (!deps.isOnline()) {
    useChatSendStore.getState().upsert(entry);
    return Promise.resolve();
  }
  return deliverPendingSend(qc, entry, deps);
}

let flushing: Promise<void> | null = null;

/** Deliver this sender's queued messages of one workspace, oldest first; one flush at a time. */
export function flushQueuedSends(qc: QueryClient, workspaceId: string, senderId: string, deps: ChatSendDeps): Promise<void> {
  if (flushing) return flushing;
  const queued = useChatSendStore
    .getState()
    .entries.filter((entry) => entry.status === "queued" && entry.workspaceId === workspaceId && entry.senderId === senderId);
  flushing = (async () => {
    for (const entry of queued) {
      if (!deps.isOnline()) break;
      await deliverPendingSend(qc, entry, deps);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** The person gave up on a send that did not go. */
export function discardPendingSend(clientMsgId: string): void {
  useChatSendStore.getState().remove(clientMsgId);
}
