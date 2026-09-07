"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import {
  outboxEntryFromPayload,
  type ChatTextSendPayload,
} from "@uniwork/core/chat/deliver-chat-text-message";
import { usePendingChatMessagesStore } from "@uniwork/core/chat/pending-messages-store";
import { isRetriableChatSendError } from "@uniwork/core/chat/send-retry";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type {
  useCreateChatGroup,
  useInviteChatGroupMembers,
  useLeaveChatRoom,
  useResolveDMRoom,
  useSendChatRoomMessage,
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
  draft,
  setDraft,
  replyTo,
  setReplyTo,
  ensureRoom,
  sendRoomMessage,
  resolveDM,
  createGroup,
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
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  replyTo: ChatMessage | null;
  setReplyTo: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  ensureRoom: { mutateAsync: () => Promise<{ room_id?: string | null }> };
  sendRoomMessage: Pick<ReturnType<typeof useSendChatRoomMessage>, "mutateAsync">;
  resolveDM: Pick<ReturnType<typeof useResolveDMRoom>, "mutateAsync">;
  createGroup: Pick<ReturnType<typeof useCreateChatGroup>, "mutateAsync">;
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

  const sendMessageBody = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      let roomId = activeRoomId;
      if (target.kind === "workspace" && !roomId) {
        const created = await ensureRoom.mutateAsync();
        roomId = created.room_id ?? null;
      }
      if (target.kind === "dm" && target.contact && !roomId) {
        const room = await resolveDM.mutateAsync(target.contact.user_id);
        roomId = room?.id ?? null;
      }
      if (!roomId) return;

      const payload: ChatTextSendPayload = {
        roomId,
        body: trimmed,
        client_msg_id: newChatClientMsgId(),
        ...(replyTo ? { reply_to_message_id: replyTo.id } : {}),
        ...(composerPriority ? { priority: composerPriority } : {}),
      };

      const queueForLater = () => {
        usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
        useChatSendOutboxStore.getState().enqueue(outboxEntryFromPayload(workspaceId, payload));
        setReplyTo(null);
        setDraft("");
        setComposerPriority?.(null);
        setConnectError(t("chat.send_queued_offline"));
      };

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        queueForLater();
        return;
      }

      usePendingChatMessagesStore.getState().upsert({
        workspaceId,
        roomId,
        client_msg_id: payload.client_msg_id,
        body: payload.body,
        senderId: currentUserId,
        createdAt: Date.now(),
        reply_to_message_id: payload.reply_to_message_id,
        priority: payload.priority,
        status: "sending",
      });

      try {
        await sendRoomMessage.mutateAsync(payload);
        setReplyTo(null);
        setDraft("");
        setComposerPriority?.(null);
        setConnectError(null);
      } catch (err: unknown) {
        if (errorCode(err) === "chat_user_blocked") {
          usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
          setConnectError(t("chat.block_send_error"));
        } else if (isRetriableChatSendError(err)) {
          queueForLater();
        } else {
          usePendingChatMessagesStore.getState().remove(payload.client_msg_id);
          setConnectError(err instanceof Error ? err.message : "send_failed");
        }
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
      replyTo,
      setReplyTo,
      setDraft,
      setConnectError,
      composerPriority,
      setComposerPriority,
      t,
    ],
  );

  const provisionAndSend = useCallback(async () => {
    const text = serializeComposerDraftToMessageBody(
      draft.trim(),
      mentionCandidates,
      mentionAllLabel,
    );
    if (!text) return;
    await sendMessageBody(text);
  }, [draft, mentionCandidates, mentionAllLabel, sendMessageBody]);

  const handleCreateGroup = useCallback(
    (members: ChatContact[], name: string) => {
      if (members.length < 2) return;
      setCreatingGroup(true);
      setConnectError(null);
      const resolvedName =
        name.trim() ||
        members.map((member) => displayLabelForChatContact(member)).join(", ");
      void createGroup
        .mutateAsync({
          name: resolvedName,
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
        })
        .catch((err: unknown) => {
          setConnectError(err instanceof Error ? err.message : "group_failed");
        })
        .finally(() => {
          setCreatingGroup(false);
        });
    },
    [createGroup, setTarget, setCreateGroupOpen, setConnectError, setCreatingGroup],
  );

  const handleAddGroupMembers = useCallback(
    (members: ChatContact[]) => {
      if (!activeGroup || members.length === 0) return;
      setInvitingMembers(true);
      setConnectError(null);
      void inviteMembers
        .mutateAsync({
          roomId: activeGroup.room_id,
          memberUserIds: members.map((member) => member.user_id),
        })
        .then((room) => {
          if (room && activeGroup) {
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
          setAddMembersOpen(false);
        })
        .catch((err: unknown) => {
          setConnectError(err instanceof Error ? err.message : "group_invite_failed");
        })
        .finally(() => {
          setInvitingMembers(false);
        });
    },
    [activeGroup, inviteMembers, setTarget, setAddMembersOpen, setConnectError, setInvitingMembers],
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
        setConnectError(err instanceof Error ? err.message : t("chat.leave_conversation_failed"));
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
