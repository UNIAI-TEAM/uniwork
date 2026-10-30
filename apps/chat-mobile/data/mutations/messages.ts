// What a conversation does to its messages: send (through the outbox), retry
// or drop an unsent one, edit, delete, pin, react, vote, follow up, make a
// task, forward, say "typing", mark read. See command.ts for the layer's rule.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  createTaskFromMessage,
  followUpCommand,
  forwardMessage,
  linkMessageToTask,
  shareMessageAsDocument,
  togglePin,
  unlinkMessageTask,
} from "../chat-actions";
import { chatApi } from "../chat-api";
import { chatSendDeps, discardPendingSend, retryPendingSend, sendChatMessage, type ChatSendInput } from "../chat-send";
import { deleteMessage, editMessage, markRoomRead, toggleReaction, votePoll } from "../pending-ops";
import { bestEffort } from "../report";
import type { PendingSend } from "@/lib/send-pipeline";
import { useCommand } from "./command";

export type SendInput = Omit<ChatSendInput, "workspaceId" | "roomId" | "senderId">;

/** Queues a send in the outbox; it never rejects (a failure shows on the bubble, which offers a retry). */
export const useSendMessage = (wsId: string, roomId: string, senderId: string) =>
  useCommand("chat.send_message", (qc, input: SendInput) => sendChatMessage(qc, { workspaceId: wsId, roomId, senderId, ...input }, chatSendDeps));

export const useRetrySend = () => useCommand("chat.retry_send", (qc, entry: PendingSend) => retryPendingSend(qc, entry, chatSendDeps));

/** Drops an unsent message and its copied file; local only, nothing to wait for. */
export function useDiscardSend(): (clientMsgId: string) => void {
  return useCallback((clientMsgId: string) => discardPendingSend(clientMsgId, chatSendDeps), []);
}

/** An edit shows at once and is delivered when it can be (the last edit wins); rejects only when the server refused it for good. */
export const useEditMessage = (wsId: string, roomId: string, userId: string) =>
  useCommand("chat.edit_message", (qc, { messageId, body }: { messageId: string; body: string }) =>
    editMessage(qc, wsId, roomId, messageId, body, userId),
  );

/** A delete takes the message off at once and is delivered when it can be; rejects only when the server refused it for good. */
export const useDeleteMessage = (wsId: string, roomId: string, userId: string) =>
  useCommand("chat.delete_message", (qc, messageId: string) => deleteMessage(qc, wsId, roomId, messageId, userId));

export const useTogglePin = (wsId: string, roomId: string) =>
  useCommand("chat.toggle_pin", (qc, messageId: string) => togglePin(qc, wsId, roomId, messageId));

/** A reaction shows at once and is delivered when it can be; rejects only when the server refused it for good. */
export const useReact = (wsId: string, roomId: string, userId: string) =>
  useCommand("chat.react", (qc, { messageId, emoji }: { messageId: string; emoji: string }) =>
    toggleReaction(qc, wsId, roomId, messageId, emoji, userId),
  );

export const useVotePoll = (wsId: string, roomId: string, userId: string) =>
  useCommand("chat.vote_poll", (qc, { messageId, optionId }: { messageId: string; optionId: string }) =>
    votePoll(qc, wsId, roomId, messageId, optionId, userId),
  );

/** `create` takes the message id; `complete` and `remove` take the follow-up's. */
export const useFollowUp = (wsId: string) =>
  useCommand("chat.follow_up", (qc, { command, id }: { command: "create" | "complete" | "remove"; id: string }) =>
    followUpCommand(qc, wsId, command, id),
  );

type CreateTaskFrom =
  | { messageId: string; title?: string; description?: string; due_date?: string; priority?: string; status?: string }
  | { followUpId: string };

export const useCreateTask = (wsId: string, roomId: string) =>
  useCommand("chat.create_task", (qc, from: CreateTaskFrom) => createTaskFromMessage(qc, wsId, roomId, from));

export const useLinkTask = (wsId: string, roomId: string) =>
  useCommand("chat.link_task", (qc, { messageId, taskId }: { messageId: string; taskId: string }) =>
    linkMessageToTask(qc, wsId, roomId, messageId, taskId),
  );

export const useUnlinkMessage = (wsId: string, roomId: string) =>
  useCommand("chat.unlink_message", (qc, { messageId, linkId }: { messageId: string; linkId: string }) =>
    unlinkMessageTask(qc, wsId, roomId, messageId, linkId),
  );

export const useShareAsDocument = (wsId: string, roomId: string) =>
  useCommand("chat.share_document", (qc, messageId: string) => shareMessageAsDocument(qc, wsId, roomId, messageId));

/** Asks the people who manage a document for view access. Resolves only when the answer says it was sent. */
export const useRequestDocumentAccess = () =>
  useCommand("chat.request_document_access", async (_qc, documentId: string) => {
    if (!(await chatApi.requestDocumentAccess(documentId))) throw new Error("chat_access_request_failed");
  });

export const useForwardMessage = (wsId: string) =>
  useCommand("chat.forward_message", (_qc, { messageId, roomIds }: { messageId: string; roomIds: string[] }) =>
    forwardMessage(wsId, messageId, roomIds),
  );

/** "Typing…" for the others in the room: best effort, a lost one is superseded by the next keystroke. */
export function useSignalTyping(wsId: string, roomId: string): () => void {
  return useCallback(() => void chatApi.signalTyping(wsId, roomId).catch(bestEffort("chat", "typing not signalled", "breadcrumb")), [wsId, roomId]);
}

/** Clears the badge now and queues the read for the server (data/pending-ops.ts reports a refusal itself). */
export function useMarkRoomRead(): (wsId: string, roomId: string, userId: string) => void {
  const qc = useQueryClient();
  return useCallback((wsId: string, roomId: string, userId: string) => void markRoomRead(qc, wsId, roomId, userId), [qc]);
}
