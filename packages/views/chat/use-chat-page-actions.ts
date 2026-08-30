"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api/http";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import { createClient, type MatrixClient } from "matrix-js-sdk";
import type { ChatMessage } from "./chat-messages";
import { sendMatrixTextReply } from "./matrix-message-actions";
import { sendMatrixTyping } from "./matrix-dm";
import {
  defaultGroupName,
  inviteMembersToGroupRoom,
  readGroupMemberUserIds,
  resolveGroupRoomId,
} from "./matrix-group";
import { leaveAndForgetRoom } from "./matrix-room-leave";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { matrixBaseUrl, matrixIdForContact, memberSetChanged } from "./chat-page-utils";

export function useChatPageActions({
  target,
  setTarget,
  matrixSession,
  matrixClient,
  clientRef,
  workspaceRoomId,
  activeRoomId,
  activeGroup,
  draft,
  setDraft,
  replyTo,
  setReplyTo,
  ensureRoom,
  saveGroup,
  setGroupRoomId,
  setDmRoomId,
  setConnectError,
  setCreateGroupOpen,
  setAddMembersOpen,
  setDmSettingsOpen,
  setGroupSettingsOpen,
  removeGroup,
  removeContact,
  setLeavingConversation,
  setCreatingGroup,
  setInvitingMembers,
  groupResolveRef,
  clearGroupMemberProfiles,
}: {
  target: ChatSidebarTarget;
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  matrixSession: NonNullable<ReturnType<typeof useMatrixStore.getState>["session"]> | null;
  matrixClient: MatrixClient | null;
  clientRef: React.RefObject<MatrixClient | null>;
  workspaceRoomId: string | null;
  activeRoomId: string | null;
  activeGroup: GroupChat | null;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  replyTo: ChatMessage | null;
  setReplyTo: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  ensureRoom: { mutateAsync: () => Promise<{ room_id?: string | null }> };
  saveGroup: (group: GroupChat) => void;
  setGroupRoomId: React.Dispatch<React.SetStateAction<string | null>>;
  setDmRoomId: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectError: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateGroupOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAddMembersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDmSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  removeGroup: (groupId: string) => void;
  removeContact: (userId: string) => void;
  setLeavingConversation: React.Dispatch<React.SetStateAction<boolean>>;
  setCreatingGroup: React.Dispatch<React.SetStateAction<boolean>>;
  setInvitingMembers: React.Dispatch<React.SetStateAction<boolean>>;
  groupResolveRef: React.MutableRefObject<string | null>;
  clearGroupMemberProfiles: () => void;
}) {
  const { t } = useTranslation();

  const provisionAndSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !matrixSession) return;
    let targetRoomId = activeRoomId;
    if (target.kind === "workspace" && !targetRoomId) {
      const created = await ensureRoom.mutateAsync();
      if (!created.room_id) return;
      targetRoomId = created.room_id;
    }
    if (!targetRoomId) return;

    const client = clientRef.current;
    if (client) {
      const membership = client.getRoom(targetRoomId)?.getMyMembership();
      if (membership === "invite") {
        await client.joinRoom(targetRoomId);
      }
      await sendMatrixTyping(client, targetRoomId, false);
      if (replyTo) {
        await sendMatrixTextReply(client, targetRoomId, text, replyTo.id);
        setReplyTo(null);
      } else {
        await client.sendTextMessage(targetRoomId, text);
      }
      setDraft("");
      return;
    }
    const baseUrl = matrixBaseUrl(matrixSession);
    if (!baseUrl) return;
    const temp = createClient({
      baseUrl,
      accessToken: matrixSession.access_token,
      userId: matrixSession.user_id,
    });
    if (replyTo) {
      await sendMatrixTextReply(temp, targetRoomId, text, replyTo.id);
      setReplyTo(null);
    } else {
      await temp.sendTextMessage(targetRoomId, text);
    }
    setDraft("");
  }, [
    draft,
    matrixSession,
    activeRoomId,
    target.kind,
    ensureRoom,
    clientRef,
    replyTo,
    setReplyTo,
    setDraft,
  ]);

  const handleCreateGroup = useCallback(
    (members: ChatContact[], name: string) => {
      if (!matrixClient || !matrixSession || members.length < 2) return;
      setCreatingGroup(true);
      setConnectError(null);

      const inviteMatrixUserIds = members.map((member) => matrixIdForContact(member, matrixSession));
      const resolvedName =
        name.trim() ||
        defaultGroupName(
          members.map((member) => displayLabelForChatContact(member)),
          t("chat.new_group"),
        );

      void resolveGroupRoomId(matrixClient, {
        name: resolvedName,
        inviteMatrixUserIds,
        myMatrixUserId: matrixSession.user_id,
        workspaceRoomId,
      })
        .then((roomId) => {
          const group: GroupChat = {
            id: roomId,
            name: resolvedName,
            room_id: roomId,
            member_user_ids: [...members.map((member) => member.user_id)].sort(),
          };
          saveGroup(group);
          setGroupRoomId(roomId);
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
    [
      matrixClient,
      matrixSession,
      workspaceRoomId,
      saveGroup,
      setGroupRoomId,
      setTarget,
      setCreateGroupOpen,
      setConnectError,
      setCreatingGroup,
      t,
    ],
  );

  const handleAddGroupMembers = useCallback(
    (members: ChatContact[]) => {
      if (!matrixClient || !matrixSession || !activeGroup || members.length === 0) return;
      setInvitingMembers(true);
      setConnectError(null);

      const inviteMatrixUserIds = members.map((member) => matrixIdForContact(member, matrixSession));

      void inviteMembersToGroupRoom(matrixClient, activeGroup.room_id, inviteMatrixUserIds)
        .then(() => {
          const memberUserIds = readGroupMemberUserIds(
            matrixClient,
            activeGroup.room_id,
            matrixSession.user_id,
          );
          if (memberSetChanged(activeGroup.member_user_ids, memberUserIds)) {
            saveGroup({ ...activeGroup, member_user_ids: memberUserIds });
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
    [
      matrixClient,
      matrixSession,
      activeGroup,
      saveGroup,
      setAddMembersOpen,
      setConnectError,
      setInvitingMembers,
    ],
  );

  const handleLeaveConversation = useCallback(
    async (roomId: string, cleanup: () => void) => {
      if (!matrixClient || !roomId) return;
      setLeavingConversation(true);
      setConnectError(null);
      try {
        await leaveAndForgetRoom(matrixClient, roomId);
        cleanup();
        setTarget({ kind: "workspace" });
        setDmSettingsOpen(false);
        setGroupSettingsOpen(false);
        setGroupRoomId(null);
        setDmRoomId(null);
        clearGroupMemberProfiles();
        groupResolveRef.current = null;
      } catch (err: unknown) {
        setConnectError(err instanceof Error ? err.message : t("chat.leave_conversation_failed"));
      } finally {
        setLeavingConversation(false);
      }
    },
    [
      matrixClient,
      setLeavingConversation,
      setConnectError,
      setTarget,
      setDmSettingsOpen,
      setGroupSettingsOpen,
      setGroupRoomId,
      setDmRoomId,
      clearGroupMemberProfiles,
      groupResolveRef,
      t,
    ],
  );

  return { provisionAndSend, handleCreateGroup, handleAddGroupMembers, handleLeaveConversation };
}
