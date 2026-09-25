"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOptionalWorkspace } from "../layout/workspace-context";
import {
  mergeActiveDmContact,
  sidebarFromChatRooms,
  unreadMapFromRooms,
  mentionUnreadMapFromRooms,
  roomPreviewMapFromRooms,
  selectLazyChatScopeRoomIds,
  useBlockChatUser,
  useChatBlockStatus,
  useChatRooms,
  useCreateChatGroup,
  useEnsureWorkspaceChatRoom,
  useInviteChatGroupMembers,
  useLeaveChatRoom,
  useChatRoomMembers,
  useChatNicknames,
  useResolveDMRoom,
  useSendChatRoomMessage,
  useSendChatThreadMessage,
  useSendChatVoiceMessage,
  useSendChatFileMessage,
  useUnblockChatUser,
  useChatSendOutboxFlush,
  useChatSendOutboxCount,
  useSyncChatRoomsOnAuth,
} from "@uniwork/core/chat";
import { useActiveChatRoomStore } from "@uniwork/core/chat/active-chat-room-store";
import { useAuthStore } from "@uniwork/core/auth";
import { useChatRoomScopes } from "@uniwork/core/realtime";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useCurrentMember } from "@uniwork/core/permissions";
import type { ChatSidebarTarget } from "./chat-sidebar";
import type { ChatMessage } from "./chat-messages";
import type { ComposerMessagePriority } from "@uniwork/core/chat/composer-priority";
import { toggleComposerPriority } from "@uniwork/core/chat/composer-priority";
import { useChatReminderNotifications } from "./use-chat-reminder-notify";
import { chatErrorMessage } from "./chat-error-message";
import {
  applySelfAvatarToNameContext,
  buildMemberAvatarUrlMap,
  withSelfAvatarFromUser,
} from "./chat-member-avatar";
import { buildChatNameContext, chatHeaderTitle, workspaceRoomTitle } from "./chat-page-utils";
import { buildChatMentionCandidates } from "./chat-mention-utils";
import { memberDisplayLabel } from "./workspace-member-picker-utils";
import { ChatPageAuthLoading } from "./chat-page-auth-loading";
import { ChatPageContent } from "./chat-page-content";
import { useChatPageActions } from "./use-chat-page-actions";
import { useChatMentionNotify } from "./use-chat-mention-notify";
import { useChatMediaSend } from "./use-chat-media-send";
import { useChatPageSignals } from "./use-chat-page-signals";
import { useChatVoiceCall } from "./chat-voice-call-host";
import { useChatVoiceHandlers } from "./use-chat-voice-handlers";
import { useNativeGroupMemberProfiles } from "./use-native-group-member-profiles";
import { useNativeTyping } from "./use-native-typing";
import { chatComposerDraftKey } from "./chat-composer-draft-key";
import { readChatComposerDraft, useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import { useMembers } from "@uniwork/core/workspaces";
import { useResolvedRoomPermissions } from "./use-resolved-room-permissions";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { Member } from "@uniwork/core/types/workspace";

/* Stable fallbacks while queries load: a fresh `[]` / `{}` per render would
   change every memo downstream (and re-render the memoised sidebar). */
const NO_ROOMS: ChatRoomRecord[] = [];
const NO_NICKNAMES: Record<string, string> = {};
const NO_MEMBERS: Member[] = [];

export function ChatPageView({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { t } = useTranslation();
  const workspaceName = useOptionalWorkspace()?.workspace.name;
  useChatReminderNotifications(workspaceId);
  const authReady = useAuthStore((s) => s.status === "authed");
  const authUser = useAuthStore((s) => (s.status === "authed" ? s.user : null));
  const { data: rooms = NO_ROOMS, isError, refetch, isSuccess: roomsLoaded } = useChatRooms(workspaceId);
  const { data: nicknamesByUserId = NO_NICKNAMES } = useChatNicknames(workspaceId);
  const { data: workspaceMembers = NO_MEMBERS } = useMembers(workspaceId);
  const refetchRooms = useCallback(() => void refetch(), [refetch]);
  const ensureRoom = useEnsureWorkspaceChatRoom(workspaceId);
  const resolveDM = useResolveDMRoom(workspaceId);
  const resolveDMRef = useRef(resolveDM);
  resolveDMRef.current = resolveDM;
  const createGroup = useCreateChatGroup(workspaceId);
  const inviteMembers = useInviteChatGroupMembers(workspaceId);
  const leaveRoom = useLeaveChatRoom(workspaceId);
  const sendRoomMessage = useSendChatRoomMessage(workspaceId);
  const sendVoiceMessage = useSendChatVoiceMessage(workspaceId);
  const sendFileMessage = useSendChatFileMessage(workspaceId);
  useChatSendOutboxFlush(workspaceId, currentUserId);
  const pendingOutboxCount = useChatSendOutboxCount(workspaceId, currentUserId);
  const blockUser = useBlockChatUser(workspaceId);
  const unblockUser = useUnblockChatUser(workspaceId);

  const { workspaceRoom, contacts: roomContacts, groups, channels } = useMemo(
    () => sidebarFromChatRooms(rooms),
    [rooms],
  );

  const workspaceRoomId = workspaceRoom?.id ?? ensureRoom.data?.room_id ?? null;
  const workspaceRoomName = workspaceRoomTitle(workspaceRoom?.name, workspaceName, t("chat.workspace_room"));
  const unreadByRoomId = useMemo(() => unreadMapFromRooms(rooms), [rooms]);
  const mentionUnreadByRoomId = useMemo(() => mentionUnreadMapFromRooms(rooms), [rooms]);
  const roomPreviewsByRoomId = useMemo(() => roomPreviewMapFromRooms(rooms), [rooms]);
  const unreadBadgesReady = roomsLoaded;

  const [target, setTarget] = useState<ChatSidebarTarget>({ kind: "workspace" });
  const [resolvedDmRoomId, setResolvedDmRoomId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [dmSettingsOpen, setDmSettingsOpen] = useState(false);
  const [leavingConversation, setLeavingConversation] = useState(false);
  const [blockingContact, setBlockingContact] = useState(false);
  const [unblockingContact, setUnblockingContact] = useState(false);
  const [invitingMembers, setInvitingMembers] = useState(false);
  const [composerPriority, setComposerPriority] = useState<ComposerMessagePriority | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const currentMember = useCurrentMember(workspaceId);

  const activeContact = target.kind === "dm" ? target.contact : null;
  const activeGroup = useMemo(() => {
    if (target.kind !== "group") return null;
    return groups.find((group) => group.id === target.group.id) ?? target.group;
  }, [groups, target]);
  const activeChannel = useMemo(() => {
    if (target.kind !== "channel") return null;
    return channels.find((channel) => channel.id === target.channel.id) ?? target.channel;
  }, [channels, target]);
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
          setConnectError(chatErrorMessage(err, t, t("chat.dm_failed")));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dmPeerUserId, dmContactRoomId, t]);

  const activeRoomId =
    target.kind === "workspace"
      ? workspaceRoomId
      : target.kind === "dm"
        ? (resolvedDmRoomId ?? activeContact?.dm_room_id ?? null)
        : target.kind === "channel"
          ? (activeChannel?.id ?? null)
          : (activeGroup?.room_id ?? null);
  const sendThreadMessage = useSendChatThreadMessage(workspaceId, activeRoomId ?? "");

  useEffect(() => {
    setMessageSearchOpen(false);
    setJumpToMessageId(null);
    setComposerPriority(null);
    setActiveThreadRootId(null);
  }, [activeRoomId]);

  useEffect(() => {
    useActiveChatRoomStore.getState().setActiveRoom(workspaceId, activeRoomId);
    return () => {
      useActiveChatRoomStore.getState().setActiveRoom(null, null);
    };
  }, [workspaceId, activeRoomId]);

  useChatMentionNotify({ currentUserId, activeRoomId });

  const { data: activeRoomMembers = [] } = useChatRoomMembers(
    workspaceId,
    activeRoomId ?? "",
    Boolean(activeRoomId),
  );
  const activeRoomRecord = useMemo(
    () => (activeRoomId ? rooms.find((room) => room.id === activeRoomId) : undefined),
    [activeRoomId, rooms],
  );
  const roomPermissions = useResolvedRoomPermissions({
    room: activeRoomRecord,
    members: activeRoomMembers,
    currentUserId,
    wsRole: currentMember.role,
  });
  const chatSendRestricted = !roomPermissions.canSendMessages;
  const chatSendMutedByModerator = roomPermissions.sendRestricted;
  const canPinMessages = roomPermissions.canPinContent;
  const canCreatePolls = roomPermissions.canCreatePolls;
  const canCreateNotes = roomPermissions.canCreateNotes;

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
  useChatPageSignals(workspaceId, currentUserId, authReady);

  const peerLastReadAt =
    target.kind === "dm" ? (activeRoomRecord?.peer_last_read_at ?? null) : null;

  const showLoading =
    !authReady ||
    (target.kind === "workspace" && ensureRoom.isPending && !workspaceRoomId) ||
    (target.kind === "dm" && !activeRoomId && (resolveDM.isPending || !roomsLoaded)) ||
    (target.kind === "group" && !activeRoomId) ||
    (target.kind === "channel" && !activeRoomId);

  const { groupMemberProfiles, clearGroupMemberProfiles } = useNativeGroupMemberProfiles({
    workspaceId,
    targetKind: target.kind,
    activeGroup,
    activeChannel,
  });

  const mentionCandidates = useMemo(
    () =>
      buildChatMentionCandidates(
        target.kind,
        currentUserId,
        workspaceMembers,
        groupMemberProfiles,
        memberDisplayLabel,
      ),
    [currentUserId, groupMemberProfiles, target.kind, workspaceMembers],
  );
  const mentionAllLabel = t("chat.mention_all");
  // The draft lives in the composer's store, keyed by conversation: typing
  // re-renders the composer, not this page and its sidebar.
  const composerDraftKey = chatComposerDraftKey(workspaceId, target);
  const readComposerDraft = useCallback(() => readChatComposerDraft(composerDraftKey), [composerDraftKey]);
  const writeComposerDraft = useCallback(
    (value: string) => useChatComposerDraftStore.getState().setDraft(composerDraftKey, value),
    [composerDraftKey],
  );

  const { provisionAndSend, sendMessageBody, handleCreateGroup, handleAddGroupMembers, handleLeaveConversation } =
    useChatPageActions({
      workspaceId,
      currentUserId,
      target,
      setTarget,
      activeRoomId,
      activeGroup,
      activeChannel,
      getDraft: readComposerDraft,
      setDraft: writeComposerDraft,
      replyTo,
      setReplyTo,
      activeThreadRootId,
      ensureRoom,
      sendRoomMessage,
      sendThreadMessage,
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
      mentionCandidates,
      mentionAllLabel,
      composerPriority,
      setComposerPriority,
    });

  useSyncChatRoomsOnAuth(workspaceId, ensureRoom);

  const headerTitle = chatHeaderTitle(
    target,
    contacts,
    groups,
    workspaceRoomName,
    (params) => t("chat.dm_with", params),
    nicknamesByUserId,
    channels,
  );
  const memberAvatarByUserId = useMemo(
    () =>
      withSelfAvatarFromUser(
        buildMemberAvatarUrlMap(workspaceMembers),
        authUser?.id,
        authUser?.avatar_url,
      ),
    [workspaceMembers, authUser?.avatar_url, authUser?.id],
  );
  const nameContext = useMemo(
    () =>
      applySelfAvatarToNameContext(
        buildChatNameContext(
          contacts,
          activeContact,
          activeGroup,
          groupMemberProfiles,
          workspaceMembers,
          nicknamesByUserId,
        ),
        authUser?.id,
        authUser?.avatar_url,
      ),
    [contacts, activeContact, activeGroup, groupMemberProfiles, workspaceMembers, nicknamesByUserId, authUser?.avatar_url, authUser?.id],
  );

  const { startCall, acceptCall, declineCall, inCall } = useChatVoiceCall();
  const { handleStartVoiceCall, handleStartVideoCall } = useChatVoiceHandlers({
    targetKind: target.kind,
    activeRoomId,
    activeContact,
    activeGroup,
    activeChannel,
    startCall,
    acceptCall,
    declineCall,
  });
  const typingLabel = useNativeTyping({
    workspaceId,
    roomId: activeRoomId,
    currentUserId,
    nameContext,
    draftKey: composerDraftKey,
    enabled: Boolean(activeRoomId) && !showLoading && !dmBlocked,
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
      setConnectError(chatErrorMessage(err, t, t("chat.block_failed")));
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
      setConnectError(chatErrorMessage(err, t, t("chat.unblock_failed")));
    } finally {
      setUnblockingContact(false);
    }
  }, [activeContact, unblockUser, t]);

  const { handleSendVoice, handleSendFile } = useChatMediaSend({
    activeRoomId,
    targetKind: target.kind,
    replyToId: replyTo?.id,
    ensureRoom,
    sendVoiceMessage,
    sendFileMessage,
    clearReply: () => setReplyTo(null),
  });

  if (!authReady) {
    return <ChatPageAuthLoading />;
  }

  const callControlsDisabled =
    !activeRoomId || inCall || (target.kind === "dm" && dmBlocked);
  const leaveRoomAnd = (cleanup: () => void) => {
    if (activeRoomId) void handleLeaveConversation(activeRoomId, cleanup);
  };
  const messageRefreshKey = Math.max(
    sendRoomMessage.isSuccess ? sendRoomMessage.submittedAt : 0,
    sendVoiceMessage.isSuccess ? sendVoiceMessage.submittedAt : 0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPageContent
        target={target}
        setTarget={setTarget}
        currentUserId={currentUserId}
        headerTitle={headerTitle}
        workspaceRoomTitle={workspaceRoomName}
        contacts={contacts}
        groups={groups}
        channels={channels}
        activeContact={activeContact}
        activeGroup={activeGroup}
        activeChannel={activeChannel}
        workspaceId={workspaceId}
        messageRefreshKey={messageRefreshKey}
        activeRoomId={activeRoomId}
        showLoading={showLoading}
        connectError={connectError}
        pendingOutboxCount={pendingOutboxCount}
        isWorkspaceError={isError}
        onRefetchWorkspace={refetchRooms}
        workspaceRoomId={workspaceRoomId}
        unreadByRoomId={unreadByRoomId}
        mentionUnreadByRoomId={mentionUnreadByRoomId}
        roomPreviewsByRoomId={roomPreviewsByRoomId}
        unreadBadgesReady={unreadBadgesReady}
        nicknamesByUserId={nicknamesByUserId}
        nameContext={nameContext}
        replyTo={replyTo}
        onReplyToChange={setReplyTo}
        activeThreadRootId={activeThreadRootId}
        onActiveThreadRootIdChange={setActiveThreadRootId}
        composerDraftKey={composerDraftKey}
        composerPriority={composerPriority}
        onComposerPriorityChange={setComposerPriority}
        onSend={() => void provisionAndSend()}
        onSendMedia={(body) => void sendMessageBody(body)}
        onSendVoice={handleSendVoice}
        onSendFile={handleSendFile}
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
        channelSettingsOpen={channelSettingsOpen}
        onChannelSettingsOpenChange={setChannelSettingsOpen}
        creatingGroup={creatingGroup}
        onCreateGroup={handleCreateGroup}
        invitingMembers={invitingMembers}
        onAddGroupMembers={handleAddGroupMembers}
        leavingConversation={leavingConversation}
        onLeaveGroup={() => leaveRoomAnd(() => setResolvedDmRoomId(null))}
        onLeaveDm={() => leaveRoomAnd(() => setResolvedDmRoomId(null))}
        onLeaveChannel={() => leaveRoomAnd(() => setChannelSettingsOpen(false))}
        groupMemberProfiles={groupMemberProfiles}
        mentionCandidates={mentionCandidates}
        typingLabel={typingLabel}
        onVoiceCall={() => void handleStartVoiceCall()}
        voiceCallDisabled={callControlsDisabled}
        onVideoCall={() => void handleStartVideoCall()}
        videoCallDisabled={callControlsDisabled}
        workspaceMembers={workspaceMembers}
        memberAvatarByUserId={memberAvatarByUserId}
        workspaceSettingsOpen={workspaceSettingsOpen}
        onWorkspaceSettingsOpenChange={setWorkspaceSettingsOpen}
        messageSearchOpen={messageSearchOpen}
        onMessageSearchOpenChange={setMessageSearchOpen}
        jumpToMessageId={jumpToMessageId}
        onJumpToMessageIdChange={setJumpToMessageId}
        chatSendRestricted={chatSendRestricted}
        chatSendMutedByModerator={chatSendMutedByModerator}
        canPinMessages={canPinMessages}
        canCreatePolls={canCreatePolls}
        canCreateNotes={canCreateNotes}
        peerLastReadAt={peerLastReadAt}
        t={t}
      />
    </div>
  );
}
