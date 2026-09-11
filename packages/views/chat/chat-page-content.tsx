"use client";

import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { ChatComposer, type ComposerAttachAction } from "./chat-composer";
import { toggleComposerPriority } from "@uniwork/core/chat/composer-priority";
import { DmChatToolbar } from "./dm-settings-sheet";
import { GroupChatToolbar } from "./group-settings-sheet";
import { WorkspaceChatToolbar } from "./workspace-settings-sheet";
import type { ChatSidebarTarget } from "./chat-sidebar";
import { ChatSidebar } from "./chat-sidebar";
import { NativeChatMessagePanel } from "./native-chat-message-panel";
import { ChatPinnedMessagesBar } from "./chat-pinned-messages-bar";
import { ChatMessageSearchBar } from "./chat-message-search-bar";
import { ChatRealtimeStatusBanner } from "./chat-realtime-status-banner";
import type { ChatMentionCandidate } from "./chat-mention-utils";
import { buildChatMentionCandidates } from "./chat-mention-utils";
import { memberDisplayLabel } from "./workspace-member-picker-utils";
import type { ChatPageContentProps } from "./chat-page-content-props";
import { ChatPageContentDialogs } from "./chat-page-content-dialogs";
import { chatComposerPlaceholder } from "./chat-composer-placeholder";

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
  nicknamesByUserId,
  nameContext,
  replyTo,
  onReplyToChange,
  onActiveThreadRootIdChange,
  draft,
  onDraftChange,
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
  t,
}: ChatPageContentProps) {
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [createReminderOpen, setCreateReminderOpen] = useState(false);
  const [createNoteOpen, setCreateNoteOpen] = useState(false);
  const [mobileListMode, setMobileListMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const showMobileList = mobileListMode || !activeRoomId;
  const showMobileChat = Boolean(activeRoomId) && !mobileListMode;
  const backToListLabel = t("common.back");

  const handleTargetChange = (next: ChatSidebarTarget) => {
    setTarget(next);
    setMobileListMode(false);
  };

  const handleBackToConversationList = () => {
    setMobileListMode(true);
  };

  const handleToggleSidebar = () => {
    setSidebarCollapsed((collapsed) => !collapsed);
  };

  const prevActiveRoomIdRef = useRef<string | null>(activeRoomId);

  useEffect(() => {
    const prev = prevActiveRoomIdRef.current;
    prevActiveRoomIdRef.current = activeRoomId;
    if (!prev && activeRoomId) {
      setMobileListMode(false);
    }
  }, [activeRoomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const keepChatWhenNarrow = () => {
      if (!media.matches && activeRoomId) {
        setMobileListMode(false);
      }
    };
    keepChatWhenNarrow();
    media.addEventListener("change", keepChatWhenNarrow);
    return () => media.removeEventListener("change", keepChatWhenNarrow);
  }, [activeRoomId]);

  useEffect(() => {
    if (!activeRoomId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onMessageSearchOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRoomId, onMessageSearchOpenChange]);

  const mentionCandidates = useMemo(
    (): ChatMentionCandidate[] =>
      buildChatMentionCandidates(
        target.kind,
        currentUserId,
        workspaceMembers,
        groupMemberProfiles,
        memberDisplayLabel,
      ),
    [currentUserId, groupMemberProfiles, target.kind, workspaceMembers],
  );

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
        createPollOpen={createPollOpen}
        onCreatePollOpenChange={setCreatePollOpen}
        createReminderOpen={createReminderOpen}
        onCreateReminderOpenChange={setCreateReminderOpen}
        createNoteOpen={createNoteOpen}
        onCreateNoteOpenChange={setCreateNoteOpen}
      />

      {/* Chat fills the content inset: the message list is the screen here, so
          no centred card and no gutter — the panels reach the shell edges. */}
      <div className="flex h-full min-h-0 w-full flex-1">
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 overflow-hidden bg-surface",
            sidebarCollapsed
              ? "lg:grid lg:grid-cols-[minmax(0,1fr)]"
              : "lg:grid lg:grid-cols-[300px_minmax(0,1fr)]",
          )}
        >
          <div
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
              embedded
            />
          </div>

          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/15",
              showMobileChat ? "flex flex-1" : "hidden",
              "lg:flex lg:flex-1",
            )}
          >
            <ChatRealtimeStatusBanner pendingOutboxCount={pendingOutboxCount} />
            {isWorkspaceError && target.kind === "workspace" ? (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
                <p className="text-caption text-muted-foreground">{t("chat.room_load_failed")}</p>
                <Button type="button" variant="outline" size="sm" onClick={onRefetchWorkspace}>
                  {t("chat.retry")}
                </Button>
              </div>
            ) : null}
            {connectError && (target.kind === "dm" || target.kind === "group" || target.kind === "channel") ? (
              <p className="border-b border-border bg-surface px-4 py-2 text-caption text-muted-foreground">
                {connectError}
              </p>
            ) : null}
            {target.kind === "dm" && dmBlocked ? (
              <p className="border-b border-border bg-surface px-4 py-2 text-caption text-muted-foreground">
                {dmBlockedByMe ? t("chat.block_active_banner") : t("chat.blocked_me_banner")}
              </p>
            ) : null}

            {showLoading ? (
              <div className="flex flex-1 items-center justify-center p-6">
                <CollectionPageState
                  icon={MessageSquare} tone={moduleTone("chat")} title={t("chat.loading")}
                  description={
                    target.kind === "workspace"
                      ? t("chat.group_description")
                      : target.kind === "group"
                        ? t("chat.group_loading")
                        : target.kind === "channel"
                          ? t("chat.channel.loading")
                          : t("chat.dm_hint")
                  }
                />
              </div>
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
                {!messageSearchOpen && target.kind === "workspace" ? (
                  <WorkspaceChatToolbar
                    title={headerTitle}
                    memberCount={workspaceMembers.length}
                    backAriaLabel={backToListLabel}
                    onBack={handleBackToConversationList}
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={handleToggleSidebar}
                    onOpenSettings={() => onWorkspaceSettingsOpenChange(true)}
                    onOpenSearch={() => onMessageSearchOpenChange(true)}
                  />
                ) : null}
                {!messageSearchOpen && target.kind === "group" && activeGroup ? (
                  <GroupChatToolbar
                    title={headerTitle}
                    memberCount={activeGroup.member_user_ids.length + 1}
                    backAriaLabel={backToListLabel}
                    onBack={handleBackToConversationList}
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={handleToggleSidebar}
                    onOpenSettings={() => onGroupSettingsOpenChange(true)}
                    onOpenSearch={() => onMessageSearchOpenChange(true)}
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                    onVideoCall={onVideoCall}
                    videoCallDisabled={videoCallDisabled}
                  />
                ) : null}
                {!messageSearchOpen && target.kind === "channel" && activeChannel ? (
                  <GroupChatToolbar
                    title={headerTitle}
                    memberCount={activeChannel.member_user_ids.length + 1}
                    backAriaLabel={backToListLabel}
                    onBack={handleBackToConversationList}
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={handleToggleSidebar}
                    onOpenSettings={() => onChannelSettingsOpenChange(true)}
                    onOpenSearch={() => onMessageSearchOpenChange(true)}
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                    onVideoCall={onVideoCall}
                    videoCallDisabled={videoCallDisabled}
                  />
                ) : null}
                {!messageSearchOpen && target.kind === "dm" && activeContact ? (
                  <DmChatToolbar
                    contact={
                      contacts.find((entry) => entry.user_id === activeContact.user_id) ??
                      activeContact
                    }
                    nicknamesByUserId={nicknamesByUserId}
                    backAriaLabel={backToListLabel}
                    onBack={handleBackToConversationList}
                    sidebarCollapsed={sidebarCollapsed}
                    onToggleSidebar={handleToggleSidebar}
                    onOpenSettings={() => onDmSettingsOpenChange(true)}
                    onOpenSearch={() => onMessageSearchOpenChange(true)}
                    onVoiceCall={onVoiceCall}
                    voiceCallDisabled={voiceCallDisabled}
                    onVideoCall={onVideoCall}
                    videoCallDisabled={videoCallDisabled}
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
                  emptyLabel={
                    target.kind === "workspace"
                      ? t("chat.group_description")
                      : target.kind === "group"
                        ? t("chat.group_empty", { name: headerTitle })
                        : target.kind === "channel"
                          ? t("chat.channel.empty_thread", { name: headerTitle })
                          : target.kind === "dm"
                            ? t("chat.dm_empty", {
                                name: displayLabelForChatContact(target.contact, nicknamesByUserId),
                              })
                            : t("chat.empty_description")
                  }
                  replyTo={replyTo}
                  onReplyToChange={onReplyToChange}
                  workHubEnabled={workHubEnabled}
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
                />

                <ChatComposer
                  workspaceId={workspaceId}
                  draft={draft}
                  onDraftChange={onDraftChange}
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
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MessageSquare className="size-8" aria-hidden />
                </span>
                <p className="text-body font-medium text-foreground">{t("chat.contacts_title")}</p>
                <p className="max-w-sm text-caption text-muted-foreground">{t("chat.contacts_hint")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
