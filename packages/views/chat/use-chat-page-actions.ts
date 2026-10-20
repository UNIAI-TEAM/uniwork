"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import {
  outboxEntryFromPayload,
  type ChatTextSendPayload,
} from "@uniwork/core/chat/deliver-chat-text-message";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { isChatSendNetworkError, isChatSendRateLimited, isRetriableChatSendError } from "@uniwork/core/chat/send-retry";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type {
  useCreateChatGroup,
  useInviteChatGroupMembers,
  useLeaveChatRoom,
  useResolveDMRoom,
  useSendChatRoomMessage,
  useSetChatRoomAvatar,
} from "@uniwork/core/chat";
import type { ChatMessage } from "./chat-messages";
import type { ChatSidebarTarget } from "./chat-sidebar";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { serializeComposerDraftToMessageBody } from "./chat-mention-utils";

export function useChatPageActions({
  workspaceId,
  currentUserId,
  target,
  setTarget,
  activeRoomId,
  activeGroup,
  activeChannel,
  getDraft,
  setDraft,
  replyTo,
  setReplyTo,
  activeThreadRootId = null,
  ensureRoom,
  sendRoomMessage,
  sendThreadMessage,
  resolveDM,
  createGroup,
  setRoomAvatar,
  inviteMembers,
  leaveRoom,
  setConnectError,
  setCreateGroupOpen,
  setAddMembersOpen,
  setDmSettingsOpen,
  setGroupSettingsOpen,
  setCreatingGroup,
  setInvitingMembers,
  setLeavingConversation,
  clearGroupMemberProfiles,
  mentionCandidates = [],
  mentionAllLabel = "all",
  composerPriority = null,
  setComposerPriority,
}: {
  workspaceId: string;
  currentUserId: string;
  target: ChatSidebarTarget;
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  activeRoomId: string | null;
  activeGroup: GroupChat | null;
  activeChannel: ChatRoomRecord | null;
  /** Reads the composer's draft at send time (it lives in the draft store, not in page state). */
  getDraft: () => string;
  /** Writes the draft of the conversation the send started in. */
  setDraft: (value: string) => void;
  replyTo: ChatMessage | null;
  setReplyTo: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  activeThreadRootId?: string | null;
  ensureRoom: { mutateAsync: () => Promise<{ room_id?: string | null }> };
  sendRoomMessage: Pick<ReturnType<typeof useSendChatRoomMessage>, "mutateAsync">;
  sendThreadMessage?: {
    mutateAsync: (input: {
      threadRootId: string;
      body: string;
      client_msg_id?: string;
      priority?: string;
    }) => Promise<unknown>;
  };
  resolveDM: Pick<ReturnType<typeof useResolveDMRoom>, "mutateAsync">;
  createGroup: Pick<ReturnType<typeof useCreateChatGroup>, "mutateAsync">;
  setRoomAvatar: Pick<ReturnType<typeof useSetChatRoomAvatar>, "mutateAsync">;
  inviteMembers: Pick<ReturnType<typeof useInviteChatGroupMembers>, "mutateAsync">;
  leaveRoom: Pick<ReturnType<typeof useLeaveChatRoom>, "mutateAsync">;
  setConnectError: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateGroupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAddMembersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDmSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCreatingGroup: React.Dispatch<React.SetStateAction<boolean>>;
  setInvitingMembers: React.Dispatch<React.SetStateAction<boolean>>;
  setLeavingConversation: React.Dispatch<React.SetStateAction<boolean>>;
  clearGroupMemberProfiles: () => void;
  mentionCandidates?: ChatMentionCandidate[];
  mentionAllLabel?: string;
  composerPriority?: ComposerMessagePriority | null;
  setComposerPriority?: React.Dispatch<React.SetStateAction<ComposerMessagePriority | null>>;
}) {
  const { t } = useTranslation();

  // Sends one body (text, reply, sticker, GIF). It never touches the draft:
  // the composer path below owns that. True when sent or queued.
  // `sideThreadRootId` is the thread open beside the timeline: its composer
  // has no reply or priority, so the main composer's are neither sent nor cleared.
  const sendMessageBody = useCallback(
    async (text: string, sideThreadRootId?: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;

      let roomId = activeRoomId;
      if (target.kind === "workspace" && !roomId) {
        const created = await ensureRoom.mutateAsync();
        roomId = created.room_id ?? null;
      }
      if (target.kind === "dm" && target.contact && !roomId) {
        const room = await resolveDM.mutateAsync(target.contact.user_id);
        roomId = room?.id ?? null;
      }
      if (!roomId) return false;

      const threadsAllowed =
        target.kind === "channel" || target.kind === "group" || target.kind === "workspace";
      const threadRootId = sideThreadRootId ?? activeThreadRootId;
      const sendingInThread = Boolean(threadsAllowed && threadRootId && sendThreadMessage);
      const mainComposer = !sideThreadRootId;
      const clearComposerExtras = () => {
        if (!mainComposer) return;
        setReplyTo(null);
        setComposerPriority?.(null);
      };

      const payload: ChatTextSendPayload = {
        roomId,
        body: trimmed,
        client_msg_id: newChatClientMsgId(),
        ...(mainComposer && replyTo && !sendingInThread ? { reply_to_message_id: replyTo.id } : {}),
        ...(mainComposer && composerPriority ? { priority: composerPriority } : {}),
        ...(sendingInThread && threadRootId ? { thread_root_id: threadRootId } : {}),
      };

      // A send the server refused for a passing reason (5xx, 408…) while the
      // network is up stays in the timeline as failed with "Thử lại"; only a
      // real network loss waits quietly for the reconnect.
      const queueForLater = (failed = false) => {
        usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
        useChatSendOutboxStore.getState().enqueue(outboxEntryFromPayload(workspaceId, currentUserId, payload, { failed }));
        clearComposerExtras();
        setConnectError(failed ? null : t("chat.send_queued_offline"));
      };

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueForLater();
        return true;
      }

      usePendingChatMessagesStore.getState().upsert({
        workspaceId,
        roomId,
        client_msg_id: payload.client_msg_id,
        body: payload.body,
        senderId: currentUserId,
        createdAt: Date.now(),
        reply_to_message_id: payload.reply_to_message_id,
        thread_root_id: payload.thread_root_id,
        priority: payload.priority,
        status: "sending",
      });

      try {
        if (sendingInThread && threadRootId && sendThreadMessage) {
          await sendThreadMessage.mutateAsync({
            threadRootId,
            body: payload.body,
            client_msg_id: payload.client_msg_id,
            priority: payload.priority,
          });
        } else {
          await sendRoomMessage.mutateAsync(payload);
        }
        clearComposerExtras();
        setConnectError(null);
        return true;
      } catch (err: unknown) {
        if (errorCode(err) === "chat_user_blocked") {
          usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
          setConnectError(t("chat.block_send_error"));
        } else if (isChatSendRateLimited(err)) {
          // Still online: keep the draft so the sender can send it again.
          usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
          setConnectError(t("chat.send_rate_limited"));
        } else if (isRetriableChatSendError(err)) {
          queueForLater(!isChatSendNetworkError(err));
          return true;
        } else {
          usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
          setConnectError(apiErrorMessage(err) ?? t("chat.send_failed"));
        }
        return false;
      }
    },
    [
      workspaceId,
      currentUserId,
      activeRoomId,
      target,
      ensureRoom,
      resolveDM,
      sendRoomMessage,
      sendThreadMessage,
      replyTo,
      setReplyTo,
      activeThreadRootId,
      setConnectError,
      composerPriority,
      setComposerPriority,
      t,
    ],
  );

  // The main composer's draft by default; the side thread's composer passes
  // its own draft and root.
  const provisionAndSend = useCallback(
    async (read: () => string = getDraft, write: (value: string) => void = setDraft, sideThreadRootId?: string) => {
      const raw = read().trim();
      const text = serializeComposerDraftToMessageBody(raw, mentionCandidates, mentionAllLabel);
      if (!text) return;
      // Clear at once: a second Enter finds nothing to send, and text typed
      // while the server answers is not wiped when it does.
      write("");
      let sent = false;
      try {
        sent = await sendMessageBody(text, sideThreadRootId);
      } finally {
        // Not sent and not queued: give the words back, ahead of anything typed since.
        if (!sent) {
          const typed = read();
          write(typed ? `${raw}\n${typed}` : raw);
        }
      }
    },
    [getDraft, setDraft, mentionCandidates, mentionAllLabel, sendMessageBody],
  );

  const handleCreateGroup = useCallback(
    (members: ChatContact[], name: string, avatar: File | null = null) => {
      if (members.length < 2) return;
      setCreatingGroup(true);
      setConnectError(null);
      void createGroup
        .mutateAsync({
          // Empty lets the server pick a short default from the members' names.
          name: name.trim(),
          member_user_ids: members.map((member) => member.user_id),
        })
        .then((room) => {
          if (!room) throw new Error("group_failed");
          const group: GroupChat = {
            id: room.id,
            name: room.name,
            room_id: room.id,
            member_user_ids: room.member_user_ids,
          };
          setTarget({ kind: "group", group });
          setCreateGroupOpen(false);
          // The group exists either way: a photo that does not follow is a toast, not a failed create.
          if (avatar) {
            setRoomAvatar
              .mutateAsync({ roomId: room.id, file: avatar })
              .catch(() => toast.error(t("chat.group_avatar_failed_after_create")));
          }
        })
        .catch((err: unknown) => {
          setConnectError(apiErrorMessage(err) ?? t("chat.group_failed"));
        })
        .finally(() => {
          setCreatingGroup(false);
        });
    },
    [createGroup, setRoomAvatar, setTarget, setCreateGroupOpen, setConnectError, setCreatingGroup, t],
  );

  const handleAddGroupMembers = useCallback(
    (members: ChatContact[]) => {
      const inviteRoomId =
        target.kind === "channel"
          ? activeChannel?.id
          : target.kind === "group"
            ? activeGroup?.room_id
            : null;
      if (!inviteRoomId || members.length === 0) return;
      setInvitingMembers(true);
      setConnectError(null);
      void inviteMembers
        .mutateAsync({
          roomId: inviteRoomId,
          memberUserIds: members.map((member) => member.user_id),
        })
        .then((room) => {
          if (room && target.kind === "group" && activeGroup) {
            setTarget({
              kind: "group",
              group: {
                id: room.id,
                name: room.name,
                room_id: room.id,
                member_user_ids: room.member_user_ids,
              },
            });
          }
          if (room && target.kind === "channel" && activeChannel) {
            setTarget({
              kind: "channel",
              channel: {
                ...activeChannel,
                ...room,
              },
            });
          }
          setAddMembersOpen(false);
        })
        .catch((err: unknown) => {
          setConnectError(apiErrorMessage(err) ?? t("chat.group_invite_failed"));
        })
        .finally(() => {
          setInvitingMembers(false);
        });
    },
    [
      t,
      target.kind,
      activeChannel,
      activeGroup,
      inviteMembers,
      setTarget,
      setAddMembersOpen,
      setConnectError,
      setInvitingMembers,
    ],
  );

  const handleLeaveConversation = useCallback(
    async (roomId: string, cleanup: () => void) => {
      if (!roomId) return;
      setLeavingConversation(true);
      setConnectError(null);
      try {
        await leaveRoom.mutateAsync(roomId);
        cleanup();
        setTarget({ kind: "workspace" });
        setDmSettingsOpen(false);
        setGroupSettingsOpen(false);
        clearGroupMemberProfiles();
      } catch (err: unknown) {
        setConnectError(apiErrorMessage(err) ?? t("chat.leave_conversation_failed"));
      } finally {
        setLeavingConversation(false);
      }
    },
    [
      leaveRoom,
      setLeavingConversation,
      setConnectError,
      setTarget,
      setDmSettingsOpen,
      setGroupSettingsOpen,
      clearGroupMemberProfiles,
      t,
    ],
  );

  return { provisionAndSend, sendMessageBody, handleCreateGroup, handleAddGroupMembers, handleLeaveConversation };
}
