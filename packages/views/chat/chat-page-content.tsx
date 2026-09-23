"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { paths } from "@uniwork/core/paths";
import type { Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalNavigation } from "../navigation";
import { ChatRoomComposer, type ChatComposerHandle, type ComposerAttachAction } from "./chat-composer";
import { toggleComposerPriority } from "@uniwork/core/chat/composer-priority";
import { ChatSidebar } from "./chat-sidebar";
import { NativeChatMessagePanel } from "./native-chat-message-panel";
import { ChatPinnedMessagesBar } from "./chat-pinned-messages-bar";
import { ChatMessageSearchBar } from "./chat-message-search-bar";
import { ChatRealtimeStatusBanner } from "./chat-realtime-status-banner";
import type { ChatPageContentProps } from "./chat-page-content-props";
import { ChatPageContentDialogs } from "./chat-page-content-dialogs";
import { ChatPageContentSheets } from "./chat-page-content-sheets";
import {
  ChatPageConversationToolbar,
  chatPageEmptyLabel,
  ChatPageConversationIntro,
} from "./chat-page-conversation-toolbar";
import { ChatFrameListToggle, ChatPageEmptyConversation } from "./chat-page-empty-conversation";
import { ChatConversationSkeleton } from "./chat-conversation-skeleton";
import { ChatConversationNotices } from "./chat-notice";
import { chatComposerPlaceholder } from "./chat-composer-placeholder";
import { useChatFollowUpUi } from "./use-chat-follow-up-ui";
import { useChatCatchUpUi } from "./use-chat-catch-up-ui";
import { useChatPagePanels } from "./use-chat-page-panels";

export function ChatPageContent({
  target,
  setTarget,
  currentUserId,
  headerTitle,
  contacts,
  groups,
  channels,
  workHubEnabled,
  activeContact,
  activeGroup,
  activeChannel,
  workspaceId,
  messageRefreshKey,
  activeRoomId,
  showLoading,
  connectError,
  pendingOutboxCount = 0,
  isWorkspaceError,
  onRefetchWorkspace,
  workspaceRoomId,
  unreadByRoomId,
  mentionUnreadByRoomId,
  roomPreviewsByRoomId,
  unreadBadgesReady,
  workspaceRoomTitle,
  nicknamesByUserId,
  nameContext,
  replyTo,
  onReplyToChange,
  activeThreadRootId = null,
  onActiveThreadRootIdChange,
  composerDraftKey,
  composerPriority,
  onComposerPriorityChange,
  onSend,
  onSendMedia,
  onSendVoice,
  onSendFile,
  groupSettingsOpen,
  onGroupSettingsOpenChange,
  dmSettingsOpen,
  onDmSettingsOpenChange,
  dmBlocked,
  dmBlockedByMe,
  dmBlockedMe,
  onBlockContact,
  onUnblockContact,
  blockingContact,
  unblockingContact,
  addMembersOpen,
  onAddMembersOpenChange,
  createGroupOpen,
  onCreateGroupOpenChange,
  channelSettingsOpen,
  onChannelSettingsOpenChange,
  creatingGroup,
  onCreateGroup,
  invitingMembers,
  onAddGroupMembers,
  leavingConversation,
  onLeaveGroup,
  onLeaveDm,
  onLeaveChannel,
  groupMemberProfiles,
  mentionCandidates,
  typingLabel,
  onVoiceCall,
  voiceCallDisabled,
  onVideoCall,
  videoCallDisabled,
  workspaceMembers,
  workspaceSettingsOpen,
  onWorkspaceSettingsOpenChange,
  messageSearchOpen,
  onMessageSearchOpenChange,
  jumpToMessageId,
  onJumpToMessageIdChange,
  chatSendRestricted,
  chatSendMutedByModerator,
  canPinMessages,
  canCreatePolls,
  canCreateNotes,
  peerLastReadAt = null,
  t,
}: ChatPageContentProps) {
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [createReminderOpen, setCreateReminderOpen] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const followUpUi = useChatFollowUpUi(workspaceId, workHubEnabled);
  const catchUpUi = useChatCatchUpUi(workspaceId, activeRoomId, activeThreadRootId);
  const {
    sidebarCollapsed,
    sidebarRef,
    conversationRef,
    showMobileList,
    showMobileChat,
    handleTargetChange,
    handleBackToConversationList,
    handleToggleSidebar,
  } = useChatPagePanels({
    setTarget,
    activeRoomId,
    workspaceRoomId,
    contacts,
    groups,
    channels,
    roomsReady: unreadBadgesReady,
    showLoading,
  });
  const backToListLabel = t("chat.back_to_conversations");

  // The sidebar is memoised; hand it references that only move when their
  // meaning does.
  // The message list hands focus back to the composer after reply, thread,
  // cancel and delete.
  const composerRef = useRef<ChatComposerHandle>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  const openFollowUpsRef = useRef(followUpUi.openList);
  openFollowUpsRef.current = followUpUi.openList;
  const openFollowUps = useCallback(() => openFollowUpsRef.current(), []);
  const navigation = useOptionalNavigation();
  const pushRoute = navigation?.push;
  const handleJoinedWorkspace = useCallback(
    (joined: Workspace | null) => {
      pushRoute?.(joined ? paths.workspace(joined.organization_slug, joined.slug).chat() : paths.workspaces());
    },
    [pushRoute],
  );

  // ⌘/Ctrl+F searches the room only while focus is inside the conversation;
  // anywhere else the browser keeps its own find.
  useEffect(() => {
    if (!activeRoomId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      const root = conversationRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return;
      event.preventDefault();
      onMessageSearchOpenChange(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRoomId, conversationRef, onMessageSearchOpenChange]);

  const showListToggleInFrame = sidebarCollapsed && (showLoading || !activeRoomId || messageSearchOpen);

  const handleAttachAction = (action: ComposerAttachAction) => {
    if (action === "create_poll") {
      if (target.kind === "dm") return;
      if (!canCreatePolls) {
        toast.error(t("chat.poll_create_forbidden"));
        return;
      }
      if (!activeRoomId) return;
      setCreatePollOpen(true);
      return;
    }
    if (action === "create_reminder") {
      if (!canCreateNotes) {
        toast.error(t("chat.reminder_create_forbidden"));
        return;
      }
      if (!activeRoomId) return;
      setCreateReminderOpen(true);
      return;
    }
    if (action === "create_note") {
      if (!canCreateNotes) {
        toast.error(t("chat.note_create_forbidden"));
        return;
      }
      if (!activeRoomId) return;
      setCreateNoteOpen(true);
      return;
    }
    if (action === "create_post") {
      if (!canCreateNotes) {
        toast.error(t("chat.post_create_forbidden"));
        return;
      }
      if (!activeRoomId) return;
      setCreatePostOpen(true);
      return;
    }
    if (action === "mark_important") {
      onComposerPriorityChange(toggleComposerPriority(composerPriority, "important"));
      return;
    }
    if (action === "mark_urgent") {
      onComposerPriorityChange(toggleComposerPriority(composerPriority, "urgent"));
      return;
    }
    toast.info(t("chat.composer_coming_soon"));
  };

  return (
    <>
      <ChatPageContentDialogs
        target={target}
        setTarget={setTarget}
        workspaceId={workspaceId}
        headerTitle={headerTitle}
        contacts={contacts}
        activeContact={activeContact}
        activeGroup={activeGroup}
        activeChannel={activeChannel}
        currentUserId={currentUserId}
        workspaceRoomId={workspaceRoomId}
        nicknamesByUserId={nicknamesByUserId}
        groupMemberProfiles={groupMemberProfiles}
        groupSettingsOpen={groupSettingsOpen}
        onGroupSettingsOpenChange={onGroupSettingsOpenChange}
        dmSettingsOpen={dmSettingsOpen}
        onDmSettingsOpenChange={onDmSettingsOpenChange}
        channelSettingsOpen={channelSettingsOpen}
        onChannelSettingsOpenChange={onChannelSettingsOpenChange}
        workHubEnabled={workHubEnabled}
        dmBlockedByMe={dmBlockedByMe}
        dmBlockedMe={dmBlockedMe}
        onBlockContact={onBlockContact}
        onUnblockContact={onUnblockContact}
        blockingContact={blockingContact}
        unblockingContact={unblockingContact}
        addMembersOpen={addMembersOpen}
        onAddMembersOpenChange={onAddMembersOpenChange}
        invitingMembers={invitingMembers}
        onAddGroupMembers={onAddGroupMembers}
        leavingConversation={leavingConversation}
        onLeaveGroup={onLeaveGroup}
        onLeaveDm={onLeaveDm}
        onLeaveChannel={onLeaveChannel}
        workspaceMembers={workspaceMembers}
        workspaceSettingsOpen={workspaceSettingsOpen}
        onWorkspaceSettingsOpenChange={onWorkspaceSettingsOpenChange}
        activeRoomId={activeRoomId}
        canPinMessages={canPinMessages}
        t={t}
        onMessageSearchOpenChange={onMessageSearchOpenChange}
        createPollOpen={createPollOpen}
        onCreatePollOpenChange={setCreatePollOpen}
        createReminderOpen={createReminderOpen}
        onCreateReminderOpenChange={setCreateReminderOpen}
        createNoteOpen={createNoteOpen}
        onCreateNoteOpenChange={setCreateNoteOpen}
        createPostOpen={createPostOpen}
        onCreatePostOpenChange={setCreatePostOpen}
      />

      {/* Chat fills the content inset: the message list is the screen here, so
          no centred card and no gutter — the panels reach the shell edges. */}
      <div className="flex h-full min-h-0 w-full flex-1">
        {/* Exactly one h1 in every state: the list's title and the room name
            are sections under it, and either may be off screen. */}
        <h1 className="sr-only">{t("chat.title")}</h1>
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 overflow-hidden bg-surface",
            sidebarCollapsed
              ? "lg:grid lg:grid-cols-[minmax(0,1fr)]"
              : "lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]",
          )}
        >
          <div
            ref={sidebarRef}
            className={cn(
              "min-h-0 min-w-0 flex-col overflow-hidden",
              showMobileList ? "flex w-full flex-1" : "hidden",
              sidebarCollapsed ? "lg:hidden" : "lg:flex lg:w-auto lg:flex-none",
            )}
          >
            <ChatSidebar
              currentUserId={currentUserId}
              workspaceId={workspaceId}
              target={target}
              onTargetChange={handleTargetChange}
              contacts={contacts}
              groups={groups}
              channels={channels}
              workHubEnabled={workHubEnabled}
              onOpenFollowUps={openFollowUps}
              onJoinedWorkspace={handleJoinedWorkspace}
              onCreateGroup={onCreateGroup}
              creatingGroup={creatingGroup}
              createGroupOpen={createGroupOpen}
              onCreateGroupOpenChange={onCreateGroupOpenChange}
              workspaceRoomId={workspaceRoomId}
              unreadByRoomId={unreadByRoomId}
              mentionUnreadByRoomId={mentionUnreadByRoomId}
              roomPreviewsByRoomId={roomPreviewsByRoomId}
              unreadBadgesReady={unreadBadgesReady}
              nicknamesByUserId={nicknamesByUserId}
              loading={!unreadBadgesReady && !isWorkspaceError}
              loadError={isWorkspaceError}
              onRetry={onRefetchWorkspace}
              workspaceRoomTitle={workspaceRoomTitle}
              onCollapse={handleToggleSidebar}
              embedded
            />
          </div>

          <div
            ref={conversationRef}
            className={cn(
              "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background",
              showMobileChat ? "flex flex-1" : "hidden",
              "lg:flex lg:flex-1",
            )}
          >
            {showListToggleInFrame ? <ChatFrameListToggle t={t} onShowList={handleToggleSidebar} /> : null}
            <ChatRealtimeStatusBanner pendingOutboxCount={pendingOutboxCount} />
            <ChatConversationNotices
              workspaceLoadFailed={isWorkspaceError && target.kind === "workspace"}
              onRetryWorkspace={onRefetchWorkspace}
              connectError={target.kind === "workspace" ? null : connectError}
              blockedNotice={
                target.kind === "dm" && dmBlocked
                  ? dmBlockedByMe
                    ? t("chat.block_active_banner")
                    : t("chat.blocked_me_banner")
                  : null
              }
            />

            {showLoading ? (
              <ChatConversationSkeleton />
            ) : activeRoomId ? (
              <>
                {messageSearchOpen ? (
                  <ChatMessageSearchBar
                    workspaceId={workspaceId}
                    roomId={activeRoomId}
                    currentUserId={currentUserId}
                    nameContext={nameContext}
                    youLabel={t("chat.you")}
                    onClose={() => onMessageSearchOpenChange(false)}
                    onJumpToMessage={onJumpToMessageIdChange}
                  />
                ) : null}
                {!messageSearchOpen ? (
                  <ChatPageConversationToolbar
                    target={target}
                    headerTitle={headerTitle}
                    contacts={contacts}
                    activeContact={activeContact}
                    activeGroup={activeGroup}
                    activeChannel={activeChannel}
                    workspaceMembersCount={workspaceMembers.length}
                    nicknamesByUserId={nicknamesByUserId}
                    backToListLabel={backToListLabel}
                    sidebarCollapsed={sidebarCollapsed}
                    onBack={handleBackToConversationList}
                    onToggleSidebar={handleToggleSidebar}
                    onOpenWorkspaceSettings={() => onWorkspaceSettingsOpenChange(true)}
                    onOpenGroupSettings={() => onGroupSettingsOpenChange(true)}
                    onOpenChannelSettings={() => onChannelSettingsOpenChange(true)}
                    onOpenDmSettings={() => onDmSettingsOpenChange(true)}
                    onCatchUp={catchUpUi.onCatchUp}
                    catchUpDisabled={catchUpUi.loading}
                    onOpenRecordings={
                      target.kind === "dm" || target.kind === "group" || target.kind === "channel"
                        ? () => setRecordingsOpen(true)
                        : undefined
                    }
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                    onVideoCall={onVideoCall}
                    videoCallDisabled={videoCallDisabled}
                    onSearch={() => onMessageSearchOpenChange(true)}
                  />
                ) : null}

                {!messageSearchOpen ? (
                  <ChatPinnedMessagesBar
                    workspaceId={workspaceId}
                    roomId={activeRoomId}
                    canPinMessages={canPinMessages}
                    onJumpToMessage={onJumpToMessageIdChange}
                  />
                ) : null}

                <NativeChatMessagePanel
                  workspaceId={workspaceId}
                  roomId={activeRoomId}
                  currentUserId={currentUserId}
                  nameContext={nameContext}
                  youLabel={t("chat.you")}
                  emptyLabel={chatPageEmptyLabel(t, target, headerTitle, nicknamesByUserId)}
                  intro={
                    <ChatPageConversationIntro
                      target={target}
                      headerTitle={headerTitle}
                      activeChannel={activeChannel}
                      nicknamesByUserId={nicknamesByUserId}
                      t={t}
                      onViewMembers={() => onWorkspaceSettingsOpenChange(true)}
                      onAddMembers={() => onAddMembersOpenChange(true)}
                      workspaceMemberCount={workspaceMembers.length}
                    />
                  }
                  replyTo={replyTo}
                  onReplyToChange={onReplyToChange}
                  workHubEnabled={workHubEnabled}
                  threadsEnabled={
                    workHubEnabled &&
                    (target.kind === "channel" ||
                      target.kind === "group" ||
                      target.kind === "workspace")
                  }
                  onFollowUp={followUpUi.onFollowUp}
                  onActiveThreadRootIdChange={onActiveThreadRootIdChange}
                  refreshKey={messageRefreshKey}
                  showSenderName={
                    target.kind === "workspace" ||
                    target.kind === "group" ||
                    target.kind === "channel"
                  }
                  embedded
                  anchorMessageId={jumpToMessageId}
                  onClearAnchor={() => onJumpToMessageIdChange(null)}
                  canPinMessages={canPinMessages}
                  canSendMessages={!dmBlocked && !chatSendRestricted}
                  onFocusComposer={focusComposer}
                  peerLastReadAt={peerLastReadAt}
                />

                <ChatRoomComposer
                  ref={composerRef}
                  workspaceId={workspaceId}
                  draftKey={composerDraftKey}
                  composerPriority={composerPriority}
                  onComposerPriorityChange={onComposerPriorityChange}
                  onSend={onSend}
                  onSendMedia={onSendMedia}
                  onSendVoice={onSendVoice}
                  onSendFile={onSendFile}
                  disabled={showLoading || !activeRoomId || dmBlocked || chatSendRestricted}
                  mentionCandidates={
                    target.kind === "workspace" ||
                    target.kind === "group" ||
                    target.kind === "channel"
                      ? mentionCandidates
                      : undefined
                  }
                  placeholder={chatComposerPlaceholder(t, {
                    dmBlocked,
                    chatSendMutedByModerator,
                    chatSendRestricted,
                  })}
                  sendLabel={t("chat.send")}
                  typingLabel={typingLabel}
                  onAttachAction={handleAttachAction}
                  showCreatePoll={canCreatePolls && target.kind !== "dm"}
                />
              </>
            ) : (
              <ChatPageEmptyConversation
                t={t}
                listHidden={sidebarCollapsed}
                onShowList={handleToggleSidebar}
                onBackToList={handleBackToConversationList}
              />
            )}
          </div>
        </div>
      </div>
      <ChatPageContentSheets
        followUpSheet={followUpUi.sheet}
        catchUpOpen={catchUpUi.open}
        onCatchUpOpenChange={catchUpUi.setOpen}
        catchUpLoading={catchUpUi.loading}
        catchUpError={catchUpUi.error}
        catchUpResult={catchUpUi.result}
        onCatchUpRetry={catchUpUi.onRetry}
        onJumpToMessage={onJumpToMessageIdChange}
        workspaceId={workspaceId}
        recordingsOpen={recordingsOpen}
        onRecordingsOpenChange={setRecordingsOpen}
        activeRoomId={activeRoomId}
        currentUserId={currentUserId}
        nameContext={nameContext}
      />
    </>
  );
}
