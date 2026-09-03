"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  mergeActiveDmContact,
  sidebarFromChatRooms,
  unreadMapFromRooms,
  selectLazyChatScopeRoomIds,
  useBlockChatUser,
  useChatBlockStatus,
  useChatRooms,
  useChatVoiceToken,
  useCreateChatGroup,
  useEnsureWorkspaceChatRoom,
  useInviteChatGroupMembers,
  useLeaveChatRoom,
  useResolveDMRoom,
  useSendChatRoomMessage,
  useUnblockChatUser,
} from "@uniwork/core/chat";
import { useAuthStore } from "@uniwork/core/auth";
import { useChatRoomScopes } from "@uniwork/core/realtime";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useMembers } from "@uniwork/core/workspaces";
import { CollectionPageHeader, CollectionPageState } from "../layout/collection-page";
import type { ChatSidebarTarget } from "./chat-sidebar";
import type { ChatMessage } from "./chat-messages";
import { buildChatNameContext, chatHeaderTitle } from "./chat-page-utils";
import { ChatPageContent } from "./chat-page-content";
import { useChatPageActions } from "./use-chat-page-actions";
import { useChatVoiceHandlers } from "./use-chat-voice-handlers";
import { useNativeGroupMemberProfiles } from "./use-native-group-member-profiles";
import { useNativeTyping } from "./use-native-typing";
import { useNativeVoiceCall } from "./use-native-voice-call";
import { VoiceCallOverlay } from "./voice-call-overlay";

export function ChatPageView({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const authReady = useAuthStore((s) => s.status === "authed");
  const { data: rooms = [], isError, refetch, isSuccess: roomsLoaded } = useChatRooms(workspaceId);
  const { data: workspaceMembers = [] } = useMembers(workspaceId);
  const ensureRoom = useEnsureWorkspaceChatRoom(workspaceId);
  const resolveDM = useResolveDMRoom(workspaceId);
  const resolveDMRef = useRef(resolveDM);
  resolveDMRef.current = resolveDM;
  const createGroup = useCreateChatGroup(workspaceId);
  const inviteMembers = useInviteChatGroupMembers(workspaceId);
  const leaveRoom = useLeaveChatRoom(workspaceId);
  const sendRoomMessage = useSendChatRoomMessage(workspaceId);
  const blockUser = useBlockChatUser(workspaceId);
  const unblockUser = useUnblockChatUser(workspaceId);

  const { workspaceRoom, contacts: roomContacts, groups } = useMemo(
    () => sidebarFromChatRooms(rooms),
    [rooms],
  );

  const workspaceRoomId = workspaceRoom?.id ?? ensureRoom.data?.room_id ?? null;
  const unreadByRoomId = useMemo(() => unreadMapFromRooms(rooms), [rooms]);
  const unreadBadgesReady = roomsLoaded;

  const [target, setTarget] = useState<ChatSidebarTarget>({ kind: "workspace" });
  const [resolvedDmRoomId, setResolvedDmRoomId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [dmSettingsOpen, setDmSettingsOpen] = useState(false);
  const [leavingConversation, setLeavingConversation] = useState(false);
  const [blockingContact, setBlockingContact] = useState(false);
  const [unblockingContact, setUnblockingContact] = useState(false);
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const syncedRef = useRef(false);

  const activeContact = target.kind === "dm" ? target.contact : null;
  const activeGroup = target.kind === "group" ? target.group : null;
  const dmPeerUserId = activeContact?.user_id ?? null;
  const dmContactRoomId = activeContact?.dm_room_id ?? null;
  const { data: blockStatus } = useChatBlockStatus(
    workspaceId,
    dmPeerUserId ?? "",
    target.kind === "dm" && Boolean(dmPeerUserId),
  );
  const dmBlocked =
    Boolean(blockStatus?.blocked_by_me) || Boolean(blockStatus?.blocked_me);

  const contacts = useMemo(
    () => mergeActiveDmContact(roomContacts, activeContact, resolvedDmRoomId),
    [roomContacts, activeContact, resolvedDmRoomId],
  );

  useEffect(() => {
    if (!dmPeerUserId) {
      setResolvedDmRoomId(null);
      return;
    }
    if (dmContactRoomId) {
      setResolvedDmRoomId(dmContactRoomId);
      return;
    }

    let cancelled = false;
    void resolveDMRef.current
      .mutateAsync(dmPeerUserId)
      .then((room) => {
        if (cancelled || !room?.id) return;
        setResolvedDmRoomId(room.id);
        setTarget((current) =>
          current.kind === "dm" && current.contact.user_id === dmPeerUserId
            ? { kind: "dm", contact: { ...current.contact, dm_room_id: room.id } }
            : current,
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConnectError(err instanceof Error ? err.message : "dm_failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dmPeerUserId, dmContactRoomId]);

  const activeRoomId =
    target.kind === "workspace"
      ? workspaceRoomId
      : target.kind === "dm"
        ? (resolvedDmRoomId ?? activeContact?.dm_room_id ?? null)
        : (activeGroup?.room_id ?? null);

  const voiceAllowedRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const room of rooms) {
      if (room.kind === "dm" || room.kind === "group") {
        ids.add(room.id);
      }
    }
    return ids;
  }, [rooms]);

  const chatScopeRoomIds = useMemo(
    () =>
      selectLazyChatScopeRoomIds({
        rooms,
        activeRoomId: target.kind !== "workspace" ? activeRoomId : null,
        maxSubscriptions: runtimeConfig().chatScopeSubscriptionLimit,
      }),
    [rooms, activeRoomId, target.kind],
  );
  useChatRoomScopes(chatScopeRoomIds);

  const showLoading =
    !authReady ||
    (target.kind === "workspace" && ensureRoom.isPending && !workspaceRoomId) ||
    (target.kind === "dm" && !activeRoomId && (resolveDM.isPending || !roomsLoaded)) ||
    (target.kind === "group" && !activeRoomId);

  const { groupMemberProfiles, clearGroupMemberProfiles } = useNativeGroupMemberProfiles({
    workspaceId,
    targetKind: target.kind,
    activeGroup,
  });

  const { provisionAndSend, handleCreateGroup, handleAddGroupMembers, handleLeaveConversation } =
    useChatPageActions({
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
    });

  useEffect(() => {
    if (!authReady || syncedRef.current) return;
    syncedRef.current = true;
    void ensureRoom.mutate();
  }, [authReady, ensureRoom]);

  useEffect(() => {
    if (!authReady) return;
    void refetch();
  }, [authReady, refetch]);

  const headerTitle = chatHeaderTitle(
    target,
    contacts,
    groups,
    t("chat.title"),
    (params) => t("chat.dm_with", params),
  );
  const nameContext = useMemo(
    () =>
      buildChatNameContext(
        contacts,
        activeContact,
        activeGroup,
        groupMemberProfiles,
        workspaceMembers,
      ),
    [contacts, activeContact, activeGroup, groupMemberProfiles, workspaceMembers],
  );

  const chatVoiceToken = useChatVoiceToken();
  const mintVoiceToken = useCallback(
    async (roomId: string, callId: string) => chatVoiceToken.mutateAsync({ roomId, callId }),
    [chatVoiceToken],
  );
  const { voiceCall, startCall, acceptCall, declineCall, leaveCall, endCallForAll, markVoiceConnected, inCall } = useNativeVoiceCall({
    workspaceId,
    currentUserId,
    mintToken: mintVoiceToken,
    allowedRoomIds: voiceAllowedRoomIds,
  });
  const { handleStartVoiceCall, handleAcceptVoiceCall } = useChatVoiceHandlers({
    targetKind: target.kind,
    activeRoomId,
    activeContact,
    activeGroup,
    startCall,
    acceptCall,
    declineCall,
  });
  const typingLabel = useNativeTyping({
    workspaceId,
    roomId: activeRoomId,
    currentUserId,
    nameContext,
    draft,
    enabled: target.kind !== "workspace" && Boolean(activeRoomId) && !showLoading && !dmBlocked,
  });

  const handleBlockContact = useCallback(async () => {
    if (!activeContact) return;
    setBlockingContact(true);
    setConnectError(null);
    try {
      await blockUser.mutateAsync(activeContact.user_id);
      setTarget({ kind: "workspace" });
      setResolvedDmRoomId(null);
      setDmSettingsOpen(false);
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : t("chat.block_failed"));
    } finally {
      setBlockingContact(false);
    }
  }, [activeContact, blockUser, t]);

  const handleUnblockContact = useCallback(async () => {
    if (!activeContact) return;
    setUnblockingContact(true);
    setConnectError(null);
    try {
      await unblockUser.mutateAsync(activeContact.user_id);
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : t("chat.unblock_failed"));
    } finally {
      setUnblockingContact(false);
    }
  }, [activeContact, unblockUser, t]);

  if (!authReady) {
    return (
      <div className="flex h-full flex-col">
        <CollectionPageHeader icon={MessageSquare} title={t("chat.title")} />
        <CollectionPageState
          icon={MessageSquare}
          title={t("chat.loading")}
          description={t("chat.group_description")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPageContent
        target={target}
        setTarget={setTarget}
        currentUserId={currentUserId}
        headerTitle={headerTitle}
        contacts={contacts}
        groups={groups}
        activeContact={activeContact}
        activeGroup={activeGroup}
        workspaceId={workspaceId}
        messageRefreshKey={sendRoomMessage.isSuccess ? sendRoomMessage.submittedAt : 0}
        activeRoomId={activeRoomId}
        showLoading={showLoading}
        connectError={connectError}
        isWorkspaceError={isError}
        onRefetchWorkspace={() => void refetch()}
        workspaceRoomId={workspaceRoomId}
        unreadByRoomId={unreadByRoomId}
        unreadBadgesReady={unreadBadgesReady}
        nameContext={nameContext}
        replyTo={replyTo}
        onReplyToChange={setReplyTo}
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => void provisionAndSend()}
        groupSettingsOpen={groupSettingsOpen}
        onGroupSettingsOpenChange={setGroupSettingsOpen}
        dmSettingsOpen={dmSettingsOpen}
        onDmSettingsOpenChange={setDmSettingsOpen}
        dmBlocked={dmBlocked}
        dmBlockedByMe={Boolean(blockStatus?.blocked_by_me)}
        dmBlockedMe={Boolean(blockStatus?.blocked_me)}
        onBlockContact={() => void handleBlockContact()}
        onUnblockContact={() => void handleUnblockContact()}
        blockingContact={blockingContact}
        unblockingContact={unblockingContact}
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
          if (activeRoomId) {
            void handleLeaveConversation(activeRoomId, () => {
              setResolvedDmRoomId(null);
            });
          }
        }}
        onLeaveDm={() => {
          if (activeRoomId) {
            void handleLeaveConversation(activeRoomId, () => {
              setResolvedDmRoomId(null);
            });
          }
        }}
        groupMemberProfiles={groupMemberProfiles}
        typingLabel={typingLabel}
        onVoiceCall={() => void handleStartVoiceCall()}
        voiceCallDisabled={
          !activeRoomId ||
          inCall ||
          chatVoiceToken.isPending ||
          (target.kind === "dm" && dmBlocked)
        }
        t={t}
      />
      <VoiceCallOverlay
        state={voiceCall}
        onAccept={() => void handleAcceptVoiceCall()}
        onDecline={() => void declineCall()}
        onLeave={leaveCall}
        onEndForAll={() => void endCallForAll()}
        onConnected={markVoiceConnected}
      />
    </div>
  );
}
