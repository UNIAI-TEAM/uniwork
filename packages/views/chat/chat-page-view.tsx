"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useChatContactActions,
  useChatContacts,
  useChatVoiceToken,
  useEnsureWorkspaceChatRoom,
  useGroupChatActions,
  useGroupChats,
  useWorkspaceChatRoom,
} from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { useMatrixStore } from "@uniwork/core/chat/matrix-store";
import { useAuthStore } from "@uniwork/core/auth";
import { isAdHocGroupRoom } from "./matrix-group";
import { useMatrixTyping, useMatrixTypingSender } from "./use-matrix-typing";
import { useMarkRoomAsRead, useMatrixUnread } from "./use-matrix-unread";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import type { ChatSidebarTarget } from "./chat-sidebar";
import type { ChatMessage } from "./chat-messages";
import { useChatMessageCount } from "./chat-message-panel";
import { useVoiceCall } from "./use-voice-call";
import { VoiceCallOverlay } from "./voice-call-overlay";
import { formatTypingLabel, resolveTypingDisplayName } from "./typing-indicator";
import {
  buildChatNameContext,
  chatHeaderTitle,
  matrixBaseUrl,
  matrixIdForContact,
} from "./chat-page-utils";
import { ChatPageContent } from "./chat-page-content";
import { useChatMatrixClient } from "./use-chat-matrix-client";
import { useChatRoomResolution } from "./use-chat-room-resolution";
import { useGroupMemberProfiles } from "./use-group-member-profiles";
import { useChatPageActions } from "./use-chat-page-actions";
import { useChatVoiceHandlers } from "./use-chat-voice-handlers";

export function ChatPageView({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { t, i18n } = useTranslation();
  const matrixSession = useMatrixStore((s) => s.session);
  const authReady = useAuthStore((s) => s.status === "authed");
  const matrixEnabled = Boolean(matrixBaseUrl(matrixSession));
  const { data: room, isFetched, isError, refetch, isFetching } = useWorkspaceChatRoom(workspaceId);
  const ensureRoom = useEnsureWorkspaceChatRoom(workspaceId);
  const { rememberRoom, upsertContact, removeContact } = useChatContactActions(currentUserId);
  const { saveGroup, removeGroup, reconcileGroups } = useGroupChatActions(currentUserId);
  const contacts = useChatContacts(currentUserId);
  const groups = useGroupChats(currentUserId);
  const [target, setTarget] = useState<ChatSidebarTarget>({ kind: "workspace" });
  const [dmRoomId, setDmRoomId] = useState<string | null>(null);
  const [groupRoomId, setGroupRoomId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [dmSettingsOpen, setDmSettingsOpen] = useState(false);
  const [leavingConversation, setLeavingConversation] = useState(false);
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const syncedRef = useRef(false);

  const handleConnectError = useCallback((message: string) => {
    setConnectError(message || null);
  }, []);

  const { matrixClient, clientRef, setWorkspaceRoomId } = useChatMatrixClient({
    matrixSession,
    currentUserId,
    upsertContact,
    saveGroup,
    reconcileGroups,
    onConnectError: handleConnectError,
  });

  const workspaceRoomId = room?.room_id ?? ensureRoom.data?.room_id ?? null;

  useEffect(() => {
    setWorkspaceRoomId(workspaceRoomId);
  }, [workspaceRoomId, setWorkspaceRoomId]);

  const activeContact = target.kind === "dm" ? target.contact : null;
  const activeGroup = useMemo(() => {
    if (target.kind !== "group") return null;
    const key = target.group.room_id || target.group.id;
    return (
      groups.find((group) => group.id === key || group.room_id === key || group.id === target.group.id) ??
      target.group
    );
  }, [target, groups]);

  const activeRoomId =
    target.kind === "workspace"
      ? workspaceRoomId
      : target.kind === "dm"
        ? (dmRoomId ?? activeContact?.dm_room_id ?? null)
        : (groupRoomId ?? activeGroup?.room_id ?? null);

  const selectedGroupId = target.kind === "group" ? (activeGroup?.room_id ?? target.group.id) : null;
  const activeGroupRoomId = activeGroup?.room_id ?? null;

  const { groupResolveRef } = useChatRoomResolution({
    target,
    setTarget,
    contacts,
    matrixSession,
    matrixClient,
    workspaceRoomId,
    activeContact,
    activeGroup,
    selectedGroupId,
    activeGroupRoomId,
    rememberRoom,
    saveGroup,
    upsertContact,
    currentUserId,
    dmRoomId,
    setDmRoomId,
    groupRoomId,
    setGroupRoomId,
    setConnectError,
  });

  const { groupMemberProfiles, clearGroupMemberProfiles } = useGroupMemberProfiles({
    targetKind: target.kind,
    matrixClient,
    matrixSession,
    activeRoomId,
    selectedGroupId,
    currentUserId,
    saveGroup,
  });

  const trackedRoomIds = useMemo(() => {
    const ids = new Set<string>();
    const groupRoomIds = new Set(groups.map((group) => group.room_id));
    if (workspaceRoomId) ids.add(workspaceRoomId);
    for (const contact of contacts) {
      if (contact.dm_room_id && !groupRoomIds.has(contact.dm_room_id)) {
        ids.add(contact.dm_room_id);
      }
    }
    for (const group of groups) {
      if (group.room_id) ids.add(group.room_id);
    }
    return [...ids];
  }, [workspaceRoomId, contacts, groups]);

  const { counts: unreadByRoomId, badgesReady: unreadBadgesReady } = useMatrixUnread(
    matrixClient,
    trackedRoomIds,
    matrixSession?.user_id ?? null,
    activeRoomId,
  );

  const roomQuerySettled = isFetched && !isFetching;
  const showLoading =
    target.kind === "workspace"
      ? !workspaceRoomId && (ensureRoom.isPending || !roomQuerySettled || !authReady)
      : target.kind === "dm"
        ? !activeRoomId
        : !activeRoomId;

  const messageCount = useChatMessageCount(matrixClient, activeRoomId);
  useMarkRoomAsRead(matrixClient, activeRoomId, Boolean(activeRoomId) && !showLoading, messageCount);

  const chatVoiceToken = useChatVoiceToken();
  const mintVoiceToken = useCallback(
    async (matrixRoomId: string) => chatVoiceToken.mutateAsync(matrixRoomId),
    [chatVoiceToken],
  );
  const { voiceCall, startCall, acceptCall, declineCall, hangUp, inCall } = useVoiceCall({
    client: matrixClient,
    myMatrixUserId: matrixSession?.user_id ?? null,
    mintToken: mintVoiceToken,
  });

  const { handleStartVoiceCall, handleAcceptVoiceCall } = useChatVoiceHandlers({
    targetKind: target.kind,
    activeRoomId,
    activeContact,
    startCall,
    acceptCall,
    declineCall,
  });

  const { provisionAndSend, handleCreateGroup, handleAddGroupMembers, handleLeaveConversation } =
    useChatPageActions({
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
    });

  useEffect(() => {
    if (!matrixSession || !authReady || syncedRef.current) return;
    syncedRef.current = true;
    void ensureRoom.mutate();
  }, [matrixSession, authReady, ensureRoom]);

  useEffect(() => {
    if (!authReady) return;
    void refetch();
  }, [authReady, refetch]);

  useEffect(() => {
    if (!matrixClient || !matrixSession) return;
    const activeGroupRoomIds = matrixClient
      .getRooms()
      .filter((room) => isAdHocGroupRoom(room, matrixSession.user_id, workspaceRoomId))
      .map((room) => room.roomId);
    reconcileGroups(activeGroupRoomIds);
  }, [matrixClient, matrixSession, workspaceRoomId, reconcileGroups]);

  useEffect(() => {
    if (!matrixClient || !activeRoomId) return;
    const membership = matrixClient.getRoom(activeRoomId)?.getMyMembership();
    if (membership === "invite") {
      void matrixClient.joinRoom(activeRoomId);
    }
  }, [matrixClient, activeRoomId]);

  const typingUserIds = useMatrixTyping(matrixClient, activeRoomId, matrixSession?.user_id ?? null);
  useMatrixTypingSender(matrixClient, activeRoomId, draft);

  const headerTitle = chatHeaderTitle(
    target,
    contacts,
    groups,
    t("chat.title"),
    (params) => t("chat.dm_with", params),
  );
  const nameContext = buildChatNameContext(contacts, activeContact, activeGroup, groupMemberProfiles);

  if (!matrixEnabled) {
    return (
      <div className="flex h-full flex-col">
        <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
        <CollectionPageState
          icon={MessageSquare}
          title={t("chat.matrix_disabled")}
          description={t("chat.empty_description")}
        />
      </div>
    );
  }

  if (!matrixSession) {
    return (
      <div className="flex h-full flex-col">
        <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
        <CollectionPageState
          icon={MessageSquare}
          title={t("chat.no_matrix_session")}
          description={t("chat.empty_description")}
        />
      </div>
    );
  }

  const typingLabel = formatTypingLabel(
    typingUserIds.map((id) => {
      const roomMember = matrixClient?.getRoom(activeRoomId ?? "")?.getMember(id);
      return resolveTypingDisplayName(id, nameContext, roomMember?.name);
    }),
    t,
    i18n.language,
  );

  const dmReaderMatrixUserId =
    target.kind === "dm" && activeContact
      ? matrixIdForContact(activeContact, matrixSession)
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionPageHeader icon={MessageSquare} title={headerTitle} />
      <ChatPageContent
        target={target}
        setTarget={setTarget}
        currentUserId={currentUserId}
        headerTitle={headerTitle}
        contacts={contacts}
        activeContact={activeContact}
        activeGroup={activeGroup}
        matrixClient={matrixClient}
        matrixSessionUserId={matrixSession.user_id}
        activeRoomId={activeRoomId}
        showLoading={showLoading}
        connectError={connectError}
        isWorkspaceError={isError}
        onRefetchWorkspace={() => void refetch()}
        workspaceRoomId={workspaceRoomId}
        unreadByRoomId={unreadByRoomId}
        unreadBadgesReady={unreadBadgesReady}
        nameContext={nameContext}
        dmReaderMatrixUserId={dmReaderMatrixUserId}
        replyTo={replyTo}
        onReplyToChange={setReplyTo}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => void provisionAndSend()}
        typingLabel={typingLabel}
        groupSettingsOpen={groupSettingsOpen}
        onGroupSettingsOpenChange={setGroupSettingsOpen}
        dmSettingsOpen={dmSettingsOpen}
        onDmSettingsOpenChange={setDmSettingsOpen}
        addMembersOpen={addMembersOpen}
        onAddMembersOpenChange={setAddMembersOpen}
        createGroupOpen={createGroupOpen}
        onCreateGroupOpenChange={setCreateGroupOpen}
        creatingGroup={creatingGroup}
        onCreateGroup={handleCreateGroup}
        invitingMembers={invitingMembers}
        onAddGroupMembers={handleAddGroupMembers}
        leavingConversation={leavingConversation}
        onLeaveGroup={() => {
          if (activeRoomId && activeGroup) {
            void handleLeaveConversation(activeRoomId, () => removeGroup(activeGroup.id));
          }
        }}
        onLeaveDm={() => {
          if (activeRoomId && activeContact) {
            void handleLeaveConversation(activeRoomId, () => removeContact(activeContact.user_id));
          }
        }}
        groupMemberProfiles={groupMemberProfiles}
        onVoiceCall={() => void handleStartVoiceCall()}
        voiceCallDisabled={!activeRoomId || inCall || chatVoiceToken.isPending}
        t={t}
      />
      <VoiceCallOverlay
        state={voiceCall}
        onAccept={() => void handleAcceptVoiceCall()}
        onDecline={() => void declineCall()}
        onEnd={() => void hangUp()}
      />
    </div>
  );
}
