"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatComposerHandle, ComposerAttachAction } from "./chat-composer";
import { toggleComposerPriority } from "@uniwork/core/chat/composer-priority";
import { ChatSidebar, type ChatSidebarTarget } from "./chat-sidebar";
import { ChatPageConversation } from "./chat-page-conversation";
import { ChatThreadSidePanel } from "./chat-thread-side-panel";
import { ChatPageInfoPanel } from "./chat-page-content-info";
import { ChatRealtimeStatusBanner } from "./chat-realtime-status-banner";
import type { ChatPageContentProps } from "./chat-page-content-props";
import { ChatPageContentDialogs } from "./chat-page-content-dialogs";
import { ChatPageContentSheets } from "./chat-page-content-sheets";
import { ChatFrameListToggle, ChatPageEmptyConversation } from "./chat-page-empty-conversation";
import { ChatConversationSkeleton } from "./chat-conversation-skeleton";
import { ChatConversationNotices } from "./chat-notice";
import { ChatPersonMessageProvider } from "./chat-person-card";
import { useChatVoiceCall } from "./chat-voice-call-host";
import { useChatPersonActions } from "./use-chat-person-actions";
import { chatComposerBlockProps } from "./chat-composer-placeholder";
import { useChatFollowUpUi } from "./use-chat-follow-up-ui";
import { useChatCatchUpUi } from "./use-chat-catch-up-ui";
import { useChatPagePanels } from "./use-chat-page-panels";

export function ChatPageContent(props: ChatPageContentProps) {
  const {
    target,
    setTarget,
    currentUserId,
    headerTitle,
    contacts,
    groups,
    channels,
    workspaceId,
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
    activeThreadRootId = null,
    composerDraftKey,
    composerPriority,
    onComposerPriorityChange,
    onSendThreadReply,
    onSendThreadMedia,
    onGroupSettingsOpenChange,
    dmBlocked,
    dmBlockedByMe,
    onCreateGroupOpenChange,
    createGroupOpen,
    onChannelSettingsOpenChange,
    creatingGroup,
    onCreateGroup,
    mentionCandidates,
    memberAvatarByUserId,
    onWorkspaceSettingsOpenChange,
    onMessageSearchOpenChange,
    onJumpToMessageIdChange,
    chatSendRestricted,
    chatSendMutedByModerator,
    canPinMessages,
    canModerate,
    canCreatePolls,
    canCreateNotes,
    t,
  } = props;
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [createReminderOpen, setCreateReminderOpen] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const { startCall } = useChatVoiceCall();
  const { messagePerson, callPerson } = useChatPersonActions({
    workspaceId, currentUserId, nameContext, contacts, setTarget, startCall,
    closeSheets: () => {
      [onWorkspaceSettingsOpenChange, onGroupSettingsOpenChange, onChannelSettingsOpenChange].forEach((close) => close(false));
    },
  });
  const followUpUi = useChatFollowUpUi(workspaceId);
  const {
    sidebarCollapsed,
    sidebarRef,
    conversationRef,
    showMobileList,
    showMobileChat,
    handleTargetChange,
    handleBackToConversationList,
    handleToggleSidebar,
    threadBeside,
    sideThread,
    setSideThread,
    infoOpen,
    infoDocked,
    setInfoOpen,
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
  // A thread open beside the timeline is the open thread for the brief and its read mark.
  const catchUpUi = useChatCatchUpUi(workspaceId, activeRoomId, activeThreadRootId ?? sideThread?.id ?? null);

  // The sidebar is memoised; hand it references that only move when their
  // meaning does.
  // The message list hands focus back to the composer after reply, thread,
  // cancel and delete.
  const composerRef = useRef<ChatComposerHandle>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  const openFollowUpsRef = useRef(followUpUi.openList);
  openFollowUpsRef.current = followUpUi.openList;
  const openFollowUps = useCallback(() => openFollowUpsRef.current(), []);
  // "Bắt kịp nhanh": open the busiest room, then its brief once it has opened.
  const quickCatchUpRef = useRef<(next: ChatSidebarTarget, roomId: string) => void>(() => undefined);
  quickCatchUpRef.current = (next, roomId) => {
    handleTargetChange(next);
    catchUpUi.requestCatchUp(roomId);
  };
  const quickCatchUp = useCallback((next: ChatSidebarTarget, roomId: string) => quickCatchUpRef.current(next, roomId), []);
  const closeSideThread = useCallback(() => {
    setSideThread(null);
    focusComposer();
  }, [focusComposer, setSideThread]);
  // The info panel and a side thread share the right column: the toggle brings the panel back over a thread.
  const panelShown = infoOpen && !sideThread;
  const togglePanel = useCallback(() => {
    if (sideThread) setSideThread(null);
    setInfoOpen(!panelShown);
  }, [panelShown, setInfoOpen, setSideThread, sideThread]);
  const closePanel = useCallback(() => setInfoOpen(false), [setInfoOpen]);
  const workspaceMemberIds = useMemo(() => props.workspaceMembers.map((member) => member.user_id), [props.workspaceMembers]);
  const channelMemberIds = useMemo(() => Object.keys(props.groupMemberProfiles), [props.groupMemberProfiles]);

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

  const showListToggleInFrame = sidebarCollapsed && (showLoading || !activeRoomId);
  // With a room open the strips sit under its header (canvas); without one, at the top of the pane.
  const roomOpen = Boolean(activeRoomId) && !showLoading;
  const notices = (
    <>
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
    </>
  );
  const blockProps = chatComposerBlockProps(t, { dmBlocked, chatSendMutedByModerator, chatSendRestricted });

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
    <ChatPersonMessageProvider onMessage={messagePerson} onCall={callPerson} roomId={activeRoomId}>
      <ChatPageContentDialogs
        {...props}
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
              : "lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[23.75rem_minmax(0,1fr)]",
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
              onOpenFollowUps={openFollowUps}
              onQuickCatchUp={catchUpUi.enabled ? quickCatchUp : undefined}
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
              memberAvatarByUserId={memberAvatarByUserId}
              knownPeople={nameContext}
              onCollapse={handleToggleSidebar}
              embedded
            />
          </div>

          <div
            ref={conversationRef}
            className={cn(
              "relative min-h-0 min-w-0 overflow-hidden bg-background",
              showMobileChat ? "flex flex-1" : "hidden",
              "lg:flex lg:flex-1",
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showListToggleInFrame ? <ChatFrameListToggle t={t} onShowList={handleToggleSidebar} /> : null}
              {roomOpen ? null : notices}
              {showLoading ? (
                <ChatConversationSkeleton />
              ) : activeRoomId ? (
                <ChatPageConversation
                  props={props}
                  activeRoomId={activeRoomId}
                  catchUp={catchUpUi}
                  onFollowUp={followUpUi.onFollowUp}
                  sidebarCollapsed={sidebarCollapsed}
                  onBack={handleBackToConversationList}
                  onToggleSidebar={handleToggleSidebar}
                  onAttachAction={handleAttachAction}
                  composerRef={composerRef}
                  focusComposer={focusComposer}
                  onOpenSideThread={threadBeside ? setSideThread : undefined}
                  sideThreadRootId={sideThread?.id ?? null}
                  panelOpen={panelShown}
                  onTogglePanel={togglePanel}
                  workspaceMemberIds={workspaceMemberIds}
                  channelMemberIds={channelMemberIds}
                  notices={notices}
                />
              ) : (
                <ChatPageEmptyConversation
                  t={t}
                  listHidden={sidebarCollapsed}
                  onShowList={handleToggleSidebar}
                  onBackToList={handleBackToConversationList}
                />
              )}
            </div>
            {sideThread && activeRoomId && !showLoading ? (
              <ChatThreadSidePanel
                key={sideThread.id}
                workspaceId={workspaceId}
                roomId={activeRoomId}
                root={sideThread}
                roomTitle={headerTitle}
                currentUserId={currentUserId}
                nameContext={nameContext}
                canPinMessages={canPinMessages}
                canModerate={canModerate}
                canSendMessages={!dmBlocked && !chatSendRestricted}
                onFollowUp={followUpUi.onFollowUp}
                onClose={closeSideThread}
                draftKey={`${composerDraftKey}:thread:${sideThread.id}`}
                onSendReply={onSendThreadReply}
                onSendMedia={onSendThreadMedia}
                composerDisabled={dmBlocked || chatSendRestricted}
                readOnlyReason={blockProps.readOnlyReason}
                readOnlyPlaceholder={blockProps.placeholder}
                mentionCandidates={mentionCandidates}
                memberAvatarByUserId={memberAvatarByUserId}
              />
            ) : panelShown && activeRoomId && !showLoading ? (
              <ChatPageInfoPanel
                props={props}
                roomId={activeRoomId}
                docked={infoDocked}
                onClose={closePanel}
                workspaceMemberIds={workspaceMemberIds}
                channelMemberIds={channelMemberIds}
                onCatchUp={catchUpUi.onCatchUp}
                catchUpDisabled={catchUpUi.loading}
                onOpenRecordings={target.kind === "workspace" ? undefined : () => setRecordingsOpen(true)}
              />
            ) : null}
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
    </ChatPersonMessageProvider>
  );
}
